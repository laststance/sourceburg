import { createHash } from 'node:crypto'

import { Article, Incident } from '../schema'

/*
 * A complete, internally consistent incident/article pair plus the probe output
 * that proves it, built from real react-hook-form object names and real committer
 * dates normalized to Z. Tests mutate one thing and assert one rule fires.
 *
 * This is a fixture builder rather than a literal because probe stdout has to
 * agree byte for byte with the facts; hand-writing both halves would mean every
 * test that touches an excerpt also edits a blob.
 */

export const ANCHOR = 'a2ac01fd3872cf95b4e6ac8f4b4800f72b55eafd'
export const FIX = 'c6c3d87eb844af1fd1c01428f2fa113735982d4c'
export const REVERT = 'dfcebdbde1891fdd76fb56751cbe08dd980dfa5b'
export const REFIX = '5e9e02453d86c856de3e362e404aee8ad52921e9'

export const KNOWN_AT = '2026-05-17T23:41:25Z'
export const FIX_AT = '2026-05-09T02:02:12Z'
export const REVERT_AT = '2026-05-17T23:01:00Z'
export const REFIX_AT = '2026-08-07T10:05:00Z'

/** The three commit subjects, named so the fixture and its probe output cannot drift. */
export const FIX_SUBJECT = 'fix #13260'
export const REVERT_SUBJECT = 'Revert "fix #13260"'
export const ANCHOR_SUBJECT = 'test(useFieldArray): regression coverage'

export const REPO = 'react-hook-form/react-hook-form'
export const QUOTED_PATH = 'src/logic/getFieldArrayParentNames.ts'

/** Four-line file; the excerpt is lines 2-3, so an off-by-one slice is visible. */
export const BLOB = [
  'import { get } from "../utils"',
  'export default function getFieldArrayParentNames(name: string) {',
  '  return name.split(".").slice(0, -1)',
  '}',
].join('\n')

export const EXCERPT = ['export default function getFieldArrayParentNames(name: string) {', '  return name.split(".").slice(0, -1)'].join('\n')

export const COMMENT_BODY = 'This still reproduces on 7.62.0, and the workaround stopped working.'
export const COMMENT_EXCERPT = 'This still reproduces on 7.62.0'
export const COMMENT_HASH = createHash('sha256').update(COMMENT_BODY).digest('hex')
export const COMMENT_AT = '2026-05-02T04:15:00Z'
export const ISSUE_AT = '2026-05-01T00:00:00Z'

export function incidentFixture(overrides: Record<string, unknown> = {}): Incident {
  return Incident.parse({
    id: 'rhf-fieldarray-revert',
    signal: 'git-trace',
    selection: { kind: 'manual', reason: 'found by hand' },
    repo: { nameWithOwner: REPO, defaultBranch: 'master', spdxLicense: 'MIT' },
    anchorSha: ANCHOR,
    knownAt: KNOWN_AT,
    commits: [
      { sha: FIX, committedAt: FIX_AT, subject: FIX_SUBJECT },
      { sha: REVERT, committedAt: REVERT_AT, subject: REVERT_SUBJECT },
      { sha: ANCHOR, committedAt: KNOWN_AT, subject: ANCHOR_SUBJECT },
    ],
    discussions: [
      {
        kind: 'issue',
        number: 13260,
        createdAt: ISSUE_AT,
        quotes: [
          {
            excerpt: COMMENT_EXCERPT,
            bodyHash: COMMENT_HASH,
            offset: 0,
            author: 'a-reporter',
            commentId: 55,
            createdAt: COMMENT_AT,
            fetchedAt: '2026-09-01T00:00:00Z',
          },
        ],
      },
    ],
    codeQuotes: [
      {
        path: QUOTED_PATH,
        atSha: FIX,
        atShaCommittedAt: FIX_AT,
        startLine: 2,
        endLine: 3,
        text: EXCERPT,
      },
    ],
    diff: null,
    revealedLater: [
      {
        at: REFIX_AT,
        what: 'the bug was fixed again, differently',
        evidence: { kind: 'commit', sha: REFIX },
      },
    ],
    ...overrides,
  })
}

export const CODE_REF = `code:${FIX}:${QUOTED_PATH}:2-3`

/**
 * Eight prose sentences so the baseline sits well under the 0.25 ratio: two
 * quoted lines against eight prose lines is 0.2.
 */
function eightProseSentences() {
  return Array.from({ length: 8 }, (_, i) => ({
    text: `Sentence number ${i + 1} is short enough to occupy exactly one notional line.`,
    cites: i === 0 ? [] : [`commit:${FIX}`],
  }))
}

export function articleFixture(revealedRef: string, overrides: Record<string, unknown> = {}): Article {
  return Article.parse({
    incidentId: 'rhf-fieldarray-revert',
    lang: 'en',
    persona: 'desk',
    title: 'A field-array fix was reverted within nine days',
    titleCites: [`commit:${REVERT}`],
    dek: 'A regression test landed in its place',
    dekCites: [`commit:${ANCHOR}`],
    publishedAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    blocks: [
      { type: 'prose', sentences: eightProseSentences() },
      { type: 'codeQuote', ref: CODE_REF },
      { type: 'personQuote', ref: 'discussion:13260#55' },
      { type: 'timelineBox' },
    ],
    aftermath: [{ text: 'It was fixed again in August.', ref: revealedRef }],
    ...overrides,
  })
}

/** Probe output that makes {@link incidentFixture} verify clean. */
export function passingProbes() {
  return [
    { id: `gitCommitDate:${ANCHOR}`, status: 'ok' as const, stdout: `${KNOWN_AT}\n` },
    { id: `gitCommitDate:${FIX}`, status: 'ok' as const, stdout: `${FIX_AT}\n` },
    { id: `gitCommitDate:${REVERT}`, status: 'ok' as const, stdout: `${REVERT_AT}\n` },
    { id: `gitCommitDate:${REFIX}`, status: 'ok' as const, stdout: `${REFIX_AT}\n` },
    // One per commit, and none for REFIX: the aftermath cites a sha, not a subject.
    { id: `gitCommitSubject:${FIX}`, status: 'ok' as const, stdout: `${FIX_SUBJECT}\n` },
    { id: `gitCommitSubject:${REVERT}`, status: 'ok' as const, stdout: `${REVERT_SUBJECT}\n` },
    { id: `gitCommitSubject:${ANCHOR}`, status: 'ok' as const, stdout: `${ANCHOR_SUBJECT}\n` },
    { id: `gitBlob:${FIX}:${QUOTED_PATH}`, status: 'ok' as const, stdout: BLOB },
    {
      id: `ghIssue:${REPO}#13260`,
      status: 'ok' as const,
      stdout: JSON.stringify({ number: 13260, created_at: ISSUE_AT }),
    },
    {
      id: `ghComment:${REPO}#c55`,
      status: 'ok' as const,
      stdout: JSON.stringify({
        id: 55,
        created_at: COMMENT_AT,
        user: { login: 'a-reporter' },
        body: COMMENT_BODY,
      }),
    },
  ]
}
