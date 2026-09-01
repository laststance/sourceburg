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
  return index
}
