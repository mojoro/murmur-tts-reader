import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import { verifyToken } from '../../server/utils/jwt'

const SECRET = 'test-secret'

async function createTestToken(userId: number, expiresIn = '1h'): Promise<string> {
  return new SignJWT({ sub: String(userId) })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(SECRET))
}

describe('verifyToken', () => {
  it('returns userId from a valid token', async () => {
    const token = await createTestToken(42)
    const userId = await verifyToken(token, SECRET)
    expect(userId).toBe(42)
  })

  it('throws for an expired token', async () => {
    const token = await new SignJWT({ sub: '42' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('0s')
      .sign(new TextEncoder().encode(SECRET))

    await new Promise((r) => setTimeout(r, 1100))
    await expect(verifyToken(token, SECRET)).rejects.toThrow()
  })

  it('throws for a tampered token', async () => {
    const token = await createTestToken(42)
    const tampered = token.slice(0, -5) + 'XXXXX'
    await expect(verifyToken(tampered, SECRET)).rejects.toThrow()
  })

  it('throws for wrong secret', async () => {
    const token = await createTestToken(42)
    await expect(verifyToken(token, 'wrong-secret')).rejects.toThrow()
  })

  it('throws for garbage input', async () => {
    await expect(verifyToken('not-a-jwt', SECRET)).rejects.toThrow()
  })
})
