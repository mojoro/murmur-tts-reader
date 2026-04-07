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

  const reader = new Readability(doc)
  const article = reader.parse()
  if (!article || !article.textContent?.trim()) {
    throw new Error('Could not extract article content from this URL')
  }

  return {
    title: article.title,
    content: article.textContent.trim(),
    excerpt: article.excerpt ?? undefined,
    siteName: article.siteName ?? undefined,
    thumbnailUrl: thumbnailUrl ?? undefined,
  }
}
