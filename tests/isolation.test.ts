import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { ID, seed } from '../db/seed';
import { ADMIN_URL } from '../db/migrate';
import { handle } from '../lib/handler';
import { pool, withUser } from '../lib/db';

const { alice, bob, carol, wsA, wsB, pA1, pB1, nB1 } = ID;
const RAND = '99999999-9999-4999-8999-999999999999';
const admin = new Pool({ connectionString: ADMIN_URL });
beforeEach(seed);
afterAll(async () => { await admin.end(); await pool.end(); });

describe('edge case 1a: IDs in the URL', () => {
  const cases: [string, string[], unknown][] = [
    ['GET', ['projects'], null], ['POST', ['projects'], { name: 'x' }], ['GET', ['projects', pB1], null],
    ['PATCH', ['projects', pB1], { name: 'x' }], ['DELETE', ['projects', pB1], null],
    ['POST', ['projects', pB1, 'notes'], { title: 't', body: 'b' }],
    ['PATCH', ['projects', pB1, 'notes', nB1], { title: 't', body: 'b' }], ['DELETE', ['projects', pB1, 'notes', nB1], null],
    ['POST', ['projects', pB1, 'summarize'], {}], ['GET', ['members'], null],
  ];
  it('foreign workspace is byte-identical to a nonexistent workspace (404)', async () => {
    for (const [m, p, b] of cases) {
      const real = await handle(alice, m, wsB, p, b), fake = await handle(alice, m, RAND, p, b);
      expect(real.status).toBe(404); expect(real).toEqual(fake);
    }
  });
  it("foreign project/note id under my own workspace is identical to a nonexistent one", async () => {
    for (const [m, p, b] of cases.slice(2, 9)) {
      const swap = (id: string) => p.map((s) => (s === pB1 ? id : s === nB1 ? RAND : s));
      const real = await handle(alice, m, wsA, swap(pB1), b), fake = await handle(alice, m, wsA, swap(RAND), b);
      expect(real.status).toBe(404); expect(real).toEqual(fake);
    }
    expect(await handle(carol, 'GET', wsB, ['projects', pB1], null)).toMatchObject({ status: 200 }); // untouched
  });
});

describe('edge case 1b: IDs in the request body', () => {
  it('client-supplied workspace_id / project_id are ignored; data lands in the URL workspace', async () => {
    const r = await handle(alice, 'POST', wsA, ['projects', ID.pA1, 'notes'], { title: 't', body: 'b', workspace_id: wsB, project_id: pB1 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ workspace_id: wsA, project_id: ID.pA1 });
    const pr = await handle(alice, 'POST', wsA, ['projects'], { name: 'mine', workspace_id: wsB });
    expect(pr.body).toMatchObject({ workspace_id: wsA });
    const b = (await handle(carol, 'GET', wsB, ['projects', pB1], null)).body as any;
    expect(b.notes).toHaveLength(1);
  });
});

describe('edge case 1c: direct database calls', () => {
  it('user A cannot read, insert, update or delete workspace B rows', async () => {
    await withUser(alice, async (c) => {
      for (const sql of ['select count(*)::int n from workspaces where id=$1', 'select count(*)::int n from memberships where workspace_id=$1',
        'select count(*)::int n from projects where workspace_id=$1', 'select count(*)::int n from notes where workspace_id=$1'])
        expect((await c.query(sql, [wsB])).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int n from users where id=$1', [carol])).rows[0].n).toBe(0);
    });
    await expect(withUser(alice, (c) => c.query('insert into projects (workspace_id, name) values ($1,$2)', [wsB, 'x']))).rejects.toMatchObject({ code: '42501' });
    await expect(withUser(alice, (c) => c.query('insert into notes (workspace_id, project_id, title, body) values ($1,$2,$3,$3)', [wsB, pB1, 'x']))).rejects.toMatchObject({ code: '42501' });
    await withUser(alice, async (c) => {
      expect((await c.query('update notes set body=$1 where id=$2', ['hacked', nB1])).rowCount).toBe(0);
      expect((await c.query('delete from projects where id=$1', [pB1])).rowCount).toBe(0);
    });
    expect((await admin.query('select body from notes where id=$1', [nB1])).rows[0].body).toBe('Confidential price: 12M');
    expect((await admin.query('select 1 from projects where id=$1', [pB1])).rowCount).toBe(1);
  });
  it('no user context => deny everything (a missing policy input fails closed)', async () => {
    for (const t of ['users', 'workspaces', 'memberships', 'projects', 'notes'])
      expect((await pool.query(`select count(*)::int n from ${t}`)).rows[0].n).toBe(0);
    await expect(withUser('not-a-uuid', (c) => c.query('select * from projects'))).rejects.toBeTruthy();
  });
  it('every public table has RLS enabled and forced', async () => {
    const r = await admin.query(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relname<>'schema_migrations' and not (c.relrowsecurity and c.relforcerowsecurity)`);
    expect(r.rows).toEqual([]);
  });
});

describe('roles are enforced by the server and by the database', () => {
  it('viewer can read but not write (bob is a viewer in B)', async () => {
    expect((await handle(bob, 'GET', wsB, ['projects', pB1], null)).status).toBe(200);
    expect((await handle(bob, 'POST', wsB, ['projects'], { name: 'x' })).status).toBe(403);
    expect((await handle(bob, 'DELETE', wsB, ['projects', pB1], null)).status).toBe(403);
    await expect(withUser(bob, (c) => c.query('insert into projects (workspace_id, name) values ($1,$2)', [wsB, 'x']))).rejects.toMatchObject({ code: '42501' });
  });
  it('editor can create/edit but not invite; owner can invite', async () => {
    expect((await handle(bob, 'POST', wsA, ['projects'], { name: 'x' })).status).toBe(201);
    expect((await handle(bob, 'POST', wsA, ['members'], { email: 'carol@example.com', role: 'viewer' })).status).toBe(403);
    await expect(withUser(bob, (c) => c.query('select app_invite($1,$2,$3)', [wsA, 'carol@example.com', 'owner']))).rejects.toMatchObject({ code: '42501' });
    expect((await handle(alice, 'POST', wsA, ['members'], { email: 'carol@example.com', role: 'viewer' })).status).toBe(200);
    expect((await handle(carol, 'GET', wsA, ['projects'], null)).status).toBe(200);
  });
});
