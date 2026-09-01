import { describe, expect, it } from 'vitest'
import { revealedRefFor } from './facts'
import { Article, Incident, RepoPath, Sha, Slug, articleSchemaFor } from './schema'

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

/*
 * The fixtures below use REAL react-hook-form object names and REAL committer
 * dates normalized to Z, so the same values carry over to the verifier tests that
 * will run `git cat-file` against them.
 */
const ANCHOR = 'a2ac01fd3872cf95b4e6ac8f4b4800f72b55eafd'
const FIX = 'c6c3d87eb844af1fd1c01428f2fa113735982d4c'
const REVERT = 'dfcebdbde1891fdd76fb56751cbe08dd980dfa5b'
const REFIX = '5e9e02453d86c856de3e362e404aee8ad52921e9'
const KNOWN_AT = '2026-05-17T23:41:25Z'

/** Incident anchored at the regression test, with the refix as its aftermath. */
function rhfIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rhf-fieldarray-revert',
    signal: 'git-trace' as const,
    selection: { kind: 'manual' as const, reason: 'found by hand' },
    repo: {
      nameWithOwner: 'react-hook-form/react-hook-form',
      defaultBranch: 'master',
      spdxLicense: 'MIT',
    },
    anchorSha: ANCHOR,
    knownAt: KNOWN_AT,
    commits: [
      { sha: FIX, committedAt: '2026-05-09T02:02:12Z', subject: 'fix #13260' },
      { sha: REVERT, committedAt: '2026-05-17T23:01:00Z', subject: 'Revert "fix #13260"' },
      { sha: ANCHOR, committedAt: KNOWN_AT, subject: 'test(useFieldArray): regression coverage' },
    ],
    discussions: [],
    codeQuotes: [],
    diff: null,
    revealedLater: [
      {
        at: '2026-08-07T10:05:00Z',
        what: 'the bug was fixed again, differently',
        evidence: { kind: 'commit' as const, sha: REFIX },
      },
    ],
    ...overrides,
  }
}

