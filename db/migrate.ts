import { Client } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5433/notes';

export async function migrate() {
  const c = new Client({ connectionString: ADMIN_URL });
  await c.connect();
  try {
    await c.query('create table if not exists schema_migrations (name text primary key)');
    const dir = join(process.cwd(), 'db', 'migrations');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if ((await c.query('select 1 from schema_migrations where name = $1', [f])).rowCount) continue;
      await c.query('begin');
      try {
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('insert into schema_migrations values ($1)', [f]);
        await c.query('commit');
      } catch (e) { await c.query('rollback'); throw e; }
    }
  } finally { await c.end(); }
}
