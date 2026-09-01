import { datedFacts, parseFactRef } from '../lib/facts'
import { highlightExcerpt } from '../lib/highlight'
import { permalinkFor, sourceLabelFor } from '../lib/links'

import type { Article, Incident } from '../lib/schema'

/*
 * The five block types.
 *
 * The model never emits MDX or HTML; it emits an `Article` object and this turns
 * blocks into React. Quotes arrive as plain string props on typed components — not
 * parsed, not interpolated — and `dangerouslySetInnerHTML` appears nowhere.
 *
 * Every box is `break-inside-avoid`, because the breaking half is a multi-column
 * flow and a bordered box split across a column break reads as a rendering bug.
 */

/** GitHub's short form, and what the code box header strip is set for. */
const SHORT_SHA_LENGTH = 7

/** What every block needs: the facts to resolve refs against, and the citation numbering. */
export type BlockContext = {
  incident: Incident
  numberOf: Map<string, number>
  /** `''` on the article page; the article path on `/`, where `#src-n` would point at nothing. */
  anchorBase: string
}

/**
 * The `[n]` markers for one sentence. Monospace on purpose: they read as apparatus.
 * @example <Cites cites={sentence.cites} context={context} />
 */
export function Cites({ cites, context }: { cites: readonly string[]; context: BlockContext }) {
  return (
    <>
      {cites.map((ref) => {
        const number = context.numberOf.get(ref)
        if (number === undefined) return null
        const label = sourceLabelFor(ref, context.incident)
        return (
          <sup key={ref}>
            <a
              href={`${context.anchorBase}#src-${number}`}
              className="cite-marker"
              aria-label={label === null ? `Source ${number}` : `Source ${number}: ${label}`}
            >
              [{number}]
            </a>
          </sup>
        )
      })}
    </>
  )
}

/** The `sentences` array, taken from the schema rather than re-declared beside it. */
type ProseSentences = Extract<Article['blocks'][number], { type: 'prose' }>['sentences']

/** Justified serif column text. One sentence per element, so a marker sits with its claim. */
function ProseBlock({ sentences, context }: { sentences: ProseSentences; context: BlockContext }) {
  return (
    <p className="column-text mb-4 font-serif text-base leading-7">
      {sentences.map((sentence, index) => (
        <span key={index}>
          {sentence.text}
          <Cites cites={sentence.cites} context={context} />
          {index < sentences.length - 1 ? ' ' : null}
        </span>
      ))}
    </p>
  )
}

/**
 * A verified excerpt, printed at its real line numbers and never soft-wrapped.
 * A wrapped line would make the printed numbering disagree with the cited range.
 */
async function CodeQuoteBox({ blockRef, context }: { blockRef: string; context: BlockContext }) {
  const parsed = parseFactRef(blockRef)
  if (parsed === null || parsed.kind !== 'code') return null
  const quote = context.incident.codeQuotes.find(
    (code) =>
      code.atSha === parsed.atSha &&
      code.path === parsed.path &&
      code.startLine === parsed.startLine &&
      code.endLine === parsed.endLine,
  )
  if (quote === undefined) return null

  const lines = await highlightExcerpt(quote.text, quote.path, quote.startLine)
  const permalink = permalinkFor(blockRef, context.incident)

  return (
    <figure className="mb-6 break-inside-avoid border border-rule">
      <figcaption className="border-b border-rule px-3 py-1 font-mono text-xs">
        {quote.path} @ {quote.atSha.slice(0, SHORT_SHA_LENGTH)}
      </figcaption>
      <div className="code-scroll px-3 py-2">
        <pre className="text-xs leading-5">
          <code>
            {lines.map((line) => (
              <span key={line.number} className="block">
                <span className="inline-block w-10 shrink-0 pr-3 text-right opacity-45 select-none">{line.number}</span>
                {line.tokens.map((token, index) => (
                  <span
                    key={index}
                    className={token.comment ? 'italic opacity-70' : undefined}
                    style={{ color: token.tone === 'spot' ? 'var(--code-spot)' : 'var(--ink)' }}
                  >
                    {token.text}
                  </span>
                ))}
              </span>
            ))}
          </code>
        </pre>
      </div>
      {permalink === null ? null : (
        <div className="border-t border-rule px-3 py-1 font-mono text-[0.7rem] break-all">
          <a href={permalink} className="permalink underline">
            {permalink}
          </a>
        </div>
      )}
    </figure>
  )
}

