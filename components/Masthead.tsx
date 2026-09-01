import Link from 'next/link'

/**
 * The site header on every page: wordmark, slogan, hairline rule, feed link.
 *
 * The slogan is not decoration. There is no nav and no About page in v1, so it is the
 * only place a first-time reader learns that these articles are generated and then
 * checked against their sources — the site's one differentiator, and an unrendered
 * differentiator is worth nothing.
 *
 * @returns the `banner` landmark
 * @example <Masthead />
 */
export function Masthead() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline gap-x-5 gap-y-1 px-4 py-3 sm:px-6">
        <Link href="/" className="font-display text-2xl leading-none tracking-wide uppercase">
          sourceburg
        </Link>
        <p className="font-serif text-sm italic">Every fact machine-verified against its source</p>
        {/* The one delivery channel in v1, so it is visible rather than discoverable. */}
        <a href="/feed.xml" className="permalink ml-auto font-mono text-xs tracking-wide uppercase underline">
          Atom feed /feed.xml
        </a>
      </div>
    </header>
  )
}
