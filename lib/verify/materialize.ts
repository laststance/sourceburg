import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { ProbeResult } from './probe'

/*
 * Pinning, per decision 13A. The full fetched body goes to a gitignored cache;
 * the artifact of record keeps only the hash, the adopted excerpt, its byte
 * offset, the author, the dates, and fetchedAt.
 *
 * Committing full third-party bodies would preserve a deleted comment in a public
 * history forever and would publish injection payloads verbatim even when they
 * never reach an article. The hash is what makes verification possible without
 * keeping the body.
 */

/** What the collector wants to quote, before it has been checked against the body. */
export type QuoteDraft = { commentId: number; excerpt: string }

/** A quote pinned to a body that existed, at an offset that was measured. */
export type PinnedQuote = {
  commentId: number
  excerpt: string
  bodyHash: string
  offset: number
  author: string
  createdAt: string
  fetchedAt: string
}

export type MaterializeResult = {
  pinned: PinnedQuote[]
  rejected: { commentId: number; reason: string }[]
}

/**
 * Writes fetched bodies to the private cache and returns each quote pinned to
 * what was actually there. A draft whose excerpt is not a substring of the body
 * is REJECTED rather than adjusted — a near-miss quotation is the failure this
 * whole pipeline exists to make impossible.
 *
 * @param drafts - the excerpts the collector wants to keep
 * @param probes - `ghComment` results carrying the fetched bodies
 * @param options - cache directory and the timestamp to record as `fetchedAt`
 * @returns the pinned quotes, plus every draft that could not be pinned and why
 * @example (await materialize(drafts, probes, opts)).rejected.length // => 0
 */
export async function materialize(
  drafts: readonly QuoteDraft[],
  probes: readonly ProbeResult[],
  options: { cacheDir: string; fetchedAt: string; repo: string },
): Promise<MaterializeResult> {
  const { cacheDir, fetchedAt, repo } = options
  const byId = new Map(probes.map((probe) => [probe.id, probe]))
  const pinned: PinnedQuote[] = []
  const rejected: { commentId: number; reason: string }[] = []

  await mkdir(cacheDir, { recursive: true })

  for (const draft of drafts) {
    const probe = byId.get(`ghComment:${repo}#c${draft.commentId}`)
    if (probe === undefined || probe.status !== 'ok') {
      rejected.push({ commentId: draft.commentId, reason: 'the comment was never fetched' })
      continue
    }

    let payload: { body?: unknown; user?: unknown; created_at?: unknown }
    try {
      payload = JSON.parse(probe.stdout) as typeof payload
    } catch {
      rejected.push({ commentId: draft.commentId, reason: 'the comment body did not parse as JSON' })
      continue
    }

    const body = typeof payload.body === 'string' ? payload.body : null
    const author =
      typeof payload.user === 'object' && payload.user !== null
        ? (payload.user as { login?: unknown }).login
        : undefined
    const createdAt = payload.created_at

    if (body === null || typeof author !== 'string' || typeof createdAt !== 'string') {
      rejected.push({ commentId: draft.commentId, reason: 'the comment is missing a body, an author, or a date' })
      continue
    }

    const offset = body.indexOf(draft.excerpt)
    if (offset === -1) {
      // Not adjusted, not fuzzy-matched: rejected.
      rejected.push({ commentId: draft.commentId, reason: 'the excerpt does not appear in the fetched body' })
      continue
    }

    // The body lands in the gitignored cache; only the hash leaves this function.
    await writeFile(join(cacheDir, `comment-${draft.commentId}.json`), probe.stdout, 'utf8')

    pinned.push({
      commentId: draft.commentId,
      excerpt: draft.excerpt,
      bodyHash: createHash('sha256').update(body).digest('hex'),
      offset,
      author,
      createdAt,
      fetchedAt,
    })
  }

  return { pinned, rejected }
}
