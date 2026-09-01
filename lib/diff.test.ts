import { describe, expect, it } from 'vitest'

import { diffLines, diffSide } from './diff'

/** A real deletion hunk: git's header, then thirteen removed lines and no added ones. */
const DELETION = [
  'diff --git a/src/logic/getFieldArrayParentNames.ts b/src/logic/getFieldArrayParentNames.ts',
  'deleted file mode 100644',
  'index ef24d178..00000000',
  '--- a/src/logic/getFieldArrayParentNames.ts',
  '+++ /dev/null',
  '@@ -1,3 +0,0 @@',
  "-import type { InternalFieldName } from '../types';",
  '-',
  '-export default (names) => names;',
].join('\n')

const EDIT = ['@@ -1,3 +1,3 @@', ' const a = 1', '-const b = 2', '+const b = 3', ' const c = 4'].join('\n')

describe('a before/after box shows the file, not git machinery', () => {
  it('drops the diff header so no reader sees "diff --git" as source', () => {
    // Arrange / Act
    const lines = diffLines(DELETION)

    // Assert
    expect(lines.map((line) => line.text)).not.toContain('deleted file mode 100644')
    expect(lines.some((line) => line.text.startsWith('diff --git'))).toBe(false)
  })

  it('never marks a header line as added, which is what a naive prefix filter does', () => {
    // Arrange / Act
    const after = diffSide(diffLines(DELETION), 'after')

    // Assert — a deletion added nothing at all
    expect(after).toEqual([])
  })

  it('keeps every removed line of a deletion on the before side', () => {
    // Arrange / Act
    const before = diffSide(diffLines(DELETION), 'before')

    // Assert
    expect(before.map((line) => line.text)).toEqual([
      "import type { InternalFieldName } from '../types';",
      '',
      'export default (names) => names;',
    ])
  })
})

describe('a trailing newline is not a line of the file', () => {
  it('reports a deletion as empty even when the hunk ends with a newline', () => {
    // Arrange — every hunk git produces ends with one, and split() turns it into a
    // trailing '' that counts as context, so AFTER held one blank line and the box
    // printed an empty pane instead of saying the file was gone.
    const after = diffSide(diffLines(`${DELETION}\n`), 'after')

    // Assert
    expect(after).toEqual([])
  })
})

describe('context lines belong to both versions and to neither marker', () => {
  it('puts a context line on both sides', () => {
    // Arrange / Act
    const before = diffSide(diffLines(EDIT), 'before').map((line) => line.text)
    const after = diffSide(diffLines(EDIT), 'after').map((line) => line.text)

    // Assert
    expect(before).toEqual(['const a = 1', 'const b = 2', 'const c = 4'])
    expect(after).toEqual(['const a = 1', 'const b = 3', 'const c = 4'])
  })

  it('marks a context line as context so it gets no + or - in print', () => {
    // Arrange / Act
    const kinds = diffLines(EDIT).map((line) => line.kind)

    // Assert
    expect(kinds).toEqual(['context', 'removed', 'added', 'context'])
  })
})
