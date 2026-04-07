import { Readability } from '@mozilla/readability'

export interface ExtractedArticle {
  title: string
  content: string
  excerpt?: string
  siteName?: string
  thumbnailUrl?: string
}

export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const { html, thumbnailUrl } = await $fetch<{ html: string; thumbnailUrl: string | null }>('/api/extract-url', {
    method: 'POST',
    body: { url },
  })

  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Set the base URL so relative links resolve correctly
  const base = doc.createElement('base')
  base.href = url
  doc.head.prepend(base)

  // Grab the page <title> before Readability mutates the DOM — Readability
  // sometimes picks the site-wide og:title instead of the page-specific title.
  const pageTitle = doc.querySelector('title')?.textContent?.trim()

  // Unhide streaming SSR content (Next.js, etc.) so Readability can see it.
  // Frameworks like Next.js render content into hidden divs (id="S:0", "S:1", ...)
  // that get revealed by JavaScript. We need Readability to see this content.
  for (const el of Array.from(doc.querySelectorAll('[hidden]'))) {
    el.removeAttribute('hidden')
  }

  // Remove skeleton/placeholder elements that add noise
  doc.querySelectorAll('[class*="animate-pulse"]').forEach(el => el.remove())

  const reader = new Readability(doc)
  const article = reader.parse()
  if (!article || !article.textContent?.trim()) {
    throw new Error('Could not extract article content from this URL')
  }

  return {
    title: pageTitle || article.title,
    content: article.textContent.trim(),
    excerpt: article.excerpt ?? undefined,
    siteName: article.siteName ?? undefined,
    thumbnailUrl: thumbnailUrl ?? undefined,
  }
}
