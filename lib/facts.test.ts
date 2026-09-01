import { describe, expect, it } from 'vitest'
import { aftermathKnownAt, datedFacts, parseFactRef, revealedRefFor } from './facts'
import type { Article, Incident } from './schema'

const SHA = 'c6c3d87e0000000000000000000000000000abcd'

describe('a citation id resolves to a fact, never to an array position', () => {
  it('parses a commit ref', () => {
    // Arrange / Act
    const parsed = parseFactRef(`commit:${SHA}`)
    // Assert
    expect(parsed).toEqual({ kind: 'commit', sha: SHA })
  })

  it('parses a discussion ref without a comment id', () => {
    // Arrange / Act
    const parsed = parseFactRef('discussion:13260')
    // Assert
    expect(parsed).toEqual({ kind: 'discussion', number: 13260 })
  })

  it('parses a discussion ref pinned to one comment', () => {
    // Arrange / Act
    const parsed = parseFactRef('discussion:13260#2894113001')
    // Assert
    expect(parsed).toEqual({ kind: 'discussion', number: 13260, commentId: 2894113001 })
  })

  it('keeps the slashes in a code ref path instead of splitting the whole id on colons', () => {
    // Arrange: the path contains dots and slashes and sits between two colon fields
    const ref = `code:${SHA}:src/logic/getFieldArrayParentNames.ts:1-13`
    // Act
    const parsed = parseFactRef(ref)
    // Assert
    expect(parsed).toEqual({
      kind: 'code',
      atSha: SHA,
      path: 'src/logic/getFieldArrayParentNames.ts',
      startLine: 1,
      endLine: 13,
    })
  })

  it('returns null for a ref that looks right but is not one of the five forms', () => {
    // Arrange: a short sha, the shape a hand-typed citation would take
    const parsed = parseFactRef('commit:c6c3d87e')
    // Assert
    expect(parsed).toBeNull()
  })

  it('returns null for an array index masquerading as a ref', () => {
    // Arrange / Act
    const parsed = parseFactRef('0')
    // Assert
    expect(parsed).toBeNull()
  })
})

/** Incident carrying only what datedFacts reads, so a failure names the chronology rule. */
function incidentWith(overrides: Partial<Incident>): Incident {
  return {
    id: 'rhf-fieldarray-revert',
    signal: 'git-trace',
    selection: { kind: 'manual', reason: 'found by hand' },
    repo: { nameWithOwner: 'react-hook-form/react-hook-form', defaultBranch: 'master', spdxLicense: 'MIT' },
    anchorSha: SHA,
    knownAt: '2026-05-17T23:41:25Z',
    commits: [],
    discussions: [],
    codeQuotes: [],
    diff: null,
    revealedLater: [],
    ...overrides,
  } as Incident
}

describe('the timeline box and the verifier count dated facts the same way', () => {
  it('orders facts oldest first regardless of the order they were collected in', () => {
    // Arrange: the revert commit is listed before the issue that predates it
    const incident = incidentWith({
      commits: [{ sha: SHA, committedAt: '2026-05-17T22:54:48Z', subject: 'Revert the fix' }] as Incident['commits'],
      discussions: [
        { kind: 'issue', number: 13260, createdAt: '2026-01-20T09:15:09Z', quotes: [] },
      ] as Incident['discussions'],
    })
    // Act
    const facts = datedFacts(incident)
    // Assert
    expect(facts.map((f) => f.at)).toEqual(['2026-01-20T09:15:09Z', '2026-05-17T22:54:48Z'])
  })

  it('counts a comment as its own dated event, because it can post months after the thread opened', () => {
    // Arrange
    const incident = incidentWith({
      discussions: [
        {
          kind: 'issue',
          number: 13260,
          createdAt: '2026-01-20T09:15:09Z',
          quotes: [
            {
              excerpt: 'still broken',
              bodyHash: 'a'.repeat(64),
              offset: 0,
              author: 'danhorvath',
              commentId: 999,
              createdAt: '2026-05-09T01:38:20Z',
              fetchedAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      ] as Incident['discussions'],
    })
    // Act
    const facts = datedFacts(incident)
    // Assert
    expect(facts).toHaveLength(2)
  })

  it('excludes revealedLater so a timeline box cannot reach two using aftermath the article may not know', () => {
    // Arrange: one known fact, two later revelations
    const incident = incidentWith({
      commits: [{ sha: SHA, committedAt: '2026-05-17T22:54:48Z', subject: 'Revert the fix' }] as Incident['commits'],
      revealedLater: [
        { at: '2026-08-06T12:58:11Z', what: 'resurfaced as #13641', evidence: { kind: 'discussion', number: 13641 } },
        { at: '2026-08-06T22:31:06Z', what: 'fixed in #13644', evidence: { kind: 'discussion', number: 13644 } },
      ] as Incident['revealedLater'],
    })
    // Act
    const facts = datedFacts(incident)
    // Assert: one, not three — the timelineBox precondition correctly fails
    expect(facts).toHaveLength(1)
  })
})

describe('the aftermath band is dated by when its facts became known', () => {
  it('uses the revealed date the aftermath cites, not the publication timestamp', () => {
    // Arrange — an article shipped WITH its aftermath has updatedAt === publishedAt,
    // and "(written later: <the day it was published>)" is a claim the page disproves.
    const incident = incidentWith({
      revealedLater: [
        {
          at: '2026-05-28T12:26:34Z',
          what: 'The issue reopened.',
          evidence: { kind: 'discussion', number: 13260, commentId: 4563957418 },
        },
      ] as Incident['revealedLater'],
    })
    const article = {
      updatedAt: '2026-05-17T23:41:25Z',
      aftermath: [{ text: 'Eleven days later.', ref: revealedRefFor(incident.revealedLater[0]) }],
    } as Article

    // Act
    const dated = aftermathKnownAt(incident, article)

    // Assert
    expect(dated).toBe('2026-05-28T12:26:34Z')
  })

  it('falls back to updatedAt when there is no aftermath to date', () => {
    // Arrange
    const incident = incidentWith({})
    const article = { updatedAt: '2026-06-02T00:00:00Z', aftermath: [] } as unknown as Article

    // Act / Assert
    expect(aftermathKnownAt(incident, article)).toBe('2026-06-02T00:00:00Z')
  })
})
