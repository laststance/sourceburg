import { describe, expect, it } from 'vitest'

import { datelineOf } from './dates'

describe('a dateline says the same date wherever the site was built', () => {
  it('formats a UTC timestamp as a broadsheet dateline', () => {
    // Arrange / Act / Assert
    expect(datelineOf('2019-03-11T09:41:25Z')).toBe('MARCH 11, 2019')
  })

  it('does not roll the day back in a timezone behind UTC', () => {
    // Arrange — 00:41 UTC is the previous evening in New York; the fact-set says the
    // 18th, and a dateline that printed the 17th would contradict the timeline box.
    const dateline = datelineOf('2026-05-18T00:41:25Z')

    // Assert
    expect(dateline).toBe('MAY 18, 2026')
  })

  it('does not roll the day forward in a timezone ahead of UTC', () => {
    // Arrange — 23:41 UTC is already tomorrow in Tokyo
    const dateline = datelineOf('2026-05-17T23:41:25Z')

    // Assert
    expect(dateline).toBe('MAY 17, 2026')
  })
})
