export default defineEventHandler(async (event) => {
  const { url } = await readBody<{ url: string }>(event)

  if (!url || typeof url !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'URL is required' })
  }

  try {
    new URL(url)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid URL' })
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      throw createError({ statusCode: response.status, statusMessage: `Upstream returned ${response.status}` })
    }

    const html = await response.text()
    return { html }
  } catch (error: any) {
    if (error.statusCode) throw error
    throw createError({
      statusCode: 502,
      statusMessage: error.message || 'Failed to fetch URL',
    })
  }
})
