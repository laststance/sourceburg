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

## 5. Three facts nothing verifies: `spdxLicense`, `defaultBranch`, `commits[].subject`

**What:** Give the probe vocabulary a way to check `incident.repo.spdxLicense`,
`incident.repo.defaultBranch`, and `incident.commits[].subject` against their
sources, the way every sha, date, and quoted line is already checked.

**Why:** Two separate reasons, and the second one is worse.

`spdxLicense` has a policy attached: `pureRules` refuses to publish a code
excerpt from a repo whose SPDX id is not in `EXCERPTABLE_LICENSES`. That gate
reads a string nothing verifies. `bin/collect.ts` fetches it from
`gh api repos/{nwo}`, so a collected fact-set is honest — but a fact-set is a
committed artifact that a later run parses, and an edited `spdxLicense: "MIT"`
on a proprietary repo would pass every probe and publish the excerpt.

`commits[].subject` is worse because it **reaches the reader**.
`datedFacts()` in `lib/facts.ts:92` pushes it as the `label` of every timeline
entry, so a commit subject is rendered text presented as fact on a site whose
whole claim is that every rendered fact was checked against its source.
`spdxLicense` at least gates publication; `subject` just gets printed.
Confirmed by grep: nothing in `plan.ts`, `verify.ts`, `probe.ts`, or
`execute.ts` reads `commits[].subject`.

**Pros:** Closes the last gap between "every fact is verified" and what the
code actually does. `commandFor` already speaks `gh api` and `git show`.

**Cons — and the two shapes are not equally cheap:**

- *A new `gitCommitSubject` kind* (`git show -s --format=%s <sha>^{commit}`)
  is purely additive: one case in `ProbeSpec` / `probeId` / `commandFor` /
  `preflight`, one `add()` in `plan()`, one rule in `verify()`, one fixture
  entry per commit. It costs one extra git invocation per commit.
- *Widening `gitCommitDate` to `--format=%cd%n%s`* spends no extra process, but
  `plan()` emits `gitCommitDate` from **six** call sites and only one of them
  (`commits[i]`) has a subject in the schema — `anchorSha`, `codeQuotes[].atSha`,
  `diff.beforeSha`, `diff.afterSha`, and `revealedLater[].evidence.sha` would all
  start carrying a second line nothing reads. It also changes `committerDate()`'s
  `stdout.trim()` into a split, and every `gitCommitDate` fixture stdout with it.

So the extra `git show` is probably the cheaper end of it, despite being the
one that adds a probe. Both touch `ProbeSpec`, `probeId`, `commandFor`,
`plan()`, `verify()`, and their tests — the four files step 4 locked down —
and `plan()`'s "every fact contributes a probe" test has to grow a case. The
repo rule still needs a verdict for a repo with no license at all (GitHub
returns `null`, and `NOASSERTION` is not the same as unlicensed).

**Context:** `spdxLicense` was deliberately deferred while building the
collector (step 6, 2026-09-01): a `ghRepo` probe kind that `plan()` never
emits would be dead vocabulary, so the collector calls `gh api repos/{nwo}`
directly and says so in its header comment. `commits[].subject` was found
straight after, reviewing that same step — the collector fetches it correctly
(`git show -s --format=%s`, which prints the subject alone and never the
commit header where author emails live), so no fact-set is dishonest today;
the hole is in the verifier's coverage.

**Depends on / blocked by:** Nothing. Cheapest to do next time `plan()` is open.

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
