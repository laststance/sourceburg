/*
 * Dates the reader sees.
 *
 * Formatted in UTC, always. Every date in a fact-set was normalized to `Z` at the git
 * boundary so that a committer's zone offset could never drift a comparison; letting
 * the render layer re-localise them would put that drift back in the one place it is
 * visible, and an article's dateline would change depending on where it was built.
 */

/**
 * The dateline form: a full month name, the day, the year, in broadsheet caps.
 * @param iso - a `Z`-normalized ISO timestamp from the fact-set
 * @returns the display date, uppercased
 * @example datelineOf('2019-03-11T09:41:25Z') // => 'MARCH 11, 2019'
 */
export function datelineOf(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
    .format(new Date(iso))
    .toUpperCase()
}
