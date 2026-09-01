/*
 * The three-valued verdict.
 *
 * Two-valued verification is the failure this file exists to prevent: a 403 rate
 * limit and a fabricated SHA both mean "did not verify", and collapsing them
 * sends you looking for a bug in the collector that is not there. Only PASS
 * publishes, so the split costs nothing in safety and buys back the diagnosis.
 */

export type Verdict = 'PASS' | 'FAIL' | 'INDETERMINATE'

/** One reason a run did not pass. `rule` names the spec line so a failure is greppable. */
export type Finding = {
  verdict: Exclude<Verdict, 'PASS'>
  rule: string
  detail: string
}

export type Result = { verdict: Verdict; findings: Finding[] }

/**
 * Folds many verdicts into one, worst-wins. FAIL outranks INDETERMINATE because a
 * known-bad fact is not rescued by an unrelated timeout.
 *
 * @param verdicts - every verdict from the run, in any order
 * @returns `FAIL` if any failed, else `INDETERMINATE` if any was inconclusive, else `PASS`
 * @example aggregate(['PASS', 'INDETERMINATE', 'FAIL']) // => 'FAIL'
 */
export function aggregate(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes('FAIL')) return 'FAIL'
  if (verdicts.includes('INDETERMINATE')) return 'INDETERMINATE'
  return 'PASS'
}

/** Builds a {@link Result} from findings, deriving the verdict so the two cannot disagree. */
export function resultOf(findings: readonly Finding[]): Result {
  return { verdict: aggregate(findings.map((f) => f.verdict)), findings: [...findings] }
}

/**
 * Process exit code for a verdict. Distinct codes exist so CI can retry an
 * INDETERMINATE run and must never retry a FAIL.
 *
 * @returns 0 for PASS, 1 for FAIL, 2 for INDETERMINATE
 * @example exitCodeFor('INDETERMINATE') // => 2
 */
export function exitCodeFor(verdict: Verdict): 0 | 1 | 2 {
  switch (verdict) {
    case 'PASS':
      return 0
    case 'FAIL':
      return 1
    case 'INDETERMINATE':
      return 2
  }
}
