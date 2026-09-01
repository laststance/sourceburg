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

---

## 5. Two repo facts nothing verifies: `spdxLicense` and `defaultBranch`

**`commits[].subject` was the third, and it was closed on 2026-09-01.** What it
cost, recorded because the estimate in this item was the reason the shape was
chosen: a `gitCommitSubject` probe kind (`git show -s --format=%s <sha>^{commit}`,
the same command the collector was already running by hand), one `add()` in
`plan()`, one rule in `verify()`, three fixture stdouts, two tests. The widening
of `gitCommitDate` was not attempted; the six emission sites were counted first
(`anchorSha`, `commits[i]`, `codeQuotes[i].atSha`, `diff.beforeSha`,
`diff.afterSha`, `revealedLater[i]`) and only one of them has a subject, so the
extra `git show` per commit is the cheaper end after all.

The change paid for itself somewhere this item did not predict: `bin/collect.ts`
had its own copy of that command, listed in its header as deliberately outside
the probe vocabulary. It now goes through `commandFor` like everything else, so
the collector and the verifier can no longer disagree about what a subject is.
Proved end to end rather than by fixture: re-collecting incident #1 produced a
byte-identical fact-set (15 fetches, `fetchedAt` aside), it verifies PASS against
a real clone, and hand-editing one subject FAILs with
`commits[].subject matches its source`.

**Still open, and the reason this item is not deleted:**

`spdxLicense` has a policy attached — `pureRules` refuses to publish a code
excerpt from a repo whose SPDX id is not in `EXCERPTABLE_LICENSES`. That gate
reads a string nothing verifies. `bin/collect.ts` fetches it from
`gh api repos/{nwo}`, so a collected fact-set is honest, but a fact-set is a
committed artifact that a later run parses, and an edited `spdxLicense: "MIT"`
on a proprietary repo would pass every probe and publish the excerpt.
`defaultBranch` is milder: `licenseHref` builds a link from it, so a wrong value
is a 404 rather than a false claim.

Both come from one `gh api repos/{nwo}` call, so both close with one `ghRepo`
probe kind. It needs a verdict this item does not have: GitHub returns
`license: null` for an unlicensed repo and `NOASSERTION` for a LICENSE file it
cannot identify, and the collector currently maps both to `""`. Neither is in
`EXCERPTABLE_LICENSES`, so today's policy is already correct for both — the
question is only what the new rule compares against.

**A second half is open too, and it is not verification.** A commit subject is
now checked against its source, but it is not screened for email addresses the
way `codeQuotes[].text` and `quotes[].excerpt` are, and it renders in the
timeline. The screen was deliberately not added in the same pass:
`EMAIL_PATTERN` exists to reject npm specifiers, and a subject plausibly carries
`main@v2.beta`, which clears the "first label starts with a letter" guard and the
two-letter TLD. A false positive there is worse than in a code excerpt, because
the escape hatch differs: an excerpt has "pick a different one", a subject does
not — the only fix is dropping a commit the story may need. **Do not add the
screen without a false-positive corpus of real subjects first.**

**Depends on / blocked by:** Nothing. The `ghRepo` half is cheapest next time
`plan()` is open; the email half is blocked on the corpus, not on code.

---


## 6. What the injection eval cannot see

**What:** Decide what covers the injection cases the poisoned-fixture eval
structurally misses, and revisit the writer's input rule before session 3.

**Why:** `evals/injection/` plants six canaries and fails if any reaches the
article. That is exact and has no false positives, which is exactly why it is
narrow. Three things it does not detect:

1. **Obedience by omission.** The fixture's first payload also says "do not
   mention the revert." An article that quietly drops the revert scores clean —
   there is no canary for a sentence that was never written.
2. **A payload restated in the model's own words.** Injection succeeds without
   copying anything. No threshold fixes this: measured on the frozen baseline,
   the longest verbatim run between hand-approved prose and the comment bodies
   it describes is **15 characters**, and it is the repo name. Any threshold
   above that spares the baseline and lets "Vercel is insolvent" (19 chars)
   through; any threshold below it fails the baseline.
3. **A true-but-steered story.** The design doc's own line: a headline can be
   false while every sha in the article is real.

The v1 answer to all three is that a person reads the article before it
publishes. That is a real answer for one article a week and not a real answer
for anything faster.

**A fourth one was found and closed on 2026-09-01, by reading.** The first live
run printed `0 reached the page` and that was false: three canaries were on the
page. A quote block carries a ref, not text, so the checker walked the article
and saw ids while the reader saw "Funded in part by Northwind Trading." That is
a laundering route, not just bad wording — a writer told to make the reader see
X can pick the quote that already contains X and keep its own prose spotless.
{@link pageTextOf} now splits the page three ways and fails the first two; the
fixture gained a clean code range, a clean comment and a clean `revealedLater`
entry, because until it had those, "emit a `codeQuote`" and "keep the page
clean" were mutually exclusive and the FAIL would have proved nothing. The
lesson generalises past this eval: **the checked artifact was not the artifact
the reader gets.**

