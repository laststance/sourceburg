# TODOS — sourceburg

Deferred work. Each entry carries enough context to be picked up cold.
Created 2026-09-01 by /plan-eng-review.

---

## 1. Correction policy for drifted quotes

**What:** Decide what the site does when `--refresh` detects that a quoted GitHub
comment no longer matches the hash pinned at publication.

**Why:** Decision 13A gives the pipeline the ability to *detect* that a person edited
or deleted a comment you quoted. Detection without a policy means the first time it
happens you will invent the policy on the spot, tired, with a live article. A newspaper
prints a correction. Does sourceburg? Silently regenerate, annotate the article, or
leave it and log?

**Pros:** Makes "verifiable technical journalism" cover the *ethics* of quoting, not
only the mechanics. Honest toward the person quoted.

**Cons:** Likely needs `corrections[]` on the `Article` schema, plus a place in the
broadsheet layout to render it. Probability of occurring during v1 is near zero.

**Context:** Review decision 13A: `materialize()` writes the full fetched body to a
gitignored cache and puts only the hash, the adopted excerpt, its byte offset, the
author, the dates, and `fetchedAt` into the committed artifact. Verification runs
against that pin. `--refresh` re-fetches live and reports drift. Everything after
"reports drift" is undefined. Related: the design doc's own line that whether a quote
is fair in context is a human judgment no machine check covers.

**Depends on / blocked by:** 13A implemented. Becomes real only after articles have
been live long enough for a quoted comment to change (months).

---

## 2. Font budget for the broadsheet

**What:** ~~Fix the number of display weights, the subsetting strategy,~~ and an LCP
ceiling for the article and front pages. **Only the ceiling number is still open.**

**Why:** Decision 11A moved syntax highlighting to build time (Shiki), so client JS
for content is zero. That leaves fonts as effectively the only thing shipped to a
reader. A broadsheet is a typographic design: one letterpress-scale display weight is
routinely 200KB+, and the layout wants several (headline, sub-headline, body,
caption). Without a stated ceiling this grows by accretion and the design chosen for
how it looks loses on how slowly it appears.

**Pros:** `next/font` subsetting plus `size-adjust` closes both the byte weight and the
layout shift in one move. A stated number can be checked later.

**Cons:** ~~No typeface has been chosen yet, so any number set today is a guess.~~
Resolved by /plan-design-review: the faces are **Anton** (display, one weight),
**Source Serif 4** (regular + italic), **JetBrains Mono** (regular). All SIL OFL
1.1, self-hosted, Latin-subset, **~145KB woff2 total**. The loading strategy was
closed by /plan-eng-review D7: **Anton is preloaded with `font-display: optional`**
(it is the LCP element, and `swap` would reflow the largest text on the page in a
design that declares nothing animates); Source Serif 4 and JetBrains Mono are
`swap` with `size-adjust`-tuned fallbacks. What remains open here is only the LCP
ceiling number and whether the budget survives a real article page.

**Context:** Variant A (broadsheet) was approved in /office-hours D11; the mockup and
the recorded choice live in `~/.gstack/projects/sourceburg/designs/mockup-20260901/`.
The typeface decision was made in /plan-design-review D7 and is specified in the
design doc's Typography section; T23 implements it and cites this item for the ceiling.
Raised as a watch item in the first /plan-eng-review performance section, deliberately
not decided there because it belonged to the moment the typeface is picked. The second
/plan-eng-review picked the display strategy once the faces were known; the number
still waits for a page to measure.

**Depends on / blocked by:** The article page build (design doc Next Steps, broadsheet
front page + article page).

---

## 3. `gh search` fallback for repos with no search index

**What:** Implement the local-sort fallback for ranking issues by comment count.

**Why:** `gh search issues --repo O/N --sort comments --order desc` returns HTTP 422
"cannot be searched" on some repos (verified on `facebook/react`) while working on
others (verified on `vitejs/vite`, returning 226/192/169-comment issues). Plain
`gh issue list --repo facebook/react` works fine on the same repo, so the repo is
reachable; the *search index* is not uniformly available. Any collector that ranks by
comment count will silently produce zero candidates on an affected repo.

**Pros:** Makes the flame-war collector work on every target repo instead of an
unpredictable subset.

**Cons:** Pagination plus client-side sorting is slower and spends more rate limit than
one search call.

**Context:** Verified live on 2026-09-01, recorded as Open Question 4 in the design doc
and as learning `gh-issue-sort-comments` (confidence 10/10). Fallback shape: paginate
`gh issue list --json number,title,comments` and sort locally. Probe each target repo
before relying on search.

**Depends on / blocked by:** The flame-war / discussion collector, which is session-2
work at the earliest. Not needed for the git-trace collector.

---

## 4. Quotability under the email rule

**What:** Find out how often the "no email address in a quoted line" rule actually
fires on real target repos, and decide what to do when it fires too often.

**Why:** /plan-eng-review D10 resolved a direct conflict: the design says no email
address is ever rendered, and the verifier says every quoted line byte-matches its
source. Redacting at render time would put something on the page the verifier never
checked, so the rule moved to selection instead — a `codeQuote.text` or
`quote.excerpt` matching an email pattern is a **FAIL**, and the writer picks a
different excerpt. That is the right call and it narrows what can be quoted. Nobody
knows by how much. Old C and Python file headers carry maintainer addresses as a
matter of course, and on some repos that could leave very little quotable code.

**Pros:** Keeps "every quoted line verified against its source" literally true, with
no silent exception, on the one claim the whole site rests on.

**Cons:** If a repo's most explanatory code is exactly the code with an address in
the header, that article gets written without code quotes and loses its best
evidence. Loosening the rule later is a privacy decision, not a formatting one.

**Trigger for revisiting:** article #1 leaves **3 or fewer** usable code-quote
candidates after the email filter. Then the choice is a narrower pattern (headers
only), a different candidate repo, or accepting prose-only articles for that repo.

**Context:** Found by the codex outside voice during /plan-eng-review pass 2 as a
direct contradiction between DESIGN.md's never-rendered list and the plan's
byte-match rule. The verifier rule lives in the plan doc's Mechanical section; the
reasoning lives in DESIGN.md under the never-rendered list. Test paths P50 and P51.

**Depends on / blocked by:** Nothing. It resolves the first time an article is
written against a real repo.
