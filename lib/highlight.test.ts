import { join } from 'node:path'

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

describe('no renderer hands raw HTML to React', () => {
  it('finds dangerouslySetInnerHTML in the root layout and nowhere else', async () => {
    // Arrange — Shiki's `codeToHtml` returns a string of HTML, and the one obvious way to
    // render it is the one prop that turns model-adjacent text into live markup.
    // `codeToTokens` exists so that never has to happen; this is what keeps it true after
    // the next edit.
    //
    // `app/layout.tsx` is the one allowed site, and it is allowed by PATH and COUNT so that adding
    // a second is a test failure rather than a judgment call. What lives there is the
    // pre-paint script that applies a reader's stored font and size: a frozen literal
    // built from this repo's own constants, writing into an attribute, never into markup,
    // and never touching a fact-set. A renderer doing the same thing with quoted text is
    // the defect this catches, and no renderer is on the list.
    const { execFileSync } = await import('node:child_process')
    const root = join(import.meta.dirname, '..')

    // Act — one line per OCCURRENCE, not per file. `-l` would name `app/layout.tsx` once no
    // matter how many times it matched, so a second script added right beside the first would
    // have slipped through the allowlist below; `-o` with `-H` prints every hit. grep exits 1
    // when it matches nothing, which is a passing case here, so the throw is caught and read
    // as an empty result rather than as a broken test.
    let hits: string[]
    try {
      hits = execFileSync(
        'grep',
        ['-rHo', '-E', String.raw`dangerouslySetInnerHTML\s*[=:]`, '--include=*.ts', '--include=*.tsx', 'app', 'components', 'lib', 'bin'],
        { cwd: root, encoding: 'utf8' },
      )
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.slice(0, line.indexOf(':')))
    } catch {
      hits = []
    }

    // Assert
    expect(hits).toEqual(['app/layout.tsx'])
  })
})
