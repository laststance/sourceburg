import { describe, expect, it } from 'vitest'

import { highlightExcerpt, languageFor } from './highlight'

describe('a code excerpt prints the lines the citation names', () => {
  it('numbers from the excerpt first line, not from one', async () => {
    // Arrange — an excerpt of src/parser.ts:412-414; a box starting at 1 would cite
    // a range the reader cannot find in the file.
    const text = 'const a = 1\nconst b = 2\nconst c = 3'

    // Act
    const lines = await highlightExcerpt(text, 'src/parser.ts', 412)

    // Assert
    expect(lines.map((line) => line.number)).toEqual([412, 413, 414])
  })

  it('keeps every character of the excerpt, since it was byte-verified', async () => {
    // Arrange
    const text = 'export default (names: string[]) => names'

    // Act
    const lines = await highlightExcerpt(text, 'src/logic/a.ts', 3)

    // Assert
    expect(lines[0].tokens.map((token) => token.text).join('')).toBe(text)
  })
})

describe('code is printed in two tones, because the palette has five colours', () => {
  it('gives a keyword the spot tone and an identifier the ink tone', async () => {
    // Arrange
    const lines = await highlightExcerpt('return names', 'src/a.ts', 1)

    // Act
    const toneOf = (text: string) => lines[0].tokens.find((token) => token.text.trim() === text)?.tone

    // Assert
    expect(toneOf('return')).toBe('spot')
    expect(toneOf('names')).toBe('ink')
  })

  it('marks a comment so it can be set apart without a sixth colour', async () => {
    // Arrange
    const lines = await highlightExcerpt('// keep the roots', 'src/a.ts', 1)

    // Assert
    expect(lines[0].tokens.some((token) => token.comment)).toBe(true)
  })

  it('falls back to plain text for a path Shiki has no grammar for', async () => {
    // Arrange / Act / Assert — an unknown extension must not throw mid-build
    expect(languageFor('LICENSE')).toBe('text')
    expect(languageFor('src/a.ts')).toBe('ts')
    await expect(highlightExcerpt('anything at all', 'LICENSE', 1)).resolves.toHaveLength(1)
  })
})
