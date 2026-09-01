/*
 * License caps and the arithmetic behind them. The numbers are arbitrary but
 * FIXED, which is the only property that makes them machine-checkable: a cap
 * argued case by case is guidance, and guidance does not block a publish.
 */

/** Hard cap on excerpted lines from any single path in one article, regardless of license. */
export const MAX_QUOTED_LINES_PER_PATH = 40

/** Hard cap on `quotedLines / (quotedLines + proseLines)`. */
export const MAX_QUOTED_RATIO = 0.25

/** Prose is measured in notional 80-char lines so the ratio compares like with like. */
export const PROSE_CHARS_PER_LINE = 80

/** SPDX ids that permit excerpting at all; anything else means link-and-paraphrase. */
export const EXCERPTABLE_LICENSES = [
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC',
  'GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'MPL-2.0',
] as const

/** The production origin, no trailing slash. Absolute URLs in the feed need one. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sourceburg.vercel.app'

/** How much of a long value a verification finding prints before eliding it. */
export const FINDING_DETAIL_CHARS = 60

/*
 * The two reader knobs. Both live on `<html>` as data attributes and in localStorage
 * under these keys, and `app/globals.css` is the only thing that reads the attributes.
 *
 * Values are strings a reader's browser hands back, so nothing here may ever reach the
 * page as markup: the pre-paint script puts them in an ATTRIBUTE, where an unknown
 * value simply matches no rule and falls back to the default below.
 */

/** The `<html>` attribute carrying the typeface choice. `globals.css` keys its override off it. */
export const READING_FONT_ATTR = 'data-reading-font'

/** The `<html>` attribute carrying the size step. */
export const READING_SIZE_ATTR = 'data-reading-size'

/** localStorage key for the typeface choice. Namespaced, because localStorage is per-origin. */
export const READING_FONT_KEY = 'sourceburg:reading-font'

/** localStorage key for the text-size step. */
export const READING_SIZE_KEY = 'sourceburg:reading-size'

/** The typefaces a reader may pick, in menu order. `serif` is the desk's own choice. */
export const READING_FONTS = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans-serif' },
] as const

/** The size steps, in menu order. Each maps to a `--reading-scale` in `globals.css`. */
export const READING_SIZES = [
  { value: 'regular', label: 'Regular' },
  { value: 'large', label: 'Large' },
  { value: 'larger', label: 'Larger' },
] as const

export type ReadingFont = (typeof READING_FONTS)[number]['value']
export type ReadingSize = (typeof READING_SIZES)[number]['value']

/** What the server renders, and what an unset or unrecognised stored value falls back to. */
export const READING_FONT_DEFAULT: ReadingFont = 'serif'
export const READING_SIZE_DEFAULT: ReadingSize = 'regular'
