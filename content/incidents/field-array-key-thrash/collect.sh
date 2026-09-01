#!/usr/bin/env bash
# The provenance of incident #1: the exact invocation that produced its fact-set.
#
# Committed so the fact-set is reproducible from a clean checkout rather than from
# a transcript. Everything here is a REFERENCE — which commits, which threads,
# which lines, which sentence to quote. Every date, subject, hash, comment body,
# code line, and diff hunk is fetched by the collector, never written here.
#
# REPO_DIR is supplied by the operator: where a clone happens to sit is runtime
# context, and the design doc puts the local clone path on the never-rendered list.
#
#   REPO_DIR=~/clone/react-hook-form ./content/incidents/field-array-key-thrash/collect.sh
set -euo pipefail

: "${REPO_DIR:?set REPO_DIR to a clone of react-hook-form/react-hook-form}"
OUT="${OUT:-/tmp/sb-collected.json}"

ANCHOR=a2ac01fd3872cf95b4e6ac8f4b4800f72b55eafd  # the regression test (#13453)
FIX=c6c3d87eb844af1fd1c01428f2fa113735982d4c     # the fix (#13420)
REVERT=dfcebdbde1891fdd76fb56751cbe08dd980dfa5b  # the revert
SIBLING=ca01f6582e315a59cc6e3c9fc51ef5ecc2b69e48 # a related revert, six minutes earlier
QUOTED_PATH=src/logic/getFieldArrayParentNames.ts

pnpm collect \
  --repo-dir "$REPO_DIR" \
  --id field-array-key-thrash \
  --reason 'first incident, hand-picked to exercise every probe kind' \
  --anchor-sha "$ANCHOR" \
  --commit "$FIX" \
  --commit "$REVERT" \
  --commit "$SIBLING" \
  --code "$FIX:$QUOTED_PATH:3-10" \
  --discussion 'discussion:13260' \
  --quote 'discussion:13420#4472139263=this causes react keys to thrash on `setValue` which causes component remount and field to lose focus' \
  --quote 'discussion:13420#4472672303=Can we open a seperate issue with a codesandbox or code to reproduce?' \
  --diff "$REVERT^..$REVERT:$QUOTED_PATH" \
  --revealed 'discussion:13260#4563957418=The issue reopened: a reader reported the original bug still reproducing eleven days after the revert.' \
  --out "$OUT"
