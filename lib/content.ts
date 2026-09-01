import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { readPublished } from './publish'

import type { Published } from './publish'

/*
 * The published tree as the site reads it.
 *
 * Pages read `content/`, never `evals/` and never a fact-set on someone's disk:
 * the only articles that render are the ones `publish()` wrote after `verify()`
 * exited 0. An incident directory that exists but has no pointer is a collection
 * that never passed, and it stays invisible rather than half-rendered.
 */

/** Where the site reads from, relative to the repo root. */
export const CONTENT_DIR = 'content'

/**
 * Every live publication, newest incident first.
 *
 * Ordered by `incident.knownAt`, **the incident's date, not the publication date**:
 * this is a newspaper about the past, so sorting by when the pipeline happened to
 * run would put a 2019 story above a 2024 one for no reason a reader could see.
 *
 * @param contentDir - the content root, `CONTENT_DIR` in the app
 * @returns published pairs, `knownAt` descending; `[]` when nothing is published
 * @example (await readAllPublished(CONTENT_DIR)).length // => 0 on a dry news day
 */
export async function readAllPublished(contentDir: string): Promise<Published[]> {
  let ids: string[]
  try {
    ids = await readdir(join(contentDir, 'incidents'))
  } catch {
    // No `content/incidents` at all is the same state as an empty one: N = 0.
    return []
  }

  const found = await Promise.all(ids.map((id) => readPublished(join(contentDir, 'incidents', id))))
  return found
    .filter((entry): entry is Published => entry !== null)
    .sort((a, b) => b.incident.knownAt.localeCompare(a.incident.knownAt))
}
