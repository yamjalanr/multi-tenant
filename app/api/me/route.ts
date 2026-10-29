import { NextRequest, NextResponse } from 'next/server';
import { withUser } from '@/lib/db';
import { sessionUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const uid = sessionUser(req.cookies.get('session')?.value);
  if (!uid) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const out = await withUser(uid, async (c) => ({
    user: (await c.query('select id, name, email from users where id=$1', [uid])).rows[0],
    workspaces: (await c.query('select w.id, w.name, m.role from workspaces w join memberships m on m.workspace_id=w.id where m.user_id=$1 order by w.name', [uid])).rows,
  }));
  return out.user ? NextResponse.json(out) : NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
}
