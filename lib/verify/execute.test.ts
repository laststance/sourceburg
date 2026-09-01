import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { classifyFailure, commandFor, execute, isRetryable } from './execute'
import { materialize } from './materialize'

describe('a broken environment never reads as a fabricated fact', () => {
  it('classifies a fabricated sha as absent, which is a FAIL', () => {
    // Arrange: git's exact wording, held as a literal so a rewording turns this red
    const stderr = 'fatal: Not a valid object name deadbeefdeadbeefdeadbeefdeadbeefdeadbeef^{commit}'
    // Act
    const kind = classifyFailure(stderr)
    // Assert
    expect(kind).toBe('absent')
  })

  it('classifies a missing clone as an error, which is INDETERMINATE', () => {
    // Arrange
    const stderr = "fatal: cannot change to '/tmp/nope': No such file or directory"
    // Act
    const kind = classifyFailure(stderr)
    // Assert
    expect(kind).toBe('error')
  })

  it('classifies a rate limit as an error, so nobody hunts a collector bug', () => {
    // Arrange
    const stderr = 'gh: HTTP 403: API rate limit exceeded'
    // Act
    const kind = classifyFailure(stderr)
    // Assert
    expect(kind).toBe('error')
  })

  it('classifies a 404 as absent, because a missing issue is a wrong fact', () => {
    // Arrange
    const stderr = 'gh: Not Found (HTTP 404)'
    // Act
    const kind = classifyFailure(stderr)
    // Assert
    expect(kind).toBe('absent')
  })

  it('defaults an unrecognized failure to error rather than to a fabrication verdict', () => {
    // Arrange
    const stderr = 'fatal: something nobody has seen before'
    // Act
    const kind = classifyFailure(stderr)
    // Assert
    expect(kind).toBe('error')
  })

  it('never retries a fabricated sha, because no amount of waiting makes it exist', () => {
    // Arrange
    const stderr = 'fatal: Not a valid object name deadbeef'
    // Act
    const retryable = isRetryable(stderr)
    // Assert
    expect(retryable).toBe(false)
  })

  it('does not retry an unrecognized permanent error, so a run cannot spin forever', () => {
    // Arrange
    const stderr = 'fatal: something nobody has seen before'
    // Act
    const retryable = isRetryable(stderr)
    // Assert
    expect(retryable).toBe(false)
  })

  it('does not retry when stderr carries both an absent and a transient marker, because absent wins', () => {
    // Arrange: the connection dropped, but git also told us the object is not there.
    // Retrying would spend attempts on a fact that will never resolve.
    const stderr = 'fatal: unknown revision or path not in the working tree (ECONNRESET)'
    // Act
    const retryable = isRetryable(stderr)
    // Assert
    expect(retryable).toBe(false)
  })

  it('retries a rate limit', () => {
    // Arrange
    const stderr = 'gh: HTTP 403: API rate limit exceeded'
    // Act
    const retryable = isRetryable(stderr)
    // Assert
    expect(retryable).toBe(true)
  })
})

describe('no probe ever builds a shell string', () => {
  it('passes a path as its own argv element, so a crafted path cannot become a command', () => {
    // Arrange: a path that would be catastrophic through a shell
    const spec = { kind: 'gitBlob' as const, sha: 'a'.repeat(40), path: 'src/a.ts' }
    // Act
    const { file, args } = commandFor(spec, '/clone')
    // Assert
    expect(file).toBe('git')
    expect(args).toEqual(['-C', '/clone', 'show', `${'a'.repeat(40)}:src/a.ts`])
  })

  it('reads a code excerpt with the blob form of git show, which prints no commit header', () => {
    // Arrange & Act: `git show <sha>` would print author email addresses
    const { args } = commandFor({ kind: 'gitBlob', sha: 'b'.repeat(40), path: 'p.ts' }, '/clone')
    // Assert
    expect(args).not.toContain('-s')
    expect(args[args.length - 1]).toBe(`${'b'.repeat(40)}:p.ts`)
  })

  it('reads a diff with git diff rather than git show, whose header carries author addresses', () => {
    // Arrange & Act
    const { file, args } = commandFor(
      { kind: 'gitDiff', beforeSha: 'c'.repeat(40), afterSha: 'd'.repeat(40), path: 'p.ts' },
      '/clone',
    )
    // Assert
    expect(file).toBe('git')
    expect(args).toEqual(['-C', '/clone', 'diff', 'c'.repeat(40), 'd'.repeat(40), '--', 'p.ts'])
  })

  it('resolves a discussion through gh api, not through a bare URL fetch', () => {
    // Arrange & Act
    const { file, args } = commandFor({ kind: 'ghIssue', repo: 'o/n', number: 7 }, '/clone')
    // Assert
    expect(file).toBe('gh')
    expect(args).toEqual(['api', 'repos/o/n/issues/7'])
  })
})

