import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { Readability } from '@mozilla/readability'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export interface ExtractedImage {
  data: Blob
  alt?: string
}

export interface ParsedDocument {
  title: string
  content: string
  thumbnail?: Blob
  images?: ExtractedImage[]
}

export async function parseDocument(file: File): Promise<ParsedDocument> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const baseName = file.name.replace(/\.[^.]+$/, '')

  switch (ext) {
    case 'txt':
      return { title: baseName, content: await file.text() }
    case 'md':
      return { title: baseName, content: parseMarkdown(await file.text()) }
    case 'html':
    case 'htm':
      return parseHtml(baseName, await file.text())
    case 'pdf':
      return { title: baseName, ...(await parsePdf(file)) }
    case 'docx':
      return { title: baseName, ...(await parseDocx(file)) }
    case 'epub':
      return { title: baseName, ...(await parseEpub(file)) }
    default:
      throw new Error(`Unsupported file type: .${ext}`)
  }
}

function parseHtml(fallbackTitle: string, html: string): ParsedDocument {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const reader = new Readability(doc)
  const article = reader.parse()
  if (article?.textContent?.trim()) {
    return { title: article.title || fallbackTitle, content: article.textContent.trim() }
  }
  // Fallback: just extract body text
  const text = doc.body?.textContent?.trim()
  if (!text) throw new Error('Could not extract text from HTML file')
  const title = doc.querySelector('title')?.textContent?.trim() || fallbackTitle
  return { title, content: text }
}

function parseMarkdown(md: string): string {
  return md
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    // Remove images
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    // Convert links to just text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove headings markers but keep text
    .replace(/^#{1,6}\s+/gm, '')
    // Remove emphasis markers
    .replace(/(\*{1,3}|_{1,3})([^*_]+)\1/g, '$2')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Collapse multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function renderPageToBlob(
  page: pdfjsLib.PDFPageProxy,
  maxDimension: number,
  quality: number,
): Promise<Blob | undefined> {
  const viewport = page.getViewport({ scale: 1 })
  const scale = maxDimension / Math.max(viewport.width, viewport.height)
  const scaledViewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = scaledViewport.width
  canvas.height = scaledViewport.height
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: scaledViewport }).promise
  return new Promise<Blob | undefined>(resolve =>
    canvas.toBlob(b => resolve(b ?? undefined), 'image/jpeg', quality),
  )
}

async function parsePdf(file: File): Promise<{ content: string; thumbnail?: Blob; images?: ExtractedImage[] }> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const contentParts: string[] = []
  const images: ExtractedImage[] = []
  let thumbnail: Blob | undefined

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const items = textContent.items.filter((item: any) => item.str !== undefined) as any[]
    if (items.length === 0) continue

    // Group items into lines using y-position
    const lines: { text: string; y: number; height: number }[] = []
    let lineText = ''
    let lineY = 0
    let lineHeight = 0

    for (const item of items) {
      const y = item.transform[5]
      const h = item.height || Math.abs(item.transform[3])

      if (!lineText) {
        lineText = item.str
        lineY = y
        lineHeight = h
      } else if (Math.abs(y - lineY) > h * 0.5) {
        if (lineText.trim()) lines.push({ text: lineText.trim(), y: lineY, height: lineHeight })
        lineText = item.str
        lineY = y
        lineHeight = h
      } else {
        lineText += item.str
      }
    }
    if (lineText.trim()) lines.push({ text: lineText.trim(), y: lineY, height: lineHeight })
    if (lines.length === 0) continue

    // Merge lines into paragraphs based on vertical gaps
    const paragraphs: string[] = []
    let para = lines[0].text

    for (let j = 1; j < lines.length; j++) {
      const gap = Math.abs(lines[j - 1].y - lines[j].y)
      const lineSpacing = lines[j - 1].height * 1.5

      if (gap > lineSpacing * 1.8) {
        paragraphs.push(para)
        para = lines[j].text
      } else {
        para += ' ' + lines[j].text
      }
    }
    paragraphs.push(para)

    // Render page as inline image
    try {
      let pageBlob: Blob | undefined
      if (i === 1) {
        // First page: render at inline size and reuse as thumbnail
        pageBlob = await renderPageToBlob(page, 800, 0.85)
        if (pageBlob) {
          thumbnail = pageBlob
        }
      } else {
        pageBlob = await renderPageToBlob(page, 800, 0.85)
      }
      if (pageBlob) {
        const imageIndex = images.length
        images.push({ data: pageBlob, alt: `Page ${i}` })
        contentParts.push(`[image:${imageIndex}]`)
      }
    } catch {}

    contentParts.push(paragraphs.join('\n\n'))
  }

  return {
    content: contentParts.join('\n\n'),
    thumbnail,
    ...(images.length > 0 ? { images } : {}),
  }
}

