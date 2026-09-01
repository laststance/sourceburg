import { describe, expect, it } from 'vitest'

import { atomFeed, escapeXml } from './feed'

import type { Published } from './publish'

/** A published pair carrying only what the feed reads. */
function publishedEntry(id: string, title: string, dek = 'A dek.'): Published {
  return {
    manifest: {
      version: 'v-0',
      identity: { nameWithOwner: 'react-hook-form/react-hook-form', id, anchorSha: 'a'.repeat(40) },
      publishedAt: '2026-05-17T23:41:25Z',
      updatedAt: '2026-06-01T00:00:00Z',
    },
    incident: { id, knownAt: '2026-05-17T23:41:25Z', repo: { nameWithOwner: 'react-hook-form/react-hook-form' } },
    article: { title, dek },
  } as unknown as Published
}

describe('subscribers get a valid feed on a day with no news', () => {
  it('emits a feed with no entries rather than an error when nothing is published', () => {
    // Arrange / Act
    const feed = atomFeed([], 'https://example.com')

    // Assert — a fetch error would read as the site being broken; this reads as quiet
    expect(feed).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(feed).not.toContain('<entry>')
  })

  it('holds its updated timestamp still while there is nothing to report', () => {
    // Arrange — a moving <updated> tells every reader there is news when there is none
    const first = atomFeed([], 'https://example.com')
    const second = atomFeed([], 'https://example.com')

    // Assert
    expect(first).toContain('<updated>1970-01-01T00:00:00Z</updated>')
    expect(first).toBe(second)
  })
})

describe('a title cannot break the feed for every subscriber', () => {
  it('escapes markup characters in a title the model wrote', () => {
    // Arrange — titles and deks are model output, and this is string assembly
    const feed = atomFeed([publishedEntry('x', 'A <script> & "quotes" in a headline')], 'https://example.com')

    // Assert
    expect(feed).toContain('<title>A &lt;script&gt; &amp; &quot;quotes&quot; in a headline</title>')
    expect(feed).not.toContain('<script>')
  })

  it('escapes the ampersand before the entities it just introduced', () => {
    // Arrange — replacing & last would turn &lt; into &amp;lt;
    const escaped = escapeXml('a & b < c')

    // Assert
    expect(escaped).toBe('a &amp; b &lt; c')
  })
})

describe('a feed entry points at the article it names', () => {
  it('builds an absolute URL from the site origin and the derived path', () => {
    // Arrange / Act
    const feed = atomFeed([publishedEntry('field-array-key-thrash', 'A headline')], 'https://sourceburg.vercel.app')

    // Assert
    expect(feed).toContain(
      '<id>https://sourceburg.vercel.app/react-hook-form-react-hook-form/field-array-key-thrash</id>',
    )
  })

  it('takes the feed updated time from the newest entry', () => {
    // Arrange / Act
    const feed = atomFeed([publishedEntry('a', 'Newest')], 'https://example.com')

    // Assert
    expect(feed).toContain('<updated>2026-06-01T00:00:00Z</updated>')
  })
})
