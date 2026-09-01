#!/usr/bin/env tsx
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { parseCodeArg, resolveSha } from '../lib/collect'
import { parseFactRef } from '../lib/facts'
import { incidentDir } from '../lib/publish'
import { Incident } from '../lib/schema'
import { execute } from '../lib/verify/execute'
import { materialize } from '../lib/verify/materialize'
import { parseRemote } from '../lib/verify/preflight'
import { probeId } from '../lib/verify/probe'
import { containsEmail } from '../lib/verify/verify'

import type { QuoteDraft } from '../lib/verify/materialize'
import type { ProbeRequest, ProbeResult, ProbeSpec } from '../lib/verify/probe'

/*
 * The manual collector. Its arguments say WHICH facts to gather; they never say
 * what the facts are.
 *
 * The only argument-supplied content that survives into the fact-set is `--id`,
 * `--reason`, the `--quote` excerpts, and the `--revealed` prose — an id, an
 * editorial judgment, a choice of which sentence to quote, and a claim about
 * what an event revealed. Every date, subject, hash, comment body, code line,
 * and diff hunk is fetched. `bin/collect.test.ts` asserts that mechanically —
 * for a hand-maintained list of fields, so a `--committed-at` flag for one of
 * THOSE cannot be added quietly. A field added to {@link Incident} later is not
 * covered until someone adds it to that list too.
 *
 * Every fetch goes through {@link execute}, the same layer the verifier uses, so
 * collection and verification share one command construction. A fact gathered by
 * `git show <sha>:<path>` and checked by something subtly different would verify
 * against the wrong bytes.
 *
 * Three calls sit OUTSIDE that vocabulary, all deliberately:
 *
 * 1. {@link resolveSha} — resolution is argument normalization, not a fact, and
 *    it runs before any fact is fetched. See `lib/collect.ts`.
 * 2. `git remote get-url origin` and `git show -s --format=%s` — the repo name
 *    and the commit subjects. `%s` prints the subject alone, never the commit
 *    header, which is where the author email addresses live.
 * 3. `gh api repos/{nwo}` — the default branch and the SPDX license. There is no
 *    probe kind for repo metadata and adding one that {@link plan} never emits
 *    would be dead vocabulary. The cost is recorded: `spdxLicense` is currently
 *    an unverified fact (TODOS #5).
 */

const run = promisify(execFile)

/** Every value given for a repeatable flag, in the order typed. */
function argsOf(flag: string): string[] {
  const values: string[] = []
  process.argv.forEach((token, i) => {
    if (token === flag && process.argv[i + 1] !== undefined) values.push(process.argv[i + 1])
  })
  return values
}

function argOf(flag: string): string | undefined {
  return argsOf(flag)[0]
}

/** Splits `<ref>=<text>` at the FIRST `=`, since prose routinely contains one. */
function splitAssignment(flag: string, raw: string): { ref: string; text: string } {
  const at = raw.indexOf('=')
  if (at === -1) throw new Error(`${flag} ${raw} is not <ref>=<text>`)
  return { ref: raw.slice(0, at), text: raw.slice(at + 1) }
}

/** A probe request built by hand; `covers` is empty because nothing is being verified yet. */
function request(spec: ProbeSpec): ProbeRequest {
  return { ...spec, id: probeId(spec), covers: [] }
}

/** The stdout of a probe that had to succeed, or a message naming what could not be fetched. */
function stdoutOf(probes: readonly ProbeResult[], spec: ProbeSpec, label: string): string {
  const probe = probes.find((candidate) => candidate.id === probeId(spec))
  if (probe === undefined || probe.status !== 'ok') {
    throw new Error(`could not fetch ${label}: ${probe?.status === 'absent' ? probe.detail : (probe?.detail ?? 'no result')}`)
  }
  return probe.stdout
}

