import { describe, expect, it } from 'vitest'

import { revealedRefFor } from '../facts'
import { MAX_QUOTED_RATIO, MAX_QUOTED_LINES_PER_PATH } from '../constants'
import {
  ANCHOR, FIX, REPO, QUOTED_PATH, FIX_AT, BLOB, COMMENT_AT, COMMENT_BODY, COMMENT_HASH,
  articleFixture, incidentFixture, passingProbes,
} from './fixtures'
import { containsEmail, countProseLines, countQuotedLines, pureRules, verify } from './verify'

/** The baseline triple every test below mutates in exactly one place. */
function baseline() {
  const incident = incidentFixture()
  const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
  return { incident, article, probes: passingProbes() }
}

/** Replaces one probe by id, leaving the rest of the run untouched. */
function withProbe(probes: ReturnType<typeof passingProbes>, id: string, replacement: unknown) {
  return probes.map((probe) => (probe.id === id ? replacement : probe)) as ReturnType<typeof passingProbes>
}

describe('the fact-set that is true verifies', () => {
  it('passes when every probe agrees with every stored fact', () => {
    // Arrange
    const { incident, article, probes } = baseline()
    // Act
    const result = verify(incident, article, null, probes)
    // Assert
    expect(result.findings).toEqual([])
    expect(result.verdict).toBe('PASS')
  })
})

describe('an unverified fact never reads the same as a verified one', () => {
  it('fails when a probe was never run, rather than passing on absence', () => {
    // Arrange: drop the anchor's probe entirely
    const { incident, article, probes } = baseline()
    const missing = probes.filter((probe) => probe.id !== `gitCommitDate:${ANCHOR}`)
    // Act
    const result = verify(incident, article, null, missing)
    // Assert
    expect(result.verdict).toBe('FAIL')
  })

  it('reports INDETERMINATE for a rate-limited probe, so nobody hunts a collector bug that is not there', () => {
    // Arrange
    const { incident, article, probes } = baseline()
    const limited = withProbe(probes, `ghIssue:${REPO}#13260`, {
      id: `ghIssue:${REPO}#13260`, status: 'error', detail: 'HTTP 403 rate limit exceeded',
    })
    // Act
    const result = verify(incident, article, null, limited)
    // Assert
    expect(result.verdict).toBe('INDETERMINATE')
  })

  it('reports FAIL for a sha that does not exist, which is a different problem from a timeout', () => {
    // Arrange
    const { incident, article, probes } = baseline()
    const absent = withProbe(probes, `gitCommitDate:${FIX}`, {
      id: `gitCommitDate:${FIX}`, status: 'absent', detail: 'Not a valid object name',
    })
    // Act
    const result = verify(incident, article, null, absent)
    // Assert
    expect(result.verdict).toBe('FAIL')
  })

  it('reports INDETERMINATE when the API returns something that is not JSON, because that is a transport fault', () => {
    // Arrange: an HTML login wall, the classic soft-failure a bare HTTP 200 accepts
    const { incident, article, probes } = baseline()
    const wall = withProbe(probes, `ghIssue:${REPO}#13260`, {
      id: `ghIssue:${REPO}#13260`, status: 'ok', stdout: '<html><body>Sign in</body></html>',
    })
    // Act
    const result = verify(incident, article, null, wall)
    // Assert
    expect(result.verdict).toBe('INDETERMINATE')
  })
})

