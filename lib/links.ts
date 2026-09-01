import { parseFactRef, revealedRefFor } from './facts'

import type { Incident } from './schema'

/*
 * Every URL and every visible source label on the site is built here, from ids.
 *
 * The writer emits ids and never a URL, so a link on the page is a function of a
 * verified fact rather than of something a model typed. That only holds if there
 * is one construction; two would drift, and the drifting one would still render.
 *
 * The labels are DERIVED — a kind, a number, a short sha, a line range. They never
 * carry fact-set prose. That is a security choice, not a style one: a footer row
 * built from `commits[].subject` would put text on the page that nothing verifies
 * (TODOS #5) and that the injection eval's `chosen` bucket does not watch, which
 * is exactly the laundering route the first live run exposed. Ids cannot carry a
 * payload; a commit subject can.
 */

/** GitHub's own short form, and the width the footer column is set for. */
const SHORT_SHA_LENGTH = 7

/**
 * The URL segment for a repository, derived rather than looked up, so no table can
 * disagree with it.
 * @param nameWithOwner - `owner/name` as the fact-set records it
 * @returns the slug used in `/{repo-slug}/{incident-id}`
 * @example repoSlugOf('vitejs/vite') // => 'vitejs-vite'
 */
export function repoSlugOf(nameWithOwner: string): string {
  return nameWithOwner
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Where one article lives. Built from the fact-set, never stored. */
export function articleHref(incident: Incident): string {
  return `/${repoSlugOf(incident.repo.nameWithOwner)}/${incident.id}`
}

/**
 * `issues` for an issue, `pull` for a PR — GitHub redirects the wrong one, readers
 * notice. Null when the fact-set has no such thread: guessing the segment would put
 * a URL on the page that nothing verified, which is the one thing this site claims
 * it never does. `articleSchemaFor` already refuses such a ref, so this is the
 * second wall rather than the first.
 */
function threadSegment(incident: Incident, number: number): 'issues' | 'pull' | null {
  const thread = incident.discussions.find((discussion) => discussion.number === number)
  if (thread === undefined) return null
  return thread.kind === 'pr' ? 'pull' : 'issues'
}

/**
 * The permalink for one fact ref, or null when the ref names nothing in this fact-set.
 * @param ref - one of the five id forms
 * @param incident - the fact-set the ref belongs to
 * @returns an absolute github.com URL, or null for an unresolvable ref
 * @example permalinkFor(`commit:${sha}`, incident) // => 'https://github.com/o/n/commit/…'
 */
export function permalinkFor(ref: string, incident: Incident): string | null {
  const parsed = parseFactRef(ref)
  if (parsed === null) return null
  const base = `https://github.com/${incident.repo.nameWithOwner}`

  switch (parsed.kind) {
    case 'commit':
      return `${base}/commit/${parsed.sha}`
    case 'discussion': {
      const segment = threadSegment(incident, parsed.number)
      if (segment === null) return null
      const thread = `${base}/${segment}/${parsed.number}`
      return parsed.commentId === undefined ? thread : `${thread}#issuecomment-${parsed.commentId}`
    }
    case 'code':
      return `${base}/blob/${parsed.atSha}/${parsed.path}#L${parsed.startLine}-L${parsed.endLine}`
    case 'revealed': {
      // A revealed entry has no id of its own on GitHub; it points at its evidence.
      const entry = incident.revealedLater.find((later) => revealedRefFor(later) === ref)
      if (entry === undefined) return null
      return entry.evidence.kind === 'commit'
        ? `${base}/commit/${entry.evidence.sha}`
        : permalinkFor(
            entry.evidence.commentId === undefined
              ? `discussion:${entry.evidence.number}`
              : `discussion:${entry.evidence.number}#${entry.evidence.commentId}`,
            incident,
          )
    }
  }
}

/**
 * The one-line label a footer source row prints beside its number, built from ids only.
 * @param ref - one of the five id forms
 * @param incident - the fact-set the ref belongs to
 * @returns a label with no fact-set prose in it, or null for an unresolvable ref
 * @example sourceLabelFor('discussion:13420#4472139263', incident)
 *   // => 'pull request #13420, comment by @maxkostow'
 */
export function sourceLabelFor(ref: string, incident: Incident): string | null {
  const parsed = parseFactRef(ref)
  if (parsed === null) return null

  switch (parsed.kind) {
    case 'commit':
      return `commit ${parsed.sha.slice(0, SHORT_SHA_LENGTH)}`
    case 'discussion': {
      const thread = incident.discussions.find((discussion) => discussion.number === parsed.number)
      if (thread === undefined) return null
      const kind = thread.kind === 'pr' ? 'pull request' : 'issue'
      if (parsed.commentId === undefined) return `${kind} #${parsed.number}`
      // The handle is an identifier GitHub already prints beside this comment, and
      // the design attributes pull quotes by handle, so the footer matches the box.
      const author = thread.quotes.find((quote) => quote.commentId === parsed.commentId)?.author
      return author === undefined
        ? `${kind} #${parsed.number}, one comment`
        : `${kind} #${parsed.number}, comment by @${author}`
    }
    case 'code':
      return `${parsed.path}:${parsed.startLine}-${parsed.endLine} at ${parsed.atSha.slice(0, SHORT_SHA_LENGTH)}`
    case 'revealed': {
      const entry = incident.revealedLater.find((later) => revealedRefFor(later) === ref)
      if (entry === undefined) return null
      return entry.evidence.kind === 'commit'
        ? `revealed later by commit ${entry.evidence.sha.slice(0, SHORT_SHA_LENGTH)}`
        : `revealed later in #${entry.evidence.number}`
    }
  }
}

/** The repository's own license text, the file the attribution footer must link to. */
export function licenseHref(incident: Incident): string {
  return `https://github.com/${incident.repo.nameWithOwner}/blob/${incident.repo.defaultBranch}/LICENSE`
}

/** The repository itself, for the footer's PROJECT row. */
export function repoHref(incident: Incident): string {
  return `https://github.com/${incident.repo.nameWithOwner}`
}
