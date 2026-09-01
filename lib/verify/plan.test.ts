import { describe, expect, it } from 'vitest'

import { incidentFixture, ANCHOR, FIX, REFIX, REPO, QUOTED_PATH } from './fixtures'
import { identityOf, plan } from './plan'

describe('every collected fact gets a probe, so nothing verifies by omission', () => {
  it('covers the anchor, every commit, every discussion, every quote, every code quote, and every revelation', () => {
    // Arrange
    const incident = incidentFixture()
    // Act
    const covered = new Set(plan(incident).flatMap((request) => request.covers))
    // Assert
    expect(covered).toEqual(
      new Set([
        'anchorSha',
        'commits[0]',
        'commits[1]',
        'commits[2]',
        'discussions[0]',
        'discussions[0].quotes[0]',
        'codeQuotes[0]',
        'codeQuotes[0].atShaCommittedAt',
        'revealedLater[0]',
      ]),
    )
  })

  it('probes the anchor even when it is absent from the commits array', () => {
    // Arrange: knownAt still claims to be the anchor's committer date
    const incident = incidentFixture({ commits: [] })
    // Act
    const ids = plan(incident).map((request) => request.id)
    // Assert
    expect(ids).toContain(`gitCommitDate:${ANCHOR}`)
  })

  it('fetches one blob when two excerpts come from the same file at the same revision', () => {
    // Arrange
    const incident = incidentFixture({
      codeQuotes: [
        { path: QUOTED_PATH, atSha: FIX, atShaCommittedAt: '2026-05-09T02:02:12Z', startLine: 2, endLine: 2, text: 'export default function getFieldArrayParentNames(name: string) {' },
        { path: QUOTED_PATH, atSha: FIX, atShaCommittedAt: '2026-05-09T02:02:12Z', startLine: 3, endLine: 3, text: '  return name.split(".").slice(0, -1)' },
      ],
    })
    // Act
    const blobProbes = plan(incident).filter((request) => request.kind === 'gitBlob')
    // Assert
    expect(blobProbes).toHaveLength(1)
    expect(blobProbes[0].covers).toEqual(['codeQuotes[0]', 'codeQuotes[1]'])
  })

  it('asks for the comment, not the issue, when an aftermath pins a comment id', () => {
    // Arrange
    const incident = incidentFixture({
      revealedLater: [
        { at: '2026-08-07T10:05:00Z', what: 'a maintainer explained the revert', evidence: { kind: 'discussion', number: 13260, commentId: 999 } },
      ],
    })
    // Act
    const ids = plan(incident).map((request) => request.id)
    // Assert
    expect(ids).toContain(`ghComment:${REPO}#c999`)
  })

  it('asks for the issue when an aftermath cites a thread with no comment id', () => {
    // Arrange
    const incident = incidentFixture({
      revealedLater: [
        { at: '2026-08-07T10:05:00Z', what: 'a new issue was opened', evidence: { kind: 'discussion', number: 13641 } },
      ],
    })
    // Act
    const ids = plan(incident).map((request) => request.id)
    // Assert
    expect(ids).toContain(`ghIssue:${REPO}#13641`)
  })

  it('probes both sides of a diff plus the diff itself', () => {
    // Arrange
    const incident = incidentFixture({
      diff: { beforeSha: FIX, afterSha: REFIX, path: QUOTED_PATH, hunk: '@@ -1 +1 @@' },
    })
    // Act
    const covered = new Set(plan(incident).flatMap((request) => request.covers))
    // Assert
    expect(covered).toContain('diff')
    expect(covered).toContain('diff.beforeSha')
    expect(covered).toContain('diff.afterSha')
  })

  it('never puts a preassembled command string in a request, so nothing can reach a shell', () => {
    // Arrange: a path shaped like a shell injection, legal under RepoPath
    const incident = incidentFixture()
    // Act
    const requests = plan(incident)
    // Assert
    for (const request of requests) {
      expect(Object.values(request).every((value) => !String(value).includes('&&'))).toBe(true)
    }
  })
})

describe('the identity tuple names what a republish may never move', () => {
  it('includes the anchor, because moving it changes which facts count as known at the same URL', () => {
    // Arrange
    const incident = incidentFixture()
    // Act
    const identity = identityOf(incident)
    // Assert
    expect(identity).toEqual({
      nameWithOwner: 'react-hook-form/react-hook-form',
      id: 'rhf-fieldarray-revert',
      anchorSha: ANCHOR,
    })
  })
})
