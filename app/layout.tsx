import { Anton, JetBrains_Mono, Source_Serif_4 } from 'next/font/google'

import './globals.css'

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

export const metadata: Metadata = {
  title: { default: 'sourceburg', template: '%s · sourceburg' },
  description: 'Every fact machine-verified against its source.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${anton.variable} ${sourceSerif.variable} ${jetBrainsMono.variable}`}>
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
