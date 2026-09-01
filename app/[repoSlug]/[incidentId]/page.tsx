import { notFound } from 'next/navigation'

import { ArticleView } from '../../../components/ArticleView'
import { Masthead } from '../../../components/Masthead'
import { CONTENT_DIR, readAllPublished } from '../../../lib/content'
import { articleHref, repoSlugOf } from '../../../lib/links'

import type { Published } from '../../../lib/publish'
import type { Metadata } from 'next'

/*
 * One article, at `/{repo-slug}/{incident-id}`.
 *
 * The slug is DERIVED from the fact-set rather than stored, so this route resolves by
 * recomputing it and comparing — there is no table that can disagree with the URL.
 */

async function findPublished(repoSlug: string, incidentId: string): Promise<Published | null> {
  const all = await readAllPublished(CONTENT_DIR)
  return (
    all.find(
      (entry) => entry.incident.id === incidentId && repoSlugOf(entry.incident.repo.nameWithOwner) === repoSlug,
    ) ?? null
  )
}

export async function generateStaticParams() {
  const all = await readAllPublished(CONTENT_DIR)
  return all.map((entry) => ({
    repoSlug: repoSlugOf(entry.incident.repo.nameWithOwner),
    incidentId: entry.incident.id,
  }))
}

export async function generateMetadata({ params }: PageProps<'/[repoSlug]/[incidentId]'>): Promise<Metadata> {
  const { repoSlug, incidentId } = await params
  const found = await findPublished(repoSlug, incidentId)
  if (found === null) return {}
  return {
    title: found.article.title,
    description: found.article.dek,
    // Self-referential on article pages. No hreflang: the site is English only.
    alternates: { canonical: articleHref(found.incident) },
  }
}

export default async function ArticlePage({ params }: PageProps<'/[repoSlug]/[incidentId]'>) {
  const { repoSlug, incidentId } = await params
  const found = await findPublished(repoSlug, incidentId)
  if (found === null) notFound()

  return (
    <>
      <Masthead />
      <main id="main">
        <ArticleView incident={found.incident} article={found.article} />
      </main>
    </>
  )
}
