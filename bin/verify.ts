#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'

import { incidentDir, publish, readManifest } from '../lib/publish'
import { Article, Incident } from '../lib/schema'
import { execute } from '../lib/verify/execute'
import { plan } from '../lib/verify/plan'
import { preflight } from '../lib/verify/preflight'
import { exitCodeFor } from '../lib/verify/result'
import { verify } from '../lib/verify/verify'

/*
 * The verifier as a command. Exit codes are the whole interface: 0 publishes, 1
 * means a fact is wrong and CI must never retry, 2 means we could not tell and CI
 * may. A run that printed "failed" and exited 0 would make "reporting" a lie.
 *
 * `--publish` lives HERE rather than in a `bin/publish.ts` of its own. A separate
 * command could be run without this one, and then the exit code above would be
 * advice instead of a gate; from inside the same process, an unverified article
 * has no path to `content/`.
 */

function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i === -1 ? undefined : process.argv[i + 1]
}

async function main(): Promise<number> {
  const incidentPath = argOf('--incident')
  const articlePath = argOf('--article')
  const repoDir = argOf('--repo-dir')

  if (!incidentPath || !articlePath || !repoDir) {
    process.stderr.write('usage: verify --incident <f> --article <f> --repo-dir <dir> [--content-dir <dir>]\n')
    return 2
  }

  const incident = Incident.parse(JSON.parse(await readFile(incidentPath, 'utf8')))
  const article = Article.parse(JSON.parse(await readFile(articlePath, 'utf8')))
  // The prior publication is READ FROM THE PUBLISHED TREE, not from a file named
  // on the command line. The rules below refuse a moved `publishedAt` and a
  // changed identity; feeding them a hand-written file would let the run being
  // checked also supply the record it is checked against.
  const contentDir = argOf('--content-dir')
  const previous = contentDir ? await readManifest(incidentDir(contentDir, incident.id)) : null

  /** Reports one result the same way whether it came from preflight or from verify. */
  const report = (result: { verdict: string; findings: { verdict: string; rule: string; detail: string }[] }, probeCount: number) => {
    for (const finding of result.findings) {
      process.stdout.write(`${finding.verdict}  ${finding.rule}\n        ${finding.detail}\n`)
    }
    process.stdout.write(`${result.verdict} (${probeCount} probes, ${result.findings.length} findings)\n`)
  }

  // Preflight runs BEFORE any fact is probed. A shallow clone or a mismatched
  // origin makes every probe below it meaningless, so reporting them together
  // would bury the one finding that explains the rest.
  const clone = await preflight(incident, repoDir)
  if (clone.verdict !== 'PASS') {
    report(clone, 0)
    return exitCodeFor(clone.verdict)
  }

  const requests = plan(incident)
  const probes = await execute(requests, { repoDir, cache: new Map() })
  const result = verify(incident, article, previous, probes)

  report(result, requests.length)
  if (result.verdict !== 'PASS') return exitCodeFor(result.verdict)

  if (process.argv.includes('--publish')) {
    if (contentDir === undefined) {
      process.stderr.write('--publish needs --content-dir\n')
      return 2
    }
    // `updatedAt` is stamped here, not taken from the article: the writer decides
    // what the story says, the pipeline decides when a version became live.
    const manifest = await publish(incident, article, { contentDir, updatedAt: new Date().toISOString() })
    process.stdout.write(`published ${incident.id} version ${manifest.version}\n`)
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // A crash is not a verdict. Exit 2, never 0 and never 1: we did not find a
    // wrong fact, we failed to look.
    process.stderr.write(`verify crashed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  },
)
