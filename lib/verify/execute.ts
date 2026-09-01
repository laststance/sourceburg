import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { ProbeRequest, ProbeResult, ProbeSpec } from './probe'

const run = promisify(execFile)

/*
 * The I/O half. Two properties matter more than anything else here.
 *
 * 1. Every command goes through `execFile(cmd, argv)`. `path` and `atSha` are
 *    model-authored and reach this file before anything about them is trusted, so
 *    a template literal into a shell would hand a crafted fact-set a command line.
 *    It also removes an unrelated hazard: `sha^{commit}` contains `^` and `{}`,
 *    both metacharacters in fish, so a shell round-trip breaks on benign input.
 * 2. A failure is classified, never collapsed. "The fact is wrong" and "our
 *    environment is broken" are different answers, and only the first is the
 *    collector's problem.
 */

/**
 * stderr fragments that mean THE FACT IS WRONG. Held as literals, and asserted in
 * the tests, so a git or gh release that rewords one turns a test red instead of
 * silently reclassifying a fabricated SHA as a transient blip in production.
 */
const ABSENT_MARKERS = [
  'Not a valid object name',
  'does not exist in',
  'expected commit type',
  'unknown revision or path not in the working tree',
  'HTTP 404',
  'Not Found',
] as const

/**
 * stderr fragments that mean OUR SIDE IS BROKEN. Not strictly needed, since
 * anything unrecognized already defaults to INDETERMINATE, but naming them keeps
 * the common cases greppable in a log.
 */
const TRANSIENT_MARKERS = [
  'cannot change to',
  'not a git repository',
  'HTTP 403',
  'rate limit',
  'HTTP 500',
  'HTTP 502',
  'HTTP 503',
  'timed out',
  'ETIMEDOUT',
  'ECONNRESET',
  'ENOTFOUND',
] as const

/**
 * Classifies a failed command. Default is INDETERMINATE, not FAIL: an unrecognized
 * error says nothing about the fact, and both verdicts block publication anyway,
 * so the default costs diagnosis rather than safety.
 *
 * @param stderr - the failed command's stderr
 * @returns `'absent'` when the fact itself is wrong, `'error'` otherwise
 * @example classifyFailure('fatal: Not a valid object name deadbeef') // => 'absent'
 */
export function classifyFailure(stderr: string): 'absent' | 'error' {
  if (ABSENT_MARKERS.some((marker) => stderr.includes(marker))) return 'absent'
  return 'error'
}

/** True when a failure is worth retrying; an `absent` verdict never is. */
export function isRetryable(stderr: string): boolean {
  return classifyFailure(stderr) === 'error' && TRANSIENT_MARKERS.some((m) => stderr.includes(m))
}

export type ExecuteOptions = {
  /** The local clone every git probe runs inside. Never rendered, never committed. */
  repoDir: string
  timeoutMs?: number
  maxAttempts?: number
  /** Results already known. Only non-transient verdicts are ever added to it. */
  cache?: Map<string, ProbeResult>
}

/** The exact argv for a probe. Exported so a test can assert no shell string is built. */
export function commandFor(spec: ProbeSpec, repoDir: string): { file: string; args: string[] } {
  switch (spec.kind) {
    case 'gitCommitDate':
      // `^{commit}` peels and asserts the type in one call, so a blob sha fails here.
      return { file: 'git', args: ['-C', repoDir, 'show', '-s', '--format=%cI', `${spec.sha}^{commit}`] }
    case 'gitBlob':
      // The BLOB form of `git show`. `git show <sha>` would print a commit header
      // carrying author email addresses, which are on the never-rendered list.
      return { file: 'git', args: ['-C', repoDir, 'show', `${spec.sha}:${spec.path}`] }
    case 'gitDiff':
      return { file: 'git', args: ['-C', repoDir, 'diff', spec.beforeSha, spec.afterSha, '--', spec.path] }
    case 'ghIssue':
      return { file: 'gh', args: ['api', `repos/${spec.repo}/issues/${spec.number}`] }
    case 'ghComment':
      return { file: 'gh', args: ['api', `repos/${spec.repo}/issues/comments/${spec.commentId}`] }
  }
}

/**
 * Runs every probe, classifying each failure. Retries only transient ones, with a
 * bounded attempt count so an unrecognized permanent error cannot spin forever.
 *
 * @param requests - what {@link plan} produced
 * @param options - clone directory, timeout, attempt cap, and an optional cache
 * @returns one result per request, in the order requested
 * @example (await execute(plan(incident), { repoDir })).every((p) => p.status === 'ok')
 */
export async function execute(
  requests: readonly ProbeRequest[],
  options: ExecuteOptions,
): Promise<ProbeResult[]> {
  const { repoDir, timeoutMs = 20_000, maxAttempts = 3, cache } = options
  const results: ProbeResult[] = []

  for (const request of requests) {
    const cached = cache?.get(request.id)
    if (cached) {
      results.push(cached)
      continue
    }
    const result = await runOne(request, repoDir, timeoutMs, maxAttempts)
    // A transient failure is NEVER cached: caching one would freeze a single
    // timeout into a permanent verdict for the rest of the run.
    if (cache && result.status !== 'error') cache.set(request.id, result)
    results.push(result)
  }

  return results
}

async function runOne(
  request: ProbeRequest,
  repoDir: string,
  timeoutMs: number,
  maxAttempts: number,
): Promise<ProbeResult> {
  const { file, args } = commandFor(request, repoDir)
  let lastDetail = 'no attempt was made'

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { stdout } = await run(file, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 })
      return { id: request.id, status: 'ok', stdout }
    } catch (thrown) {
      const stderr = stderrOf(thrown)
      lastDetail = stderr.trim().split('\n')[0] ?? 'command failed with no output'
      if (classifyFailure(stderr) === 'absent') {
        return { id: request.id, status: 'absent', detail: lastDetail }
      }
      if (!isRetryable(stderr) || attempt === maxAttempts) break
      // Exponential backoff, so a rate limit is given time to clear.
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
    }
  }

  return { id: request.id, status: 'error', detail: lastDetail }
}

/** Pulls stderr off whatever execFile rejected with, without asserting its type. */
function stderrOf(thrown: unknown): string {
  if (typeof thrown !== 'object' || thrown === null) return String(thrown)
  const candidate = thrown as { stderr?: unknown; message?: unknown }
  if (typeof candidate.stderr === 'string' && candidate.stderr.length > 0) return candidate.stderr
  return typeof candidate.message === 'string' ? candidate.message : String(thrown)
}