**Still open, and named here because nothing tests it:** DESIGN.md says each
footer row prints "the kind, a one-line label, and the full permalink" but never
says what the label holds. If step 8 derives it from `commits[].subject` the way
{@link datedFacts} does, every `commit:` citation becomes a delivery route and
`pageTextOf` needs a fourth bucket. Decide this while writing the footer, not
after. Related: item 5, where that same subject is the fact nothing verifies.

**Pros:** Naming the boundary is what keeps the eval honest. An eval described
as "asserts no injection reaches the output" would be read as a gate.

**Cons:** Nothing here has a cheap mechanical fix, which is why it is a TODO
and not a rule. A verify-time rule was considered and rejected: see the
threshold arithmetic above, and `lib/canary.ts`'s header.

**Trigger for revisiting — this one is dated.** The writer currently reads
`incident.fact.json` and nothing else, so the only untrusted text it sees is an
excerpt a **human operator chose**. That human filter is doing real work.
**Session 3 removes it:** the automatic collector selects excerpts by model, at
which point attacker-controlled text reaches the writer with nobody having read
it first. Re-run this eval and re-read this item the day excerpt selection stops
being manual.

**Context:** The writer's input rule and its reasoning are in
`.claude/skills/sourceburg/SKILL.md` under "What you read, and nothing else".
The checker is `lib/canary.ts`. It walks every string rather than a named field
list, so a free-text field added to `Article` later is covered the day it is
added, and {@link pageTextOf} resolves the quote blocks to the text the page
will actually print. Test paths V1 and W1-W12.

**Measured once, by hand, on the 2026-09-01 run:** blind spot 1 did not fire —
the article led with the revert the payload told it to suppress, and reported
the instruction to suppress it. Blind spot 2 did not fire either: it described
each payload's shape ("specifying an exact headline the article was to carry")
without restating its content. One sample, not a result.

**Depends on / blocked by:** Nothing. The dated half depends on session 3.

---

## 7. The detector's signal set, measured before it is written

**Status:** open, and the measurement is done. Session 3 builds the automatic
collector; the first thing it builds is the **detector**, and the signal set
below is not the one incident #1 suggested.

Incident #1 was hand-picked — `selection.reason` says so: `'first incident,
hand-picked to exercise every probe kind'`. It is a sample of one, chosen for
probe coverage rather than by any signal, so "this shape makes a good story"
says nothing about how often the shape occurs. That was measured read-only over
`react-hook-form` `origin/master`, 24 months to 2026-08-31 (`911f8467`):

| signal | hits / 24 months |
|---|---|
| a `Revert "` commit | **18** (66 all time) |
| + target resolves, gap > 1 day | **10** |
| a sibling revert the same day | 10 |
| a test-only commit within 24h | 8 |
| the reverted subject names an issue it closed | 3 |
| **all three of the last — incident #1's exact shape** | **1** |

**The conjunction fires once in two years, and that once is the incident that
was picked by hand.** A detector filtering on it finds nothing and looks broken.

**So: filter on one signal, rank on the rest.** The gate is a revert whose
target resolves and whose gap exceeds a day — **10 candidates, one every ~10
weeks**, a publishable cadence for a single repo. Sibling revert, test-only
follow-up, and later thread activity become score, not gate. Incident #1 still
ranks first: it scores on all three.

**Two corrections to the signals themselves:**

1. **"Names a closed issue" is measuring the wrong text.** It fires 3/18 only
   because it greps the commit subject, and this repo's subjects carry a PR
   number (`(#13420)`) rather than `closes #N` — the issue link lives in the PR
   body. Resolve it through `gh`, or drop it. As written it is a prose match
   wearing a semantic label.
2. **A gap under a day is a different story.** Three of the 18 are 0.1d, 0.1d,
   0.4d: landed and pulled the same hour, which is a CI failure, not a fix that
   lived in the wild for eight days. Keep it in its own bucket rather than
   widening the threshold to swallow it.

**Reproduce:** `git log origin/master --grep='^Revert "' --since='24 months ago'`
for the base count; the cluster columns come from resolving each revert's target
by exact subject match and walking the 24h window after it. Deliberately not
committed as a script — the detector is the real artifact and a throwaway in the
repo would be scaffolding for it.

**Depends on / blocked by:** Nothing. This is input to session 3, not a blocker.

---

## 8. The prose column count has no test

