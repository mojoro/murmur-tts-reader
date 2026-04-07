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
  for (const el of Array.from(doc.querySelectorAll('[hidden]'))) {
    el.removeAttribute('hidden')
  }

  // Strip boilerplate before Readability to reduce noise
  doc.querySelectorAll([
    '[class*="animate-pulse"]', // skeleton placeholders
    'aside',                    // sidebars / nav panels
    'nav',                      // navigation / TOC
    'form',                     // comment forms
    '[role="navigation"]',
  ].join(', ')).forEach(el => el.remove())

  const reader = new Readability(doc)
  const article = reader.parse()
  if (!article?.content) {
    throw new Error('Could not extract article content from this URL')
  }

  return {
    title: pageTitle || article.title,
    content: htmlToText(article.content),
    excerpt: article.excerpt ?? undefined,
    siteName: article.siteName ?? undefined,
    thumbnailUrl: thumbnailUrl ?? undefined,
  }
}

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH',
])

/**
 * Convert Readability's sanitized HTML into clean, paragraph-separated text
 * suitable for TTS. Strips images, captions, and non-prose elements.
 */
function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Remove elements that don't belong in TTS text
  doc.querySelectorAll([
    'figure', 'figcaption', 'img', 'svg', 'picture', 'video', 'audio',
    'iframe', 'style', 'script', 'nav', 'aside', 'form',
    '[role="navigation"]',
  ].join(', ')).forEach(el => el.remove())

  // Remove the article-level header (date, tags, breadcrumbs)
  // Readability wraps the article in a div; the <header> inside it
  // typically contains metadata, not article prose.
  doc.querySelectorAll('article > header, header:first-child').forEach(el => el.remove())

  // Collect text from block elements with paragraph separation
  const blocks: string[] = []
  collectBlocks(doc.body, blocks)

  return blocks.join('\n\n')
}

/**
 * Recursively collect text from block-level elements.
 * Each block becomes a separate paragraph in the output.
 */
function collectBlocks(node: Element, blocks: string[]): void {
  for (const child of Array.from(node.children)) {
    if (BLOCK_TAGS.has(child.tagName)) {
      const text = child.textContent?.trim()
      if (text) blocks.push(text)
    } else {
      // Recurse into wrapper divs, sections, articles, etc.
      collectBlocks(child, blocks)
    }
  }
}
