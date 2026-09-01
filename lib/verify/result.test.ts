import { describe, expect, it } from 'vitest'

import { aggregate, exitCodeFor, resultOf } from './result'

describe('one bad fact is not rescued by unrelated successes', () => {
  it('reports FAIL when a single check failed among many passes', () => {
    // Arrange
    const verdicts = ['PASS', 'PASS', 'FAIL', 'PASS'] as const
    // Act
    const verdict = aggregate(verdicts)
    // Assert
    expect(verdict).toBe('FAIL')
  })

  it('reports FAIL rather than INDETERMINATE when both occurred, so a timeout cannot mask a fabrication', () => {
    // Arrange
    const verdicts = ['INDETERMINATE', 'FAIL'] as const
    // Act
    const verdict = aggregate(verdicts)
    // Assert
    expect(verdict).toBe('FAIL')
  })

  it('reports INDETERMINATE when nothing failed but something could not be checked', () => {
    // Arrange
    const verdicts = ['PASS', 'INDETERMINATE'] as const
    // Act
    const verdict = aggregate(verdicts)
    // Assert
    expect(verdict).toBe('INDETERMINATE')
  })

  it('reports PASS only when every check passed', () => {
    // Arrange
    const verdicts = ['PASS', 'PASS'] as const
    // Act
    const verdict = aggregate(verdicts)
    // Assert
    expect(verdict).toBe('PASS')
  })

  it('treats an empty run as PASS, because no findings is the shape of a clean verify', () => {
    // Arrange
    const verdicts = [] as const
    // Act
    const verdict = aggregate(verdicts)
    // Assert
    expect(verdict).toBe('PASS')
  })
})

describe('CI can tell a retryable run from a broken one', () => {
  it('exits 0 on PASS', () => {
    // Arrange & Act
    const code = exitCodeFor('PASS')
    // Assert
    expect(code).toBe(0)
  })

  it('exits 1 on FAIL, which CI must never retry', () => {
    // Arrange & Act
    const code = exitCodeFor('FAIL')
    // Assert
    expect(code).toBe(1)
  })

  it('exits 2 on INDETERMINATE, which CI may retry', () => {
    // Arrange & Act
    const code = exitCodeFor('INDETERMINATE')
    // Assert
    expect(code).toBe(2)
  })
})

describe('a result cannot disagree with its own findings', () => {
  it('derives FAIL from a finding rather than trusting a passed-in verdict', () => {
    // Arrange
    const findings = [{ verdict: 'FAIL' as const, rule: 'a rule', detail: 'a detail' }]
    // Act
    const result = resultOf(findings)
    // Assert
    expect(result.verdict).toBe('FAIL')
  })
})
