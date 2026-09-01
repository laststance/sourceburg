import { describe, expect, it } from 'vitest'

import { deriveHomepageLayout } from './homepage'

import type { Published } from './publish'

/** A published pair carrying only what the homepage branch reads. */
function publishedAt(id: string, knownAt: string, nameWithOwner = 'react-hook-form/react-hook-form'): Published {
  return {
    manifest: { version: 'v-0', identity: { nameWithOwner, id, anchorSha: 'a'.repeat(40) }, publishedAt: knownAt, updatedAt: knownAt },
    incident: { id, knownAt, repo: { nameWithOwner } },
    article: { title: `story ${id}` },
  } as unknown as Published
}

describe('the front page is composed for how much news there is', () => {
  it('renders the NO NEWS TODAY plate when nothing is published', () => {
    // Arrange — a dry news day is a documented success path, not an error
    const layout = deriveHomepageLayout([])

    // Assert
    expect(layout.kind).toBe('empty')
    expect(layout.lead).toBeNull()
    expect(layout.rest).toEqual([])
  })

  it('makes the only story the front page at one', () => {
    // Arrange
    const layout = deriveHomepageLayout([publishedAt('field-array-key-thrash', '2026-05-17T23:41:25Z')])

    // Assert — never a one-card grid
    expect(layout.kind).toBe('lead')
    expect(layout.lead?.incident.id).toBe('field-array-key-thrash')
    expect(layout.rest).toEqual([])
  })

  it('keeps the fold unchanged and puts later stories below it at two', () => {
    // Arrange
    const layout = deriveHomepageLayout([
      publishedAt('newer', '2026-05-17T23:41:25Z'),
      publishedAt('older', '2026-01-20T09:15:09Z'),
    ])

    // Assert
    expect(layout.kind).toBe('leadWithList')
    expect(layout.lead?.incident.id).toBe('newer')
    expect(layout.rest.map((entry) => entry.incident.id)).toEqual(['older'])
  })
})

describe('the canonical URL follows the body, not the article count', () => {
  it('points / at the incident once / carries the lead story', () => {
    // Arrange — the duplicate is declared rather than accidental
    const layout = deriveHomepageLayout([publishedAt('field-array-key-thrash', '2026-05-17T23:41:25Z')])

    // Assert
    expect(layout.canonical).toBe('/react-hook-form-react-hook-form/field-array-key-thrash')
  })

  it('still points at the lead incident at two, because the fold did not change', () => {
    // Arrange — this is the row that fails if someone branches canonical on N
    const layout = deriveHomepageLayout([
      publishedAt('newer', '2026-05-17T23:41:25Z'),
      publishedAt('older', '2026-01-20T09:15:09Z'),
    ])

    // Assert
    expect(layout.canonical).toBe('/react-hook-form-react-hook-form/newer')
  })

  it('names / itself only when there is no body to point elsewhere', () => {
    // Arrange / Act / Assert
    expect(deriveHomepageLayout([]).canonical).toBe('/')
  })
})