describe('running real git tells a wrong fact from a broken clone', () => {
  let repoDir: string
  let headSha: string

  beforeAll(() => {
    // Arrange: a throwaway repo, so the test exercises real git without needing a clone
    repoDir = mkdtempSync(join(tmpdir(), 'sourceburg-exec-'))
    const git = (...args: string[]) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'Test')
    writeFileSync(join(repoDir, 'a.ts'), 'line one\nline two\nline three\n')
    git('add', 'a.ts')
    git('commit', '-q', '-m', 'first')
    headSha = git('rev-parse', 'HEAD').trim()
  })

  afterAll(() => rmSync(repoDir, { recursive: true, force: true }))

  it('returns ok with the committer date for a sha that exists', async () => {
    // Arrange
    const request = { id: 'd', covers: [], kind: 'gitCommitDate' as const, sha: headSha }
    // Act
    const [result] = await execute([request], { repoDir })
    // Assert
    expect(result.status).toBe('ok')
  })

  it('returns a committer date already normalized to UTC, so the schema and git agree on one format', async () => {
    // Arrange: a commit authored at +10:00, the form `git log --format=%cI` prints
    const tzRepo = mkdtempSync(join(tmpdir(), 'sourceburg-tz-'))
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', tzRepo, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_COMMITTER_DATE: '2026-05-18T09:41:25+10:00', GIT_AUTHOR_DATE: '2026-05-18T09:41:25+10:00' },
      })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'Test')
    writeFileSync(join(tzRepo, 'a.ts'), 'x\n')
    git('add', 'a.ts')
    git('commit', '-q', '-m', 'offset commit')
    const sha = git('rev-parse', 'HEAD').trim()
    // Act
    const [result] = await execute(
      [{ id: 'd', covers: [], kind: 'gitCommitDate' as const, sha }],
      { repoDir: tzRepo },
    )
    // Assert: the same instant, in the only format the schema accepts
    expect(result.status === 'ok' && result.stdout.trim()).toBe('2026-05-17T23:41:25Z')
    rmSync(tzRepo, { recursive: true, force: true })
  })

  it('returns absent for a fabricated sha, so the verifier can call it a FAIL', async () => {
    // Arrange
    const request = { id: 'd', covers: [], kind: 'gitCommitDate' as const, sha: 'deadbeef'.repeat(5) }
    // Act
    const [result] = await execute([request], { repoDir, maxAttempts: 1 })
    // Assert
    expect(result.status).toBe('absent')
  })

  it('returns absent for a path that does not exist at that revision', async () => {
    // Arrange
    const request = { id: 'b', covers: [], kind: 'gitBlob' as const, sha: headSha, path: 'no/such.ts' }
    // Act
    const [result] = await execute([request], { repoDir, maxAttempts: 1 })
    // Assert
    expect(result.status).toBe('absent')
  })

  it('returns error, not absent, when the clone itself is missing', async () => {
    // Arrange
    const request = { id: 'd', covers: [], kind: 'gitCommitDate' as const, sha: headSha }
    // Act
    const [result] = await execute([request], { repoDir: join(tmpdir(), 'definitely-not-here'), maxAttempts: 1 })
    // Assert
    expect(result.status).toBe('error')
  })

  it('reads a blob back byte for byte, so the verifier compares against real file content', async () => {
    // Arrange
    const request = { id: 'b', covers: [], kind: 'gitBlob' as const, sha: headSha, path: 'a.ts' }
    // Act
    const [result] = await execute([request], { repoDir })
    // Assert
    expect(result.status === 'ok' && result.stdout).toBe('line one\nline two\nline three\n')
  })
})

