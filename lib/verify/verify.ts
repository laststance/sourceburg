import { createHash } from 'node:crypto'

import { assignCitationNumbers } from '../citations'
import { MAX_QUOTED_LINES_PER_PATH, MAX_QUOTED_RATIO, PROSE_CHARS_PER_LINE, EXCERPTABLE_LICENSES } from '../constants'
import { articleRefs } from '../facts'
import { articleSchemaFor } from '../schema'
import { identityOf } from './plan'
import { probeId } from './probe'
import { resultOf } from './result'

import type { ProbeResult } from './probe'
import type { Finding, Result } from './result'
import type { PreviouslyPublished } from './plan'
import type { Article, Incident } from '../schema'

/*
 * The pure half of verification. Everything here is a function of the fact-set,
 * the article, the prior publication, and recorded probe output, which is what
 * makes the whole rule set fixture-testable without git or the network.
 */

/**
 * Matches a real email address while rejecting npm-style specifiers.
 *
 * The domain's first label must START WITH A LETTER, which is the whole trick:
 * `@babel/core@7.24.0` and `pkg@1.2.3` put a digit there. A false positive here
 * is not harmless — it silently shrinks the set of quotable code and would be
 * misread as "this repo has little quotable code" (TODOS #4).
 */
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/

/** True when the text carries something that reads as a real email address. */
export function containsEmail(text: string): boolean {
  return EMAIL_PATTERN.test(text)
}

/**
 * Excerpted lines counted the way the license cap means them: over the DISTINCT
 * code quotes at least one block actually references. Summing `incident.codeQuotes`
 * wholesale counts excerpts the article never printed, and counts an excerpt twice
 * when two blocks cite it — the exposure is the excerpt, not the render.
 *
 * @returns lines per repo path, for the per-path cap and the ratio
 * @example countQuotedLines(incident, article).get('src/a.ts') // => 20
 */
export function countQuotedLines(incident: Incident, article: Article): Map<string, number> {
  const cited = new Set(articleRefs(article))
  const perPath = new Map<string, number>()
  for (const quote of incident.codeQuotes) {
    const ref = `code:${quote.atSha}:${quote.path}:${quote.startLine}-${quote.endLine}`
    if (!cited.has(ref)) continue
    const lines = quote.endLine - quote.startLine + 1
    perPath.set(quote.path, (perPath.get(quote.path) ?? 0) + lines)
  }
  return perPath
}

/** Prose measured in notional 80-char lines, so the ratio compares like with like. */
export function countProseLines(article: Article): number {
  let lines = 0
  for (const block of article.blocks) {
    if (block.type !== 'prose') continue
    for (const sentence of block.sentences) {
      lines += Math.ceil(sentence.text.length / PROSE_CHARS_PER_LINE)
    }
  }
  return lines
}

const fail = (rule: string, detail: string): Finding => ({ verdict: 'FAIL', rule, detail })
const inconclusive = (rule: string, detail: string): Finding => ({
  verdict: 'INDETERMINATE',
  rule,
  detail,
})

/**
 * The whole mechanical rule set. Pure: hand it recorded probe output and it
 * returns the same verdict it would in production.
 *
 * @param incident - the fact-set of record
 * @param article - the article claiming to be about it
 * @param previous - the prior publication, or null on first publish
 * @param probes - one result per request {@link plan} produced
 * @returns PASS only when every rule holds; FAIL beats INDETERMINATE beats PASS
 * @example verify(incident, article, null, probes).verdict // => 'PASS'
 */
