import { describe, expect, it } from 'vitest'

import { revealedRefFor } from './facts'
import { articleHref, licenseHref, permalinkFor, repoSlugOf, sourceLabelFor } from './links'
import { Incident } from './schema'

const FIX_SHA = 'c6c3d87eb844af1fd1c01428f2fa113735982d4c'
const REVERT_SHA = 'dfcebdbde1891fdd76fb56751cbe08dd980dfa5b'
const BODY_HASH = '3b04af3a876ee2a5f8a0f016b90950f0787eb7fea6934a2ddfc416fe9fae44aa'

/** One fact-set carrying a PR, an issue, a code range, and a revealed entry. */
const INCIDENT = Incident.parse({
  id: 'field-array-key-thrash',
  signal: 'git-trace',
  selection: { kind: 'manual', reason: 'found by hand' },
  repo: { nameWithOwner: 'react-hook-form/react-hook-form', defaultBranch: 'master', spdxLicense: 'MIT' },
  anchorSha: FIX_SHA,
  knownAt: '2026-05-17T23:41:25Z',
  commits: [
    { sha: FIX_SHA, committedAt: '2026-05-09T02:02:12Z', subject: 'fix: notify every matching field array root' },
    { sha: REVERT_SHA, committedAt: '2026-05-17T22:54:48Z', subject: 'Revert "fix: notify every matching field array root"' },
  ],
  discussions: [
    {
      kind: 'pr',
      number: 13420,
      createdAt: '2026-05-09T01:38:20Z',
      quotes: [
        {
          excerpt: 'this causes react keys to thrash',
          bodyHash: BODY_HASH,
          offset: 0,
          author: 'maxkostow',
          commentId: 4472139263,
          createdAt: '2026-05-17T18:44:19Z',
          fetchedAt: '2026-09-01T07:00:00Z',
        },
      ],
    },
    { kind: 'issue', number: 13260, createdAt: '2026-01-20T09:15:09Z', quotes: [] },
  ],
  codeQuotes: [
    {
      path: 'src/logic/getFieldArrayParentNames.ts',
      atSha: FIX_SHA,
      atShaCommittedAt: '2026-05-09T02:02:12Z',
      startLine: 3,
      endLine: 10,
      text: 'export default (names: string[]) => names',
    },
  ],
  diff: null,
  revealedLater: [
    {
      at: '2026-05-28T12:26:34Z',
      what: 'The issue reopened eleven days after the revert.',
      evidence: { kind: 'discussion', number: 13260, commentId: 4563957418 },
    },
  ],
})

describe('a reader following a citation lands on the fact it cites', () => {
  it('sends a pull request ref to /pull/ and an issue ref to /issues/', () => {
    // Arrange / Act — GitHub redirects the wrong one, so a test on the raw string
    // is the only place this is visible before a reader sees the bounce.
    const pr = permalinkFor('discussion:13420', INCIDENT)
    const issue = permalinkFor('discussion:13260', INCIDENT)

    // Assert
    expect(pr).toBe('https://github.com/react-hook-form/react-hook-form/pull/13420')
    expect(issue).toBe('https://github.com/react-hook-form/react-hook-form/issues/13260')
  })

  it('anchors a comment ref at that comment, not at the top of the thread', () => {
    // Arrange / Act
    const link = permalinkFor('discussion:13420#4472139263', INCIDENT)

    // Assert
    expect(link).toBe(
      'https://github.com/react-hook-form/react-hook-form/pull/13420#issuecomment-4472139263',
    )
  })

  it('opens a code ref at the exact lines the box printed', () => {
    // Arrange / Act
    const link = permalinkFor(`code:${FIX_SHA}:src/logic/getFieldArrayParentNames.ts:3-10`, INCIDENT)

    // Assert — the range is part of the citation id, so the URL must carry it too
    expect(link).toBe(
      `https://github.com/react-hook-form/react-hook-form/blob/${FIX_SHA}/src/logic/getFieldArrayParentNames.ts#L3-L10`,
    )
  })

  it('follows a revealed ref through to its evidence', () => {
    // Arrange — a revealed entry has no id of its own on GitHub
    const ref = revealedRefFor(INCIDENT.revealedLater[0])

    // Act
    const link = permalinkFor(ref, INCIDENT)

    // Assert
    expect(link).toBe(
      'https://github.com/react-hook-form/react-hook-form/issues/13260#issuecomment-4563957418',
    )
  })

  it('refuses to guess a URL for a thread the fact-set does not hold', () => {
    // Arrange / Act — /issues/ vs /pull/ cannot be known without the thread, and a
    // plausible guess is still an unverified URL on a page that promises none.
    const link = permalinkFor('discussion:99999', INCIDENT)

    // Assert
    expect(link).toBeNull()
    expect(sourceLabelFor('discussion:99999', INCIDENT)).toBeNull()
  })
})

describe('a source label is built from ids, never from fact-set prose', () => {
  it('labels a commit with its short sha and NOT its subject', () => {
    // Arrange — the subject is the fact nothing verifies (TODOS #5) and the bucket
    // the injection eval does not watch, so it must not reach a footer row.
    const label = sourceLabelFor(`commit:${FIX_SHA}`, INCIDENT)

    // Assert
    expect(label).toBe('commit c6c3d87')
    expect(label).not.toContain('notify every matching field array root')
  })

  it('names the handle on a comment row so the footer matches the pull quote', () => {
    // Arrange / Act
    const label = sourceLabelFor('discussion:13420#4472139263', INCIDENT)

    // Assert
    expect(label).toBe('pull request #13420, comment by @maxkostow')
  })

  it('labels a code row with the path, the range, and the sha it was read at', () => {
    // Arrange / Act
    const label = sourceLabelFor(`code:${FIX_SHA}:src/logic/getFieldArrayParentNames.ts:3-10`, INCIDENT)

    // Assert
    expect(label).toBe('src/logic/getFieldArrayParentNames.ts:3-10 at c6c3d87')
  })

  it('labels a revealed row without repeating what it revealed', () => {
    // Arrange — `revealedLater[].what` is the writer's claim, not a verified string
    const label = sourceLabelFor(revealedRefFor(INCIDENT.revealedLater[0]), INCIDENT)

    // Assert
    expect(label).toBe('revealed later in #13260')
  })
})

describe('a repo slug is derived, so no table can disagree with it', () => {
  it('lowercases the owner and turns the slash into a hyphen', () => {
    // Arrange / Act / Assert
    expect(repoSlugOf('vitejs/vite')).toBe('vitejs-vite')
  })

  it('collapses runs of punctuation instead of emitting a double hyphen', () => {
    // Arrange / Act / Assert — `a-b--c` would be two different URLs for one repo
    expect(repoSlugOf('Foo.Bar/_baz')).toBe('foo-bar-baz')
  })

  it('builds the article path from the slug and the incident id', () => {
    // Arrange / Act / Assert
    expect(articleHref(INCIDENT)).toBe('/react-hook-form-react-hook-form/field-array-key-thrash')
  })

  it('points the license row at the repository default branch', () => {
    // Arrange / Act / Assert
    expect(licenseHref(INCIDENT)).toBe(
      'https://github.com/react-hook-form/react-hook-form/blob/master/LICENSE',
    )
  })
})
