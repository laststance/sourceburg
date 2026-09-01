import { execFileSync } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { Incident } from '../schema'

import { parseRemote, preflight, shasOf } from './preflight'
import { incidentFixture } from './fixtures'

const NWO = 'react-hook-form/react-hook-form'
const ORIGIN_URL = `git@github.com:${NWO}.git`

/** Runs git with a fixed identity so the tests do not depend on the developer's config. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      TZ: 'UTC',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  })
}

/** A one-commit fact-set pointing at a real object in a scratch clone. */
function incidentAt(sha: string, committedAt: string, nameWithOwner = NWO): Incident {
  return Incident.parse({
    id: 'scratch',
    signal: 'git-trace',
    selection: { kind: 'manual', reason: 'preflight test' },
    repo: { nameWithOwner, defaultBranch: 'master', spdxLicense: 'MIT' },
    anchorSha: sha,
    knownAt: committedAt,
    commits: [{ sha, committedAt, subject: 'scratch' }],
    discussions: [],
    codeQuotes: [],
    diff: null,
    revealedLater: [],
  })
}

let upstream: string
let clone: string
let upstreamSha: string
let upstreamAt: string
let localOnlySha: string

beforeAll(async () => {
  // Arrange — an upstream repo with one commit, and a clone that adds a second
  // commit of its own. The second is the fork / unmerged-PR shape: a real object,
  // present locally, absent from the branch a reader can reach.
  const root = await mkdtemp(join(tmpdir(), 'sourceburg-preflight-'))
  upstream = join(root, 'upstream')
  clone = join(root, 'clone')

  execFileSync('git', ['init', '-q', '-b', 'master', upstream])
  await writeFile(join(upstream, 'a.txt'), 'one\n')
  git(upstream, 'add', 'a.txt')
  git(upstream, 'commit', '-qm', 'upstream commit')
  upstreamSha = git(upstream, 'rev-parse', 'HEAD').trim()
  upstreamAt = git(upstream, 'show', '-s', '--date=iso-strict-local', '--format=%cd', 'HEAD').trim()

  execFileSync('git', ['clone', '-q', upstream, clone])
  git(clone, 'remote', 'set-url', 'origin', ORIGIN_URL)
  await writeFile(join(clone, 'b.txt'), 'two\n')
  git(clone, 'add', 'b.txt')
  git(clone, 'commit', '-qm', 'local only')
  localOnlySha = git(clone, 'rev-parse', 'HEAD').trim()
})

describe('parseRemote', () => {
  it('reads owner/name from both URL forms git pushes people toward', () => {
    // Arrange / Act / Assert — one case per form, hard-coded.
    expect(parseRemote('git@github.com:react-hook-form/react-hook-form.git')).toBe(NWO)
    expect(parseRemote('https://github.com/react-hook-form/react-hook-form.git')).toBe(NWO)
    expect(parseRemote('https://github.com/react-hook-form/react-hook-form')).toBe(NWO)
    expect(parseRemote('ssh://git@github.com/react-hook-form/react-hook-form.git')).toBe(NWO)
  })

  it('refuses to read a GitHub identity out of a host that is not GitHub', () => {
    // A lookalike host would let a mirror pass as the repo the article names.
    expect(parseRemote('https://github.com.evil.example/a/b')).toBeNull()
    expect(parseRemote('git@gitlab.com:a/b.git')).toBeNull()
    expect(parseRemote('/tmp/some/local/path')).toBeNull()
  })
})

describe('shasOf', () => {
  it('enumerates shas through plan() so a new fact kind cannot be missed twice', () => {
    // Arrange — the standard fixture has three commits, a code quote at one of
    // them, and an aftermath commit.
    const incident = incidentFixture()

    // Act
    const shas = shasOf(incident)

    // Assert — four distinct objects: fix, revert, anchor, refix.
    expect(shas.length).toBe(4)
    expect(shas).toContain('c6c3d87eb844af1fd1c01428f2fa113735982d4c')
    expect(shas).toContain('5e9e02453d86c856de3e362e404aee8ad52921e9')
  })
})

describe('preflight', () => {
  it('accepts a full clone whose origin and history both check out', async () => {
    // Arrange / Act
    const result = await preflight(incidentAt(upstreamSha, upstreamAt), clone)

    // Assert
    expect(result).toEqual({ verdict: 'PASS', findings: [] })
  })

  it('refuses a sha that exists locally but never reached the published branch', async () => {
    // Arrange — the clone's own commit. Every fact probe would have passed on it:
    // the object resolves, the date is real, a blob at it reads fine.
    const localAt = git(clone, 'show', '-s', '--date=iso-strict-local', '--format=%cd', localOnlySha).trim()

    // Act
    const result = await preflight(incidentAt(localOnlySha, localAt), clone)

    // Assert
    expect(result.verdict).toBe('FAIL')
    expect(result.findings[0].rule).toBe('every sha is reachable from the default branch')
  })

  it('refuses a shallow clone rather than trusting the history it can see', async () => {
    // Arrange — depth 1 over file:// , which is how a CI checkout usually arrives.
    const root = await mkdtemp(join(tmpdir(), 'sourceburg-shallow-'))
    const shallow = join(root, 'shallow')
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${upstream}`, shallow])
    git(shallow, 'remote', 'set-url', 'origin', ORIGIN_URL)

    // Act
    const result = await preflight(incidentAt(upstreamSha, upstreamAt), shallow)

    // Assert
    expect(result.verdict).toBe('FAIL')
    expect(result.findings).toEqual([
      {
        verdict: 'FAIL',
        rule: 'the clone is not shallow',
        detail: 'a shallow clone hides the history every ancestry check depends on',
      },
    ])
  })

  it('stops at an origin mismatch instead of grading shas against the wrong repo', async () => {
    // Arrange — the fact-set names a different repo than origin, AND cites a sha
    // the ancestry check would also reject. Once origin is known to be the wrong
    // repo, `origin/master` names history the fact-set never claimed, so grading
    // shas against it produces a finding about a comparison nobody asked for.
    const incident = incidentAt(localOnlySha, upstreamAt, 'someone-else/a-fork')

    // Act
    const result = await preflight(incident, clone)

    // Assert — one finding, and it is the origin one. No sha was graded.
    expect(result.findings.length).toBe(1)
    expect(result.findings[0]).toEqual({
      verdict: 'FAIL',
      rule: 'origin is the repo the fact-set names',
      detail: `the fact-set names someone-else/a-fork, origin is ${NWO}`,
    })
  })

  it('calls an unfetched default branch inconclusive, not a wrong fact', async () => {
    // Arrange — a real repo whose default branch is named something else, so
    // origin/master does not resolve. Retrying this is correct; failing is not.
    const incident = incidentAt(upstreamSha, upstreamAt)
    const bare = await mkdtemp(join(tmpdir(), 'sourceburg-nobranch-'))
    execFileSync('git', ['init', '-q', '-b', 'main', bare])

    // Act
    const result = await preflight(incident, bare)

    // Assert
    expect(result.verdict).toBe('INDETERMINATE')
    expect(result.findings[0].rule).toBe('the default branch is fetched')
  })
})
