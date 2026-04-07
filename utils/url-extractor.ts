import { Readability } from '@mozilla/readability'

export interface ExtractedArticle {
  title: string
  content: string
  excerpt?: string
  siteName?: string
  thumbnailUrl?: string
}

const MIN_CONTENT_LENGTH = 200

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

  // Readability mutates the DOM, so clone first for fallback use
  const clone = doc.cloneNode(true) as Document
  const reader = new Readability(clone)
  const article = reader.parse()

  let title = article?.title || ''
  let content = article?.textContent?.trim() || ''

  // If Readability returned too little, try fallback strategies
  if (content.length < MIN_CONTENT_LENGTH) {
    content = fallbackExtract(doc, html) || content
  }

  if (!title) {
    title = doc.querySelector('title')?.textContent?.trim() || url
  }

  if (!content) {
    throw new Error('Could not extract article content from this URL')
  }

  return {
    title,
    content,
    excerpt: article?.excerpt ?? undefined,
    siteName: article?.siteName ?? undefined,
    thumbnailUrl: thumbnailUrl ?? undefined,
  }
}

/**
 * Fallback extraction for JS-rendered pages (Next.js, Gatsby, etc.)
 * where Readability can't find article content in the DOM.
 */
function fallbackExtract(doc: Document, html: string): string | null {
  // 1. JSON-LD structured data (many blogs/news sites)
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent || '')
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        const body = item.articleBody || item.text
        if (typeof body === 'string' && body.length >= MIN_CONTENT_LENGTH) return body
      }
    } catch {}
  }

  // 2. __NEXT_DATA__ (Next.js pages router)
  const nextDataEl = doc.getElementById('__NEXT_DATA__')
  if (nextDataEl) {
    try {
      const data = JSON.parse(nextDataEl.textContent || '')
      const text = deepExtractText(data.props?.pageProps)
      if (text.length >= MIN_CONTENT_LENGTH) return text
    } catch {}
  }

  // 3. Next.js RSC payloads (app router — self.__next_f.push)
  const rscText = extractFromRSC(html)
  if (rscText && rscText.length >= MIN_CONTENT_LENGTH) return rscText

  // 4. Body text with boilerplate stripped
  const cleaned = doc.cloneNode(true) as Document
  cleaned.querySelectorAll('script, style, noscript, nav, header, footer, aside, [role="navigation"], [role="banner"]').forEach(el => el.remove())
  const bodyText = cleaned.body?.textContent?.replace(/\s+/g, ' ').trim()
  if (bodyText && bodyText.length >= MIN_CONTENT_LENGTH) return bodyText

  return null
}

/**
 * Extract readable text from Next.js RSC flight payloads.
 * RSC data is in self.__next_f.push([1,"..."]) script calls.
 */
function extractFromRSC(html: string): string | null {
  // Match the string payloads inside __next_f.push calls
  const chunks: string[] = []
  const pattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g
  let match
  while ((match = pattern.exec(html)) !== null) {
    // Unescape the JSON string
    try {
      const decoded = JSON.parse(`"${match[1]}"`) as string
      chunks.push(decoded)
    } catch {
      chunks.push(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
    }
  }

  if (chunks.length === 0) return null

  const payload = chunks.join('')

  // RSC format has text content as string values in arrays like ["$","p",null,{"children":"text"}]
  // Extract substantial text segments (sentences/paragraphs)
  const textParts: string[] = []
  // Match quoted strings that look like readable content (>30 chars)
  const stringPattern = /"((?:[^"\\]|\\.){30,})"/g
  let strMatch
  while ((strMatch = stringPattern.exec(payload)) !== null) {
    try {
      const text = JSON.parse(`"${strMatch[1]}"`) as string
      // Filter: must contain spaces (prose), not be a URL/path/code
      if (text.includes(' ') && !text.startsWith('http') && !text.startsWith('/') && !/^[{[\d]/.test(text) && !/[<>{}]/.test(text)) {
        textParts.push(text)
      }
    } catch {}
  }

  if (textParts.length === 0) return null

  // Deduplicate and join
  const seen = new Set<string>()
  const unique = textParts.filter((t) => {
    if (seen.has(t)) return false
    seen.add(t)
    return true
  })

  return unique.join('\n\n')
}

/**
 * Recursively extract long string values from a JSON object.
 * Used for __NEXT_DATA__ and similar embedded JSON.
 */
function deepExtractText(obj: unknown, depth = 0): string {
  if (depth > 10) return ''
  if (typeof obj === 'string') return obj.length >= 50 ? obj : ''
  if (Array.isArray(obj)) return obj.map(v => deepExtractText(v, depth + 1)).filter(Boolean).join('\n\n')
  if (obj && typeof obj === 'object') {
    return Object.values(obj).map(v => deepExtractText(v, depth + 1)).filter(Boolean).join('\n\n')
  }
  return ''
}
