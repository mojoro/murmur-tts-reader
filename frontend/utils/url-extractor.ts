import { Readability } from '@mozilla/readability'

export interface ExtractedArticle {
  title: string
  content: string
  excerpt?: string
  siteName?: string
  thumbnailUrl?: string
  images?: { url: string; alt: string }[]
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

  const { text, images } = htmlToText(article.content, url)

  return {
    title: pageTitle || article.title || 'Untitled',
    content: text,
    excerpt: article.excerpt ?? undefined,
    siteName: article.siteName ?? undefined,
    thumbnailUrl: thumbnailUrl ?? undefined,
    images: images.length > 0 ? images : undefined,
  }
}

const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'BLOCKQUOTE', 'PRE', 'TD', 'TH',
])

/** Sentinel attribute used to mark image placeholder elements in the DOM */
const IMAGE_MARKER_ATTR = 'data-image-marker'

/**
 * Returns true if an <img> should be skipped (tiny icon or data: URI).
 */
function shouldSkipImage(img: HTMLImageElement): boolean {
  const src = img.getAttribute('src') || ''
  if (src.startsWith('data:')) return true

  const w = parseInt(img.getAttribute('width') || '', 10)
  const h = parseInt(img.getAttribute('height') || '', 10)
  if ((w > 0 && w < 50) || (h > 0 && h < 50)) return true

  return false
}

/**
 * Convert Readability's sanitized HTML into clean, paragraph-separated text
 * suitable for TTS. Extracts inline images as indexed markers.
 */
function htmlToText(html: string, baseUrl: string): { text: string; images: { url: string; alt: string }[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const images: { url: string; alt: string }[] = []

  // Set base URL so img.src resolves relative paths to absolute
  const base = doc.createElement('base')
  base.href = baseUrl
  doc.head.prepend(base)

  // Replace <figure> elements containing images with marker placeholders.
  // Process figures first so their contained <img> tags aren't also matched
  // by the standalone <img> pass below.
  for (const figure of Array.from(doc.querySelectorAll('figure'))) {
    const img = figure.querySelector('img') as HTMLImageElement | null
    if (img && !shouldSkipImage(img)) {
      const idx = images.length
      images.push({ url: img.src, alt: img.alt || '' })
      const marker = doc.createElement('p')
      marker.setAttribute(IMAGE_MARKER_ATTR, String(idx))
      figure.replaceWith(marker)
    } else {
      figure.remove()
    }
  }

  // Replace standalone <img> elements (not already handled inside figures)
  for (const img of Array.from(doc.querySelectorAll('img')) as HTMLImageElement[]) {
    if (!shouldSkipImage(img)) {
      const idx = images.length
      images.push({ url: img.src, alt: img.alt || '' })
      const marker = doc.createElement('p')
      marker.setAttribute(IMAGE_MARKER_ATTR, String(idx))
      img.replaceWith(marker)
    } else {
      img.remove()
    }
  }

  // Remove remaining non-prose elements (figcaption already gone with figure)
  doc.querySelectorAll([
    'figcaption', 'svg', 'picture', 'video', 'audio',
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

  return { text: blocks.join('\n\n'), images }
}

/**
 * Recursively collect text from block-level elements.
 * Each block becomes a separate paragraph in the output.
 * Image marker elements produce `[image:N]` on their own line.
 */
function collectBlocks(node: Element, blocks: string[]): void {
  for (const child of Array.from(node.children)) {
    // Check for image marker placeholder
    if (child.hasAttribute(IMAGE_MARKER_ATTR)) {
      const idx = child.getAttribute(IMAGE_MARKER_ATTR)
      blocks.push(`[image:${idx}]`)
    } else if (BLOCK_TAGS.has(child.tagName)) {
      const text = child.textContent?.trim()
      if (text) blocks.push(text)
    } else {
      // Recurse into wrapper divs, sections, articles, etc.
      collectBlocks(child, blocks)
    }
  }
}
