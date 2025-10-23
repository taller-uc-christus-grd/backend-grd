import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'devSecret';

type JwtPayload = { id: string; role: string };

export function signToken(payload: JwtPayload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

export function verifyTokenRaw(token: string) {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}