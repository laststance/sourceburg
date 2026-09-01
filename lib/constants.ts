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
