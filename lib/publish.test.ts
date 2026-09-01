import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { revealedRefFor } from './facts'
import {
  acquireLock,
  incidentDir,
  publish,
  readManifest,
  readPublished,
  versionHash,
} from './publish'
import { articleFixture, incidentFixture } from './verify/fixtures'
import { pureRules } from './verify/verify'

const ROOT = import.meta.dirname
const UPDATED_AT = '2026-09-01T00:00:00Z'

const incident = incidentFixture()
const article = articleFixture(revealedRefFor(incident.revealedLater[0]))

async function contentRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sourceburg-publish-'))
}

/**
 * Runs a real publish in a child process that SIGKILLs itself at `stage`. A
 * thrown error would unwind and run cleanup; only a signal reproduces the crash
 * the version scheme exists to survive.
 */
async function crashDuringPublish(contentDir: string, stage: 'afterWrite' | 'afterTmp') {
  const script = join(contentDir, 'crash.ts')
  await writeFile(
    script,
    `
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { revealedRefFor } from ${JSON.stringify(join(ROOT, 'facts.ts'))}
import { acquireLock, incidentDir, versionHash, writeVersion } from ${JSON.stringify(join(ROOT, 'publish.ts'))}
import { articleFixture, incidentFixture } from ${JSON.stringify(join(ROOT, 'verify/fixtures.ts'))}

// An async IIFE, not top-level await: tsx compiles a file outside the package
// as CJS, where top-level await is a syntax error.
void (async () => {
  const incident = incidentFixture()
  const article = articleFixture(revealedRefFor(incident.revealedLater[0]))
  const dir = incidentDir(${JSON.stringify(contentDir)}, incident.id)
  const edited = { ...article, title: 'A different headline entirely' }

  await acquireLock(dir)
  await writeVersion(dir, incident, edited)
  if (${JSON.stringify(stage)} === 'afterTmp') {
    await writeFile(join(dir, 'manifest.tmp'), JSON.stringify({
      version: versionHash(incident, edited), identity: { nameWithOwner: 'x', id: 'x', anchorSha: 'x' },
      publishedAt: 'x', updatedAt: 'x',
    }))
  }
  process.kill(process.pid, 'SIGKILL')
})()
`,
    'utf8',
  )
  // node with tsx as a loader, not the `tsx` shim: the shim is a shell script
  // that execs node, so a SIGKILL to the grandchild surfaces as an ordinary
  // non-zero exit and `signal` stays null. Here the killed process IS the child.
  return spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: join(ROOT, '..'),
    encoding: 'utf8',
  })
}

describe('versionHash', () => {
  it('ignores fetchedAt so a re-fetch that changed no fact mints no new version', () => {
    // Arrange — the same story, re-collected an hour later.
    const refetched = incidentFixture({
      discussions: incident.discussions.map((d) => ({
        ...d,
        quotes: d.quotes.map((q) => ({ ...q, fetchedAt: '2026-09-02T11:22:33Z' })),
      })),
    })

    // Act & Assert
    expect(versionHash(refetched, article)).toBe(versionHash(incident, article))
  })

  it('mints a new version when the prose changes', () => {
    // Arrange
    const edited = { ...article, title: 'A different headline entirely' }

    // Act & Assert
    expect(versionHash(incident, edited)).not.toBe(versionHash(incident, article))
  })
})

