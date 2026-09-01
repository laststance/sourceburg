import { articleRefs } from './facts'

import type { Article } from './schema'

/**
 * Assigns each distinct citation its `[n]`, in first-appearance order across
 * title, dek, blocks, then aftermath. Numbering is DERIVED, never stored: an `n`
 * field on the model would mean editing one paragraph renumbers, and therefore
 * changes the content hash of, every other citation in the article.
 *
 * @param article - the article to number
 * @returns
 * - `ordered`: the distinct refs, index `i` carrying marker `i + 1`
 * - `numberOf`: ref to its 1-based marker
 * @example assignCitationNumbers(a).numberOf.get('commit:abc…') // => 1
 */
export function assignCitationNumbers(article: Article): {
  ordered: string[]
  numberOf: Map<string, number>
} {
  const ordered: string[] = []
  const numberOf = new Map<string, number>()
  // First appearance wins, so a ref used in three blocks gets one number.
  for (const ref of articleRefs(article)) {
    if (numberOf.has(ref)) continue
    ordered.push(ref)
    numberOf.set(ref, ordered.length)
  }
  return { ordered, numberOf }
}