/** A person's words, attributed by handle. A thread ref is not enough to attribute one. */
function PersonQuoteBox({ blockRef, context }: { blockRef: string; context: BlockContext }) {
  const parsed = parseFactRef(blockRef)
  if (parsed === null || parsed.kind !== 'discussion' || parsed.commentId === undefined) return null

  const quote = context.incident.discussions
    .flatMap((thread) => thread.quotes)
    .find((candidate) => candidate.commentId === parsed.commentId)
  if (quote === undefined) return null
  const permalink = permalinkFor(blockRef, context.incident)

  return (
    <figure className="mb-6 break-inside-avoid border border-rule p-4">
      <blockquote className="font-serif text-lg leading-7 italic">{quote.excerpt}</blockquote>
      <figcaption className="mt-3 font-mono text-xs">
        <cite className="not-italic">@{quote.author}</cite>
        {permalink === null ? null : (
          <>
            {' · '}
            <a href={permalink} className="permalink break-all underline">
              {permalink}
            </a>
          </>
        )}
      </figcaption>
    </figure>
  )
}

/** One side of a unified hunk, reconstructed. Context lines belong to both sides. */
function diffSide(hunk: string, side: '-' | '+'): string[] {
  return hunk
    .split('\n')
    .filter((line) => !line.startsWith('@@') && !line.startsWith('---') && !line.startsWith('+++'))
    .filter((line) => line.startsWith(side) || !(line.startsWith('-') || line.startsWith('+')))
    .map((line) => line.slice(line.startsWith(side) ? 1 : 0))
}

/**
 * Before and after, stacked. Removed and added are marked typographically — the sign
 * and the weight — never by a coloured fill: the palette has one spot colour and it
 * belongs to code, and a red/green fill is unreadable to a large share of readers.
 */
function DiffBox({ context }: { context: BlockContext }) {
  const { diff } = context.incident
  // The verifier already refuses a `diffBox` block when `diff` is null, so by the time
  // the renderer runs this cannot be on disk. It still omits rather than framing air.
  if (diff === null) return null

  const sides = [
    { label: `BEFORE · ${diff.beforeSha.slice(0, SHORT_SHA_LENGTH)}`, lines: diffSide(diff.hunk, '-'), removed: true },
    { label: `AFTER · ${diff.afterSha.slice(0, SHORT_SHA_LENGTH)}`, lines: diffSide(diff.hunk, '+'), removed: false },
  ]

  return (
    <figure className="mb-6 break-inside-avoid border border-rule">
      <figcaption className="border-b border-rule px-3 py-1 font-mono text-xs">{diff.path}</figcaption>
      {sides.map((side) => (
        <div key={side.label} className="border-b border-rule last:border-b-0">
          <p className="px-3 pt-2 font-mono text-[0.7rem] tracking-wide uppercase opacity-70">{side.label}</p>
          <div className="code-scroll px-3 pt-1 pb-2">
            <pre className="text-xs leading-5">
              <code>
                {side.lines.map((line, index) => (
                  <span key={index} className={side.removed ? 'block opacity-60' : 'block font-semibold'}>
                    <span className="inline-block w-4 select-none">{side.removed ? '-' : '+'}</span>
                    {line}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        </div>
      ))}
    </figure>
  )
}

/** The chronology, from the same `datedFacts` the verifier counts. Horizontal on desktop. */
function TimelineBox({ context }: { context: BlockContext }) {
  const facts = datedFacts(context.incident)
  if (facts.length < 2) return null

  return (
    <figure className="mb-6 break-inside-avoid border border-rule p-3">
      <figcaption className="mb-2 font-display text-sm tracking-widest uppercase">Timeline</figcaption>
      <ol className="flex flex-col gap-3 md:flex-row md:gap-0">
        {facts.map((fact) => (
          <li key={`${fact.at}-${fact.ref}`} className="md:flex-1 md:border-l md:border-rule md:px-3 md:first:border-l-0 md:first:pl-0">
            <p className="font-mono text-[0.7rem] tracking-wide uppercase opacity-70">{fact.at.slice(0, 10)}</p>
            <p className="font-serif text-sm leading-5">
              {fact.label}
              <Cites cites={[fact.ref]} context={context} />
            </p>
          </li>
        ))}
      </ol>
    </figure>
  )
}

/** Which blocks the desktop composition moves into the right rail. */
export function isRailBlock(block: Article['blocks'][number]): boolean {
  return block.type === 'personQuote' || block.type === 'timelineBox'
}

/**
 * Renders one block. Returns null for a block whose facts are absent, so a valid
 * article with no diff reflows rather than printing an empty frame.
 * @example <Block block={article.blocks[0]} context={context} />
 */
export function Block({ block, context }: { block: Article['blocks'][number]; context: BlockContext }) {
  switch (block.type) {
    case 'prose':
      return <ProseBlock sentences={block.sentences} context={context} />
    case 'codeQuote':
      return <CodeQuoteBox blockRef={block.ref} context={context} />
    case 'personQuote':
      return <PersonQuoteBox blockRef={block.ref} context={context} />
    case 'diffBox':
      return <DiffBox context={context} />
    case 'timelineBox':
      return <TimelineBox context={context} />
  }
}