describe('every date is checked against its own source, not just against the cutoff', () => {
  it('fails when knownAt drifts from the anchor commit date', () => {
    // Arrange: one minute LATER than the anchor, so every fact still predates the
    // cutoff and only the anchor-equality rule can catch the drift
    const incident = incidentFixture({ knownAt: '2026-05-17T23:42:25Z' })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
    // Act
    const result = verify(incident, article, null, passingProbes())
    // Assert
    expect(result.verdict).toBe('FAIL')
    expect(result.findings.map((f) => f.rule)).toContain('knownAt == committerDate(anchorSha)')
  })

  it('fails a fabricated commit date that still falls on the correct side of knownAt', () => {
    // Arrange: 2026-05-10 is before knownAt, so only a per-field source match catches it
    const incident = incidentFixture({
      commits: [{ sha: FIX, committedAt: '2026-05-10T00:00:00Z', subject: 'fix #13260' }],
    })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
    // Act
    const result = verify(incident, article, null, passingProbes())
    // Assert
    expect(result.findings.map((f) => f.rule)).toContain('commits[].committedAt matches its source')
  })

  it('fails when an aftermath uses the issue date where a comment id was pinned', () => {
    // Arrange: the entry cites comment 55 but claims the issue's own date
    const incident = incidentFixture({
      revealedLater: [
        { at: '2026-08-07T10:05:00Z', what: 'a maintainer explained it', evidence: { kind: 'discussion', number: 13260, commentId: 55 } },
      ],
    })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
    // Act: the comment probe says 2026-05-02, the entry claims 2026-08-07
    const result = verify(incident, article, null, passingProbes())
    // Assert
    expect(result.findings.map((f) => f.rule)).toContain('revealedLater[].at matches its source')
  })
})

describe('quoted bytes match the source they name', () => {
  it('fails when an excerpt does not match the file at the cited revision', () => {
    // Arrange: the text says something the blob does not
    const incident = incidentFixture({
      codeQuotes: [{ path: QUOTED_PATH, atSha: FIX, atShaCommittedAt: FIX_AT, startLine: 2, endLine: 3, text: 'export default function somethingElse() {}' }],
    })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]), {
      blocks: [
        { type: 'prose', sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'codeQuote', ref: `code:${FIX}:${QUOTED_PATH}:2-3` },
      ],
    })
    // Act
    const result = verify(incident, article, null, passingProbes())
    // Assert
    expect(result.findings.map((f) => f.rule)).toContain('codeQuotes[].text byte-matches the blob')
  })

  it('fails an off-by-one line range, because line 1 is the first line and slicing is inclusive', () => {
    // Arrange: the same text claimed one line higher
    const incident = incidentFixture({
      codeQuotes: [{ path: QUOTED_PATH, atSha: FIX, atShaCommittedAt: FIX_AT, startLine: 1, endLine: 2, text: BLOB.split('\n').slice(1, 3).join('\n') }],
    })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]), {
      blocks: [
        { type: 'prose', sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'codeQuote', ref: `code:${FIX}:${QUOTED_PATH}:1-2` },
      ],
    })
    // Act
    const result = verify(incident, article, null, passingProbes())
    // Assert
    expect(result.findings.map((f) => f.rule)).toContain('codeQuotes[].text byte-matches the blob')
  })

  it('fails when a quote is attributed to the wrong handle', () => {
    // Arrange
    const { incident, article, probes } = baseline()
    const wrongAuthor = withProbe(probes, `ghComment:${REPO}#c55`, {
      id: `ghComment:${REPO}#c55`, status: 'ok',
      stdout: JSON.stringify({ created_at: COMMENT_AT, user: { login: 'someone-else' }, body: COMMENT_BODY }),
    })
    // Act
    const result = verify(incident, article, null, wrongAuthor)
    // Assert
    expect(result.findings.map((f) => f.rule)).toContain('quotes[] match the comment they cite')
  })

  it('fails an excerpt that is real but sits at a different offset than the one pinned', () => {
    // Arrange: the excerpt appears at 0, the fact claims 20
    const incident = incidentFixture({
      discussions: [
        {
          kind: 'issue', number: 13260, createdAt: '2026-05-01T00:00:00Z',
          quotes: [{
            excerpt: 'This still reproduces on 7.62.0',
            bodyHash: COMMENT_HASH,
            offset: 20, author: 'a-reporter', commentId: 55,
            createdAt: COMMENT_AT, fetchedAt: '2026-09-01T00:00:00Z',
          }],
        },
      ],
    })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
    // Act
    const result = verify(incident, article, null, passingProbes())
    // Assert
    expect(result.findings.map((f) => f.rule)).toContain('quotes[] match the comment they cite')
  })
})

