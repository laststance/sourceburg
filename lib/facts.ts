import { createHash } from 'node:crypto'

import type { Incident, Article } from './schema'

/*
 * Content-addressed fact ids and the one chronology function.
 *
 * Ids are never array indices: an index changes when the array is reordered,
 * which would silently repoint a citation at a different fact.
 */

export type FactRefParsed =
  | { kind: 'commit'; sha: string }
  | { kind: 'discussion'; number: number; commentId?: number }
  | { kind: 'code'; atSha: string; path: string; startLine: number; endLine: number }
  | { kind: 'revealed'; revealedKind: string; key: string; digest: string }

/**
 * Parses one of the five id forms; returns null for anything else so a ref that
 * parses-but-points-nowhere is a FAIL rather than an exception.
 *
 * @returns the parsed ref, or null when the string is not a well-formed id
 * @example parseFactRef('code:abc…:src/a.ts:12-31') // { kind: 'code', startLine: 12, … }
 */
export function parseFactRef(ref: string): FactRefParsed | null {
  const commit = /^commit:([0-9a-f]{40})$/.exec(ref)
  if (commit) return { kind: 'commit', sha: commit[1] }

  const discussion = /^discussion:(\d+)(?:#(\d+))?$/.exec(ref)
  if (discussion) {
    return {
      kind: 'discussion',
      number: Number(discussion[1]),
      ...(discussion[2] ? { commentId: Number(discussion[2]) } : {}),
    }
  }

  // The path sits between two colon-delimited fields, so it is matched last and
  // non-greedily against the trailing line range rather than by splitting on ':'.
  const code = /^code:([0-9a-f]{40}):(.+):(\d+)-(\d+)$/.exec(ref)
  if (code) {
    return {
      kind: 'code',
      atSha: code[1],
      path: code[2],
      startLine: Number(code[3]),
      endLine: Number(code[4]),
    }
  }

  const revealed = /^revealed:([^:]+):([^:]+):([^:]+)$/.exec(ref)
  if (revealed) {
    return { kind: 'revealed', revealedKind: revealed[1], key: revealed[2], digest: revealed[3] }
  }

  return null
}

/** Every FactRef an article uses, in first-appearance order: title, dek, blocks, aftermath. */
export function articleRefs(article: Article): string[] {
  const refs: string[] = [...article.titleCites, ...article.dekCites]
  for (const block of article.blocks) {
    if (block.type === 'prose') {
      for (const sentence of block.sentences) refs.push(...sentence.cites)
    } else if (block.type === 'codeQuote' || block.type === 'personQuote') {
      refs.push(block.ref)
    }
  }
  for (const entry of article.aftermath) refs.push(entry.ref)
  return refs
}

export type DatedFact = { at: string; label: string; ref: string }

/**
 * The incident's chronology on the knownAt side, oldest first. This is the ONE
 * definition of "a dated fact": the verifier's `timelineBox => >= 2 dated facts`
 * rule and the renderer's timeline box both call it, so "fewer than two dated
 * facts" cannot mean two different things in two places.
 *
 * `revealedLater` is deliberately excluded — it is the aftermath, and mixing it
 * in would let a timeline box satisfy its minimum using facts the breaking-news
 * half is not allowed to know.
 *
 * @returns dated facts sorted ascending by `at`
 * @example datedFacts(incident).length >= 2 // the timelineBox precondition
 */
export function datedFacts(incident: Incident): DatedFact[] {
  const facts: DatedFact[] = []

  for (const commit of incident.commits) {
    facts.push({ at: commit.committedAt, label: commit.subject, ref: `commit:${commit.sha}` })
  }
  for (const discussion of incident.discussions) {
    facts.push({
      at: discussion.createdAt,
      label: `${discussion.kind} #${discussion.number}`,
      ref: `discussion:${discussion.number}`,
    })
    // A comment is its own dated event: it can post months after the thread opened.
    for (const quote of discussion.quotes) {
      facts.push({
        at: quote.createdAt,
        label: `comment by ${quote.author}`,
        ref: `discussion:${discussion.number}#${quote.commentId}`,
      })
    }
  }

  return facts.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
}

/**
 * Mints the `revealed:` id for one aftermath entry. Content-addressed over the
 * claim itself, so editing `what` repoints the citation instead of silently
 * changing what an already-published `[n]` asserts.
 *
 * @param entry - one {@link Incident} `revealedLater` element
 * @returns `revealed:{evidenceKind}:{evidenceKey}:{12-hex digest of at + what}`
 * @example revealedRefFor({ at: '2026-08-07T10:05:00Z', what: 'refixed', evidence: { kind: 'commit', sha } })
 *   // => 'revealed:commit:5e9e0245…:1f3c9a02bb71'
 */
export function revealedRefFor(entry: Incident['revealedLater'][number]): string {
  const key =
    entry.evidence.kind === 'commit'
      ? entry.evidence.sha
      : entry.evidence.commentId === undefined
        ? String(entry.evidence.number)
        : `${entry.evidence.number}#${entry.evidence.commentId}`
  // NUL separator: no ISO timestamp or claim text can contain it, so two
  // different (at, what) pairs cannot concatenate into the same digest input.
  const digest = createHash('sha256').update(`${entry.at}\0${entry.what}`).digest('hex').slice(0, 12)
  return `revealed:${entry.evidence.kind}:${key}:${digest}`
}

/** Ids the incident can actually resolve, keyed by the ref string a citation would use. */
export function incidentRefIndex(incident: Incident): Map<string, FactRefParsed['kind']> {
  const index = new Map<string, FactRefParsed['kind']>()
  for (const commit of incident.commits) index.set(`commit:${commit.sha}`, 'commit')
  for (const discussion of incident.discussions) {
    index.set(`discussion:${discussion.number}`, 'discussion')
    for (const quote of discussion.quotes) {
      index.set(`discussion:${discussion.number}#${quote.commentId}`, 'discussion')
    }
  }
  for (const quote of incident.codeQuotes) {
    index.set(`code:${quote.atSha}:${quote.path}:${quote.startLine}-${quote.endLine}`, 'code')
  }
  // The aftermath belongs in the index too: without it every aftermath citation
  // would resolve to nothing and the article could never carry an aftermath.
  for (const entry of incident.revealedLater) index.set(revealedRefFor(entry), 'revealed')
  return index
}

/**
 * When the aftermath's facts became known: the latest `revealedLater[].at` the
 * aftermath actually cites, falling back to `updatedAt`.
 *
 * The design dates the tinted band from `Article.updatedAt`, and that is right when a
 * republish adds the aftermath later. It is wrong when the article shipped with one
 * already in it: `updatedAt` then equals `publishedAt`, and the band reads
 * "(WRITTEN LATER: <the day it was published>)" — a claim the page itself disproves
 * two lines down. The revealed dates are verified facts, so this prefers them.
 *
 * @param incident - the fact-set the aftermath refs resolve against
 * @param article - the article whose aftermath is being dated
 * @returns an ISO timestamp; `article.updatedAt` when no aftermath ref resolves
 * @example aftermathKnownAt(incident, article) // => '2026-05-28T12:26:34Z'
 */
export function aftermathKnownAt(incident: Incident, article: Article): string {
  const cited = new Set(article.aftermath.map((entry) => entry.ref))
  const dates = incident.revealedLater
    .filter((entry) => cited.has(revealedRefFor(entry)))
    .map((entry) => entry.at)
  return dates.length === 0 ? article.updatedAt : dates.reduce((a, b) => (a > b ? a : b))
}
