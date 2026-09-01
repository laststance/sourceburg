import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Article, Incident } from './schema'
import { identityOf } from './verify/plan'

import type { PreviouslyPublished } from './verify/plan'

/*
 * Publication is a POINTER SWAP, never a directory swap.
 *
 * Each run writes a fresh `v-{hash}` directory and then moves one file into
 * place. `rename` within a filesystem is atomic, so a crash at any instant
 * leaves the manifest naming the previous version or the new one — never a
 * directory that is half written. The two-step "move old aside, move new in"
 * shape it replaces has a window where the article does not exist at all.
 *
 * fsync is deliberately NOT called. The failure this defends against is process
 * death, and page-cache writes outlive the process that made them; surviving
 * power loss would need `F_FULLFSYNC` on darwin and is not what P43 tests.
 */

/*
 * What `manifest.json` holds, DERIVED from {@link PreviouslyPublished} rather
 * than re-declared. The verifier's republication rules read a
 * {@link PreviouslyPublished}; a manifest IS one, plus the version it points at.
 * Spelling the four fields out twice would compile forever under structural
 * typing and drift the first time a field is added to one side only.
 */
export type Manifest = PreviouslyPublished & { version: string }

const MANIFEST = 'manifest.json'
const MANIFEST_TMP = 'manifest.tmp'
const LOCK = '.publish.lock'

/** Recursively key-sorted clone with `fetchedAt` dropped, so hashing is order-independent. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object' || value === null) return value
  const entries = Object.entries(value)
    // `fetchedAt` moves on every collector run and says nothing about the story.
    // Hashing it would mint a new version, and move `updatedAt`, for a re-fetch
    // that changed no fact. Same reasoning that exempts it from the knownAt partition.
    .filter(([key]) => key !== 'fetchedAt')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return Object.fromEntries(entries.map(([key, v]) => [key, canonical(v)]))
}

/**
 * The version directory name, derived from the content so the same facts and the
 * same prose always land in the same place.
 *
 * @returns `v-` followed by 16 hex characters
 * @example versionHash(incident, article) // => 'v-8f14e45fceea167a'
 */
export function versionHash(incident: Incident, article: Article): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ incident: canonical(incident), article: canonical(article) }))
    .digest('hex')
  return `v-${digest.slice(0, 16)}`
}

/** Where one incident's versions and pointer live. */
export function incidentDir(contentDir: string, id: string): string {
  return join(contentDir, 'incidents', id)
}

/**
 * Reads the current pointer. Returns null when nothing has been published, which
 * is what the writer needs in order to carry `publishedAt` forward.
 *
 * @returns the manifest, or null when the incident has never been published
 * @example (await readManifest(dir))?.publishedAt // the frozen publication date
 */
export async function readManifest(dir: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')) as Manifest
  } catch {
    return null
  }
}

/**
 * Takes the publish lock. A lock whose owning process is gone is treated as
 * stale and reclaimed, because P43 kills processes mid-publish by design and a
 * lock nobody holds would block every later run.
 *
 * @returns nothing; throws when another LIVE process holds the lock
 * @example await acquireLock(dir) // throws on a concurrent run
 */
export async function acquireLock(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, LOCK)
  try {
    // `wx` is O_CREAT|O_EXCL: the create and the pid write are one operation, so
    // there is no window where the lock exists without an owner recorded in it.
    await writeFile(path, String(process.pid), { flag: 'wx' })
    return
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error
  }

  const owner = Number((await readFile(path, 'utf8')).trim())
  if (Number.isInteger(owner) && owner > 0) {
    try {
      // Signal 0 tests for existence without delivering anything.
      process.kill(owner, 0)
      throw new Error(`another publish is running (pid ${owner}); holding ${path}`)
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'ESRCH') throw error
    }
  }
  await rm(path, { force: true })
  await writeFile(path, String(process.pid), { flag: 'wx' })
}

export async function releaseLock(dir: string): Promise<void> {
  await rm(join(dir, LOCK), { force: true })
}

/**
 * Writes one version directory in full. Nothing here is visible to a reader:
 * until the pointer swaps, this is just bytes on disk nobody references.
 *
 * @returns the version directory name that was written
 * @example await writeVersion(dir, incident, article) // => 'v-8f14e45fceea167a'
 */
export async function writeVersion(
  dir: string,
  incident: Incident,
  article: Article,
): Promise<string> {
  const version = versionHash(incident, article)
  const versionDir = join(dir, version)
  await mkdir(versionDir, { recursive: true })
  await writeFile(join(versionDir, 'incident.fact.json'), JSON.stringify(incident, null, 2), 'utf8')
  await writeFile(join(versionDir, 'article.json'), JSON.stringify(article, null, 2), 'utf8')
  return version
}

/**
 * The one atomic step. Writes the manifest to a temporary name and renames it
 * over the live one, so no reader ever observes a partial manifest.
 *
 * @example await swapPointer(dir, manifest) // the article is live after this line
 */
export async function swapPointer(dir: string, manifest: Manifest): Promise<void> {
  const tmp = join(dir, MANIFEST_TMP)
  await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8')
  await rename(tmp, join(dir, MANIFEST))
}

/**
 * Publishes one article, refusing anything that would rewrite an existing
 * publication's history rather than silently correcting it.
 *
 * @param incident - the verified fact-set
 * @param article - the verified article
 * @param options - content root, and the timestamp to record as `updatedAt`
 * @returns the manifest now live
 * @example (await publish(incident, article, { contentDir, updatedAt })).version
 */
export async function publish(
  incident: Incident,
  article: Article,
  options: { contentDir: string; updatedAt: string },
): Promise<Manifest> {
  const dir = incidentDir(options.contentDir, incident.id)
  const identity = identityOf(incident)

  await acquireLock(dir)
  try {
    const previous = await readManifest(dir)
    if (previous !== null) {
      for (const key of ['nameWithOwner', 'id', 'anchorSha'] as const) {
        if (identity[key] !== previous.identity[key]) {
          throw new Error(
            `${key} was ${previous.identity[key]}, now ${identity[key]}; a changed identity is a new incident, not an update`,
          )
        }
      }
      if (article.publishedAt !== previous.publishedAt) {
        throw new Error(
          `publishedAt is frozen at ${previous.publishedAt}; the article says ${article.publishedAt}`,
        )
      }
      if (options.updatedAt < previous.updatedAt) {
        throw new Error(`updatedAt would go backwards: ${previous.updatedAt} to ${options.updatedAt}`)
      }
    }

    const version = await writeVersion(dir, incident, article)
    const manifest: Manifest = {
      version,
      identity,
      publishedAt: previous?.publishedAt ?? article.publishedAt,
      updatedAt: options.updatedAt,
    }
    await swapPointer(dir, manifest)
    return manifest
  } finally {
    await releaseLock(dir)
  }
}

/**
 * Reads back what the pointer names, parsing both halves. A manifest that
 * resolves to a truncated `article.json` is the half-published state the version
 * scheme exists to prevent, so "resolves" is not enough of an assertion.
 *
 * @returns the published pair, or null when nothing is published
 * @example (await readPublished(dir))?.article.title
 */
export async function readPublished(
  dir: string,
): Promise<{ manifest: Manifest; incident: Incident; article: Article } | null> {
  const manifest = await readManifest(dir)
  if (manifest === null) return null
  const versionDir = join(dir, manifest.version)
  const incident = Incident.parse(JSON.parse(await readFile(join(versionDir, 'incident.fact.json'), 'utf8')))
  const article = Article.parse(JSON.parse(await readFile(join(versionDir, 'article.json'), 'utf8')))
  return { manifest, incident, article }
}
