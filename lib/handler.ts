import { z } from 'zod';
import type { PoolClient } from 'pg';
import { withUser } from './db';
import { getProvider, summarizeNotes, SummaryError } from './summary';

export type Res = { status: number; body: unknown };
const NF: Res = { status: 404, body: { error: 'not_found' } }; // same for "missing" and "someone else's"
const FORBIDDEN: Res = { status: 403, body: { error: 'forbidden' } };
const NOT_ALLOWED: Res = { status: 405, body: { error: 'method_not_allowed' } };
const ok = (body: unknown, status = 200): Res => ({ status, body });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Name = z.object({ name: z.string().trim().min(1).max(200) });
const NoteIn = z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(10000) });
const Invite = z.object({ email: z.string().email().max(254), role: z.enum(['owner', 'editor', 'viewer']) });
const canWrite = (r: string) => r === 'owner' || r === 'editor';
const bad = (e: z.ZodError): Res => ({ status: 400, body: { error: 'invalid_request', detail: e.issues.map((i) => i.path.join('.') + ': ' + i.message) } });
const roleOf = async (c: PoolClient, wid: string) => (await c.query('select app_role($1) as r', [wid])).rows[0].r as string | null;

// uid comes from the verified session. wid/path come from the URL and are only *lookups* that RLS scopes.
export async function handle(uid: string, method: string, wid: string, path: string[], body: unknown): Promise<Res> {
  if (!UUID.test(wid) || path.length > 4 || (path[1] && !UUID.test(path[1])) || (path[3] && !UUID.test(path[3]))) return NF;
  try {
    if (path[0] === 'projects' && path[2] === 'summarize' && path.length === 3) return method === 'POST' ? await summarize(uid, wid, path[1]) : NOT_ALLOWED;
    return await withUser(uid, async (c) => {
      const role = await roleOf(c, wid);
      return role ? route(c, role, method, wid, path, body) : NF;
    });
  } catch (e: any) {
    if (e?.code === '42501') return FORBIDDEN;
    if (e?.code === '22P02') return NF;
    if (e instanceof SummaryError) return { status: 502, body: { error: 'summary_failed' } };
    console.error(e);
    return { status: 500, body: { error: 'server_error' } };
  }
}

async function route(c: PoolClient, role: string, method: string, wid: string, path: string[], body: unknown): Promise<Res> {
  const [seg, pid, sub, nid] = path;
  const q = async (sql: string, p: unknown[]) => (await c.query(sql, p)).rows;
  if (!seg) return method === 'GET' ? ok({ ...(await q('select id, name from workspaces where id=$1', [wid]))[0], role }) : NOT_ALLOWED;

  if (seg === 'members' && path.length === 1) {
    if (method === 'GET') return ok(await q('select u.id, u.name, u.email, m.role from memberships m join users u on u.id=m.user_id where m.workspace_id=$1 order by u.name', [wid]));
    if (method !== 'POST') return NOT_ALLOWED;
    if (role !== 'owner') return FORBIDDEN;
    const p = Invite.safeParse(body); if (!p.success) return bad(p.error);
    await c.query('select app_invite($1,$2,$3)', [wid, p.data.email, p.data.role]);
    return ok({ ok: true });
  }
  if (seg !== 'projects') return NF;

  if (!pid) {
    if (method === 'GET') return ok(await q('select id, name, summary, summarized_at from projects where workspace_id=$1 order by created_at, id', [wid]));
    if (method !== 'POST') return NOT_ALLOWED;
    if (!canWrite(role)) return FORBIDDEN;
    const p = Name.safeParse(body); if (!p.success) return bad(p.error);
    return ok((await q('insert into projects (workspace_id, name) values ($1,$2) returning *', [wid, p.data.name]))[0], 201);
  }
  const proj = (await q('select * from projects where id=$1 and workspace_id=$2', [pid, wid]))[0];
  if (!proj) return NF;

  if (!sub) {
    if (method === 'GET') return ok({ ...proj, notes: await q('select id, title, body from notes where project_id=$1 and workspace_id=$2 order by created_at, id', [pid, wid]) });
    if (method !== 'PATCH' && method !== 'DELETE') return NOT_ALLOWED;
    if (!canWrite(role)) return FORBIDDEN;
    if (method === 'DELETE') { await c.query('delete from projects where id=$1 and workspace_id=$2', [pid, wid]); return ok({ ok: true }); }
    const p = Name.safeParse(body); if (!p.success) return bad(p.error);
    return ok((await q('update projects set name=$3 where id=$1 and workspace_id=$2 returning *', [pid, wid, p.data.name]))[0]);
  }
  if (sub !== 'notes') return NF;

  if (!nid) {
    if (method !== 'POST') return NOT_ALLOWED;
    if (!canWrite(role)) return FORBIDDEN;
    const p = NoteIn.safeParse(body); if (!p.success) return bad(p.error);
    return ok((await q('insert into notes (workspace_id, project_id, title, body) values ($1,$2,$3,$4) returning *', [wid, pid, p.data.title, p.data.body]))[0], 201);
  }
  if (method !== 'PATCH' && method !== 'DELETE') return NOT_ALLOWED;
  if (!canWrite(role)) return FORBIDDEN;
  if (method === 'DELETE') {
    const r = await c.query('delete from notes where id=$1 and project_id=$2 and workspace_id=$3', [nid, pid, wid]);
    return r.rowCount ? ok({ ok: true }) : NF;
  }
  const p = NoteIn.safeParse(body); if (!p.success) return bad(p.error);
  const r = await q('update notes set title=$1, body=$2, updated_at=now() where id=$3 and project_id=$4 and workspace_id=$5 returning *', [p.data.title, p.data.body, nid, pid, wid]);
  return r[0] ? ok(r[0]) : NF;
}

// The LLM call happens outside any DB transaction.
async function summarize(uid: string, wid: string, pid: string): Promise<Res> {
  const input = await withUser(uid, async (c) => {
    const role = await roleOf(c, wid);
    if (!role) return NF;
    if (!canWrite(role)) return FORBIDDEN;
    if (!(await c.query('select 1 from projects where id=$1 and workspace_id=$2', [pid, wid])).rowCount) return NF;
    return { notes: (await c.query('select title, body from notes where project_id=$1 and workspace_id=$2 order by created_at, id limit 50', [pid, wid])).rows };
  });
  if (!('notes' in input)) return input;
  const result = await summarizeNotes(getProvider(), input.notes); // throws SummaryError => 502, nothing stored
  return withUser(uid, async (c) => {
    const r = await c.query('update projects set summary=$3::jsonb, summarized_at=now() where id=$1 and workspace_id=$2 returning *', [pid, wid, JSON.stringify(result)]);
    return r.rows[0] ? ok(r.rows[0]) : NF;
  });
}
