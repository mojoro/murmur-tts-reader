import { Readability } from '@mozilla/readability'

const CORS_PROXY = 'https://api.allorigins.win/raw?url='

export interface ExtractedArticle {
  title: string
  content: string
  excerpt?: string
  siteName?: string
}

export async function extractArticle(url: string): Promise<ExtractedArticle> {
  const proxyUrl = CORS_PROXY + encodeURIComponent(url)
  const res = await fetch(proxyUrl)
  if (!res.ok) throw new Error(`Failed to fetch URL (${res.status})`)

  const html = await res.text()
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
  }
}