**Status:** open, small. Test-plan path E5 ("the prose column count does not
respond to viewport", 3-4 → 2 → 1 across 1440 / 768 / 375) is the one planned
path that shipped nothing. The behaviour is correct and was checked by eye at
all three widths; nothing would catch a regression.

Not urgent: a wrong column count is ugly, never wrong or unsafe, and the two
column bugs found so far (the aftermath band shredding a sentence in
`columns-4`, the diff box cut to a 300px track) were both found by looking at
the page rather than by a count assertion. A count assertion would have caught
neither.

**Do it as one assertion in the existing E2E**, reading
`getComputedStyle(el).columnCount` on the prose container in the test that
already runs at all three viewports — not a new spec file.

**Depends on / blocked by:** Nothing.

---

## 9. The manifest keeps two clocks under one name, and it had killed republishing

**Status:** CLOSED 2026-09-01, option (c). Was: open, real, shipped. Found on 2026-09-01 by re-running `pnpm verify`
against the published article at the end of step 10 — not by any test, because
every fixture sets both fields from the same string, and the bug lives exactly
in the gap between what the fixtures do and what the pipeline does.

`content/incidents/field-array-key-thrash/manifest.json` today:

```
publishedAt  2026-05-17T23:41:25Z        <- event time, copied from the article
updatedAt    2026-09-01T07:50:40.701Z    <- pipeline wall clock, stamped at bin/verify.ts:78
```

Two fields side by side, in two different clocks. `publishedAt` is the
fact-set's `knownAt`; `updatedAt` is `new Date()` at publish. The comment at
`bin/verify.ts:76` states that second choice deliberately — "the writer decides
what the story says, the pipeline decides when a version became live" — and on
its own it is defensible. The defect is that nothing else was moved to match.

**`lib/verify/verify.ts:439` then compares the two clocks against each other:**

```ts
if (article.updatedAt <= previous.updatedAt)   // event time <= wall clock
```

Wall clock is always later than the event time it records, so this is always
true, so **every republish FAILs before it reaches `publish()`**:

```
FAIL  updatedAt strictly increases
        was 2026-09-01T07:50:40.701Z, now 2026-05-17T23:41:25Z
FAIL (15 probes, 1 findings)
```

**And this incident can never be republished at all.** `updatedAt` is derived
from `knownAt`, `knownAt` is the anchor's date, and `anchorSha` is inside the
identity tuple — so moving the anchor to get a later `knownAt` makes it a
different incident rather than a new version of this one. The value on the left
of that comparison is frozen forever; the value on the right only grows.

The `publishedAt`-is-frozen rule passes for the mirror-image reason: both sides
of *that* comparison happen to be event time. One rule works by luck and its
neighbour fails by luck, from a single root cause.

`publish()` already carries the same guard in the right units at
`lib/publish.ts:188` (`options.updatedAt < previous.updatedAt`), where both
values are pipeline-stamped. So the verifier's rule is a duplicate expressed in
the wrong currency.

**Three fixes, and the choice is a real product call, not a cleanup:**

- **(a) Store the article's `updatedAt` in the manifest.** One line at
  `bin/verify.ts:78`. Both manifest fields become event time, the verifier rule
  compares like with like and starts working. **Cost:** a prose-only
  regeneration — same facts, same `knownAt`, better writing — produces an equal
  `updatedAt` and is then blocked by "strictly increases". That case is real;
  the skill's own description says "write, draft, or *regenerate*".
- **(b) Keep the wall clock, delete the verifier rule.** Republishing works,
  including prose-only regeneration, and `publish()`'s guard carries the
  invariant. **Cost:** the check moves after the gate, so a violation arrives as
  a thrown crash (exit 2, INDETERMINATE) rather than a FAIL naming the rule —
  which is the wrong verdict for a wrong fact.
- **(c) Two fields, two names.** The manifest keeps `updatedAt` as the live
  stamp the Atom feed wants, and records the article's own value alongside it;
  the verifier compares event time to event time. **Cost:** one more field in
  the manifest, and `Manifest` was deliberately collapsed to one definition in
  `f25a4d8` — this re-widens it slightly.

Whichever is chosen, the test that would have caught this is the same: a
republish fixture whose article `updatedAt` and manifest `updatedAt` come from
**different** sources, because every existing fixture sets them from one string.

**Chose (c), and (a) and (b) were not close.** (a) blocks a prose-only
regeneration, which the skill's own description promises ("write, draft, or
*regenerate*"). (b) moves the check behind the gate, so a wrong fact arrives as a
thrown crash — exit 2, INDETERMINATE — and this pipeline's whole three-valued
verdict exists to keep "somebody fabricated a value" from collapsing into "a
probe could not run". The objection to (c) turned out not to apply: `f25a4d8`
collapsed *duplicate re-declarations of the same four fields*, and a second clock
is a second quantity, not a duplicate of the first.

**Shipped:** `PreviouslyPublished` gains `articleUpdatedAt` (event time) beside
`updatedAt` (pipeline time), each documented with which reader it serves;
`publish()` records it; the monotonic rule compares event time to event time; a
manifest written before the field existed FAILs by name rather than skipping the
rule, because a safety rule that quietly stops running is worse than one that
fires. The single on-disk manifest was backfilled from the article it points at.

**Proven on real data, not only in fixtures.** A regeneration whose event time is
2026-06-01 against a manifest whose live stamp is 2026-09-01 — the exact shape
that was permanently impossible — now PASSes at 15 probes against the real clone.
Verifying the published article as a republish candidate still FAILs, now for the
right reason: `was 2026-05-17T23:41:25Z, now 2026-05-17T23:41:25Z`, equal event
time, no new version to announce. Both new rules mutation-checked.

**The fixture was the bug's hiding place, and it changed too.** `previous` in
`lib/verify/verify.test.ts` now carries a live stamp months ahead of its event
time. Every earlier fixture set both from one string, which is precisely why 208
green tests said nothing about a rule that could only ever compare two different
clocks.
