import { atomFeed } from '../../lib/feed'
import { CONTENT_DIR, readAllPublished } from '../../lib/content'
import { SITE_URL } from '../../lib/constants'

/*
 * The feed as a route handler. Everything it needs is on disk at build time, so this
 * is prerendered like the pages: there is no request-time work and no loading state
 * anywhere on this site.
 */
export const dynamic = 'force-static'

export async function GET(): Promise<Response> {
  const body = atomFeed(await readAllPublished(CONTENT_DIR), SITE_URL)
  return new Response(body, {
    headers: { 'content-type': 'application/atom+xml; charset=utf-8' },
  })
}