describe('no quoted line carries an email address', () => {
  it('fails a code excerpt containing a maintainer address, rather than redacting it at render', () => {
    // Arrange: the shape of package.json's own author field in this repo
    const incident = incidentFixture({
      codeQuotes: [{ path: 'package.json', atSha: FIX, atShaCommittedAt: FIX_AT, startLine: 71, endLine: 71, text: '  "author": "A Name <someone@example.com>",' }],
    })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
    // Act
    const findings = pureRules(incident, article, null)
    // Assert
    expect(findings.map((f) => f.rule)).toContain('no quoted line carries an email address')
  })

  it('does not fire on an npm scope, which would silently shrink what can be quoted', () => {
    // Arrange & Act & Assert: the domain's first label starts with a digit, or there is no local part
    expect(containsEmail('import x from "@types/node"')).toBe(false)
    expect(containsEmail('"react": "pkg@1.2.3"')).toBe(false)
    expect(containsEmail('@babel/core@7.24.0')).toBe(false)
    expect(containsEmail('next@15.0.0-canary.beta')).toBe(false)
  })

  it('does fire on a real address', () => {
    // Arrange & Act & Assert
    expect(containsEmail('contact: someone@example.com for details')).toBe(true)
  })
})

describe('the license caps hold at their exact boundary', () => {
  /** Article citing one excerpt of `lines` lines, with `prose` notional prose lines. */
  function cappedPair(lines: number, prose: number) {
    const text = Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n')
    const incident = incidentFixture({
      codeQuotes: [{ path: QUOTED_PATH, atSha: FIX, atShaCommittedAt: FIX_AT, startLine: 1, endLine: lines, text }],
    })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]), {
      blocks: [
        { type: 'prose', sentences: Array.from({ length: prose }, (_, i) => ({ text: `Prose sentence ${i + 1}.`, cites: i === 0 ? [] : [`commit:${FIX}`] })) },
        { type: 'codeQuote', ref: `code:${FIX}:${QUOTED_PATH}:1-${lines}` },
      ],
    })
    return { incident, article }
  }

  it('accepts exactly 40 lines from one path', () => {
    // Arrange: 40 quoted against 120 prose lines is exactly 0.25, so only the per-path cap is in play
    const { incident, article } = cappedPair(40, 120)
    // Act
    const rules = pureRules(incident, article, null).map((f) => f.rule)
    // Assert
    expect(rules).not.toContain('no more than 40 lines from any single path')
  })

  it('rejects 41 lines from one path', () => {
    // Arrange
    const { incident, article } = cappedPair(41, 200)
    // Act
    const rules = pureRules(incident, article, null).map((f) => f.rule)
    // Assert
    expect(rules).toContain('no more than 40 lines from any single path')
  })

  it('accepts a quoted-to-prose ratio of exactly 0.25', () => {
    // Arrange: 2 quoted, 6 prose, 2 / 8 = 0.25
    const { incident, article } = cappedPair(2, 6)
    // Act
    const rules = pureRules(incident, article, null).map((f) => f.rule)
    // Assert
    expect(rules).not.toContain('quoted-to-prose ratio at most 0.25')
  })

  it('rejects a ratio just above 0.25', () => {
    // Arrange: 2 quoted, 5 prose, 2 / 7 = 0.2857
    const { incident, article } = cappedPair(2, 5)
    // Act
    const rules = pureRules(incident, article, null).map((f) => f.rule)
    // Assert
    expect(rules).toContain('quoted-to-prose ratio at most 0.25')
  })

  it('holds the cap constants at the values the design fixed, so neither drifts unnoticed', () => {
    // Arrange & Act & Assert
    expect(MAX_QUOTED_LINES_PER_PATH).toBe(40)
    expect(MAX_QUOTED_RATIO).toBe(0.25)
  })

  it('counts an excerpt cited by two blocks once, because the exposure is the excerpt and not the render', () => {
    // Arrange
    const incident = incidentFixture()
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]), {
      blocks: [
        { type: 'prose', sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'codeQuote', ref: `code:${FIX}:${QUOTED_PATH}:2-3` },
        { type: 'codeQuote', ref: `code:${FIX}:${QUOTED_PATH}:2-3` },
      ],
    })
    // Act
    const perPath = countQuotedLines(incident, article)
    // Assert
    expect(perPath.get(QUOTED_PATH)).toBe(2)
  })

  it('ignores an excerpt the collector gathered but no block printed', () => {
    // Arrange: the incident carries the quote, the article never cites it
    const incident = incidentFixture()
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]), {
      blocks: [{ type: 'prose', sentences: [{ text: 'The lede.', cites: [] }] }],
    })
    // Act
    const perPath = countQuotedLines(incident, article)
    // Assert
    expect(perPath.size).toBe(0)
  })

  it('measures prose in 80-character lines, rounding up', () => {
    // Arrange: 81 characters is two notional lines, 80 is one
    const incident = incidentFixture()
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]), {
      blocks: [{ type: 'prose', sentences: [{ text: 'x'.repeat(81), cites: [] }, { text: 'y'.repeat(80), cites: [`commit:${FIX}`] }] }],
    })
    // Act
    const lines = countProseLines(article)
    // Assert
    expect(lines).toBe(3)
  })

  it('rejects code quotes on a repo with no detected license', () => {
    // Arrange
    const incident = incidentFixture({ repo: { nameWithOwner: REPO, defaultBranch: 'master', spdxLicense: 'NOASSERTION' } })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
    // Act
    const rules = pureRules(incident, article, null).map((f) => f.rule)
    // Assert
    expect(rules).toContain('an undeclared license permits no excerpting')
  })
})

