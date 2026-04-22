import { describe, it, expect } from 'vitest'
import { isPrivateOrDisallowedHost } from '../../server/utils/ssrf'

describe('isPrivateOrDisallowedHost', () => {
  it('rejects localhost', () => {
    expect(isPrivateOrDisallowedHost('http://localhost')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://127.0.0.1')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://127.0.0.1:8000')).toBe(true)
  })

  it('rejects RFC1918 literals', () => {
    expect(isPrivateOrDisallowedHost('http://10.0.0.1')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://192.168.1.100')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://172.16.5.5')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://172.31.255.255')).toBe(true)
  })

  it('accepts the 172.32 range (outside RFC1918)', () => {
    expect(isPrivateOrDisallowedHost('http://172.32.0.1')).toBe(false)
  })

  it('rejects link-local and loopback IPv6', () => {
    expect(isPrivateOrDisallowedHost('http://[::1]')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://[fe80::1]')).toBe(true)
    expect(isPrivateOrDisallowedHost('http://[fc00::1]')).toBe(true)
  })

  it('rejects AWS metadata service', () => {
    expect(isPrivateOrDisallowedHost('http://169.254.169.254')).toBe(true)
  })

  it('rejects CGNAT range', () => {
    expect(isPrivateOrDisallowedHost('http://100.64.0.1')).toBe(true)
  })

  it('rejects non-http schemes', () => {
    expect(isPrivateOrDisallowedHost('file:///etc/passwd')).toBe(true)
    expect(isPrivateOrDisallowedHost('ftp://example.com')).toBe(true)
    expect(isPrivateOrDisallowedHost('gopher://example.com')).toBe(true)
  })

  it('rejects unparseable URLs', () => {
    expect(isPrivateOrDisallowedHost('not a url')).toBe(true)
    expect(isPrivateOrDisallowedHost('')).toBe(true)
  })

  it('allows public URLs', () => {
    expect(isPrivateOrDisallowedHost('https://example.com')).toBe(false)
    expect(isPrivateOrDisallowedHost('https://news.ycombinator.com/item?id=1')).toBe(false)
    expect(isPrivateOrDisallowedHost('http://8.8.8.8')).toBe(false)
  })
})