async function parseDocx(file: File): Promise<{ content: string; images?: ExtractedImage[] }> {
  const arrayBuffer = await file.arrayBuffer()
  const images: ExtractedImage[] = []

  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const index = images.length
        const buffer = await image.readAsArrayBuffer()
        images.push({
          data: new Blob([buffer], { type: image.contentType }),
        })
        return { src: `murmur-image:${index}` }
      }),
    },
  )

  const doc = new DOMParser().parseFromString(result.value, 'text/html')
  const blocks: string[] = []

  for (const node of Array.from(doc.body.childNodes)) {
    extractBlocks(node, blocks)
  }

  const content = blocks.filter(b => b.length > 0).join('\n\n')
  return { content, images: images.length > 0 ? images : undefined }
}

function extractBlocks(node: Node, blocks: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent?.trim()
    if (text) blocks.push(text)
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return

  const el = node as Element
  const tag = el.tagName.toLowerCase()

  // Standalone image element
  if (tag === 'img') {
    const src = el.getAttribute('src') ?? ''
    const match = src.match(/^murmur-image:(\d+)$/)
    if (match) {
      blocks.push(`[image:${match[1]}]`)
    }
    return
  }

  // Block-level elements
  const blockTags = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'div', 'blockquote', 'tr', 'dt', 'dd'])
  if (blockTags.has(tag)) {
    const imgs = el.querySelectorAll('img[src^="murmur-image:"]')
    if (imgs.length === 0) {
      const text = el.textContent?.trim()
      if (text) blocks.push(text)
    } else {
      // Walk children to separate text and image markers
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent?.trim()
          if (text) blocks.push(text)
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const childEl = child as Element
          if (childEl.tagName.toLowerCase() === 'img') {
            const src = childEl.getAttribute('src') ?? ''
            const m = src.match(/^murmur-image:(\d+)$/)
            if (m) blocks.push(`[image:${m[1]}]`)
          } else {
            const nestedImgs = childEl.querySelectorAll('img[src^="murmur-image:"]')
            if (nestedImgs.length === 0) {
              const text = childEl.textContent?.trim()
              if (text) blocks.push(text)
            } else {
              extractBlocks(childEl, blocks)
            }
          }
        }
      }
    }
    return
  }

  // Container elements (ul, ol, table, etc.) — recurse into children
  for (const child of Array.from(el.childNodes)) {
    extractBlocks(child, blocks)
  }
}