describe('a single timeout does not freeze into a permanent verdict', () => {
  let cacheRepo: string

  beforeAll(() => {
    // Arrange: a real repo, so a fabricated sha classifies as absent rather than
    // as "this is not a git repository", which is transient and must not cache
    cacheRepo = mkdtempSync(join(tmpdir(), 'sourceburg-cache-repo-'))
    const git = (...args: string[]) => execFileSync('git', ['-C', cacheRepo, ...args], { encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'Test')
    writeFileSync(join(cacheRepo, 'a.ts'), 'x\n')
    git('add', 'a.ts')
    git('commit', '-q', '-m', 'first')
  })

  afterAll(() => rmSync(cacheRepo, { recursive: true, force: true }))

  it('caches a definite result so a repeated probe costs one fetch', async () => {
    // Arrange
    const cache = new Map()
    const request = { id: 'gitCommitDate:x', covers: [], kind: 'gitCommitDate' as const, sha: 'deadbeef'.repeat(5) }
    // Act
    await execute([request], { repoDir: cacheRepo, maxAttempts: 1, cache })
    // Assert: `absent` is definite, so it is remembered
    expect(cache.size).toBe(1)
  })

  it('never caches a transient failure, which would turn one timeout into a permanent FAIL', async () => {
    // Arrange: a missing clone is transient by classification
    const cache = new Map()
    const request = { id: 'gitCommitDate:y', covers: [], kind: 'gitCommitDate' as const, sha: 'a'.repeat(40) }
    // Act
    await execute([request], { repoDir: join(tmpdir(), 'definitely-not-here'), maxAttempts: 1, cache })
    // Assert
    expect(cache.size).toBe(0)
  })
})

describe('a quoted comment is pinned to the body it actually came from', () => {
  const repo = 'o/n'
  const body = 'This still reproduces on 7.62.0, and the workaround stopped working.'
  const probes = [
    {
      id: `ghComment:${repo}#c55`,
      status: 'ok' as const,
      stdout: JSON.stringify({ created_at: '2026-05-02T04:15:00Z', user: { login: 'a-reporter' }, body }),
    },
  ]

  it('records the excerpt offset measured from the fetched body, not one supplied by the caller', async () => {
    // Arrange
    const cacheDir = mkdtempSync(join(tmpdir(), 'sourceburg-cache-'))
    // Act
    const result = await materialize([{ commentId: 55, excerpt: 'the workaround stopped working' }], probes, {
      cacheDir, fetchedAt: '2026-09-01T00:00:00Z', repo,
    })
    // Assert
    expect(result.pinned[0].offset).toBe(37)
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('writes the full body to the private cache and keeps only a hash in the return value', async () => {
    // Arrange
    const cacheDir = mkdtempSync(join(tmpdir(), 'sourceburg-cache-'))
    // Act
    const result = await materialize([{ commentId: 55, excerpt: 'This still reproduces' }], probes, {
      cacheDir, fetchedAt: '2026-09-01T00:00:00Z', repo,
    })
    // Assert
    expect(readFileSync(join(cacheDir, 'comment-55.json'), 'utf8')).toContain(body)
    expect(JSON.stringify(result.pinned[0])).not.toContain('workaround')
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('rejects an excerpt that is not in the body rather than adjusting it to something near it', async () => {
    // Arrange
    const cacheDir = mkdtempSync(join(tmpdir(), 'sourceburg-cache-'))
    // Act
    const result = await materialize([{ commentId: 55, excerpt: 'this still reproduces' }], probes, {
      cacheDir, fetchedAt: '2026-09-01T00:00:00Z', repo,
    })
    // Assert: differs only in one capital letter
    expect(result.pinned).toHaveLength(0)
    expect(result.rejected[0].reason).toBe('the excerpt does not appear in the fetched body')
    rmSync(cacheDir, { recursive: true, force: true })
  })
})