describe('the knownAt partition is what makes the time-machine claim true', () => {
  it('rejects a commit dated after knownAt, which the article could not have known about', () => {
    // Arrange: the August refix smuggled into the breaking-news half
    const incident = rhfIncident({
      commits: [{ sha: REFIX, committedAt: '2026-08-07T10:05:00Z', subject: 'fix #13641' }],
    })
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts a fact dated exactly at knownAt, because the anchor commit is itself such a fact', () => {
    // Arrange: the anchor's own committer date equals knownAt
    const incident = rhfIncident()
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(true)
  })

  it('rejects a revelation dated exactly at knownAt, because it was knowable at publication', () => {
    // Arrange: the boundary a `<` written for `<=` would wrongly admit
    const incident = rhfIncident({
      revealedLater: [
        { at: KNOWN_AT, what: 'not actually later', evidence: { kind: 'commit' as const, sha: REFIX } },
      ],
    })
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts a revelation one second after knownAt', () => {
    // Arrange
    const incident = rhfIncident({
      revealedLater: [
        { at: '2026-05-17T23:41:26Z', what: 'barely later', evidence: { kind: 'commit' as const, sha: REFIX } },
      ],
    })
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(true)
  })

  it('rejects a code quote taken from a commit that landed after knownAt', () => {
    // Arrange: quoting the future through the codeQuotes door instead of commits
    const incident = rhfIncident({
      codeQuotes: [
        {
          path: 'src/logic/getFieldArrayParentNames.ts',
          atSha: REFIX,
          atShaCommittedAt: '2026-08-07T10:05:00Z',
          startLine: 12,
          endLine: 12,
          text: 'export default function getFieldArrayParentNames() {}',
        },
      ],
    })
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts a fetchedAt after knownAt, because when we retrieved a body is not a fact about the story', () => {
    // Arrange: the comment posted before knownAt but was fetched today
    const incident = rhfIncident({
      discussions: [
        {
          kind: 'issue' as const,
          number: 13260,
          createdAt: '2026-05-01T00:00:00Z',
          quotes: [
            {
              excerpt: 'still reproduces',
              bodyHash: 'a'.repeat(64),
              offset: 0,
              author: 'someone',
              commentId: 55,
              createdAt: '2026-05-02T00:00:00Z',
              fetchedAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      ],
    })
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(true)
  })
})

describe('two aftermath entries cannot mint the same revealed id', () => {
  it('rejects two revelations identical in date, claim, and evidence, which a Map would silently collapse', () => {
    // Arrange
    const entry = {
      at: '2026-08-07T10:05:00Z',
      what: 'the bug was fixed again, differently',
      evidence: { kind: 'commit' as const, sha: REFIX },
    }
    const incident = rhfIncident({ revealedLater: [entry, { ...entry }] })
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts two revelations on one commit that claim different things', () => {
    // Arrange: same evidence, different claim, so the digest differs
    const incident = rhfIncident({
      revealedLater: [
        { at: '2026-08-07T10:05:00Z', what: 'the bug was fixed again', evidence: { kind: 'commit' as const, sha: REFIX } },
        { at: '2026-08-07T10:05:00Z', what: 'the test was kept', evidence: { kind: 'commit' as const, sha: REFIX } },
      ],
    })
    // Act
    const result = Incident.safeParse(incident)
    // Assert
    expect(result.success).toBe(true)
  })
})

describe('an article cannot cite a fact its incident does not have', () => {
  const incident = Incident.parse(
    rhfIncident({
      discussions: [
        {
          kind: 'issue' as const,
          number: 13260,
          createdAt: '2026-05-01T00:00:00Z',
          quotes: [
            {
              excerpt: 'still reproduces',
              bodyHash: 'a'.repeat(64),
              offset: 0,
              author: 'someone',
              commentId: 55,
              createdAt: '2026-05-02T00:00:00Z',
              fetchedAt: '2026-09-01T00:00:00Z',
            },
          ],
        },
      ],
      codeQuotes: [
        {
          path: 'src/logic/getFieldArrayParentNames.ts',
          atSha: FIX,
          atShaCommittedAt: '2026-05-09T02:02:12Z',
          startLine: 12,
          endLine: 31,
          text: 'export default function getFieldArrayParentNames() {}',
        },
      ],
    }),
  )
  const CODE_REF = `code:${FIX}:src/logic/getFieldArrayParentNames.ts:12-31`
  const REVEALED_REF = revealedRefFor(incident.revealedLater[0])

  /** Article every rule accepts; each test breaks exactly one ref so the failure names that rule. */
  function rhfArticle(overrides: Record<string, unknown> = {}) {
    return {
      incidentId: 'rhf-fieldarray-revert',
      lang: 'en' as const,
      persona: 'desk' as const,
      title: 'A fix for field arrays was reverted within nine days',
      titleCites: [`commit:${REVERT}`],
      dek: 'A regression test landed in its place',
      dekCites: [`commit:${ANCHOR}`],
      publishedAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
      blocks: [
        { type: 'prose' as const, sentences: [{ text: 'The lede needs no citation.', cites: [] }] },
        { type: 'prose' as const, sentences: [{ text: 'The fix landed first.', cites: [`commit:${FIX}`] }] },
      ],
      aftermath: [{ text: 'It was fixed again in August.', ref: REVEALED_REF }],
      ...overrides,
    }
  }

  it('accepts the article the incident actually supports', () => {
    // Arrange
    const article = rhfArticle()
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(true)
  })

  it('rejects a citation that is well-formed but names a commit the incident never collected', () => {
    // Arrange: a real-looking sha that is not in this fact-set
    const article = rhfArticle({ titleCites: [`commit:${'0'.repeat(40)}`] })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects a code box whose citation points at a commit instead of a quoted excerpt', () => {
    // Arrange: the ref resolves, but to the wrong KIND of fact
    const article = rhfArticle({
      blocks: [
        { type: 'prose' as const, sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'codeQuote' as const, ref: `commit:${FIX}` },
      ],
    })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts a code box pointing at a collected excerpt', () => {
    // Arrange
    const article = rhfArticle({
      blocks: [
        { type: 'prose' as const, sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'codeQuote' as const, ref: CODE_REF },
      ],
    })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(true)
  })

  it('rejects a pull quote that names the thread instead of the comment whose words it prints', () => {
    // Arrange: `discussion:13260` asserts only that the issue exists
    const article = rhfArticle({
      blocks: [
        { type: 'prose' as const, sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'personQuote' as const, ref: 'discussion:13260' },
      ],
    })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts a pull quote pinned to the comment that carries the words', () => {
    // Arrange
    const article = rhfArticle({
      blocks: [
        { type: 'prose' as const, sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'personQuote' as const, ref: 'discussion:13260#55' },
      ],
    })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(true)
  })

  it('rejects an aftermath entry citing a commit rather than the revelation it claims', () => {
    // Arrange
    const article = rhfArticle({ aftermath: [{ text: 'Later.', ref: `commit:${REFIX}` }] })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects a diff box on an incident that collected no diff', () => {
    // Arrange: a refless block, so no citation rule can reach it
    const article = rhfArticle({
      blocks: [
        { type: 'prose' as const, sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'diffBox' as const },
      ],
    })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects a timeline box on an incident with fewer than two dated facts', () => {
    // Arrange: one commit and no discussions leaves exactly one dated fact
    const thin = Incident.parse(
      rhfIncident({ commits: [{ sha: ANCHOR, committedAt: KNOWN_AT, subject: 'only one' }] }),
    )
    const article = rhfArticle({
      titleCites: [`commit:${ANCHOR}`],
      dekCites: [`commit:${ANCHOR}`],
      blocks: [
        { type: 'prose' as const, sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'timelineBox' as const },
      ],
      aftermath: [{ text: 'Later.', ref: revealedRefFor(thin.revealedLater[0]) }],
    })
    // Act
    const result = articleSchemaFor(thin).safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('accepts a timeline box once the incident has two dated facts', () => {
    // Arrange: the full incident carries three commits
    const article = rhfArticle({
      blocks: [
        { type: 'prose' as const, sentences: [{ text: 'The lede.', cites: [] }] },
        { type: 'timelineBox' as const },
      ],
    })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(true)
  })

  it('rejects a citation that is not one of the five id forms at all, without throwing', () => {
    // Arrange: garbage reaches resolve() before parseFactRef ever sees it
    const article = rhfArticle({ titleCites: ['not-a-ref-at-all'] })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })

  it('rejects an article whose incidentId names a different incident than the fact-set it is checked against', () => {
    // Arrange
    const article = rhfArticle({ incidentId: 'some-other-story' })
    // Act
    const result = articleSchemaFor(incident).safeParse(article)
    // Assert
    expect(result.success).toBe(false)
  })
})