export function verify(
  incident: Incident,
  article: Article,
  previous: PreviouslyPublished | null,
  probes: readonly ProbeResult[],
): Result {
  const findings: Finding[] = []
  const byId = new Map(probes.map((probe) => [probe.id, probe]))

  /*
   * Reads one probe and separates the three outcomes. A missing probe is a FAIL,
   * never a PASS: an unverified fact and a verified one must not look alike.
   */
  const stdoutOf = (spec: Parameters<typeof probeId>[0], rule: string): string | null => {
    const id = probeId(spec)
    const probe = byId.get(id)
    if (probe === undefined) {
      findings.push(fail(rule, `no probe ran for ${id}`))
      return null
    }
    if (probe.status === 'absent') {
      findings.push(fail(rule, `${id}: ${probe.detail}`))
      return null
    }
    if (probe.status === 'error') {
      findings.push(inconclusive(rule, `${id}: ${probe.detail}`))
      return null
    }
    return probe.stdout
  }

  /** Committer date for a sha, or null when the probe already produced a finding. */
  const committerDate = (sha: string, rule: string): string | null => {
    const stdout = stdoutOf({ kind: 'gitCommitDate', sha }, rule)
    return stdout === null ? null : stdout.trim()
  }

  const repo = incident.repo.nameWithOwner

  // ---- every sha resolves, and every stored date matches its own source -------

  const anchorDate = committerDate(incident.anchorSha, 'knownAt == committerDate(anchorSha)')
  if (anchorDate !== null && anchorDate !== incident.knownAt) {
    findings.push(
      fail(
        'knownAt == committerDate(anchorSha)',
        `knownAt is ${incident.knownAt} but the anchor was committed at ${anchorDate}`,
      ),
    )
  }

  incident.commits.forEach((commit, i) => {
    const rule = 'commits[].committedAt matches its source'
    const date = committerDate(commit.sha, rule)
    if (date !== null && date !== commit.committedAt) {
      findings.push(
        fail(rule, `commits[${i}] claims ${commit.committedAt}, git says ${date}`),
      )
    }
  })

  // ---- code excerpts byte-match the file at the stated revision ---------------

  incident.codeQuotes.forEach((quote, i) => {
    const dateRule = 'codeQuotes[].atShaCommittedAt matches its source'
    const date = committerDate(quote.atSha, dateRule)
    if (date !== null && date !== quote.atShaCommittedAt) {
      findings.push(
        fail(dateRule, `codeQuotes[${i}] claims ${quote.atShaCommittedAt}, git says ${date}`),
      )
    }

    const rule = 'codeQuotes[].text byte-matches the blob'
    const blob = stdoutOf({ kind: 'gitBlob', sha: quote.atSha, path: quote.path }, rule)
    if (blob === null) return
    // Line numbers are 1-based and inclusive on both ends, matching how the
    // citation id and the rendered gutter both read.
    const excerpt = blob.split('\n').slice(quote.startLine - 1, quote.endLine).join('\n')
    if (excerpt !== quote.text) {
      findings.push(
        fail(rule, `codeQuotes[${i}] does not match ${quote.path}:${quote.startLine}-${quote.endLine} at ${quote.atSha.slice(0, 8)}`),
      )
    }
  })

  // ---- the diff hunk byte-matches ---------------------------------------------

  if (incident.diff !== null) {
    const { beforeSha, afterSha, path, hunk } = incident.diff
    const rule = 'diff.hunk byte-matches git diff'
    const actual = stdoutOf({ kind: 'gitDiff', beforeSha, afterSha, path }, rule)
    if (actual !== null && actual !== hunk) {
      findings.push(fail(rule, `diff.hunk does not match ${path} between the two revisions`))
    }
    committerDate(beforeSha, 'diff.beforeSha resolves')
    committerDate(afterSha, 'diff.afterSha resolves')
  }

  // ---- discussions and quotes resolve through the API, not through a 200 ------

  const jsonOf = (stdout: string, rule: string, what: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(stdout)
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
      return parsed as Record<string, unknown>
    } catch {
      // A body that does not parse is a transport or auth artifact, not evidence
      // that the fact is wrong.
      findings.push(inconclusive(rule, `${what} did not return JSON`))
      return null
    }
  }

  incident.discussions.forEach((discussion, i) => {
    const rule = 'discussions[].createdAt matches its source'
    const stdout = stdoutOf({ kind: 'ghIssue', repo, number: discussion.number }, rule)
    if (stdout !== null) {
      const payload = jsonOf(stdout, rule, `issue #${discussion.number}`)
      if (payload !== null && payload.created_at !== discussion.createdAt) {
        findings.push(
          fail(rule, `discussions[${i}] claims ${discussion.createdAt}, the API says ${String(payload.created_at)}`),
        )
      }
    }

    discussion.quotes.forEach((quote, j) => {
      const quoteRule = 'quotes[] match the comment they cite'
      const commentStdout = stdoutOf({ kind: 'ghComment', repo, commentId: quote.commentId }, quoteRule)
      if (commentStdout === null) return
      const payload = jsonOf(commentStdout, quoteRule, `comment ${quote.commentId}`)
      if (payload === null) return

      const where = `discussions[${i}].quotes[${j}]`
      const body = typeof payload.body === 'string' ? payload.body : ''
      const login =
        typeof payload.user === 'object' && payload.user !== null
          ? (payload.user as Record<string, unknown>).login
          : undefined

      if (payload.created_at !== quote.createdAt) {
        findings.push(fail(quoteRule, `${where} claims ${quote.createdAt}, the API says ${String(payload.created_at)}`))
      }
      if (login !== quote.author) {
        findings.push(fail(quoteRule, `${where} attributes the words to ${quote.author}, the API says ${String(login)}`))
      }
      const bodyHash = createHash('sha256').update(body).digest('hex')
      if (bodyHash !== quote.bodyHash) {
        findings.push(fail(quoteRule, `${where} was pinned to a body that no longer hashes the same`))
      }
      // The offset is checked as well as the text: an excerpt that appears
      // somewhere else in the body is a different quotation.
      if (body.slice(quote.offset, quote.offset + quote.excerpt.length) !== quote.excerpt) {
        findings.push(fail(quoteRule, `${where} is not at offset ${quote.offset} of the comment body`))
      }
    })
  })

  // ---- aftermath dates come from the aftermath's own source -------------------

  incident.revealedLater.forEach((entry, i) => {
    const rule = 'revealedLater[].at matches its source'
    if (entry.evidence.kind === 'commit') {
      const date = committerDate(entry.evidence.sha, rule)
      if (date !== null && date !== entry.at) {
        findings.push(fail(rule, `revealedLater[${i}] claims ${entry.at}, git says ${date}`))
      }
      return
    }
    // Comment when one is pinned, issue when not: an aftermath usually cites a
    // comment on a thread that opened long before knownAt.
    const spec =
      entry.evidence.commentId === undefined
        ? ({ kind: 'ghIssue', repo, number: entry.evidence.number } as const)
        : ({ kind: 'ghComment', repo, commentId: entry.evidence.commentId } as const)
    const stdout = stdoutOf(spec, rule)
    if (stdout === null) return
    const payload = jsonOf(stdout, rule, `revealedLater[${i}] evidence`)
    if (payload !== null && payload.created_at !== entry.at) {
      findings.push(
        fail(rule, `revealedLater[${i}] claims ${entry.at}, the API says ${String(payload.created_at)}`),
      )
    }
  })

  findings.push(...pureRules(incident, article, previous))
  return resultOf(findings)
}

