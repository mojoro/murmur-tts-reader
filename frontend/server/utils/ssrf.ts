import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export function isPrivateIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true
  if (lower.startsWith('fe80')) return true
  return false
}

export function isPrivateOrDisallowedHost(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost') return true

  const ipKind = isIP(host)
  if (ipKind === 4) return isPrivateIPv4(host)
  if (ipKind === 6) return isPrivateIPv6(host)
  return false
}

export async function resolveIsPrivate(hostname: string): Promise<boolean> {
  const result = await lookup(hostname, { all: true })
  for (const { address, family } of result) {
    if (family === 4 && isPrivateIPv4(address)) return true
    if (family === 6 && isPrivateIPv6(address)) return true
  }
  return false
}
