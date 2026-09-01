import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

import { readAllPublished } from '../../lib/content'
import { articleHref } from '../../lib/links'

import type { Published } from '../../lib/publish'

/*
 * The thirteen reader paths, run at all three viewports by the config's projects.
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

declare global {
  interface Window {
    /** Written by one test's init script below: every `data-reading-*` write, in order. */
    __attributeWrites: string[]
  }
}

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
    await page.getByRole('button', { name: 'Reading options' }).click()
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
    await page.getByRole('button', { name: 'Reading options' }).click()
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

  test('lets a text-size utility win over the column rule', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    const paragraph = page.locator('.column-text').first()

    // Act — the same thing a person writes in the JSX: a Tailwind size beside the class.
    const withUtility = await paragraph.evaluate((element) => {
      element.classList.add('text-2xl')
      return parseFloat(getComputedStyle(element).fontSize)
    })

    // Assert — `.column-text` used to sit OUTSIDE a cascade layer, and an unlayered rule
    // beats every utility whatever its specificity, so this silently rendered at 16px and
    // nothing said so. Two prose renderers had their `text-base` stripped in the same
    // change, which is what made the trap live.
    expect(withUtility).toBe(24)
  })

  test('gives every menu row a 44px target', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    await page.getByRole('button', { name: 'Reading options' }).click()

    // Act
    const rowHeights = await page
      .locator('label:has(input[name="reading-size"])')
      .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height))

    // Assert — 44px is what this site gives its own cite markers, and the reader most likely
    // to want this menu is the one least able to hit a 32px row.
    expect(rowHeights).toEqual([44, 44, 44])
  })

  test('closes the menu when the reader presses Escape', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    const choices = page.getByRole('radio', { name: 'Sans-serif' })
    await page.getByRole('button', { name: 'Reading options' }).click()
    await expect(choices).toBeVisible()

    // Act
    await page.keyboard.press('Escape')

    // Assert — the `<details>` this replaced ignored Escape, so the only way out of the
    // menu was hitting the same small link a second time. A reader who opened it, read
    // the choices and moved on left it hanging over the article.
    await expect(choices).toBeHidden()
  })

  test('closes the menu when the reader clicks the article behind it', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    const choices = page.getByRole('radio', { name: 'Sans-serif' })
    await page.getByRole('button', { name: 'Reading options' }).click()
    await expect(choices).toBeVisible()

    // Act
    await page.locator('.column-text').first().click()

    // Assert — light dismiss, which is the whole reason this is a `popover` and not a
    // `<details>`. Clicking away from an open menu means the reader is done with it.
    await expect(choices).toBeHidden()
  })

  test('walks a keyboard into the menu choices and back out to the button', async ({ page }) => {
    // Arrange
    const focused = () =>
      page.evaluate(() => {
        const element = document.activeElement
        if (element instanceof HTMLInputElement) return `${element.name}=${element.value}`
        return element?.textContent?.trim() ?? ''
      })
    await page.goto(articleHref((await newest()).incident))
    await page.getByRole('button', { name: 'Reading options' }).focus()

    // Act — open it, tab through both groups, leave.
    await page.keyboard.press('Enter')
    const afterOpening = await focused()
    await page.keyboard.press('Tab')
    const firstStop = await focused()
    await page.keyboard.press('Tab')
    const secondStop = await focused()
    await page.keyboard.press('Escape')
    const afterEscape = await focused()

    // Assert — the panel renders in the top layer, and both of these are the browser's
    // doing rather than this component's: Tab goes from an invoker into the popover it
    // opens wherever that popover sits in the document, and Escape hands focus back. Both
    // were checked by moving the panel ahead of its button in the JSX, which changes
    // neither. What this pins is that the pair stays a real invoker/popover relationship —
    // break the `popoverTarget` id, or reach for a click handler and `showPopover()`
    // instead, and a keyboard user tabs past the menu into the Atom link with no way in.
    // Escape is also more than the `<details>` this replaced ever did: there it did
    // nothing, so the way out of the menu was a mouse.
    expect(afterOpening).toBe('Reading options')
    expect(firstStop).toBe('reading-font=serif')
    expect(secondStop).toBe('reading-size=regular')
    expect(afterEscape).toBe('Reading options')
  })

  test('hangs the menu under its button with their right edges flush', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    await page.getByRole('button', { name: 'Reading options' }).click()

    // Act
    const edges = await page.evaluate(() => {
      const button = document.querySelector('.reading-menu-button')
      const panel = document.querySelector('.reading-menu-panel')
      if (button === null || panel === null) throw new Error('the reading menu is not on the page')
      const buttonBox = button.getBoundingClientRect()
      const panelBox = panel.getBoundingClientRect()
      return {
        gapBelowButton: Math.round(panelBox.top - buttonBox.bottom),
        rightEdgeDrift: Math.round(panelBox.right - buttonBox.right),
        offLeftEdge: Math.round(Math.min(0, panelBox.left)),
      }
    })

    // Assert — 8px is the `mt-2` on the panel, and a right edge flush with the button is
    // where the old `absolute right-0` put it. Both come from `position-area` now, and a
    // popover with no anchor rule silently centres itself in the viewport instead, which
    // is the failure this pins: it looks deliberate and reads as a dialog.
    expect(edges).toEqual({ gapBelowButton: 8, rightEdgeDrift: 0, offLeftEdge: 0 })
  })

  test('never rewrites a returning reader choice back to the default while hydrating', async ({ page }) => {
    // Arrange — a returning reader on sans + larger, with every write to the two attributes
    // recorded from before the first script on the page runs.
    await page.addInitScript(() => {
      // BOTH keys, so that either default appearing below is a revert and never just an
      // unset value legitimately resolving to the design.
      localStorage.setItem('sourceburg:reading-font', 'sans')
      localStorage.setItem('sourceburg:reading-size', 'larger')
      const writes: string[] = []
      Object.defineProperty(window, '__attributeWrites', { value: writes })
      const original = Element.prototype.setAttribute
      Element.prototype.setAttribute = function (name: string, value: string) {
        if (this === document.documentElement && name.startsWith('data-reading-')) {
          writes.push(`${name}=${value}`)
        }
        return original.call(this, name, value)
      }
    })
    await page.goto(articleHref((await newest()).incident))

    // Act — the checked radio is the signal that React has hydrated and had its say.
    await page.getByRole('button', { name: 'Reading options' }).click()
    await expect(page.getByRole('radio', { name: 'Larger' })).toBeChecked()
    const writes = await page.evaluate(() => window.__attributeWrites)

    // Assert — the first two writes are the inline script's, in the order `app/layout.tsx`
    // sets them. Asserting them is what stops the two negative lines below passing on an
    // empty array: delete the script, or let the `setAttribute` patch stop matching, and
    // `writes` is `[]` while both `not.toContain` stay trivially true. The checked radio
    // above cannot stand in for this — it renders from storage, never from the attribute.
    expect(writes.slice(0, 2)).toEqual(['data-reading-font=sans', 'data-reading-size=larger'])
    // An effect keyed on the rendered value fired first with the SERVER snapshot, so it
    // wrote `regular` over what the pre-paint script had set and restored `larger` a render
    // later, on every single load. It never painted in between, because the two are one
    // main-thread task, but it was a flash waiting for React to yield once.
    expect(writes).not.toContain('data-reading-size=regular')
    expect(writes).not.toContain('data-reading-font=serif')
  })

  test('has no axe-detectable violations with the reading menu open', async ({ page }) => {
    // Arrange
    await page.goto(articleHref((await newest()).incident))
    await page.getByRole('button', { name: 'Reading options' }).click()

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
    await page.getByRole('button', { name: 'Reading options' }).click()
    await page.getByRole('radio', { name: 'Sans-serif' }).check()

    // Assert — `storage` fires only in the tabs that did NOT write, so this is the path the
    // in-memory snapshot cache would otherwise strand: prose still serif in the other tab
    // until a hard reload.
    await expect(otherTab.locator('.column-text').first()).toHaveCSS('font-family', /system-ui/)
    // Its menu has to agree too. A stale dot beside live prose is its own bug.
    await otherTab.getByRole('button', { name: 'Reading options' }).click()
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
