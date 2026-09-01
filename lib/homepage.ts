import { articleHref } from './links'

import type { Published } from './publish'

/*
 * What `/` is, at N articles.
 *
 * The branch lives here rather than in `app/page.tsx` so all three states are fixed
 * in Vitest and the browser only has to confirm placement. N = 0 is a normal state,
 * not an error: a dry news day is a documented success path, and the launch screen
 * and the empty screen are the same screen.
 */

/** What `/` renders, and the canonical URL that composition implies. */
export type HomepageLayout =
  | { kind: 'empty'; lead: null; rest: Published[]; canonical: string }
  | { kind: 'lead'; lead: Published; rest: Published[]; canonical: string }
  | { kind: 'leadWithList'; lead: Published; rest: Published[]; canonical: string }

/**
 * Composes `/` for the number of published incidents.
 *
 * `canonical` branches on **whether the lead's body is on this page**, not on N —
 * the fold is unchanged as N grows, so `/` carries the lead story at every N >= 1
 * and must point at the incident URL rather than at itself. Only N = 0 names `/`.
 *
 * @param published - every live publication, `knownAt` descending
 * @returns
 * - `empty` at 0: the `NO NEWS TODAY` plate, canonical `/`
 * - `lead` at 1: the story is the front page, canonical the incident URL
 * - `leadWithList` at 2+: same fold, later stories in single-column slots below
 * @example deriveHomepageLayout([]).kind // => 'empty'
 */
export function deriveHomepageLayout(published: Published[]): HomepageLayout {
  const [lead, ...rest] = published
  if (lead === undefined) return { kind: 'empty', lead: null, rest: [], canonical: '/' }

  const canonical = articleHref(lead.incident)
  return rest.length === 0
    ? { kind: 'lead', lead, rest, canonical }
    : { kind: 'leadWithList', lead, rest, canonical }
}
