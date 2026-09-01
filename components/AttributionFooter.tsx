import { EXCERPTABLE_LICENSES } from '../lib/constants'
import { licenseHref, permalinkFor, repoHref, sourceLabelFor } from '../lib/links'

import type { Incident } from '../lib/schema'

/*
 * The attribution footer. Line for line it carries the TARGET repository's identity,
 * not sourceburg's — a footer that printed this site's own license beside someone
 * else's quoted code would be a compliance defect, not a styling choice.
 *
 * Both license branches render. When the SPDX id is undeclared the row stays and says
 * so, because naming a license the repository did not declare is the one guess this
 * project must never make; the reader can tell "we looked and found nothing" from
 * "we did not look", which is the distinction the pipeline already draws between
 * INDETERMINATE and FAIL.
 */

/** One footer row: a label in the display face, its content beside it. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // `minmax(0, 1fr)`, not `1fr`: a bare fr track takes its min-content width, and
    // a source label like `src/logic/getFieldArrayParentNames.ts:3-10` is 41 unbreakable
    // characters — enough on its own to push a 375px page 55px sideways.
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 border-t border-rule py-2 first:border-t-0">
      <p className="font-display text-xs tracking-widest uppercase">{label}</p>
      <div className="font-mono text-xs leading-5">{children}</div>
    </div>
  )
}

/**
 * The `contentinfo` landmark: project, license, the numbered source list, how this was
 * made, and the feed.
 * @param incident - the fact-set, which owns every identity printed here
 * @param orderedRefs - the citation refs in `[n]` order, from `assignCitationNumbers`
 * @example <AttributionFooter incident={incident} orderedRefs={ordered} />
 */
export function AttributionFooter({ incident, orderedRefs }: { incident: Incident; orderedRefs: string[] }) {
  const licenseKnown = (EXCERPTABLE_LICENSES as readonly string[]).includes(incident.repo.spdxLicense)

  return (
    <footer className="mt-10 border-t-2 border-ink">
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <Row label="Project">
          <a href={repoHref(incident)} className="permalink underline">
            {incident.repo.nameWithOwner}
          </a>
        </Row>

        <Row label="License">
          {licenseKnown ? (
            <>
              SPDX-License-Identifier: {incident.repo.spdxLicense} · full text:{' '}
              <a href={licenseHref(incident)} className="permalink break-all underline">
                {licenseHref(incident)}
              </a>
            </>
          ) : (
            <>
              Not detected — no SPDX identifier found at {incident.anchorSha.slice(0, 7)} ·{' '}
              <a href={repoHref(incident)} className="permalink break-all underline">
                {repoHref(incident)}
              </a>
              <br />
              No code is quoted in this article for that reason.
            </>
          )}
        </Row>

        <Row label="Sources">
          {/* An <ol> matching the [n] numbering, so a marker and its row cannot disagree. */}
          <ol className="columns-1 md:columns-2 lg:columns-3">
            {orderedRefs.map((ref, index) => {
              const permalink = permalinkFor(ref, incident)
              const label = sourceLabelFor(ref, incident)
              return (
                // `break-words` rather than `break-all`: a long path may break mid-token
                // when it has to, and an ordinary label still breaks at its spaces.
                <li key={ref} id={`src-${index + 1}`} className="mb-2 break-words break-inside-avoid">
                  <span className="pr-1">[{index + 1}]</span>
                  {label}
                  {permalink === null ? null : (
                    <>
                      <br />
                      <a href={permalink} className="permalink break-all underline">
                        {permalink}
                      </a>
                    </>
                  )}
                </li>
              )
            })}
          </ol>
        </Row>

        <Row label="How">
          Generated locally by an Agent Skill from a structured fact-set.
          <br />
          Every SHA, date, URL, and quoted line verified against its source before publication.
          <br />
          Interpretation is not machine-checkable. Judge that yourself.
        </Row>

        <Row label="Stay">
          <a href="/feed.xml" className="permalink underline">
            Atom feed · /feed.xml
          </a>
        </Row>
      </div>
    </footer>
  )
}
