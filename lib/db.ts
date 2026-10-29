import { Pool, PoolClient } from 'pg';

const g = globalThis as unknown as { __pool?: Pool };
export const pool = (g.__pool ??= new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://app_user:app_user@localhost:5433/notes',
}));

// Every request runs in a transaction scoped to the verified user. set_config(..., true) is transaction-local,
// so a pooled connection never carries identity over.
export async function withUser<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('app.user_id', $1, true)", [userId]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}
