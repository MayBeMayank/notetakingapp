import jwt from 'jsonwebtoken'

const JWT_SECRET: string = process.env['JWT_SECRET']!
const ACCESS_TOKEN_TTL = process.env['ACCESS_TOKEN_TTL'] ?? '15m'

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  })
}

export function verifyAccessToken(token: string): { sub: string } {
  const payload = jwt.verify(token, JWT_SECRET)
  if (typeof payload === 'string' || !payload['sub']) {
    throw new Error('Invalid token payload')
  }
  return { sub: payload['sub'] as string }
}
