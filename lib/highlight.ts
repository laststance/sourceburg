import { codeToTokens } from 'shiki'

import type { BundledLanguage, SpecialLanguage } from 'shiki'

/*
 * Build-time syntax highlighting, in the palette this site actually has.
 *
 * Shiki returns HTML, and `dangerouslySetInnerHTML` appears nowhere in this
 * codebase — the XSS surface is removed rather than sanitized — so this uses the
 * token API and the renderer builds React elements from plain strings.
 *
 * A theme would also bring twenty colours onto a page whose palette is five. So the
 * theme's own colours are discarded and each token is re-sorted by SCOPE into two
 * tones: `--code-spot` for the words that carry the structure, `--ink` for the rest.
 * Two tones is what letterpress could print, which is the look this site is after.
 */

/** Scope prefixes that earn the spot colour. Deliberately short: two tones, not twenty. */
const SPOT_SCOPES = ['keyword', 'string', 'constant', 'storage.type', 'support.type'] as const

/** Shiki wants a language id, and a path is what the fact-set stores. */
const LANGUAGE_BY_EXTENSION: Record<string, BundledLanguage> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  css: 'css',
  md: 'markdown',
  html: 'html',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shell',
  py: 'python',
  rs: 'rust',
  go: 'go',
}

/** One run of characters that shares a tone. */
export type CodeToken = { text: string; tone: 'ink' | 'spot'; comment: boolean }

/** One printed line, numbered as it is numbered in the file. */
export type CodeLine = { number: number; tokens: CodeToken[] }

/**
 * The language id for a repo path, falling back to unhighlighted text.
 * @param path - a repository-relative path
 * @returns a Shiki language id, or `'text'` when the extension is unknown
 * @example languageFor('src/a.ts') // => 'ts'
 */
export function languageFor(path: string): BundledLanguage | SpecialLanguage {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return LANGUAGE_BY_EXTENSION[extension] ?? 'text'
}

/**
 * Tokenizes one verified excerpt for printing, numbering from its real first line.
 *
 * The numbers matter: line numbers are part of the citation id, so an excerpt of
 * `src/parser.ts:412-431` has to print 412 through 431. Shiki numbers a snippet from
 * 1, so the offset is passed explicitly rather than left to a default.
 *
 * @param text - the excerpt exactly as the fact-set verified it
 * @param path - the repo path, used only to pick a language
 * @param startLine - the excerpt's first line number in the file
 * @returns one entry per line, each carrying its real number and its tones
 * @example (await highlightExcerpt(text, 'src/a.ts', 412))[0].number // => 412
 */
export async function highlightExcerpt(text: string, path: string, startLine: number): Promise<CodeLine[]> {
  const { tokens } = await codeToTokens(text, {
    lang: languageFor(path),
    theme: 'github-light',
    includeExplanation: 'scopeName',
  })

  return tokens.map((line, index) => ({
    number: startLine + index,
    tokens: line.map((token) => {
      const scopes = (token.explanation ?? []).flatMap((part) => part.scopes.map((scope) => scope.scopeName))
      const deepest = scopes.at(-1) ?? ''
      return {
        text: token.content,
        tone: SPOT_SCOPES.some((prefix) => deepest.startsWith(prefix)) ? 'spot' : 'ink',
        comment: deepest.startsWith('comment'),
      }
    }),
  }))
}
