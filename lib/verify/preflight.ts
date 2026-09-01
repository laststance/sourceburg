import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { plan } from './plan'
import { resultOf } from './result'

import type { Incident } from '../schema'
import type { Finding, Result } from './result'

const run = promisify(execFile)

/*
 * Environment checks that run BEFORE any fact is probed, because two of them
 * decide whether the fact probes mean anything at all.
 *
 * The checks are a chain, not a set. Each one gates the next:
 *
 *   1. `origin/{defaultBranch}` exists  — without it nothing below can run
 *   2. the clone is not shallow         — a shallow clone hides the history
 *   3. `origin` IS the target repo      — see below
 *   4. every sha is upstream            — meaningful only once 3 has passed
 *
 * Step 3 short-circuiting step 4 is the whole point. `origin/master` is a local
 * ref naming whatever `origin` happens to be; if `origin` is a fork, a fork-only
 * commit IS an ancestor of it, and step 4 would report PASS on precisely the case
 * it exists to catch. Aggregating 3 and 4 side by side would produce a run where
 * the fork finding and a spurious sha PASS appear together.
 *
 * Step 1 also disambiguates a later exit 128: once the branch ref is known to
 * exist, `merge-base` can only be complaining about the sha.
 */

/** Owner/name parsed out of a git remote URL, or null when the remote is not GitHub. */
export function parseRemote(url: string): string | null {
  const trimmed = url.trim().replace(/\.git$/, '')
  // Both forms GitHub hands out. `ssh://git@github.com/o/n` is the third, and the
  // HTTPS branch matches it because only the scheme differs.
  const ssh = /^git@github\.com:([\w.-]+)\/([\w.-]+)$/.exec(trimmed)
  if (ssh) return `${ssh[1]}/${ssh[2]}`
  const web = /^(?:https?|ssh):\/\/(?:[^@/]+@)?github\.com\/([\w.-]+)\/([\w.-]+)$/.exec(trimmed)
  if (web) return `${web[1]}/${web[2]}`
  return null
}

/** Every sha the fact-set references, taken from {@link plan} so there is one enumeration. */
export function shasOf(incident: Incident): string[] {
  const shas = new Set<string>()
  for (const request of plan(incident)) {
    switch (request.kind) {
      case 'gitCommitDate':
      case 'gitBlob':
        shas.add(request.sha)
        break
      case 'gitDiff':
        shas.add(request.beforeSha)
        shas.add(request.afterSha)
        break
      default:
        break
    }
  }
  return [...shas]
}

type GitOutcome = { ok: true; stdout: string } | { ok: false; code: number; stderr: string }

/** One git call with no shell. Never throws: the exit code is the answer here. */
async function git(repoDir: string, args: string[]): Promise<GitOutcome> {
  try {
    const { stdout } = await run('git', ['-C', repoDir, ...args], { timeout: 30_000 })
    return { ok: true, stdout }
  } catch (error: unknown) {
    const e = error as { code?: unknown; stderr?: unknown }
    return {
      ok: false,
      code: typeof e.code === 'number' ? e.code : -1,
      stderr: typeof e.stderr === 'string' ? e.stderr : String(error),
    }
  }
}

const fail = (rule: string, detail: string): Finding => ({ verdict: 'FAIL', rule, detail })
const inconclusive = (rule: string, detail: string): Finding => ({
  verdict: 'INDETERMINATE',
  rule,
  detail,
})

/**
 * Refuses a clone that cannot support verification, before a single fact is probed.
 *
 * @param incident - the fact-set whose repo and shas are being checked
 * @param repoDir - the local clone; runtime context, never committed
 * @returns PASS when the clone can be trusted, else the first failing link in the chain
 * @example (await preflight(incident, '/tmp/shallow')).verdict // => 'FAIL'
 */
export async function preflight(incident: Incident, repoDir: string): Promise<Result> {
  const branch = `origin/${incident.repo.defaultBranch}`

  const branchRule = 'the default branch is fetched'
  const branchRef = await git(repoDir, ['rev-parse', '--verify', `${branch}^{commit}`])
  if (!branchRef.ok) {
    // Not a FAIL: an unfetched branch says nothing about the facts, only that we
    // are in no position to check them.
    return resultOf([
      inconclusive(branchRule, `${branch} does not resolve in ${repoDir}; fetch it and re-run`),
    ])
  }

  const shallowRule = 'the clone is not shallow'
  const shallow = await git(repoDir, ['rev-parse', '--is-shallow-repository'])
  if (!shallow.ok) return resultOf([inconclusive(shallowRule, shallow.stderr.trim())])
  if (shallow.stdout.trim() !== 'false') {
    return resultOf([
      fail(shallowRule, 'a shallow clone hides the history every ancestry check depends on'),
    ])
  }

  const originRule = 'origin is the repo the fact-set names'
  const remote = await git(repoDir, ['remote', 'get-url', 'origin'])
  if (!remote.ok) return resultOf([inconclusive(originRule, remote.stderr.trim())])
  const actual = parseRemote(remote.stdout)
  if (actual === null) {
    return resultOf([fail(originRule, 'origin does not parse as a GitHub owner/name')])
  }
  if (actual !== incident.repo.nameWithOwner) {
    return resultOf([
      fail(originRule, `the fact-set names ${incident.repo.nameWithOwner}, origin is ${actual}`),
    ])
  }

  const upstreamRule = 'every sha is reachable from the default branch'
  const findings: Finding[] = []
  for (const sha of shasOf(incident)) {
    const ancestry = await git(repoDir, ['merge-base', '--is-ancestor', sha, branch])
    if (ancestry.ok) continue
    if (ancestry.code === 1) {
      // The object is here but not on the published branch: a fork commit, an
      // unmerged PR head, or a local commit. All three would let the article cite
      // history no reader can reach.
      findings.push(fail(upstreamRule, `${sha.slice(0, 8)} exists locally but is not an ancestor of ${branch}`))
      continue
    }
    // The branch ref was verified above, so a non-1 exit is about the sha itself.
    findings.push(fail(upstreamRule, `${sha.slice(0, 8)} does not resolve: ${ancestry.stderr.trim()}`))
  }

  return resultOf(findings)
}
