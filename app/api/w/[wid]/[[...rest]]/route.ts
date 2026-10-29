import { NextRequest } from 'next/server';
import { sessionUser } from '@/lib/auth';
import { handle } from '@/lib/handler';

type Ctx = { params: Promise<{ wid: string; rest?: string[] }> };
async function run(req: NextRequest, ctx: Ctx) {
  const uid = sessionUser(req.cookies.get('session')?.value);
  if (!uid) return Response.json({ error: 'unauthenticated' }, { status: 401 });
  const { wid, rest = [] } = await ctx.params;
  let body: unknown = null;
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    if (!req.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'unsupported_media_type' }, { status: 415 }); // basic CSRF guard on top of SameSite=Lax
    body = await req.json().catch(() => null);
  }
  const r = await handle(uid, req.method, wid, rest, body);
  return Response.json(r.body, { status: r.status });
}
export { run as GET, run as POST, run as PATCH, run as DELETE };
