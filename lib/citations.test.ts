import { describe, expect, it } from 'vitest'

import { assignCitationNumbers } from './citations'
import { Article } from './schema'

const SHA_A = 'a2ac01fd3872cf95b4e6ac8f4b4800f72b55eafd'
const SHA_B = 'c6c3d87eb844af1fd1c01428f2fa113735982d4c'
const SHA_C = 'dfcebdbde1891fdd76fb56751cbe08dd980dfa5b'

/** Article whose refs appear in a known order across all four regions. */
function numberedArticle() {
  return Article.parse({
    incidentId: 'rhf-fieldarray-revert',
    lang: 'en',
    persona: 'desk',
    title: 'A headline',
    titleCites: [`commit:${SHA_A}`],
    dek: 'A dek',
    dekCites: [`commit:${SHA_B}`],
    publishedAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    blocks: [
      { type: 'prose', sentences: [{ text: 'The lede.', cites: [] }] },
      // Cites the headline's ref again, then a new one.
      { type: 'prose', sentences: [{ text: 'A claim.', cites: [`commit:${SHA_A}`, `commit:${SHA_C}`] }] },
    ],
    aftermath: [{ text: 'Later.', ref: 'revealed:commit:x:abc123abc123' }],
  })
}

describe('the same article numbers its citations the same way on every build', () => {
  it('produces an identical order when numbered twice, so a rebuild cannot renumber a published article', () => {
    // Arrange
    const article = numberedArticle()
    // Act
    const first = assignCitationNumbers(article).ordered
    const second = assignCitationNumbers(article).ordered
    // Assert
    expect(second).toEqual(first)
  })

  it('gives a ref used in two places one number, taken from where it first appeared', () => {
    // Arrange: SHA_A is cited by the headline and again in the body
    const article = numberedArticle()
    // Act
    const { numberOf, ordered } = assignCitationNumbers(article)
    // Assert
    expect(numberOf.get(`commit:${SHA_A}`)).toBe(1)
    expect(ordered.filter((ref) => ref === `commit:${SHA_A}`)).toHaveLength(1)
  })

  it('numbers the headline before the dek before the body before the aftermath', () => {
    // Arrange
    const article = numberedArticle()
    // Act
    const { ordered } = assignCitationNumbers(article)
    // Assert
    expect(ordered).toEqual([
      `commit:${SHA_A}`,
      `commit:${SHA_B}`,
      `commit:${SHA_C}`,
      'revealed:commit:x:abc123abc123',
    ])
  })

  it('includes the aftermath sources, so the footer list is not missing the ones only it cites', () => {
    // Arrange
    const article = numberedArticle()
    // Act
    const { numberOf } = assignCitationNumbers(article)
    // Assert
    expect(numberOf.get('revealed:commit:x:abc123abc123')).toBe(4)
  })
})
