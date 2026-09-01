import { Masthead } from '../components/Masthead'
import { FrontPageLead } from '../components/ArticleView'
import { CONTENT_DIR, readAllPublished } from '../lib/content'
import { deriveHomepageLayout } from '../lib/homepage'
import { articleHref } from '../lib/links'

import Link from 'next/link'

import type { Metadata } from 'next'

/*
 * `/` is composed for the number of published incidents, and N = 0 is a normal state.
 * A dry news day is a documented success path, so the launch screen and the empty
 * screen are the same screen. `deriveHomepageLayout` owns the branch; this file
 * renders what it is handed.
 */

export async function generateMetadata(): Promise<Metadata> {
  const layout = deriveHomepageLayout(await readAllPublished(CONTENT_DIR))
  // Canonical follows whether the lead's BODY is on this page, not N. The fold does
  // not change as N grows, so at every N >= 1 the duplicate is declared, not accidental.
  return { alternates: { canonical: layout.canonical } }
}

export default async function HomePage() {
  const layout = deriveHomepageLayout(await readAllPublished(CONTENT_DIR))

  return (
    <>
      <Masthead />
      <main id="main">
        {layout.kind === 'empty' ? (
          <div className="mx-auto flex max-w-[1400px] flex-col items-start gap-6 px-4 py-20 sm:px-6">
            <p className="font-display text-5xl leading-none tracking-tight uppercase sm:text-7xl">No news today</p>
            <p className="font-serif text-lg">Nothing has been verified for publication yet.</p>
            <a href="/feed.xml" className="permalink font-mono text-sm underline">
              Atom feed · /feed.xml
            </a>
          </div>
        ) : (
          <>
            <FrontPageLead incident={layout.lead.incident} article={layout.lead.article} />
            {layout.rest.length === 0 ? null : (
              // Single-column slots below the fold. No card grid, no image tiles.
              <section className="mx-auto max-w-[1400px] border-t border-rule px-4 py-6 sm:px-6">
                <ol className="flex flex-col gap-5">
                  {layout.rest.map((entry) => (
                    <li key={entry.incident.id} className="border-t border-rule pt-4 first:border-t-0 first:pt-0">
                      <Link href={articleHref(entry.incident)} className="font-display text-2xl uppercase underline">
                        {entry.article.title}
                      </Link>
                      <p className="mt-1 max-w-[60ch] font-serif">{entry.article.dek}</p>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>
    </>
  )
}
