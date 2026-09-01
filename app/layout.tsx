import { Anton, JetBrains_Mono, Source_Serif_4 } from 'next/font/google'

import './globals.css'
import {
  READING_FONT_ATTR,
  READING_FONT_DEFAULT,
  READING_FONT_KEY,
  READING_SIZE_ATTR,
  READING_SIZE_DEFAULT,
  READING_SIZE_KEY,
} from '../lib/constants'

import type { Metadata } from 'next'

/*
 * Three families, four files, all self-hosted by `next/font` — no request leaves the
 * origin on a site that otherwise makes zero third-party calls.
 *
 * Anton is the headline at letterpress scale and therefore the LCP element, so how it
 * behaves before it arrives is a design decision. `optional` with a preload lands
 * inside its window for effectively every reader; `swap` would reflow the largest
 * text on the page mid-paint, and this site says nothing animates. The other two are
 * `swap` and unpreloaded, because a body-size substitution does not read as motion.
 */
const anton = Anton({ subsets: ['latin'], weight: '400', variable: '--font-anton', display: 'optional', preload: true })

const sourceSerif = Source_Serif_4({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-source-serif',
  display: 'swap',
  preload: false,
})

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: false,
})

/*
 * The reader's stored choice, applied while the browser is still PARSING, which is the
 * only moment early enough. `useLayoutEffect` runs before paint but after hydration, and
 * on a statically prerendered page the browser paints the HTML long before React loads —
 * a reader on `larger` would watch the article resize itself on every navigation, and
 * this site's own rule is that nothing animates.
 *
 * This is the one `dangerouslySetInnerHTML` in the tree, and `lib/highlight.test.ts` fails
 * on a second one. That test runs under `pnpm test`, NOT under `next build` — nothing gates
 * a deploy on it, so treat it as a tripwire a person still has to look at, not a wall. The
 * distinction it draws: this string is a frozen literal built from two constants in this
 * repo, and it writes what it reads into an ATTRIBUTE, where an unknown value matches no
 * CSS rule and falls back to the design. A renderer handing fact-set text to the same prop
 * would be markup, which is the thing that must never happen.
 */
const READING_PREFERENCE_SCRIPT = (
  `(function(){try{var root=document.documentElement;` +
  `var font=localStorage.getItem(${JSON.stringify(READING_FONT_KEY)});` +
  `if(font)root.setAttribute(${JSON.stringify(READING_FONT_ATTR)},font);` +
  `var size=localStorage.getItem(${JSON.stringify(READING_SIZE_KEY)});` +
  `if(size)root.setAttribute(${JSON.stringify(READING_SIZE_ATTR)},size)}catch(e){}})()`
)
  // `JSON.stringify` escapes quotes and backslashes but leaves `<` alone, so a constant
  // above that ever contained `</script>` would close this tag and put the rest on the page
  // as markup. None of the four can today — they are fixed literals a few lines apart in
  // `lib/constants.ts` — and this closes the door anyway, because the cost is one call and
  // the failure mode is the one thing this file promises cannot happen.
  .replace(/</g, String.raw`\u003c`)

export const metadata: Metadata = {
  title: { default: 'sourceburg', template: '%s · sourceburg' },
  description: 'Every fact machine-verified against its source.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // The two attributes below are the DEFAULT, and the script rewrites them before React
    // ever sees the DOM, so the mismatch React would otherwise report is expected here.
    <html
      lang="en"
      className={`${anton.variable} ${sourceSerif.variable} ${jetBrainsMono.variable}`}
      data-reading-font={READING_FONT_DEFAULT}
      data-reading-size={READING_SIZE_DEFAULT}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: READING_PREFERENCE_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-paper text-ink antialiased">
        {/* One skip link, to the one landmark a reader actually wants. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:border focus:border-ink focus:bg-paper focus:px-3 focus:py-2 focus:font-mono focus:text-sm"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  )
}
