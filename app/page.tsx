'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Login() {
  const router = useRouter();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr('');
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), password: f.get('password') }) });
      if (!res.ok) throw new Error('Invalid email or password');
      const me = await (await fetch('/api/me')).json();
      if (!me.workspaces?.length) throw new Error('You are not a member of any workspace');
      router.push(`/w/${me.workspaces[0].id}`);
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }
  return (
    <main className="card">
      <h1>Sign in</h1>
      <p className="muted">Demo: alice@example.com / bob@example.com / carol@example.com, password <code>password123</code></p>
      <form onSubmit={submit}>
        <input name="email" type="email" placeholder="Email" required autoComplete="username" /><input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <p role="alert" className="err">{err}</p>}
      </form>
    </main>
  );
}
