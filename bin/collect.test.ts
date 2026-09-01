import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseCodeArg, resolveSha } from '../lib/collect'

/*
 * `gh` is replaced by a script on PATH rather than mocked, so these exercise the
 * real command the collector builds. Git is real throughout: the point of the
 * collector is that it reads bytes and dates out of a repository, and a fake
 * git would test the assembly while skipping the part that can be wrong.
 */

const ROOT = join(import.meta.dirname, '..')
const ANCHOR_DATE = '2026-05-02T00:00:00+00:00'
const PARENT_DATE = '2026-05-01T00:00:00+00:00'

describe('the collector gathers facts from git and gh, never from its arguments', () => {
  let dir: string
  let repoDir: string
  let binDir: string
  let contentDir: string
  let anchorSha: string
  let parentSha: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'sourceburg-collect-'))
    const upstream = join(dir, 'upstream')
    repoDir = join(dir, 'repo')
    contentDir = join(dir, 'content')

    execFileSync('git', ['init', '-q', '-b', 'trunk', upstream])
    const gitIn = (cwd: string, at: string, ...args: string[]) =>
      execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at },
      })
    gitIn(upstream, PARENT_DATE, 'config', 'user.email', 'test@example.invalid')
    gitIn(upstream, PARENT_DATE, 'config', 'user.name', 'Test')

    mkdirSync(join(upstream, 'src'))
    writeFileSync(join(upstream, 'src/a.ts'), 'const header = 1\nexport function widen(name) {\n  return name.split(".")\n}\n')
    writeFileSync(join(upstream, 'src/mailer.ts'), 'const header = 1\n// maintained by nobody@example.com\nexport const send = () => null\n')
    gitIn(upstream, PARENT_DATE, 'add', '.')
    gitIn(upstream, PARENT_DATE, 'commit', '-q', '-m', 'the parent commit subject')
    parentSha = gitIn(upstream, PARENT_DATE, 'rev-parse', 'HEAD').trim()

    writeFileSync(join(upstream, 'src/a.ts'), 'const header = 1\nexport function widen(name) {\n  return name.split(".").slice(0, -1)\n}\n')
    gitIn(upstream, ANCHOR_DATE, 'commit', '-qam', 'the anchor commit subject')
    anchorSha = gitIn(upstream, ANCHOR_DATE, 'rev-parse', 'HEAD').trim()

    execFileSync('git', ['clone', '-q', upstream, repoDir])
    execFileSync('git', ['-C', repoDir, 'remote', 'set-url', 'origin', 'git@github.com:o/n.git'])

    // A `gh` that answers the three endpoints the collector calls. Dates here are
    // the ONLY source of every `createdAt` in the output, which is what makes the
    // invariant test below meaningful.
    binDir = join(dir, 'bin')
    mkdirSync(binDir)
    const gh = join(binDir, 'gh')
    writeFileSync(
      gh,
      `#!/usr/bin/env node
const path = process.argv[3] ?? ''
const say = (o) => process.stdout.write(JSON.stringify(o))
if (path === 'repos/o/n') say({ default_branch: 'trunk', license: { spdx_id: 'Apache-2.0' } })
else if (path === 'repos/o/n/issues/7') say({ created_at: '2026-04-01T09:00:00Z' })
else if (path === 'repos/o/n/issues/comments/99')
  say({ body: 'The prefix loop rebuilds the name and it thrashes keys.', user: { login: 'quotedmaintainer' }, created_at: '2026-04-15T10:00:00Z' })
else if (path === 'repos/o/n/issues/comments/1234')
  say({ body: 'Still reproducing weeks later.', user: { login: 'latereporter' }, created_at: '2026-05-10T11:00:00Z' })
else { process.stderr.write('HTTP 404: Not Found'); process.exit(1) }
`,
      'utf8',
    )
    chmodSync(gh, 0o755)
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  const runCli = (...args: string[]) =>
    spawnSync('pnpm', ['exec', 'tsx', 'bin/collect.ts', '--repo-dir', repoDir, '--content-dir', contentDir, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
    })

  const fullRun = (out: string, excerpt: string, codeRange: string) => [
    '--id', 'a-story',
    '--reason', 'a fixture exercising every probe kind',
    '--anchor-sha', anchorSha,
    '--commit', `${anchorSha}^`,
    '--code', `${anchorSha}:${codeRange}`,
    '--discussion', 'discussion:7',
    '--quote', `discussion:7#99=${excerpt}`,
    '--diff', `${anchorSha}^..${anchorSha}:src/a.ts`,
    '--revealed', 'discussion:7#1234=The bug came back three weeks later.',
    '--out', join(dir, out),
  ]

  it('expands a short revision to the full object name git resolved it to', async () => {
    // Arrange & Act
    const resolved = await resolveSha(repoDir, `${anchorSha.slice(0, 7)}^`)

    // Assert
    expect(resolved).toBe(parentSha)
  })

  it('names the argument the operator typed when the revision does not exist', async () => {
    // Arrange & Act & Assert
    await expect(resolveSha(repoDir, 'no-such-branch')).rejects.toThrow(
      'no-such-branch does not name a commit in this clone',
    )
  })

  it('validates a code range with the same parser an article citation goes through', async () => {
    // Arrange & Act
    const parsed = await parseCodeArg(repoDir, `${anchorSha.slice(0, 7)}:src/a.ts:2-3`)

    // Assert
    expect(parsed).toEqual({ atSha: anchorSha, path: 'src/a.ts', startLine: 2, endLine: 3 })
  })

  it('takes no date, subject, hash, author, or line of code from its arguments', () => {
    // Arrange
    const args = fullRun('collected.json', 'it thrashes keys', 'src/a.ts:2-3')

    // Act
    const run = runCli(...args)
    const incident = JSON.parse(readFileSync(join(dir, 'collected.json'), 'utf8'))
    const quote = incident.discussions[0].quotes[0]
    const fetched: string[] = [
      incident.knownAt,
      incident.repo.defaultBranch,
      incident.repo.spdxLicense,
      ...incident.commits.flatMap((c: { committedAt: string; subject: string }) => [c.committedAt, c.subject]),
      incident.discussions[0].createdAt,
      quote.bodyHash,
      quote.author,
      quote.createdAt,
      incident.codeQuotes[0].atShaCommittedAt,
      incident.codeQuotes[0].text,
      incident.diff.hunk,
      incident.revealedLater[0].at,
    ]

    // Assert — every one of those came out of git or gh, so none of them can be
    // found in what the operator typed.
    expect(run.status).toBe(0)
    for (const value of fetched) {
      expect(args.some((arg) => arg.includes(value))).toBe(false)
    }
    expect(incident.knownAt).toBe('2026-05-02T00:00:00Z')
    expect(incident.commits[1].subject).toBe('the parent commit subject')
    expect(quote.author).toBe('quotedmaintainer')
    expect(incident.repo.spdxLicense).toBe('Apache-2.0')
    expect(incident.revealedLater[0].at).toBe('2026-05-10T11:00:00Z')
  })

  it('refuses an excerpt that is not in the fetched body rather than adjusting it to fit', () => {
    // Arrange & Act — one word off from what the fake comment actually says.
    const run = runCli(...fullRun('near-miss.json', 'it thrashes the keys', 'src/a.ts:2-3'))

    // Assert
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('the excerpt does not appear in the fetched body')
  })

  it('refuses a code excerpt carrying an email address before it can reach a commit', () => {
    // Arrange & Act — line 2 of mailer.ts is a maintainer address.
    const run = runCli(...fullRun('leaky.json', 'it thrashes keys', 'src/mailer.ts:1-3'))

    // Assert
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('the excerpt carries an email address')
  })
}, 120_000)