describe('publish', () => {
  it('serves a complete article after a crash between the write and the pointer swap', async () => {
    // Arrange — one good publication, then a child that dies before swapping.
    const contentDir = await contentRoot()
    const dir = incidentDir(contentDir, incident.id)
    const first = await publish(incident, article, { contentDir, updatedAt: UPDATED_AT })
    const crash = await crashDuringPublish(contentDir, 'afterWrite')

    // Act
    const published = await readPublished(dir)

    // Assert — killed by signal, and the pointer still names the version that
    // was complete, whose files both still parse.
    expect(crash.signal).toBe('SIGKILL')
    expect(published?.manifest.version).toBe(first.version)
    expect(published?.article.title).toBe('A field-array fix was reverted within nine days')
  }, 60_000)

  it('serves a complete article after a crash between manifest.tmp and the rename', async () => {
    // Arrange — the narrowest window there is: the temp manifest exists on disk
    // and names a version the reader must not see yet.
    const contentDir = await contentRoot()
    const dir = incidentDir(contentDir, incident.id)
    const first = await publish(incident, article, { contentDir, updatedAt: UPDATED_AT })
    const crash = await crashDuringPublish(contentDir, 'afterTmp')

    // Act
    const published = await readPublished(dir)
    const orphan = await readFile(join(dir, 'manifest.tmp'), 'utf8')

    // Assert — the orphaned temp file is on disk and irrelevant; manifest.json
    // never moved, so nothing observable changed.
    expect(crash.signal).toBe('SIGKILL')
    expect(orphan).toContain('"version"')
    expect(published?.manifest.version).toBe(first.version)
    expect(published?.article.title).toBe('A field-array fix was reverted within nine days')
  }, 60_000)

  it('reclaims a lock whose owner died, so one crash does not block every later run', async () => {
    // Arrange — exactly the state the two crash cases above leave behind.
    const contentDir = await contentRoot()
    const dir = incidentDir(contentDir, incident.id)
    await publish(incident, article, { contentDir, updatedAt: UPDATED_AT })
    await crashDuringPublish(contentDir, 'afterWrite')
    const stale = await readFile(join(dir, '.publish.lock'), 'utf8')

    // Act
    const again = await publish(incident, article, { contentDir, updatedAt: '2026-09-03T00:00:00Z' })

    // Assert
    expect(Number(stale)).toBeGreaterThan(0)
    expect(again.updatedAt).toBe('2026-09-03T00:00:00Z')
  }, 60_000)

  it('refuses a second run while a live process holds the lock', async () => {
    // Arrange — this process holds it, and this process is alive.
    const contentDir = await contentRoot()
    const dir = incidentDir(contentDir, incident.id)
    await acquireLock(dir)

    // Act & Assert
    await expect(publish(incident, article, { contentDir, updatedAt: UPDATED_AT })).rejects.toThrow(
      /another publish is running/,
    )
  })

  it('refuses to move publishedAt once the article has been published', async () => {
    // Arrange — a regeneration that forgot to carry the date forward.
    const contentDir = await contentRoot()
    await publish(incident, article, { contentDir, updatedAt: UPDATED_AT })
    const redated = { ...article, publishedAt: '2026-09-05T00:00:00Z', updatedAt: '2026-09-05T00:00:00Z' }

    // Act & Assert
    await expect(
      publish(incident, redated, { contentDir, updatedAt: '2026-09-05T00:00:00Z' }),
    ).rejects.toThrow(/publishedAt is frozen at 2026-09-01T00:00:00Z/)
  })

  it('refuses a different incident served at the same URL under the old date', async () => {
    // Arrange — same slug, different anchor. This is a new story, not an update.
    const contentDir = await contentRoot()
    await publish(incident, article, { contentDir, updatedAt: UPDATED_AT })
    const reanchored = incidentFixture({ anchorSha: 'dfcebdbde1891fdd76fb56751cbe08dd980dfa5b' })

    // Act & Assert
    await expect(
      publish(reanchored, article, { contentDir, updatedAt: '2026-09-04T00:00:00Z' }),
    ).rejects.toThrow(/anchorSha was a2ac01fd/)
  })

  it('refuses an updatedAt that goes backwards', async () => {
    // Arrange
    const contentDir = await contentRoot()
    await publish(incident, article, { contentDir, updatedAt: UPDATED_AT })

    // Act & Assert
    await expect(
      publish(incident, article, { contentDir, updatedAt: '2026-08-31T00:00:00Z' }),
    ).rejects.toThrow(/updatedAt would go backwards/)
  })

  it('moves the pointer to the new version when the article changes', async () => {
    // Arrange
    const contentDir = await contentRoot()
    const dir = incidentDir(contentDir, incident.id)
    const first = await publish(incident, article, { contentDir, updatedAt: UPDATED_AT })
    const edited = { ...article, title: 'A field-array fix was reverted within nine days, twice' }

    // Act
    const second = await publish(incident, edited, { contentDir, updatedAt: '2026-09-06T00:00:00Z' })
    const published = await readPublished(dir)

    // Assert — new version, publishedAt carried forward, no lock left behind.
    expect(second.version).not.toBe(first.version)
    expect(second.publishedAt).toBe('2026-09-01T00:00:00Z')
    expect(published?.article.title).toBe('A field-array fix was reverted within nine days, twice')
    expect(await readManifest(dir)).toEqual(second)
  })
})

describe('the manifest as the verifier reads it', () => {
  it('freezes publishedAt against the manifest publish actually wrote, not a hand-written one', async () => {
    // Arrange — publish once, then re-read the pointer the way `verify --content-dir` does.
    const contentDir = await contentRoot()
    const first = await publish(incident, article, { contentDir, updatedAt: UPDATED_AT })
    const previous = await readManifest(incidentDir(contentDir, incident.id))
    const backdated = { ...article, publishedAt: '2026-08-01T00:00:00Z' }

    // Act — the manifest goes straight in as the prior publication, no adapter.
    const rules = pureRules(incident, backdated, previous).map((finding) => finding.rule)

    // Assert
    expect(previous?.publishedAt).toBe('2026-09-01T00:00:00Z')
    expect(previous?.version).toBe(first.version)
    expect(rules).toContain('publishedAt is frozen once published')
  })
})
