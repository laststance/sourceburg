import { articleHref } from './links'

import type { Published } from './publish'

/*
 * The Atom feed. In v1 it is the only delivery channel, so it is a first-class
 * artifact rather than an afterthought: `/` and the footer both link it by name.
 *
 * Built by string assembly, which means EVERY interpolated value is escaped here.
 * Titles and deks are model output; a `<` that reached the document raw would break
 * the feed for every subscriber, and a crafted one would inject elements into it.
 * This is the same reason the HTML side never uses `dangerouslySetInnerHTML`.
 */

/**
 * When nothing has ever been published, nothing has ever been updated.
 * A `<updated>` that moved with the clock would tell every subscriber there is news
 * on a day the site's own design calls a normal, newsless one.
 */
const NEVER_UPDATED = '1970-01-01T00:00:00Z'

/**
 * XML text-node and attribute escaping, applied to every interpolated value.
 * @param value - untrusted text
 * @returns the same text, safe in both a text node and a quoted attribute
 * @example escapeXml('a & b') // => 'a &amp; b'
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * The whole feed document, valid whether or not anything is published.
 * @param published - live publications, `knownAt` descending
 * @param siteUrl - the origin, with no trailing slash
 * @returns an Atom 1.0 document
 * @example atomFeed([], 'https://example.com').includes('<entry>') // => false
 */
export function atomFeed(published: Published[], siteUrl: string): string {
  const updated = published[0]?.manifest.updatedAt ?? NEVER_UPDATED

  const entries = published.map((entry) => {
    const url = `${siteUrl}${articleHref(entry.incident)}`
    return [
      '  <entry>',
      `    <id>${escapeXml(url)}</id>`,
      `    <title>${escapeXml(entry.article.title)}</title>`,
      `    <link rel="alternate" href="${escapeXml(url)}"/>`,
      `    <updated>${escapeXml(entry.manifest.updatedAt)}</updated>`,
      `    <published>${escapeXml(entry.manifest.publishedAt)}</published>`,
      `    <summary>${escapeXml(entry.article.dek)}</summary>`,
      // The byline is the desk, on every surface. There is no author name to print.
      '    <author><name>The Desk</name></author>',
      '  </entry>',
    ].join('\n')
  })

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(siteUrl)}/</id>`,
    '  <title>sourceburg</title>',
    '  <subtitle>Every fact machine-verified against its source</subtitle>',
    `  <updated>${escapeXml(updated)}</updated>`,
    `  <link rel="self" href="${escapeXml(siteUrl)}/feed.xml"/>`,
    `  <link rel="alternate" href="${escapeXml(siteUrl)}/"/>`,
    ...entries,
    '</feed>',
    '',
  ].join('\n')
}
