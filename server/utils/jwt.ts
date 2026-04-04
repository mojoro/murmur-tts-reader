import { jwtVerify } from 'jose'

export async function verifyToken(token: string, secret: string): Promise<number> {
  const secretKey = new TextEncoder().encode(secret)
  const { payload } = await jwtVerify(token, secretKey, {
    algorithms: ['HS256'],
  })
  return parseInt(payload.sub as string, 10)
}
