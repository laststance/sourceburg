import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { readAllPublished } from '../../lib/content'
import { articleHref } from '../../lib/links'

import type { Published } from '../../lib/publish'

/*
 * The ten reader paths, run at all three viewports by the config's projects.
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

test.describe('a reader can retype the page without losing it', () => {
  test('switches the prose to a sans face and still has it after a reload', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    const paragraph = page.locator('.column-text').first()
    const asPublished = await paragraph.evaluate((element) => getComputedStyle(element).fontFamily)

    // Act
    await page.getByText('Reading options').click()
    await page.getByRole('radio', { name: 'Sans-serif' }).check()
    const afterSwitching = await paragraph.evaluate((element) => getComputedStyle(element).fontFamily)
    await page.reload()
    const afterReload = await paragraph.evaluate((element) => getComputedStyle(element).fontFamily)

    // Assert — the desk still ships the serif to everyone who has not asked otherwise
    expect(asPublished).toContain('Georgia')
    expect(afterSwitching).toContain('system-ui')
    expect(afterSwitching).not.toContain('Georgia')
    // A preference nobody remembers is a preference nobody uses: the whole point of the
    // pre-paint script is that this survives the next page, not just this render.
    expect(afterReload).toContain('system-ui')
  })

  test('grows the prose at the largest step without ever scrolling the page sideways', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    const paragraph = page.locator('.column-text').first()
    const excerpt = page.locator('.code-scroll code').first()
    const sizeOf = (element: Element) => parseFloat(getComputedStyle(element).fontSize)
    const proseAtRegular = await paragraph.evaluate(sizeOf)
    const codeAtRegular = await excerpt.evaluate(sizeOf)

    // Act
    await page.getByText('Reading options').click()
    await page.getByRole('radio', { name: 'Larger' }).check()
    const proseAtLarger = await paragraph.evaluate(sizeOf)
    const codeAtLarger = await excerpt.evaluate(sizeOf)
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    const wraps = await excerpt.evaluate((element) => getComputedStyle(element).whiteSpace)

    // Assert
    expect(proseAtRegular).toBe(16)
    expect(proseAtLarger).toBe(20)
    // A code excerpt sets its own size in `rem` and must NOT move with the knob: its line
    // numbers are part of a citation id, and a wider line only lengthens a horizontal
    // scroll the reader never asked for.
    expect(codeAtRegular).toBe(12)
    expect(codeAtLarger).toBe(12)
    expect(wraps).toBe('pre')
    // The bug this guards is the one that has bitten this layout three times: a grid
    // track sized to min-content, found only once the content got wide enough.
    expect(overflow.scrollWidth).toBe(overflow.clientWidth)
  })

  test('has no axe-detectable violations with the reading menu open', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    await page.getByText('Reading options').click()

    // Act — the radios only enter the accessibility tree once the disclosure is open, so
    // the site-wide scan above never sees them.
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()

    // Assert
    expect(scan.violations).toEqual([])
  })

  test('picks up a typeface chosen in another tab without a reload', async ({ page, context }) => {
    // Arrange — two articles open at once, which is how a reader works through a paper.
    const href = articleHref((await newest()).incident)
    await page.goto(href)
    const otherTab = await context.newPage()
    await otherTab.goto(href)

    // Act — the choice is made in the FIRST tab only.
    await page.getByText('Reading options').click()
    await page.getByRole('radio', { name: 'Sans-serif' }).check()

    // Assert — `storage` fires only in the tabs that did NOT write, so this is the path the
    // in-memory snapshot cache would otherwise strand: prose still serif in the other tab
    // until a hard reload.
    await expect(otherTab.locator('.column-text').first()).toHaveCSS('font-family', /system-ui/)
    // Its menu has to agree too. A stale dot beside live prose is its own bug.
    await otherTab.getByText('Reading options').click()
    await expect(otherTab.getByRole('radio', { name: 'Sans-serif' })).toBeChecked()
    await otherTab.close()
  })

  test('has the larger size already applied on a returning reader first paint', async ({ page }) => {
    // Arrange — the browser of somebody who chose `Larger` on an earlier visit. The key is
    // written out here rather than imported: renaming it in `lib/constants.ts` strands every
    // preference already sitting in a real reader's browser, and this failing is how that
    // gets noticed.
    await page.addInitScript(() => localStorage.setItem('sourceburg:reading-size', 'larger'))
    // Every JS chunk refused, so React never hydrates and `ReadingControls`'s effect never
    // runs. What is left applying the preference is the inline script in `<head>` and nothing
    // else. The stylesheet is a `.css` chunk under the same directory and still goes through.
    let refusedChunks = 0
    await page.route('**/_next/static/chunks/*.js', (route) => {
      refusedChunks += 1
      return route.abort()
    })

    // Act
    await page.goto(articleHref((await newest()).incident))
    const scale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--reading-scale').trim(),
    )
    const proseSize = await page
      .locator('.column-text')
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize))

    // Assert — the reload test above passes whether or not the inline script exists, because
    // by the time it measures, React has had its turn. This is the one that fails if the
    // script stops running, which is a reader watching the article resize itself on load.
    expect(refusedChunks).toBeGreaterThan(0)
    expect(scale).toBe('1.25')
    expect(proseSize).toBe(20)
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
