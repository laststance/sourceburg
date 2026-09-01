import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { readAllPublished } from '../../lib/content'
import { articleHref } from '../../lib/links'

import type { Published } from '../../lib/publish'

/*
 * The five reader paths, run at all three viewports by the config's projects.
 *
 * Asserted against the REAL published content rather than a fixture, for the same
 * reason the render layer's four layout bugs only appeared once incident #1 was on
 * the page: the fixtures are short, and every one of those bugs was a width the
 * fixture never reached. A fixture site here would pass while the site is broken.
 *
 * Nothing here re-checks a fact against its source; `pnpm verify` does that, and
 * doing it twice in a browser would be slower and no more true. These tests ask
 * only what a reader can see.
 */

/** The newest published incident, read once per worker. Async, so it cannot be a const. */
let cached: Published | null = null
async function newest(): Promise<Published> {
  if (cached === null) cached = (await readAllPublished('content'))[0]
  return cached
}

test.describe('an article page carries the whole story and its receipts', () => {
  test('renders every block type the article uses, each with its source visible', async ({ page }) => {
    // Arrange
    const published = await newest()
    await page.goto(articleHref(published.incident))

    // Act
    const headline = page.getByRole('heading', { level: 1 })

    // Assert
    await expect(headline).toHaveText(published.article.title)
    // The quoted file path prints beside the excerpt, not only in the footer, so a
    // reader who copies a line knows which file and which revision it came from.
    await expect(page.getByText(published.incident.codeQuotes[0].path).first()).toBeVisible()
    await expect(page.getByText('Timeline', { exact: true })).toBeVisible()
    // The attribution footer is `<footer>` inside `<main>`, so it carries no
    // `contentinfo` role by design — it is this article's footer, not the site's.
    await expect(page.locator('footer')).toContainText('verified against its source')
  })

  test('every [n] marker in the text has the footer row it points at', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))

    // Act: the markers a reader can click, and the rows they land on
    const markers = await page.locator('a[href*="#src-"]').evaluateAll((links) =>
      links.map((link) => link.getAttribute('href')?.split('#')[1] ?? ''),
    )
    const rows = await page.locator('li[id^="src-"]').evaluateAll((items) => items.map((item) => item.id))

    // Assert
    expect(markers.length).toBeGreaterThan(0)
    expect(new Set(markers).size).toBe(rows.length)
    for (const marker of markers) expect(rows).toContain(marker)
  })

  test('has no axe-detectable accessibility violations', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))

    // Act
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()

    // Assert
    expect(scan.violations).toEqual([])
  })

  test('does not scroll sideways, and a long code line stays on one line', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))

    // Act
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    // A code excerpt is part of a citation id: line 7 of the file must be the
    // seventh line on the page, so soft-wrapping would renumber the excerpt.
    const wraps = await page.locator('.code-scroll code').first().evaluate((element) => {
      return getComputedStyle(element).whiteSpace
    })

    // Assert
    expect(overflow.scrollWidth).toBe(overflow.clientWidth)
    expect(wraps).toBe('pre')
  })
})

test.describe('the front page and the routes around it', () => {
  test('leads with the newest incident and links to it', async ({ page }) => {
    // Arrange
    const published = await newest()
    await page.goto('/')

    // Act
    const lead = page.getByRole('link', { name: new RegExp(published.article.title.slice(0, 30), 'i') }).first()

    // Assert
    await expect(lead).toHaveAttribute('href', articleHref(published.incident))
    await expect(page.getByRole('link', { name: /feed/i })).toBeVisible()
  })

  test('404s an unknown incident instead of rendering an empty article shell', async ({ page }) => {
    // Arrange / Act
    const response = await page.goto('/nope-nope/nope')

    // Assert
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('No such page')
    // The masthead survives: a 404 is still a page of the newspaper.
    await expect(page.getByRole('link', { name: /sourceburg/i }).first()).toBeVisible()
  })

  test('serves an Atom feed whose entry id names the incident', async ({ request }) => {
    // Arrange
    const published = await newest()
    // Act
    const response = await request.get('/feed.xml')
    const body = await response.text()

    // Assert
    expect(response.headers()['content-type']).toContain('xml')
    expect(body).toContain('<feed xmlns="http://www.w3.org/2005/Atom">')
    expect(body).toContain(published.incident.id)
  })
})
