import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { checkPassword, signSession } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null);
  const email = typeof b?.email === 'string' ? b.email : '';
  const pw = typeof b?.password === 'string' ? b.password : '';
  const row = (await pool.query('select * from auth_user($1)', [email])).rows[0];
  if (!checkPassword(pw, row?.password_hash) || !row) return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', signSession(row.id), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 86400, secure: process.env.NODE_ENV === 'production' });
  return res;
}
