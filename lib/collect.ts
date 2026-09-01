import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { parseFactRef } from './facts'

/*
 * The collector's argument layer: the code that turns what an operator typed
 * into something the fetch layer can use. It lives apart from `bin/collect.ts`
 * so it can be tested without running the command, and because `git rev-parse`
 * is the one git call that is NOT fetching a fact — it normalizes an argument
 * before any fact is fetched, which is what lets a human type `dfcebdb^` where
 * the schema stores a 40-char object name.
 */

const run = promisify(execFile)

/** One `--code` argument: `<rev>:<path>:<start>-<end>`, with the rev already resolved. */
export type CodeSpec = { atSha: string; path: string; startLine: number; endLine: number }

/**
 * Turns whatever revision a human typed into the 40-char object name git resolved
 * it to, so the fact-set never records an abbreviation that could later become
 * ambiguous. `^{commit}` also asserts the type, making a blob or tree sha fail here.
 *
 * @param repoDir - the local clone
 * @param rev - any revision expression: a short sha, a tag, `HEAD~2`, `abc123^`
 * @returns the full 40-char commit sha
 * @example await resolveSha(dir, 'dfcebdb^') // => 'ca01f6582e315a59cc6e3c9fc51ef5ecc2b69e48'
 */
export async function resolveSha(repoDir: string, rev: string): Promise<string> {
  const { stdout } = await run('git', ['-C', repoDir, 'rev-parse', `${rev}^{commit}`], {
    env: { ...process.env, TZ: 'UTC' },
  }).catch(() => {
    throw new Error(`${rev} does not name a commit in this clone`)
  })
  const sha = stdout.trim()
  // Named against the argument the human typed, not against a schema path: a
  // `Sha` brand failure three layers later would not say which flag was wrong.
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`${rev} resolved to "${sha}", which is not a sha`)
  return sha
}

/**
 * Parses `<rev>:<path>:<start>-<end>` by resolving the rev and then handing the
 * canonical `code:` ref to {@link parseFactRef}. The path and line range are
 * therefore validated by the SAME parser the article's citations go through, so
 * a ref the collector accepts is a ref an article can cite.
 *
 * @param repoDir - the local clone, used to resolve the revision
 * @param spec - the raw flag value
 * @returns the parsed code quote location
 * @example await parseCodeArg(dir, 'c6c3d87:src/logic/getFieldArrayParentNames.ts:3-10')
 */
export async function parseCodeArg(repoDir: string, spec: string): Promise<CodeSpec> {
  const firstColon = spec.indexOf(':')
  if (firstColon === -1) throw new Error(`--code ${spec} is not <rev>:<path>:<start>-<end>`)
  const sha = await resolveSha(repoDir, spec.slice(0, firstColon))
  const parsed = parseFactRef(`code:${sha}${spec.slice(firstColon)}`)
  if (parsed?.kind !== 'code') throw new Error(`--code ${spec} is not <rev>:<path>:<start>-<end>`)
  const { atSha, path, startLine, endLine } = parsed
  return { atSha, path, startLine, endLine }
}