/**
 * The rules that need no I/O: citation resolution, the email rule, the license
 * caps, citation numbering, and the republication rules. Exported so a change to
 * a cap can be tested without inventing probe output.
 *
 * @returns every finding these rules produce, empty when they all hold
 * @example pureRules(incident, article, null).length // => 0
 */
export function pureRules(
  incident: Incident,
  article: Article,
  previous: PreviouslyPublished | null,
): Finding[] {
  const findings: Finding[] = []

  // Citation resolution, block preconditions, and the lede rule all live in the
  // schema, so they are RUN here rather than restated: one definition, one answer.
  const parsed = articleSchemaFor(incident).safeParse(article)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      findings.push(fail('article satisfies its incident', `${issue.path.join('.')}: ${issue.message}`))
    }
  }

  // ---- the email rule, enforced at selection rather than at render -----------

  incident.codeQuotes.forEach((quote, i) => {
    if (containsEmail(quote.text)) {
      findings.push(
        fail(
          'no quoted line carries an email address',
          `codeQuotes[${i}] (${quote.path}) carries an address; pick a different excerpt`,
        ),
      )
    }
  })
  incident.discussions.forEach((discussion, i) =>
    discussion.quotes.forEach((quote, j) => {
      if (containsEmail(quote.excerpt)) {
        findings.push(
          fail(
            'no quoted line carries an email address',
            `discussions[${i}].quotes[${j}] carries an address; pick a different excerpt`,
          ),
        )
      }
    }),
  )

  // ---- license caps ----------------------------------------------------------

  const licenseKnown = (EXCERPTABLE_LICENSES as readonly string[]).includes(incident.repo.spdxLicense)
  if (!licenseKnown && incident.codeQuotes.length > 0) {
    findings.push(
      fail(
        'an undeclared license permits no excerpting',
        `spdxLicense is "${incident.repo.spdxLicense}" but ${incident.codeQuotes.length} code quotes were collected`,
      ),
    )
  }

  const perPath = countQuotedLines(incident, article)
  for (const [path, lines] of perPath) {
    if (lines > MAX_QUOTED_LINES_PER_PATH) {
      findings.push(
        fail(
          'no more than 40 lines from any single path',
          `${path} contributes ${lines} lines`,
        ),
      )
    }
  }

  const quotedLines = [...perPath.values()].reduce((sum, n) => sum + n, 0)
  const proseLines = countProseLines(article)
  const denominator = quotedLines + proseLines
  // A zero denominator means an article with no prose and no quotes, which the
  // schema already rejects; guarding here keeps the cap from reading NaN <= 0.25.
  const ratio = denominator === 0 ? 0 : quotedLines / denominator
  if (ratio > MAX_QUOTED_RATIO) {
    findings.push(
      fail(
        'quoted-to-prose ratio at most 0.25',
        `${quotedLines} quoted against ${proseLines} prose lines is ${ratio.toFixed(4)}`,
      ),
    )
  }

  // ---- citation numbering round-trips ----------------------------------------

  const { ordered } = assignCitationNumbers(article)
  const distinct = new Set(articleRefs(article))
  if (ordered.length !== distinct.size) {
    findings.push(
      fail(
        'citation numbering round-trips',
        `numbering produced ${ordered.length} markers for ${distinct.size} distinct refs`,
      ),
    )
  }

  // ---- republication cannot rewrite history ----------------------------------

  if (previous !== null) {
    const identity = identityOf(incident)
    for (const key of ['nameWithOwner', 'id', 'anchorSha'] as const) {
      if (identity[key] !== previous.identity[key]) {
        findings.push(
          fail(
            'the identity tuple is unchanged',
            `${key} was ${previous.identity[key]}, now ${identity[key]}`,
          ),
        )
      }
    }
    if (article.publishedAt !== previous.publishedAt) {
      findings.push(
        fail(
          'publishedAt is frozen once published',
          `was ${previous.publishedAt}, now ${article.publishedAt}`,
        ),
      )
    }
    // Strictly greater, not >=: an unchanged updatedAt would tell every feed
    // reader nothing happened while the body changed underneath them.
    if (article.updatedAt <= previous.updatedAt) {
      findings.push(
        fail(
          'updatedAt strictly increases',
          `was ${previous.updatedAt}, now ${article.updatedAt}`,
        ),
      )
    }
  }

  return findings
}
