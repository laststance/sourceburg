import { probeId } from './probe'

import type { ProbeRequest, ProbeSpec } from './probe'
import type { Incident } from '../schema'

/**
 * The identity tuple: what a republish may never change.
 *
 * `nameWithOwner` and `id` are what the URL and the Atom `<id>` derive from, so
 * changing either would re-announce the article at a new address. `anchorSha` is
 * here for a different reason and is a judgment call this file makes explicit:
 * the anchor IS the cutoff, so a republish free to move it could change which
 * facts count as "known" while keeping the same URL and the same frozen
 * `publishedAt`. That is the one dishonesty the whole pipeline exists to prevent.
 */
export type IdentityTuple = { nameWithOwner: string; id: string; anchorSha: string }

/** The record of a prior publication, or `null` on first publish. */
export type PreviouslyPublished = {
  identity: IdentityTuple
  publishedAt: string
  updatedAt: string
}

export function identityOf(incident: Incident): IdentityTuple {
  return {
    nameWithOwner: incident.repo.nameWithOwner,
    id: incident.id,
    anchorSha: incident.anchorSha,
  }
}

/**
 * Maps a fact-set to the probes that can prove it. Pure, and the ONLY place this
 * mapping exists — when the executor also knows it, adding a schema field updates
 * one side and silently skips verification on the other.
 *
 * Probes are deduplicated by content-addressed id, so two code quotes from the
 * same blob cost one fetch; the `covers` arrays merge so no fact loses its proof.
 *
 * @param incident - the fact-set to verify
 * @returns every probe needed, deduplicated, in a stable order
 * @example plan(incident).filter((p) => p.kind === 'ghComment').length // one per quote
 */
export function plan(incident: Incident): ProbeRequest[] {
  const requests = new Map<string, ProbeRequest>()
  const repo = incident.repo.nameWithOwner

  const add = (spec: ProbeSpec, covers: string) => {
    const id = probeId(spec)
    const existing = requests.get(id)
    if (existing) {
      existing.covers.push(covers)
      return
    }
    requests.set(id, { ...spec, id, covers: [covers] })
  }

  // The anchor's own date IS knownAt, so it needs a probe even when the anchor
  // never appears in `commits`.
  add({ kind: 'gitCommitDate', sha: incident.anchorSha }, 'anchorSha')

  incident.commits.forEach((commit, i) => {
    add({ kind: 'gitCommitDate', sha: commit.sha }, `commits[${i}]`)
    // The subject is rendered text — it is the label of a timeline row — so it
    // needs its own proof, not just a sha that resolves.
    add({ kind: 'gitCommitSubject', sha: commit.sha }, `commits[${i}].subject`)
  })

  incident.discussions.forEach((discussion, i) => {
    add({ kind: 'ghIssue', repo, number: discussion.number }, `discussions[${i}]`)
    // Each quote needs the comment itself: its body, its author, and its own date,
    // none of which the issue payload carries.
    discussion.quotes.forEach((quote, j) =>
      add({ kind: 'ghComment', repo, commentId: quote.commentId }, `discussions[${i}].quotes[${j}]`),
    )
  })

  incident.codeQuotes.forEach((quote, i) => {
    add({ kind: 'gitBlob', sha: quote.atSha, path: quote.path }, `codeQuotes[${i}]`)
    // The excerpt's own claim about when that revision landed needs its own proof.
    add({ kind: 'gitCommitDate', sha: quote.atSha }, `codeQuotes[${i}].atShaCommittedAt`)
  })

  if (incident.diff !== null) {
    const { beforeSha, afterSha, path } = incident.diff
    add({ kind: 'gitDiff', beforeSha, afterSha, path }, 'diff')
    add({ kind: 'gitCommitDate', sha: beforeSha }, 'diff.beforeSha')
    add({ kind: 'gitCommitDate', sha: afterSha }, 'diff.afterSha')
  }

  incident.revealedLater.forEach((entry, i) => {
    if (entry.evidence.kind === 'commit') {
      add({ kind: 'gitCommitDate', sha: entry.evidence.sha }, `revealedLater[${i}]`)
      return
    }
    // The date to match is the COMMENT's when one is pinned, the issue's when not:
    // an aftermath usually cites a comment on a thread that opened before knownAt.
    if (entry.evidence.commentId === undefined) {
      add({ kind: 'ghIssue', repo, number: entry.evidence.number }, `revealedLater[${i}]`)
      return
    }
    add({ kind: 'ghComment', repo, commentId: entry.evidence.commentId }, `revealedLater[${i}]`)
  })

  return [...requests.values()]
}
