import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { Incident } from '../schema'

import { COMMENT_AT, COMMENT_BODY, COMMENT_EXCERPT, REPO } from './fixtures'
import { materialize } from './materialize'

import type { ProbeResult } from './probe'

const COMMENT_ID = 55
const FETCHED_AT = '2026-09-01T00:00:00Z'

/** The `gh api` payload for the comment {@link COMMENT_BODY} came from. */
function commentProbe(body: string): ProbeResult {
  return {
    id: `ghComment:${REPO}#c${COMMENT_ID}`,
    status: 'ok',
    stdout: JSON.stringify({
      id: COMMENT_ID,
      created_at: COMMENT_AT,
      user: { login: 'a-reporter' },
      body,
    }),
  }
}

async function cacheDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sourceburg-materialize-'))
}

describe('materialize', () => {
  it('hands a pinned quote to the fact-set without a rename or a missing key', async () => {
    // Arrange — materialize() and the Incident schema are written in different
    // files, so nothing but this test stops a rename on one side from compiling.
    const dir = await cacheDir()

    // Act
    const { pinned } = await materialize(
      [{ commentId: COMMENT_ID, excerpt: COMMENT_EXCERPT }],
      [commentProbe(COMMENT_BODY)],
      { cacheDir: dir, fetchedAt: FETCHED_AT, repo: REPO },
    )
    const parsed = Incident.safeParse({
      id: 'rhf-fieldarray-revert',
      signal: 'git-trace',
      selection: { kind: 'manual', reason: 'found by hand' },
      repo: { nameWithOwner: REPO, defaultBranch: 'master', spdxLicense: 'MIT' },
      anchorSha: 'a2ac01fd3872cf95b4e6ac8f4b4800f72b55eafd',
      knownAt: '2026-05-17T23:41:25Z',
      commits: [],
      discussions: [{ kind: 'issue', number: 13260, createdAt: '2026-05-01T00:00:00Z', quotes: pinned }],
      codeQuotes: [],
      diff: null,
      revealedLater: [],
    })

    // Assert — the quote object is strict, so an extra or renamed key fails here.
    expect(parsed.success).toBe(true)
  })

  it('rejects an excerpt the body does not contain instead of realigning it', async () => {
    // Arrange — one character off. A fuzzy match here would publish a quotation
    // nobody wrote while every downstream check still reported green.
    const dir = await cacheDir()

    // Act
    const { pinned, rejected } = await materialize(
      [{ commentId: COMMENT_ID, excerpt: 'This still reproduces on 7.62.1' }],
      [commentProbe(COMMENT_BODY)],
      { cacheDir: dir, fetchedAt: FETCHED_AT, repo: REPO },
    )

    // Assert
    expect(pinned).toEqual([])
    expect(rejected).toEqual([
      { commentId: 55, reason: 'the excerpt does not appear in the fetched body' },
    ])
  })

  it('keeps the fetched body in the cache and out of the committed pin', async () => {
    // Arrange — a body carrying an address, which must never reach the artifact.
    const dir = await cacheDir()
    const body = 'Reported by the maintainer at nobody@example.com. This still reproduces on 7.62.0'

    // Act
    const { pinned } = await materialize(
      [{ commentId: COMMENT_ID, excerpt: 'This still reproduces on 7.62.0' }],
      [commentProbe(body)],
      { cacheDir: dir, fetchedAt: FETCHED_AT, repo: REPO },
    )
    const cached = await readFile(join(dir, `comment-${COMMENT_ID}.json`), 'utf8')

    // Assert
    expect(JSON.stringify(pinned)).not.toContain('nobody@example.com')
    expect(pinned[0].offset).toBe(50)
    expect(cached).toContain('nobody@example.com')
  })
})
