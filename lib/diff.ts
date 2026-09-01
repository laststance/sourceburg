/*
 * Unified hunks, split back into the two versions a reader compares.
 *
 * A hunk is not just its `-` and `+` lines: git prefixes it with `diff --git`, a mode
 * line, an `index` line, and the `---` / `+++` pair, none of which is source code.
 * Printing those inside a BEFORE / AFTER box shows machinery where the reader was
 * promised the file, and prefixing them with `+` claims they were added.
 */

/** One printed line and which side of the change it belongs to. */
export type DiffLine = { text: string; kind: 'context' | 'removed' | 'added' }

/**
 * Parses a unified hunk into lines, dropping everything above the first `@@`.
 * @param hunk - the hunk exactly as `git diff` produced it and the verifier checked it
 * @returns body lines with their markers stripped and their side recorded
 * @example diffLines('@@ -1 +0 @@\n-gone')  // => [{ text: 'gone', kind: 'removed' }]
 */
export function diffLines(hunk: string): DiffLine[] {
  const lines = hunk.split('\n')
  // Everything before the first @@ is git's header, not the file.
  const firstHunkHeader = lines.findIndex((line) => line.startsWith('@@'))
  const body = firstHunkHeader === -1 ? lines : lines.slice(firstHunkHeader + 1)
  // A hunk ends with a newline, and `split` turns that into a trailing empty string.
  // Left in, it counts as a context line, so a deletion's AFTER side holds one blank
  // line instead of nothing and the box prints an empty pane rather than saying why.
  while (body.at(-1) === '') body.pop()

  return body
    .filter((line) => !line.startsWith('@@'))
    .map((line) => {
      if (line.startsWith('-')) return { text: line.slice(1), kind: 'removed' }
      if (line.startsWith('+')) return { text: line.slice(1), kind: 'added' }
      // A context line carries a leading space that is formatting, not content.
      return { text: line.startsWith(' ') ? line.slice(1) : line, kind: 'context' }
    })
}

/**
 * One side of the change: context plus that side's own lines.
 * @param lines - parsed hunk lines
 * @param side - which version to reconstruct
 * @returns the lines that version contained; empty when the file was created or deleted
 * @example diffSide(diffLines(hunk), 'after').length // => 0 for a deletion
 */
export function diffSide(lines: DiffLine[], side: 'before' | 'after'): DiffLine[] {
  const excluded = side === 'before' ? 'added' : 'removed'
  return lines.filter((line) => line.kind !== excluded)
}