describe('republishing cannot rewrite what was already announced', () => {
  const previous = {
    identity: { nameWithOwner: REPO, id: 'rhf-fieldarray-revert', anchorSha: ANCHOR },
    publishedAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  }

  it('fails when publishedAt moves on a regeneration', () => {
    // Arrange
    const incident = incidentFixture()
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]), {
      publishedAt: '2026-09-02T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
    })
    // Act
    const rules = pureRules(incident, article, previous).map((f) => f.rule)
    // Assert
    expect(rules).toContain('publishedAt is frozen once published')
  })

  it('fails when updatedAt does not move, because the feed would announce nothing while the body changed', () => {
    // Arrange: identical to the previous publication
    const incident = incidentFixture()
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
    // Act
    const rules = pureRules(incident, article, previous).map((f) => f.rule)
    // Assert
    expect(rules).toContain('updatedAt strictly increases')
  })

  it('fails when the anchor moves under an already-published URL', () => {
    // Arrange: same repo, same id, an earlier cutoff. The commit list shrinks with
    // it, because a fact dated after knownAt is rejected by the schema first.
    const incident = incidentFixture({
      anchorSha: FIX,
      knownAt: FIX_AT,
      commits: [{ sha: FIX, committedAt: FIX_AT, subject: 'fix #13260' }],
    })
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]), {
      titleCites: [`commit:${FIX}`],
      dekCites: [`commit:${FIX}`],
      updatedAt: '2026-09-02T00:00:00Z',
    })
    // Act
    const rules = pureRules(incident, article, previous).map((f) => f.rule)
    // Assert
    expect(rules).toContain('the identity tuple is unchanged')
  })

  it('applies none of the republication rules on a first publish', () => {
    // Arrange
    const incident = incidentFixture()
    const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
    // Act
    const rules = pureRules(incident, article, null).map((f) => f.rule)
    // Assert
    expect(rules).not.toContain('publishedAt is frozen once published')
    expect(rules).not.toContain('updatedAt strictly increases')
  })
})
