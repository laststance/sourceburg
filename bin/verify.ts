#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'

import { Article, Incident } from '../lib/schema'
import { execute } from '../lib/verify/execute'
import { plan } from '../lib/verify/plan'
import { exitCodeFor } from '../lib/verify/result'
import { verify } from '../lib/verify/verify'

import type { PreviouslyPublished } from '../lib/verify/plan'

/*
 * The verifier as a command. Exit codes are the whole interface: 0 publishes, 1
 * means a fact is wrong and CI must never retry, 2 means we could not tell and CI
 * may. A run that printed "failed" and exited 0 would make "reporting" a lie.
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
    process.stderr.write('usage: verify --incident <f> --article <f> --repo-dir <dir> [--previous <f>]\n')
    return 2
  }

  const incident = Incident.parse(JSON.parse(await readFile(incidentPath, 'utf8')))
  const article = Article.parse(JSON.parse(await readFile(articlePath, 'utf8')))
  const previousPath = argOf('--previous')
  const previous: PreviouslyPublished | null = previousPath
    ? (JSON.parse(await readFile(previousPath, 'utf8')) as PreviouslyPublished)
    : null

  const requests = plan(incident)
  const probes = await execute(requests, { repoDir, cache: new Map() })
  const result = verify(incident, article, previous, probes)

  for (const finding of result.findings) {
    process.stdout.write(`${finding.verdict}  ${finding.rule}\n        ${finding.detail}\n`)
  }
  process.stdout.write(`${result.verdict} (${requests.length} probes, ${result.findings.length} findings)\n`)
  return exitCodeFor(result.verdict)
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
