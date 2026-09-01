# The frozen quality baseline

`article.json` is the first hand-approved sourceburg article, written by a human
against the `field-array-key-thrash` fact-set and verified PASS before anything
generated it. Test path V1 names it the standard a generated article is judged
against: not "did it parse" (the schema answers that) but "is it as good as the
one a person wrote."

Regenerate the fact-set it cites with `content/incidents/field-array-key-thrash/collect.sh`.

It is deliberately NOT the published artifact. Publication writes
`content/incidents/{id}/v-{hash}/` and is driven by whatever the writer produced
on the day. This file does not move when that does — a baseline that tracks the
current output is not a baseline.
