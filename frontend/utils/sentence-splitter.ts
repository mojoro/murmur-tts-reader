const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'ave', 'blvd',
  'gen', 'gov', 'sgt', 'cpl', 'pvt', 'capt', 'lt', 'col', 'maj',
  'rev', 'hon', 'pres', 'dept', 'univ', 'assn', 'bros', 'inc', 'ltd',
  'co', 'corp', 'vs', 'est', 'vol', 'fig', 'eq', 'approx',
  'i.e', 'e.g', 'etc', 'al', 'cf',
])

export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let current = ''

  const tokens = text.split(/(\s+)/)

  for (const token of tokens) {
    current += token

    // Check if token ends with sentence-ending punctuation
    const match = token.match(/^(.+?)([.!?]+)$/)
    if (!match) continue

    const word = match[1].toLowerCase().replace(/[^a-z.]/g, '')

    // Skip if it's a known abbreviation
    if (ABBREVIATIONS.has(word)) continue

    // Skip single letters followed by period (initials like "J.")
    if (word.length === 1) continue

    // Skip decimal numbers (e.g., "3.14")
    if (/\d$/.test(match[1]) && match[2] === '.') continue

    const trimmed = current.trim()
    if (trimmed) {
      sentences.push(trimmed)
      current = ''
    }
  }

  const remaining = current.trim()
  if (remaining) sentences.push(remaining)

  return sentences
}
