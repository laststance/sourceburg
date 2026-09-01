import Link from 'next/link'

import { assignCitationNumbers } from '../lib/citations'
import { aftermathKnownAt } from '../lib/facts'
import { datelineOf } from '../lib/dates'
import { articleHref } from '../lib/links'

import { AttributionFooter } from './AttributionFooter'
import { Block, Cites, isFullWidthBlock, isRailBlock } from './Blocks'
import { KeyArtPlate } from './KeyArtPlate'

import type { BlockContext } from './Blocks'
import type { Article, Incident } from '../lib/schema'

/*
 * The article page composition.
 *
 * Reading order is headline, dek, dateline, BREAKING, boxes, WHAT WE KNOW NOW,
 * sources. The right rail is deliberately skippable: a reader who never looks at it
 * still gets the whole story, which is what makes those boxes infographics rather
 * than content. That is an editorial principle and not a verifier rule — nothing
 * mechanical checks it, so it is checked in review by a person.
 *
 * `aftermath` is not a block type. It is the tinted band, and its heading carries
 * `(WRITTEN LATER: <date>)`; without the label the tint is decoration, and with it
 * the two-part time-machine shape is legible at a glance.
 */

/** How many prose blocks `/` prints before the jump line. */
const FRONT_PAGE_PROSE_BLOCKS = 2

/** The headline block: title, dek, and the typographic plate beside them. */
function Headline({ incident, article }: { incident: Incident; article: Article }) {
  return (
    <div className="grid gap-6 border-b border-rule pb-5 md:grid-cols-[1fr_auto] md:items-start">
      <div>
        {/* Letterpress scale: the design asks for 3 lines at desktop and 4-5 on a
            phone, which is what makes it the heaviest thing on the screen. */}
        <h1 className="font-display text-5xl leading-[0.92] tracking-tight uppercase sm:text-6xl lg:text-7xl">
          {article.title}
        </h1>
        <p className="mt-4 max-w-[46ch] font-reading text-[1.125em] leading-[1.55]">{article.dek}</p>
      </div>
      <div className="justify-self-start md:justify-self-end">
        <KeyArtPlate nameWithOwner={incident.repo.nameWithOwner} />
      </div>
    </div>
  )
}

/** Dateline: the incident's own date, the repository, and the byline that is never a name. */
function Dateline({ incident }: { incident: Incident }) {
  return (
    <p className="flex flex-wrap gap-x-3 border-b border-rule py-2 font-display text-xs tracking-widest uppercase">
      <span>Incident: {datelineOf(incident.knownAt)}</span>
      <span aria-hidden="true">|</span>
      <span>{incident.repo.nameWithOwner}</span>
      <span aria-hidden="true">|</span>
      {/* No human byline, ever. The fact-set carries no author field to populate one. */}
      <span>By the desk</span>
    </p>
  )
}

/**
 * One published article, whole.
 * @param incident - the verified fact-set every ref resolves against
 * @param article - the article the writer produced
 * @example <ArticleView incident={incident} article={article} />
 */
export function ArticleView({ incident, article }: { incident: Incident; article: Article }) {
  const { ordered, numberOf } = assignCitationNumbers(article)
  const context: BlockContext = { incident, numberOf, anchorBase: '' }

  const flow = article.blocks.filter((block) => !isRailBlock(block) && !isFullWidthBlock(block))
  const rail = article.blocks.filter(isRailBlock)
  const fullWidth = article.blocks.filter(isFullWidthBlock)

  return (
    <>
      <article className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <Headline incident={incident} article={article} />
        <Dateline incident={incident} />

        {/* `minmax(0, …)` on the text column and a floor under the rail: a bare `fr`
            track takes its min-content width from the longest unbreakable thing in it,
            and one permalink is enough to crush the rail to a few words wide. */}
        <section className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(17rem,1fr)] lg:items-start">
          {/* `min-w-0`: a grid item defaults to min-width:auto, so one unbreakable
              code line inside sets the track's floor and the whole column grows past
              the viewport. This is what makes the page scroll sideways without it. */}
          <div className="min-w-0">
            <h2 className="mb-3 font-display text-sm tracking-widest uppercase">Breaking</h2>
            {/* Multi-column below the heading; ragged and single-column under 768px. */}
            <div className="md:columns-2 md:gap-8 lg:columns-3">
              {flow.map((block, index) => (
                <Block key={index} block={block} context={context} />
              ))}
            </div>
          </div>
          {/* The rail follows the breaking half in the DOM, so it reads last on a phone. */}
          {rail.length === 0 ? null : (
            <aside aria-label="Supporting detail" className="min-w-0">
              {rail.map((block, index) => (
                <Block key={index} block={block} context={context} />
              ))}
            </aside>
          )}
        </section>

        {fullWidth.map((block, index) => (
          <Block key={index} block={block} context={context} />
        ))}

        {article.aftermath.length === 0 ? null : (
          <section className="mt-8 -mx-4 bg-paper-tint px-4 py-6 sm:-mx-6 sm:px-6">
            <h2 className="mb-3 font-display text-sm tracking-widest uppercase">
              What we know now{' '}
              <span className="font-mono text-xs normal-case">
                (written later: {datelineOf(aftermathKnownAt(incident, article))})
              </span>
            </h2>
            {/* One short entry in four columns breaks a sentence into word-wide slivers,
                so the band only goes multi-column when there is enough to fill one. */}
            <div className={article.aftermath.length > 1 ? 'md:columns-2 md:gap-8 lg:columns-3' : 'max-w-[70ch]'}>
              {article.aftermath.map((entry, index) => (
                <p key={index} className="column-text mb-4 font-reading">
                  {entry.text}
                  <Cites cites={[entry.ref]} context={context} />
                </p>
              ))}
            </div>
          </section>
        )}
      </article>

      <AttributionFooter incident={incident} orderedRefs={ordered} />
    </>
  )
}

/**
 * The lead story as the front page: the fold, then the opening columns and a jump line.
 * `/` never renders an `<ol>` of sources, so markers here are cross-page links.
 * @example <FrontPageLead incident={incident} article={article} />
 */
export function FrontPageLead({ incident, article }: { incident: Incident; article: Article }) {
  const { numberOf } = assignCitationNumbers(article)
  const href = articleHref(incident)
  const context: BlockContext = { incident, numberOf, anchorBase: href }

  const opening = article.blocks.filter((block) => block.type === 'prose').slice(0, FRONT_PAGE_PROSE_BLOCKS)

  return (
    <article className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <Headline incident={incident} article={article} />
      <Dateline incident={incident} />
      <div className="mt-6 md:columns-2 md:gap-8 lg:columns-3">
        {opening.map((block, index) => (
          <Block key={index} block={block} context={context} />
        ))}
      </div>
      <p className="mt-2 font-display text-sm tracking-widest uppercase">
        {/* The visible words are the design's jump line. The accessible name adds the
            headline, because a screen reader listing every link on the front page
            would otherwise announce "Continued" with nothing to distinguish it. */}
        <Link href={href} className="underline" aria-label={`Continued: ${article.title}`}>
          Continued &raquo;
        </Link>
      </p>
    </article>
  )
}
