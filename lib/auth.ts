import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required in production');
  return s ?? 'dev-only-secret';
}
export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
// Runs the same work when the user doesn't exist, to avoid a timing oracle.
export function checkPassword(pw: string, stored?: string) {
  const [salt, hash] = (stored ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
  const a = scryptSync(pw, salt, 64), b = Buffer.from(hash, 'hex');
  return !!stored && a.length === b.length && timingSafeEqual(a, b);
}
const mac = (d: string) => createHmac('sha256', secret()).update(d).digest('base64url');
export function signSession(uid: string, ttlSeconds = 7 * 86400) {
  const d = `${uid}.${Math.floor(Date.now() / 1000) + ttlSeconds}`;
  return `${d}.${mac(d)}`;
}
export function sessionUser(token?: string): string | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  const d = token.slice(0, i), m = token.slice(i + 1), e = mac(d);
  if (m.length !== e.length || !timingSafeEqual(Buffer.from(m), Buffer.from(e))) return null;
  const [uid, exp] = d.split('.');
  return Number(exp) > Date.now() / 1000 ? uid : null;
}
