# sourceburg — Design Spec

**Canonical for design from 2026-09-01.** Build from this file.

The review record — every rule's reasoning, what it replaced, and the scores it
came from — lives at
`~/.gstack/projects/sourceburg/ryotamurakami-unknown-design-20260901-113142.md`.
That file is frozen from its `## The Article Page` section onward. If the two
disagree, this one is right.

This file covers what renders. The pipeline, the fact-set contract, verification
mechanics, candidate scoring, and the Agent Skill contract stay in the plan doc.

**Scope is not design.** The plan doc's `## v1 Scope Lock` table decides what
ships and this file never overrules it. This file decides what the shipped thing
looks like and the plan doc never overrules that. Nothing is governed twice.

---

## Read this before you open the mockups

The approved PNGs are **aesthetic reference only**. What was approved is the
look: cream stock, letterpress-scale condensed headline, hairline rules, a dense
editorial grid, justified serif columns. The *content* of the front-page mockup
is a different product — a mature multi-project magazine staffed by human
reporters. It was approved at 02:31 on 2026-09-01, before the engineering review
locked v1 scope.

**Do not build these seven things. They are in the PNG and they are not in v1.**

| # | In the mockup | Build instead |
|---|---|---|
| 1 | Six human bylines with photographic avatars (MIKA HAYASHI, JAMES PARK, …) | `BY THE DESK`. No name, no avatar |
| 2 | `EN` / `JA` toggle, Japanese footer copy | Nothing. No language affordance at all |
| 3 | Six-item nav (LATEST / ARCHIVE / DEEP DIVES / OSS PROFILES / TIMELINES / ABOUT) | No nav. Masthead is wordmark + slogan + rule + feed link |
| 4 | Five-project card grid under LATEST INCIDENTS | See [Homepage at N](#homepage-at-n). No card grid at any N in v1 |
| 5 | Generated key art per card, photographic hero collage of three faces | Typographic plates. No photography, no faces, no illustration |
| 6 | Email subscribe form | Nothing. Email and web push are out of scope |
| 7 | No feed affordance anywhere | A visible `/feed.xml` link in both masthead and footer |

**#1 is a schema mismatch, not taste.** The fact-set carries no author field —
only `persona: 'desk'`. A human byline is UI the renderer cannot populate from
data, so it would have to be invented at render time, on a site whose stated
success criterion is that nothing is invented. Photorealistic faces are worse:
the subjects of these articles are real maintainers.

**#4 has no valid v1 rendering.** The composition is one hero plus a five-card
grid; it structurally needs six or more articles. v1 has one. And a dry news day
is a documented success path, so zero articles is a normal state — the launch
screen and the empty screen are the same screen.

Mockup files (outside this repo, not copied in):

| File | What it is |
|---|---|
| `~/.gstack/projects/sourceburg/designs/mockup-20260901/variant-A.png` | Front page. Aesthetic reference only — see the table above |
| `~/.gstack/projects/sourceburg/designs/article-page-20260901/variant-A.png` | Article page skeleton. Approved 5★ (B 1★, C 0★) with four corrections folded in below |

Variant A is the only one of the three article-page mockups whose license footer
attributes the **target repository**. The other two printed
`SPDX-License-Identifier: CC-BY-4.0 © Sourceburg` — sourceburg's own prose
license — and would have shipped a compliance defect. All three passed the
automated vision gate. An automated pass is not a review.

---

## Pages

| Route | Page |
|---|---|
| `/` | Front page. Composition depends on N — see [Homepage at N](#homepage-at-n) |
| `/{repo-slug}/{incident-id}` | The article |
| `/feed.xml` | Atom. The only delivery channel in v1 |
| any unknown path | 404 set in the same broadsheet type, with the feed link and a link home. Never a framework default page |

`repo-slug` is derived, never looked up: `nameWithOwner` lowercased, `/` → `-`,
any non-`[a-z0-9-]` → `-`, collapsed. `vitejs/vite` → `vitejs-vite`.

`<link rel="canonical">` is self-referential on article pages. No `hreflang` —
the site is English only.

Homepage and any index order by `incident.knownAt` descending — **the incident's
date, not the publication date**. This is a newspaper about the past; sorting by
when the robot happened to write it would be meaningless.

---

## The article page

```
+----------------------------------------------------------------------+
| sourceburg  Every fact machine-verified.      [rss] Atom feed /feed.xml|   masthead: wordmark,
+----------------------------------------------------------------------+   slogan, rule, feed link.
                                                                           no nav.
|                                          |                            |
|  HEADLINE, LETTERPRESS SCALE, 3 LINES    |   [ typographic plate ]    |   key art = type, not art
|                                          |                            |
|  serif dek, 2-3 lines                    |                            |
+------------------------------------------+----------------------------+
| INCIDENT: MARCH 11, 2019 | VITEJS/VITE | BY THE DESK                  |   dateline = knownAt
+=======================================================+==============+
| BREAKING                                              |  TIMELINE    |
|  col 1     col 2     col 3                            |  (box)       |   right rail: the two
|  justified serif, inline [1] [2] markers              |              |   infographic boxes
|                                                       +--------------+
|  +------------------+  +------------------+           |  PULL QUOTE  |
|  | CODE EXCERPT     |  | BEFORE / AFTER   |           |  (box)       |
|  | path @ sha       |  | static diff      |           |  @handle     |
|  +------------------+  +------------------+           +--------------+
+======================================================================+
| WHAT WE KNOW NOW   (WRITTEN LATER: MAY 24, 2024)                     |   tinted band, full width,
|  col 1     col 2     col 3     col 4                                 |   dated. the aftermath.
+======================================================================+
| PROJECT        | LICENSE          | PRIMARY SOURCES   | STAY INFORMED |   attribution + the
| vitejs/vite    | SPDX: MIT        | [1] ... permalink | feed link     |   numbered source list
+----------------------------------------------------------------------+
```

Reading order is `headline → dek → dateline → BREAKING → boxes → WHAT WE KNOW
NOW → sources`. **The right rail is deliberately skippable**: a reader who never
looks at it still gets the whole story. That is what makes the boxes
infographics rather than content.

That last one is an **editorial principle, not a verifier rule** — say so out
loud, because everything else in this file is mechanically checkable and a reader
will assume this is too. "The prose stands alone" cannot be decided by a set
constraint (a fact cited only in the rail is fine if the prose says the same
thing in words). It is checked in review, by a person, before the first article
is approved.

`aftermath` is not a block type. It is the tinted band, and its heading carries
`(WRITTEN LATER: <date>)` from `Article.updatedAt`. Without that label the tint
is decoration; with it, the two-part time-machine shape is legible at a glance
and needs no explaining.

### The five block types

| Block | Renders as | Carries | Omitted when |
|---|---|---|---|
| `prose` | justified serif column text | **an array of sentences**, each with its own `cites`; markers render immediately after the sentence they support, in monospace | never |
| `codeQuote` | bordered box: header strip `path` + short `atSha`, body = Shiki-highlighted lines with **real line numbers**, footer = permalink | file path, 7-char sha, line range, permalink | `spdxLicense` unknown, so `codeQuotes` is empty |
| `personQuote` | bordered box: large serif italic, attributed **`@handle`**, direct comment permalink beneath | `quotes[].author`, `discussion:{n}#{commentId}` | no quotes on the incident |
| `diffBox` | bordered box, before/after stacked, removed and added marked **typographically** (`-` / `+` and weight), never by colored fill | `beforeSha`, `afterSha`, `path` | `diff` is `null` — **the box is not rendered at all**, no empty frame |
| `timelineBox` | bordered box, horizontal dated chart on desktop, vertical list on mobile; each entry may carry its own `[n]` | dates from `commits` and `discussions` | fewer than two dated facts |

**The "omitted when" column is layout, not defense.** `diffBox` and `timelineBox`
are the only two block types that carry no `FactRef`, so the verifier gets its own
pair rules for them: a `diffBox` block with `incident.diff === null` is a **FAIL**,
and so is a `timelineBox` with fewer than two dated facts. By the time the renderer
runs, that combination cannot be on disk. The renderer still omits, because a valid
article can legitimately have no diff — it just never has to omit a block the writer
actually emitted. `datedFacts()` is one exported function called by both sides.

### Renderer contract

Four rules that constrain every component signature. They come from the security
model and they are not negotiable at render time.

- **The model never emits MDX or HTML.** It emits an `Article` object; a trusted
  renderer turns blocks into React.
- **`dangerouslySetInnerHTML` appears nowhere in this codebase.** This removes
  the XSS surface rather than sanitizing it.
- **Quotes are plain string props on typed components.** Not parsed, not
  interpolated.
- **Code excerpts are highlighted at build time by Shiki.** Zero client JS for
  content.

Quote volume caps (40 lines max from any single `path` per article;
`quotedLines / (quotedLines + proseLines) <= 0.25`) are **verifier rules counted
off the `Article` model, never off the rendered DOM** — viewport and font make
render-time counting nondeterministic. Do not reimplement them in a component.

### Citations are the interface

The verification pipeline is the expensive half of this project and it is
**invisible unless it is rendered**. A verified article that looks unverified
wasted the pipeline.

- Every `cites` entry becomes a superscript `[n]` immediately after the sentence
  it supports, in monospace, at the same ink as body text. **A prose block is an
  array of sentences, each carrying its own `cites`** — that mapping has to exist
  in the data or the renderer can only cluster markers at the paragraph end.
- `n` is assigned in **first-appearance order across the whole article**, by one
  exported pure function — `assignCitationNumbers(article)` in `lib/citations.ts`
  — and nowhere else. It walks `title` → `dek` → `blocks` in array order →
  `aftermath` in array order, and a ref that appears twice keeps the number it
  got on first appearance. **Aftermath refs are in the sequence**; the footer is
  the article's complete source list, not the breaking half's.
  The renderer receives the returned map as a prop. It does not count anything.
- On the article page each `[n]` is an in-page anchor to the `PRIMARY SOURCES`
  list in the footer. **On `/` it is a cross-page link to
  `/{repo-slug}/{incident-id}#src-{n}`** — the front page carries the opening
  columns but not the source list, so an in-page `#src-3` there would point at
  nothing. The number is the same on both pages, because
  `assignCitationNumbers()` runs over the whole article and the front-page
  excerpt is a prefix of it. `/` never renders an `<ol>` of sources, so no id
  namespacing is needed and none is introduced.
  Each footer row prints the kind, a one-line label, and **the full permalink as
  visible text**, not a bare "link". This is a newspaper; the URL is the evidence.
- Marked-up form:
  `<sup><a href="#src-3" aria-label="Source 3: GitHub issue 320">[3]</a></sup>`
  against an `<ol>` in the footer. Print footnote semantics, because that is
  exactly what these are.

### Byline, key art, and what is never rendered

- **Byline is `BY THE DESK`.** No human name, no avatar.
- **Key art is a typographic plate** — a large letterform or two drawn from the
  repo name, rules, and printers ornaments, generated as static SVG at build
  time.
- **The masthead names what this is.** Beside the wordmark, on every page:
  `Every fact machine-verified against its source`. There is no nav and no About
  page in v1, so the slogan is the only place a first-time reader learns that
  these articles are generated and then checked. It is the site's one
  differentiator, and an unrendered differentiator is worth nothing.
- **The footer carries a production note**, three lines under the sources: that
  the article was generated by a local Agent Skill from a structured fact-set;
  that every SHA, date, URL, and quoted line was verified against its source
  before publication; that interpretation is not machine-checkable. The last line
  is the honest one — the verifier makes "reporting" an honest word about
  references, not about narrative.

**Never rendered, at any viewport, on any page:**

- git author email addresses — the fact-set does not store them, and the renderer
  must not read them from anywhere else
- the local clone path
- any invented organisation name
- any email address
- any language toggle
- any nav to a section that does not exist

**The email rule is enforced at selection, not at render.** Quoted code and
quoted comments are byte-matched against their source and rendered as plain
strings — redacting one at render time would mean the page shows something the
verifier never checked, and the footer's "every quoted line verified against its
source" would stop being literally true. So instead: if a `codeQuote.text` or a
`quote.excerpt` matches an email pattern, **the verifier FAILs** and the writer
picks a different excerpt. Old OSS file headers carry maintainer addresses
routinely, so this will fire. The cost is a narrower choice of quotable lines,
which is the same trade this project already takes when a license is unknown.

### Attribution footer (a verifier rule, not a nicety)

Line for line, the footer carries the **target repository's** identity, not
sourceburg's.

```
PROJECT   vitejs/vite  ·  https://vitejs.dev/
LICENSE   SPDX-License-Identifier: MIT  ·  full text: https://github.com/vitejs/vite/blob/main/LICENSE
SOURCES   [1] commit 4f3c9e7 …  https://github.com/vitejs/vite/commit/4f3c9e7…
          [2] issue #320 …      https://github.com/vitejs/vite/issues/320
HOW       Generated locally by an Agent Skill from a structured fact-set.
          Every SHA, date, URL, and quoted line verified against its source before publication.
          Interpretation is not machine-checkable. Judge that yourself.
STAY      Atom feed  ·  /feed.xml
```

**When `spdxLicense` is unknown, the LICENSE line stays and says so.** It does
not vanish, and nothing is guessed — naming a license the repo did not declare
is the one guess this project must never make:

```
LICENSE   Not detected — no SPDX identifier found at 4f3c9e7  ·  https://github.com/vitejs/vite
          No code is quoted in this article for that reason.
```

Two branches, both unit-tested. The reader can tell "we looked and found
nothing" from "we did not look," which is the same distinction the pipeline
draws between INDETERMINATE and FAIL.

---

## Homepage at N

`/` is composed for the number of published incidents, and **N = 0 is a normal
state**, not an error.

| N | `/` renders |
|---|---|
| **0** | A full-page typographic plate reading `NO NEWS TODAY`, one line naming the repository under watch, and the feed link. Nothing else. Honest, and it is the launch screen too |
| **1** | **The story is the front page** — masthead, headline at full letterpress scale, dek, dateline, key art plate, and the opening columns of `BREAKING`, ending in a newspaper jump line (`CONTINUED >>`) to `/{repo-slug}/{incident-id}`. `<link rel="canonical">` on `/` points at the incident URL, so the duplicate is declared rather than accidental |
| **2+** | Unchanged above the fold; the second and later stories take single-column slots below it, ordered by `knownAt` descending. No card grid, no image tiles |

**The canonical rule is about content, not about N.** Whenever `/` carries the
lead story's body — which is every N ≥ 1, since the fold is unchanged as N grows
— `<link rel="canonical">` on `/` points at that incident's URL. Only at N = 0
does `/` name itself. Do not branch this on N; branch it on "is the body here."

**One function owns the branch.** `deriveHomepageLayout(articles)` returns
`{ kind: 'empty' | 'lead' | 'leadWithList', lead?, rest[], canonical }`, and
`app/page.tsx` renders what it is handed. The three states are then fixed in
Vitest and the browser only has to confirm placement — otherwise every homepage
assertion has to be reached by opening `/` in Playwright.

---

## Interaction states

The site is statically built, so there is no loading state anywhere and no
client-side error state. What varies is which facts exist.

| Surface | Empty | Partial | What the reader sees |
|---|---|---|---|
| `/` | N=0 → `NO NEWS TODAY` plate | N=1 → the story is the page | never a one-card grid |
| article body | — | `diff: null` → the box is not rendered, columns reflow | no empty frame, no "not available" |
| code excerpt | `spdxLicense` unknown → no `codeQuote` blocks at all | — | the prose paraphrases and links; nothing looks broken |
| pull quote | no quotes → the box is absent from the rail | — | the rail is shorter, not emptier |
| timeline | fewer than 2 dated facts → box absent | — | rail carries the pull quote alone |
| any route | unknown path → broadsheet 404 with feed link and a link home | — | not a framework default page |
| `/feed.xml` | N=0 → a valid, entry-less Atom feed | — | subscribers see nothing new, not a fetch error |

---

## Responsive

Three viewports, each an intentional composition rather than a stack.

| | ≥1280px | 768–1279px | <768px |
|---|---|---|---|
| prose | 3-4 justified columns | 2 columns | **1 column, ragged right** — justified text without hyphenation opens rivers at phone measure |
| right rail | fixed rail beside `BREAKING` | drops below the breaking half, full width | inline in reading order, after the prose it belongs to |
| headline | 3 lines at letterpress scale | 3-4 lines | 4-5 lines, still the heaviest thing on screen |
| aftermath band | full-width tinted band | same | same tint, but keep the `(WRITTEN LATER: …)` label — it is what the tint means |
| timeline box | horizontal dated chart | horizontal | vertical list |
| code excerpt | fits | fits | **horizontal scroll with a visible edge shadow. never wrap** |
| footer sources | 3 columns | 2 | 1, permalinks allowed to wrap mid-URL |

**Code excerpts must not soft-wrap at any viewport.** Line numbers are part of
the citation id (`code:{atSha}:{path}:{startLine}-{endLine}`), so a wrapped line
makes the rendered numbering disagree with the cited range. Scroll, do not wrap.

**And the numbers start at `startLine`, not at 1.** Shiki numbers a snippet from
1 by default; an excerpt of `src/parser.ts:412-431` must print 412 through 431.
A box that starts at 1 is citing a range the reader cannot find in the file, and
the permalink in the footer strip goes somewhere the numbers beside it disagree
with. Pass the offset explicitly; do not rely on a default.

---

## Accessibility

- Body text ≥16px. Ink `#1A1A1A` on paper `#F4F0E6` measures 15.29:1; on tint
  `#E8E0CE` it measures 13.25:1. The tint is the only thing allowed to change
  between the two halves.
- **The tint's real risk is invisibility, not contrast.** Against ink this dark,
  any tint down to a mid grey clears 4.5:1, so a contrast assertion alone passes
  no matter what value someone types. The band must therefore also be tested to
  sit at least **0.10 of relative luminance below paper** (`#E8E0CE` sits 0.123
  below). Arbitrary but fixed, so it is machine-checkable — the same bargain the
  license caps make. A tint nudged toward paper fails CI instead of shipping.
- `BREAKING` and `WHAT WE KNOW NOW` are real `<h2>`s. The split is structural,
  not just tinted.
- Citation markers are links with an accessible name
  (`aria-label="Source 3: …"`), never a bare `[3]`, and get vertical padding so
  the tap target reaches 44px even though the glyph is small.
- Code excerpts are `<figure><pre><code>` with a `<figcaption>` naming the path
  and SHA, so a screen reader announces what it is before reading it.
- Pull quotes are `<blockquote>` with `<cite>` carrying the handle.
- The footer source list is an `<ol>`, matching the `[n]` numbering.
- One skip link to `<main>`. Landmarks: `banner`, `main`, `contentinfo`.
- Visited and unvisited permalinks are visually distinct — on a page whose job is
  sending you to primary sources, "have I read this one" is real information.
- **No motion in v1.** Nothing animates, so there is nothing for
  `prefers-reduced-motion` to turn off.

Verified by `@axe-core/playwright`, asserted inside the existing article-page
E2E rather than a separate test file (T25).

---

## Typography

Three families, four files, no more. All self-hosted and Latin-subset.

| Role | Face | Notes |
|---|---|---|
| headline, section labels, dateline | **Anton** | ultra-heavy condensed. **One weight only** — headline hierarchy comes from size and tracking, never from a bolder cut, because there isn't one |
| dek, body, pull quotes, footer | **Source Serif 4** (regular + italic) | real italics, designed for screen text; holds up justified at desktop measure, ragged below 768px |
| code, diffs, `[n]` markers | **JetBrains Mono** (regular) | the `[n]` markers are monospace on purpose: they read as apparatus, not as prose |

All three are SIL OFL 1.1, self-hosted and subset — **no request leaves the
origin**, which matters on a site that otherwise makes zero third-party calls.
Roughly 145KB of woff2 for the four files. The LCP ceiling lives in
[TODOS.md](./TODOS.md) #2.

**Anton is preloaded and set `font-display: optional`.** The headline at
letterpress scale is the LCP element, so how it behaves before the font arrives
is a design decision, not a build detail. `swap` would reflow the largest text on
the page mid-paint, and this document says nothing animates — a font swap is
motion whatever it is called. `block` would hide the measured element while it
waits. Preloading makes `optional` land inside its window for effectively every
reader; the few it misses see a correct fallback rather than a substitution.

Source Serif 4 and JetBrains Mono are `swap`, not preloaded — a body-size
substitution does not read as motion. Both fallbacks carry `size-adjust` tuned
against the real face so the swap does not move the column.

No system stack, no Inter, no Roboto.

### The reader's own two knobs

That rule governs what the **desk** may choose, not what a **reader** may impose
on their own machine. The masthead carries a `Reading options` menu with two
radio groups — typeface (Serif / Sans-serif) and text size (Regular / Large /
Larger) — and the defaults are exactly the design above: Source Serif 4 at 1rem
is what everyone gets until they say otherwise.

The sans path is the **system stack, not a fourth face**, and that is the whole
point of it: it ships zero bytes, so the budget in [TODOS.md](./TODOS.md) #2
survives, and there is no swap for a reader to watch. Source Serif 4 is what the
page is designed in; a reader who finds a serif harder to read is better served
by the face their own OS already renders best than by another 40KB download of
somebody else's opinion.

Both choices live as `data-reading-font` and `data-reading-size` on `<html>`, set
by an inline script **before first paint**, and `app/globals.css` turns them into
`--reading-family` and `--reading-scale`. Nothing reflows on load, which keeps
the no-motion rule above true for a returning reader as well as a new one.

The size knob moves **inherited** type only: prose, deks, pull quotes. Code
excerpts and the masthead set their size in `rem` and stay put — a scaled code
line only lengthens a horizontal scroll the reader never asked for, and its line
numbers are part of a citation id either way.

This is the first client JavaScript on the reading path. Decision 11A drove
client JS for content to zero by tokenising code at build time, and that still
holds: the menu renders no word of any article, and what it ships is two
attributes.

Colors are CSS variables. There are five:

| Variable | Use |
|---|---|
| `--paper` | `#F4F0E6`, the stock |
| `--ink` | `#1A1A1A`, all body and display text |
| `--paper-tint` | `#E8E0CE`, the aftermath band, and nothing else |
| `--rule` | `#B8AF97`, hairline rules |
| `--code-spot` | `#8C2318`, inside code highlighting only |

All five are named and valued, so CI can assert the set. `--code-spot` measures
7.79:1 against paper and 6.75:1 against tint — it is text inside a code box, so
it clears 4.5:1 in both halves. `--rule` is non-text and sits at 1.92:1 against
paper: visible as a printed hairline, not competing with ink.

---

## Out of scope for v1

Deferred by decision, not forgotten. Each returns with the thing that needs it.

- Nav, `/about`, and an archive index — they need a second article to navigate to
- Print stylesheet
- Any motion or animation
- Dark mode
- Multi-project taxonomy, project cards, per-project sections
- Email and web push
- Generated key art, photography, illustration
- Interactive timeline, interactive or animated diff
- Any language other than English

---

## Section → task map

| Spec section | Task |
|---|---|
| The five block types, aftermath band | T17 |
| Citations are the interface | T18 |
| Attribution footer | T19 |
| Masthead (wordmark, slogan, feed link) | T20 |
| Homepage at N | T21 |
| Key art typographic plate | T22 |
| Typography, fonts, CSS variables | T23 |
| Responsive, no-wrap code excerpts | T24 |
| Accessibility (axe assertion) | T25 |
| Broadsheet 404, entry-less feed | T26 |

Full task detail, including files and verify steps, is in the plan doc's
`## Implementation Tasks`.
