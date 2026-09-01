/*
 * The probe vocabulary. Every request carries its arguments as separate fields,
 * never a preassembled command string, because {@link execute} passes them to
 * `execFile` as an argv array. `path` and `atSha` are model-authored; a template
 * literal into a shell would hand a crafted fact-set a command line.
 *
 * `covers` is the list of fact paths a probe discharges. It exists so a test can
 * assert that every collected fact contributed at least one probe, which is the
 * mechanical half of "a new schema field cannot silently skip verification".
 */

/** What to fetch. Kept separate from {@link ProbeRequest} because `Omit` over a
 * union collapses the discriminant and stops narrowing. */
export type ProbeSpec =
  | { kind: 'gitCommitDate'; sha: string }
  | { kind: 'gitBlob'; sha: string; path: string }
  | { kind: 'gitDiff'; beforeSha: string; afterSha: string; path: string }
  | { kind: 'ghIssue'; repo: string; number: number }
  | { kind: 'ghComment'; repo: string; commentId: number }

export type ProbeRequest = ProbeSpec & { id: string; covers: string[] }

/**
 * What one probe came back with. The three statuses map onto the three verdicts:
 * `ok` lets the rule decide, `absent` means the fact itself is wrong (FAIL), and
 * `error` means our environment failed and says nothing about the fact
 * (INDETERMINATE). Collapsing the last two is the bug the split exists to prevent.
 */
export type ProbeResult =
  | { id: string; status: 'ok'; stdout: string }
  | { id: string; status: 'absent'; detail: string }
  | { id: string; status: 'error'; detail: string }

/** Stable, content-addressed probe id, so two facts needing the same fetch share one. */
export function probeId(request: ProbeSpec): string {
  switch (request.kind) {
    case 'gitCommitDate':
      return `gitCommitDate:${request.sha}`
    case 'gitBlob':
      return `gitBlob:${request.sha}:${request.path}`
    case 'gitDiff':
      return `gitDiff:${request.beforeSha}:${request.afterSha}:${request.path}`
    case 'ghIssue':
      return `ghIssue:${request.repo}#${request.number}`
    case 'ghComment':
      return `ghComment:${request.repo}#c${request.commentId}`
  }
}