async function main(): Promise<number> {
  const repoDir = argOf('--repo-dir')
  const id = argOf('--id')
  const reason = argOf('--reason')
  const anchorArg = argOf('--anchor-sha')
  const out = argOf('--out')

  if (!repoDir || !id || !reason || !anchorArg || !out) {
    process.stderr.write(
      'usage: collect --repo-dir <dir> --id <slug> --reason <text> --anchor-sha <rev> --out <file>\n' +
        '               [--commit <rev>]... [--code <rev>:<path>:<a>-<b>]...\n' +
        '               [--discussion discussion:<n>]... [--quote discussion:<n>#<id>=<excerpt>]...\n' +
        '               [--diff <rev>..<rev>:<path>] [--revealed <ref>=<what>]... [--content-dir <dir>]\n',
    )
    return 2
  }

  // ---- resolve every revision before any fact is fetched ---------------------

  const anchorSha = await resolveSha(repoDir, anchorArg)
  // The anchor leads, then the rest, deduped like `discussionNumbers` below:
  // `--commit <anchor>` (or the same commit under a tag and a sha) is a natural
  // thing to type, and a repeat would print the same timeline row twice.
  const commitShas = [anchorSha, ...(await Promise.all(argsOf('--commit').map((rev) => resolveSha(repoDir, rev))))]
    .filter((sha, i, all) => all.indexOf(sha) === i)
  const codeSpecs = await Promise.all(argsOf('--code').map((spec) => parseCodeArg(repoDir, spec)))

  const diffArg = argOf('--diff')
  let diffSpec: { beforeSha: string; afterSha: string; path: string } | null = null
  if (diffArg !== undefined) {
    const match = /^(.+)\.\.(.+?):(.+)$/.exec(diffArg)
    if (!match) throw new Error(`--diff ${diffArg} is not <rev>..<rev>:<path>`)
    diffSpec = {
      beforeSha: await resolveSha(repoDir, match[1]),
      afterSha: await resolveSha(repoDir, match[2]),
      path: match[3],
    }
  }

  // ---- what the repo says about itself ---------------------------------------

  // `nameWithOwner` comes from the clone's own origin, so it cannot be mistyped.
  // That does make preflight's origin check tautological for a freshly collected
  // incident, which is fine: preflight defends the later run, where somebody
  // verifies a committed fact-set against a clone that may be a fork.
  const originUrl = (await run('git', ['-C', repoDir, 'remote', 'get-url', 'origin'])).stdout
  const nameWithOwner = parseRemote(originUrl)
  if (nameWithOwner === null) throw new Error(`origin (${originUrl.trim()}) is not a GitHub repo`)

  const repoRecord = JSON.parse((await run('gh', ['api', `repos/${nameWithOwner}`], { maxBuffer: 1 << 24 })).stdout) as {
    default_branch?: unknown
    license?: { spdx_id?: unknown } | null
  }
  const defaultBranch = typeof repoRecord.default_branch === 'string' ? repoRecord.default_branch : ''
  const spdxLicense = typeof repoRecord.license?.spdx_id === 'string' ? repoRecord.license.spdx_id : ''

  // ---- what to fetch ---------------------------------------------------------

  const quoteDrafts: (QuoteDraft & { number: number })[] = argsOf('--quote').map((raw) => {
    const { ref, text } = splitAssignment('--quote', raw)
    const parsed = parseFactRef(ref)
    if (parsed?.kind !== 'discussion' || parsed.commentId === undefined) {
      throw new Error(`--quote ${ref} is not discussion:<number>#<commentId>`)
    }
    return { number: parsed.number, commentId: parsed.commentId, excerpt: text }
  })

  const revealedDrafts = argsOf('--revealed').map((raw) => {
    const { ref, text } = splitAssignment('--revealed', raw)
    const parsed = parseFactRef(ref)
    if (parsed === null || (parsed.kind !== 'commit' && parsed.kind !== 'discussion')) {
      throw new Error(`--revealed ${ref} must be commit:<sha> or discussion:<number>[#<commentId>]`)
    }
    return { evidence: parsed, what: text }
  })

  // Explicit threads first, then any thread a quote implies but nobody listed.
  const discussionNumbers = [...argsOf('--discussion'), ...quoteDrafts.map((draft) => `discussion:${draft.number}`)]
    .map((ref) => {
      const parsed = parseFactRef(ref)
      if (parsed?.kind !== 'discussion') throw new Error(`--discussion ${ref} is not discussion:<number>`)
      return parsed.number
    })
    .filter((number, i, all) => all.indexOf(number) === i)

  const specs: ProbeSpec[] = [
    ...commitShas.map((sha): ProbeSpec => ({ kind: 'gitCommitDate', sha })),
    ...codeSpecs.flatMap((spec): ProbeSpec[] => [
      { kind: 'gitCommitDate', sha: spec.atSha },
      { kind: 'gitBlob', sha: spec.atSha, path: spec.path },
    ]),
    ...(diffSpec ? [{ kind: 'gitDiff' as const, ...diffSpec }] : []),
    ...discussionNumbers.map((number): ProbeSpec => ({ kind: 'ghIssue', repo: nameWithOwner, number })),
    ...quoteDrafts.map((draft): ProbeSpec => ({ kind: 'ghComment', repo: nameWithOwner, commentId: draft.commentId })),
    // The aftermath's own date comes from its own evidence, never from an argument.
    ...revealedDrafts.map((draft): ProbeSpec => {
      if (draft.evidence.kind === 'commit') return { kind: 'gitCommitDate', sha: draft.evidence.sha }
      return draft.evidence.commentId === undefined
        ? { kind: 'ghIssue', repo: nameWithOwner, number: draft.evidence.number }
        : { kind: 'ghComment', repo: nameWithOwner, commentId: draft.evidence.commentId }
    }),
  ]

  // Deduplicated by content-addressed id, so an anchor that is also a code quote's
  // sha, or a comment that is both quoted and cited as aftermath, costs one fetch.
  const requests = [...new Map(specs.map((spec) => [probeId(spec), request(spec)])).values()]
  const probes = await execute(requests, { repoDir, cache: new Map() })

  // ---- assemble --------------------------------------------------------------

  const fetchedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const committedAt = (sha: string) => stdoutOf(probes, { kind: 'gitCommitDate', sha }, `the date of ${sha.slice(0, 8)}`).trim()

  const contentDir = argOf('--content-dir') ?? 'content'
  const cacheDir = join(incidentDir(contentDir, id), 'cache')
  const { pinned, rejected } = await materialize(quoteDrafts, probes, { cacheDir, fetchedAt, repo: nameWithOwner })
  if (rejected.length > 0) {
    for (const failure of rejected) {
      process.stderr.write(`REFUSED comment ${failure.commentId}: ${failure.reason}\n`)
    }
    return 1
  }

  const subjects = await Promise.all(
    commitShas.map(async (sha) => (await run('git', ['-C', repoDir, 'show', '-s', '--format=%s', `${sha}^{commit}`])).stdout.trim()),
  )

  const codeQuotes = codeSpecs.map((spec) => {
    const blob = stdoutOf(probes, { kind: 'gitBlob', sha: spec.atSha, path: spec.path }, `${spec.path} at ${spec.atSha.slice(0, 8)}`)
    return {
      path: spec.path,
      atSha: spec.atSha,
      atShaCommittedAt: committedAt(spec.atSha),
      startLine: spec.startLine,
      endLine: spec.endLine,
      text: blob.split('\n').slice(spec.startLine - 1, spec.endLine).join('\n'),
    }
  })

  /*
   * The email rule fires HERE as well as in the verifier. Both stages need it for
   * different reasons: the verifier refuses to publish, but the collector is what
   * WRITES the excerpt into a committed artifact, and a FAIL that arrives after
   * the address is already in git history is a correction, not a prevention.
   * Same predicate, one stage earlier — not a second copy of the rule.
   */
  for (const quote of codeQuotes) {
    if (containsEmail(quote.text)) {
      process.stderr.write(`REFUSED ${quote.path}:${quote.startLine}-${quote.endLine}: the excerpt carries an email address\n`)
      return 1
    }
  }
  for (const quote of pinned) {
    if (containsEmail(quote.excerpt)) {
      process.stderr.write(`REFUSED comment ${quote.commentId}: the excerpt carries an email address\n`)
      return 1
    }
  }

  const discussions = discussionNumbers.map((number) => {
    const payload = JSON.parse(stdoutOf(probes, { kind: 'ghIssue', repo: nameWithOwner, number }, `issue #${number}`)) as {
      created_at?: unknown
      pull_request?: unknown
    }
    if (typeof payload.created_at !== 'string') throw new Error(`#${number} came back without a created_at`)
    return {
      // A thread is a PR exactly when the issues API attaches a `pull_request` key.
      kind: payload.pull_request === undefined ? ('issue' as const) : ('pr' as const),
      number,
      createdAt: payload.created_at,
      quotes: pinned
        .filter((quote) => quoteDrafts.some((draft) => draft.commentId === quote.commentId && draft.number === number))
        .map(({ excerpt, bodyHash, offset, author, commentId, createdAt }) => ({
          excerpt,
          bodyHash,
          offset,
          author,
          commentId,
          createdAt,
          fetchedAt,
        })),
    }
  })

  const revealedLater = revealedDrafts.map((draft) => {
    if (draft.evidence.kind === 'commit') {
      return { at: committedAt(draft.evidence.sha), what: draft.what, evidence: draft.evidence }
    }
    const spec: ProbeSpec =
      draft.evidence.commentId === undefined
        ? { kind: 'ghIssue', repo: nameWithOwner, number: draft.evidence.number }
        : { kind: 'ghComment', repo: nameWithOwner, commentId: draft.evidence.commentId }
    const payload = JSON.parse(stdoutOf(probes, spec, `the revelation's evidence`)) as { created_at?: unknown }
    if (typeof payload.created_at !== 'string') throw new Error('the revelation evidence came back without a created_at')
    // `parseFactRef` omits `commentId` rather than setting it undefined, which is
    // what keeps the minted `revealed:` id the same as a hand-written one.
    return { at: payload.created_at, what: draft.what, evidence: draft.evidence }
  })

  const incident = Incident.parse({
    id,
    signal: 'git-trace',
    selection: { kind: 'manual', reason },
    repo: { nameWithOwner, defaultBranch, spdxLicense },
    anchorSha,
    knownAt: committedAt(anchorSha),
    commits: commitShas.map((sha, i) => ({ sha, committedAt: committedAt(sha), subject: subjects[i] })),
    discussions,
    codeQuotes,
    diff: diffSpec === null ? null : { ...diffSpec, hunk: stdoutOf(probes, { kind: 'gitDiff', ...diffSpec }, `the diff of ${diffSpec.path}`) },
    revealedLater,
  })

  await mkdir(join(out, '..'), { recursive: true }).catch(() => undefined)
  await writeFile(out, `${JSON.stringify(incident, null, 2)}\n`, 'utf8')
  process.stdout.write(
    `collected ${incident.id}: knownAt ${incident.knownAt}, ${requests.length} fetches, ` +
      `${incident.commits.length} commits, ${pinned.length} quotes, ${incident.codeQuotes.length} code excerpts\n`,
  )
  return 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(`collect failed: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  },
)
