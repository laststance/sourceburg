import Link from 'next/link'

import { Masthead } from '../components/Masthead'

/*
 * 404, set in the same broadsheet type as everything else. Never a framework default
 * page: a reader who mistypes a URL should still be able to tell what this site is,
 * and the only two things worth offering are the front page and the feed.
 */
export default function NotFound() {
  return (
    <>
      <Masthead />
      <main id="main" className="mx-auto flex max-w-[1400px] flex-col items-start gap-6 px-4 py-20 sm:px-6">
        <p className="font-display text-5xl leading-none tracking-tight uppercase sm:text-7xl">No such page</p>
        <p className="font-serif text-lg">That address does not name anything published here.</p>
        <div className="flex flex-wrap gap-4 font-mono text-sm">
          <Link href="/" className="permalink underline">
            Front page
          </Link>
          <a href="/feed.xml" className="permalink underline">
            Atom feed · /feed.xml
          </a>
        </div>
      </main>
    </>
  )
}
