import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/*
 * The exit code IS the interface: everything downstream branches on it. A run
 * that printed "failed" and exited 0 would make "reporting" a lie, so these
 * spawn the real command rather than calling the functions.
 */

const ROOT = join(import.meta.dirname, '..')

describe('the verifier command reports its verdict through its exit code', () => {
  let dir: string
  let repoDir: string
  let sha: string

  beforeAll(() => {
    // Arrange: an upstream with one commit at a known instant, and a clone of it.
    // The clone is what the CLI is pointed at, because preflight refuses a
    // directory with no origin and no remote-tracking branch — which is what a
    // bare `git init` is.
    dir = mkdtempSync(join(tmpdir(), 'sourceburg-cli-'))
    const upstream = join(dir, 'upstream')
    repoDir = join(dir, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', upstream])
    const gitIn = (cwd: string, ...args: string[]) =>
      execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_COMMITTER_DATE: '2026-05-18T09:41:25+10:00', GIT_AUTHOR_DATE: '2026-05-18T09:41:25+10:00' },
      })
    gitIn(upstream, 'config', 'user.email', 'test@example.invalid')
    gitIn(upstream, 'config', 'user.name', 'Test')
    writeFileSync(join(upstream, 'a.ts'), 'x\n')
    gitIn(upstream, 'add', 'a.ts')
    gitIn(upstream, 'commit', '-q', '-m', 'the anchor')
    sha = gitIn(upstream, 'rev-parse', 'HEAD').trim()

    execFileSync('git', ['clone', '-q', upstream, repoDir])
    // The fact-set names o/n, so origin has to be o/n or preflight stops there.
    gitIn(repoDir, 'remote', 'set-url', 'origin', 'git@github.com:o/n.git')

    const incident = {
      id: 'a-story', signal: 'git-trace',
      selection: { kind: 'manual', reason: 'a fixture' },
      repo: { nameWithOwner: 'o/n', defaultBranch: 'main', spdxLicense: 'MIT' },
      anchorSha: sha, knownAt: '2026-05-17T23:41:25Z',
      commits: [{ sha, committedAt: '2026-05-17T23:41:25Z', subject: 'the anchor' }],
      discussions: [], codeQuotes: [], diff: null, revealedLater: [],
    }
    const article = {
      incidentId: 'a-story', lang: 'en', persona: 'desk',
      title: 'A headline', titleCites: [`commit:${sha}`],
      dek: 'A dek', dekCites: [`commit:${sha}`],
      publishedAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
      blocks: [{ type: 'prose', sentences: [{ text: 'The lede.', cites: [] }] }],
      aftermath: [],
    }
    writeFileSync(join(dir, 'incident.json'), JSON.stringify(incident))
    writeFileSync(join(dir, 'article.json'), JSON.stringify(article))

    // The same story with one sha nobody ever committed.
    const fabricated = 'deadbeef'.repeat(5)
    writeFileSync(
      join(dir, 'fabricated.json'),
      JSON.stringify({ ...incident, commits: [{ sha: fabricated, committedAt: '2026-05-17T23:41:25Z', subject: 'invented' }] }),
    )
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const runCli = (incidentFile: string, repo: string) =>
    spawnSync('pnpm', ['exec', 'tsx', 'bin/verify.ts',
      '--incident', join(dir, incidentFile), '--article', join(dir, 'article.json'), '--repo-dir', repo,
    ], { cwd: ROOT, encoding: 'utf8' })

  it('exits 0 when every fact checks out against the real repository', () => {
    // Arrange & Act
    const run = runCli('incident.json', repoDir)
    // Assert
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('PASS')
  })

  it('exits 1 on a fabricated sha, the code CI must never retry', () => {
    // Arrange & Act
    const run = runCli('fabricated.json', repoDir)
    // Assert
    expect(run.status).toBe(1)
  })

  it('exits 2 when the clone is missing, so a broken environment is retryable and not a verdict', () => {
    // Arrange & Act
    const run = runCli('incident.json', join(tmpdir(), 'definitely-not-a-clone'))
    // Assert
    expect(run.status).toBe(2)
  })
}, 60_000)
