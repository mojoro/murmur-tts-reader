import { isIP } from 'node:net'
import { isPrivateOrDisallowedHost, resolveIsPrivate } from '../utils/ssrf'

const MAX_REDIRECTS = 5
const MAX_BYTES = 5 * 1024 * 1024

export default defineEventHandler(async (event) => {
  const { url } = await readBody<{ url: string }>(event)
  if (!url || typeof url !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'URL is required' })
  }

  let current = url
  let redirects = 0
  let finalResponse: Response | null = null

  while (redirects <= MAX_REDIRECTS) {
    if (isPrivateOrDisallowedHost(current)) {
      throw createError({ statusCode: 400, statusMessage: 'URL is private or disallowed' })
    }
    const parsed = new URL(current)
    if (isIP(parsed.hostname) === 0 && await resolveIsPrivate(parsed.hostname)) {
      throw createError({ statusCode: 400, statusMessage: 'URL resolves to a private address' })
    }

    const resp = await fetch(current, {
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Murmur/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location')
      if (!location) break
      current = new URL(location, current).href
      redirects++
      continue
    }

    finalResponse = resp
    break
  }

  if (!finalResponse) {
    throw createError({ statusCode: 502, statusMessage: 'Too many redirects' })
  }
  if (!finalResponse.ok) {
    throw createError({ statusCode: finalResponse.status, statusMessage: `Upstream returned ${finalResponse.status}` })
  }
  const ct = finalResponse.headers.get('content-type') || ''
  if (!ct.toLowerCase().startsWith('text/html')) {
    throw createError({ statusCode: 415, statusMessage: 'Only text/html URLs are supported' })
  }

  const buf = await finalResponse.arrayBuffer()
  if (buf.byteLength > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Response too large' })
  }
  const html = new TextDecoder().decode(buf)

  let thumbnailUrl: string | null = null
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (ogMatch?.[1]) {
    try {
      thumbnailUrl = new URL(ogMatch[1], current).href
    } catch {
      // ignore unparseable og:image
    }
  }

  return { html, thumbnailUrl }
})
