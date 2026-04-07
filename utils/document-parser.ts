import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { Readability } from '@mozilla/readability'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

export interface ParsedDocument {
  title: string
  content: string
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
      return { title: baseName, content: await parsePdf(file) }
    case 'docx':
      return { title: baseName, content: await parseDocx(file) }
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

async function parsePdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages: string[] = []

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
    pages.push(paragraphs.join('\n\n'))
  }

  return pages.join('\n\n')
}

async function parseDocx(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
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

  const textParts: string[] = []
  for (const itemref of spineItems) {
    const idref = itemref.getAttribute('idref')
    if (!idref) continue
    const href = manifestItems.get(idref)
    if (!href) continue

    const filePath = opfDir + href
    const htmlFile = zip.file(filePath)
    if (!htmlFile) continue

    const html = await htmlFile.async('string')
    const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml')
    // Remove style/script elements so their contents don't leak into text
    doc.querySelectorAll('style, script, link[rel="stylesheet"]').forEach(el => el.remove())
    const text = doc.body?.textContent?.trim()
    if (text) textParts.push(text)
  }

  return {
    title: title || file.name.replace(/\.epub$/i, ''),
    content: textParts.join('\n\n'),
  }
}
