import { describe, expect, it } from 'vitest'
import { Article, Incident, RepoPath, Sha, Slug } from './schema'

const SHA_A = 'a2ac41fd0000000000000000000000000000abcd'
const SHA_B = 'c6c3d87e0000000000000000000000000000abcd'

/** Minimal article that passes; each test mutates one field so the failure names one rule. */
function validArticle() {
  return {
    incidentId: 'rhf-fieldarray-revert',
    lang: 'en' as const,
    persona: 'desk' as const,
    title: 'A fix was reverted',
    titleCites: [`commit:${SHA_A}`],
    dek: 'And a test landed instead',
    dekCites: [`commit:${SHA_B}`],
    publishedAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    blocks: [
      { type: 'prose' as const, sentences: [{ text: 'The lede.', cites: [] }] },
      { type: 'prose' as const, sentences: [{ text: 'A claim.', cites: [`commit:${SHA_A}`] }] },
    ],
    aftermath: [{ text: 'Later.', ref: `commit:${SHA_B}` }],
  }
}

describe('branded primitives are security controls', () => {
  it('rejects a 40-char string that is not hex, so a non-sha cannot reach git', () => {
    // Arrange: right length, wrong alphabet — the case a bare .length(40) would pass
    const notHex = 'z'.repeat(40)
    // Act
    const result = Sha.safeParse(notHex)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects a slug containing a path separator, so an id cannot escape the content directory', () => {
    // Arrange
    const escaping = 'rhf/../../etc'
    // Act
    const result = Slug.safeParse(escaping)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects a repo path whose segment is .., so a code quote cannot read outside the clone', () => {
    // Arrange: every character is regex-legal; only the segment check catches it
    const traversal = 'src/../../../.ssh/id_rsa'
    // Act
    const result = RepoPath.safeParse(traversal)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts a normal source path so the guard does not block real quotes', () => {
    // Arrange
    const real = 'src/logic/getFieldArrayParentNames.ts'
    // Act
    const result = RepoPath.safeParse(real)
    // Assert
    expect(result.success).toBe(true)
  })
})

describe('timestamps are forced to UTC at the schema boundary', () => {
  it('rejects a git committer date that still carries a +10:00 offset', () => {
    // Arrange: exactly what `git log --format=%cI` prints for this repo
    const article = { ...validArticle(), publishedAt: '2026-05-18T09:41:25+10:00' }
    // Act
    const result = Article.safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts the same instant normalized to Z', () => {
    // Arrange
    const article = { ...validArticle(), publishedAt: '2026-05-17T23:41:25Z' }
    // Act
    const result = Article.safeParse(article)
    // Assert
    expect(result.success).toBe(true)
  })
})

describe('an article cannot publish an uncited claim', () => {
  it('rejects an uncited headline', () => {
    // Arrange
    const article = { ...validArticle(), titleCites: [] }
    // Act
    const result = Article.safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects an uncited dek', () => {
    // Arrange
    const article = { ...validArticle(), dekCites: [] }
    // Act
    const result = Article.safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects a non-lede prose block whose every sentence is uncited', () => {
    // Arrange: blocks[1] is not the lede, so it owes at least one citation
    const article = validArticle()
    article.blocks[1] = { type: 'prose', sentences: [{ text: 'Unsupported.', cites: [] }] }
    // Act
    const result = Article.safeParse(article)
    // Assert
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].message).toBe(
      'prose block 1 is not the lede and carries no cited sentence',
    )
  })

  it('allows the lede at blocks[0] to carry no citation', () => {
    // Arrange: blocks[0] is uncited by design; the exemption is positional
    const article = validArticle()
    // Act
    const result = Article.safeParse(article)
    // Assert
    expect(result.success).toBe(true)
  })

  it('requires a citation on a prose block at index 0 when it renders markers mid-paragraph', () => {
    // Arrange: one paragraph, only the second sentence cited — the D8 shape
    const article = validArticle()
    article.blocks[1] = {
      type: 'prose',
      sentences: [
        { text: 'Setup with no marker.', cites: [] },
        { text: 'The claim.', cites: [`commit:${SHA_A}`] },
      ],
    }
    // Act
    const result = Article.safeParse(article)
    // Assert
    expect(result.success).toBe(true)
  })
})

describe('updatedAt is monotonic so the Atom feed cannot walk backwards', () => {
  it('rejects an updatedAt earlier than publishedAt', () => {
    // Arrange
    const article = { ...validArticle(), publishedAt: '2026-09-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }
    // Act
    const result = Article.safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })
})

describe('code quote line ranges', () => {
  /** Incident wrapper varies only in codeQuotes, so the failure names the range rule. */
  function incidentWithRange(startLine: number, endLine: number) {
    return {
      id: 'rhf-fieldarray-revert',
      signal: 'git-trace' as const,
      selection: { kind: 'manual' as const, reason: 'found by hand' },
      repo: { nameWithOwner: 'react-hook-form/react-hook-form', defaultBranch: 'master', spdxLicense: 'MIT' },
      anchorSha: SHA_A,
      knownAt: '2026-05-17T23:41:25Z',
      commits: [],
      discussions: [],
      codeQuotes: [
        {
          path: 'src/logic/getFieldArrayParentNames.ts',
          atSha: SHA_B,
          atShaCommittedAt: '2026-05-09T02:02:12Z',
          startLine,
          endLine,
          text: 'export default function getFieldArrayParentNames() {}',
        },
      ],
      diff: null,
      revealedLater: [],
    }
  }

  it('rejects a reversed line range, which would make the citation id unresolvable', () => {
    // Arrange
    const incident = incidentWithRange(31, 12)
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts a one-line quote where startLine equals endLine', () => {
    // Arrange: the boundary a `<` written for `<=` would silently reject
    const incident = incidentWithRange(12, 12)
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(true)
  })
})

describe('a hand-picked incident cannot fabricate ranking scores', () => {
  it('rejects a manual selection that carries a scores object', () => {
    // Arrange
    const incident = {
      ...(() => {
        const base = {
          id: 'rhf-fieldarray-revert',
          signal: 'git-trace' as const,
          repo: { nameWithOwner: 'react-hook-form/react-hook-form', defaultBranch: 'master', spdxLicense: 'MIT' },
          anchorSha: SHA_A,
          knownAt: '2026-05-17T23:41:25Z',
          commits: [],
          discussions: [],
          codeQuotes: [],
          diff: null,
          revealedLater: [],
        }
        return base
      })(),
      selection: { kind: 'manual', reason: 'found by hand', scores: { novelty: 3, evidence: 3, consequence: 3, explicability: 3 } },
    }
    // Act
    const result = Incident.safeParse(incident)
    // Assert: strict object rejects the extra key rather than silently keeping it
    expect(result.success).toBe(false)
  })
})