async function parseEpub(file: File): Promise<ParsedDocument> {
  const arrayBuffer = await file.arrayBuffer()
  const zip = await JSZip.loadAsync(arrayBuffer)

  // Find the content.opf to get reading order and title
  let opfPath = 'content.opf'
  const container = zip.file('META-INF/container.xml')
  if (container) {
    const containerXml = await container.async('string')
    const match = containerXml.match(/full-path="([^"]+\.opf)"/)
    if (match) opfPath = match[1]
  }

  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error('Invalid EPUB: no content.opf found')
  const opfXml = await opfFile.async('string')
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml')

  // Extract title
  const titleEl = opfDoc.querySelector('metadata title')
  const title = titleEl?.textContent?.trim() || ''

  // Get spine reading order
  const spineItems = Array.from(opfDoc.querySelectorAll('spine itemref'))
  const manifestItems = new Map<string, string>()
  for (const item of Array.from(opfDoc.querySelectorAll('manifest item'))) {
    const id = item.getAttribute('id')
    const href = item.getAttribute('href')
    if (id && href) manifestItems.set(id, href)
  }

  // Resolve paths relative to OPF location
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : ''

  // Extract cover image
  let thumbnail: Blob | undefined
  // Try properties="cover-image" first, then meta name="cover" fallback
  let coverHref: string | null = null
  const coverImageItem = opfDoc.querySelector('manifest item[properties~="cover-image"]')
  if (coverImageItem) {
    coverHref = coverImageItem.getAttribute('href')
  } else {
    const coverMeta = opfDoc.querySelector('metadata meta[name="cover"]')
    const coverId = coverMeta?.getAttribute('content')
    if (coverId) {
      const coverItem = opfDoc.querySelector(`manifest item[id="${coverId}"]`)
      coverHref = coverItem?.getAttribute('href') ?? null
    }
  }
  if (coverHref) {
    const coverFile = zip.file(opfDir + coverHref)
    if (coverFile) {
      try {
        const data = await coverFile.async('uint8array')
        const ext = coverHref.split('.').pop()?.toLowerCase() ?? ''
        const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
        thumbnail = new Blob([data], { type: mimeMap[ext] || 'image/jpeg' })
      } catch {}
    }
  }

  const contentParts: string[] = []
  const images: ExtractedImage[] = []
  const imgMimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
  }

  const blockTags = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'DIV', 'BLOCKQUOTE', 'LI', 'DT', 'DD',
    'FIGCAPTION', 'PRE', 'ADDRESS',
  ])

  for (const itemref of spineItems) {
    const idref = itemref.getAttribute('idref')
    if (!idref) continue
    const href = manifestItems.get(idref)
    if (!href) continue

    const filePath = opfDir + href
    const htmlFile = zip.file(filePath)
    if (!htmlFile) continue

    // Directory of this chapter file within the ZIP, for resolving relative image paths
    const chapterDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/') + 1) : ''

    const html = await htmlFile.async('string')
    const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml')
    // Remove style/script elements so their contents don't leak into text
    doc.querySelectorAll('style, script, link[rel="stylesheet"]').forEach(el => el.remove())

    const body = doc.body
    if (!body) continue

    const chapterParts: string[] = []

    // Walk the body's descendant elements to find block elements and images in document order
    const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT)
    const visited = new Set<Node>()

    let node: Node | null = walker.currentNode
    while (node) {
      if (visited.has(node)) {
        node = walker.nextNode()
        continue
      }

      const el = node as Element
      const tagName = el.tagName?.toUpperCase()

      // Handle standalone <img> tags (skip SVG images)
      if (tagName === 'IMG') {
        visited.add(node)
        await extractEpubImage(el, chapterDir, zip, imgMimeMap, images, chapterParts)
        node = walker.nextNode()
        continue
      }

      // Handle block-level text elements
      if (blockTags.has(tagName)) {
        visited.add(node)
        // Extract inline images inside this block element before adding its text
        const childImgs = el.querySelectorAll('img')
        for (const img of Array.from(childImgs)) {
          visited.add(img)
          await extractEpubImage(img, chapterDir, zip, imgMimeMap, images, chapterParts)
        }
        const text = el.textContent?.trim()
        if (text) chapterParts.push(text)
        node = walker.nextNode()
        continue
      }

      node = walker.nextNode()
    }

    if (chapterParts.length > 0) {
      contentParts.push(chapterParts.join('\n\n'))
    }
  }

  return {
    title: title || file.name.replace(/\.epub$/i, ''),
    content: contentParts.join('\n\n'),
    thumbnail,
    ...(images.length > 0 ? { images } : {}),
  }
}

/**
 * Extract an image from an EPUB <img> element, read its data from the ZIP,
 * and append an [image:N] marker. Skips SVG images.
 */
async function extractEpubImage(
  img: Element,
  chapterDir: string,
  zip: JSZip,
  mimeMap: Record<string, string>,
  images: ExtractedImage[],
  parts: string[],
): Promise<void> {
  const src = img.getAttribute('src')
  if (!src || src.endsWith('.svg') || src.startsWith('data:image/svg')) return

  const imgPath = resolveEpubImagePath(chapterDir, src)
  const imgFile = zip.file(imgPath)
  if (!imgFile) return

  try {
    const data = await imgFile.async('uint8array')
    const ext = src.split('.').pop()?.toLowerCase()?.replace(/\?.*$/, '') ?? ''
    const mimeType = mimeMap[ext] || 'image/jpeg'
    const blob = new Blob([data], { type: mimeType })
    const alt = img.getAttribute('alt') || undefined
    const idx = images.length
    images.push({ data: blob, alt })
    parts.push(`[image:${idx}]`)
  } catch {}
}

/**
 * Resolve a relative image path against a chapter's directory within the EPUB ZIP.
 * Handles `../` segments for paths like `../images/fig1.jpg` relative to `OEBPS/text/`.
 */
function resolveEpubImagePath(chapterDir: string, src: string): string {
  // Strip any query string or fragment
  const cleanSrc = src.split('?')[0].split('#')[0]

  const baseParts = chapterDir.replace(/\/$/, '').split('/').filter(Boolean)
  const srcParts = cleanSrc.split('/')

  for (const part of srcParts) {
    if (part === '..') {
      baseParts.pop()
    } else if (part !== '.' && part !== '') {
      baseParts.push(part)
    }
  }

  return baseParts.join('/')
}
