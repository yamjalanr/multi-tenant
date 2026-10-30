'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

type Summary = { summary: string; key_points: string[]; flagged_notes: number; attempts: number };
type Project = { id: string; name: string; summary?: Summary | null };
type Note = { id: string; title: string; body: string };

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) { window.location.href = '/'; throw new Error('Signed out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(({ not_found: 'Not found', forbidden: 'You do not have permission to do that', summary_failed: 'The summary could not be generated. Please try again.' } as Record<string, string>)[data.error] ?? 'Something went wrong');
  return data;
}
function useLoad<T>(path: string) {
  const [s, setS] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const load = useCallback(() => {
    setS((x) => ({ ...x, loading: true, error: undefined }));
    api<T>(path).then((data) => setS({ data, loading: false }), (e) => setS({ loading: false, error: e.message }));
  }, [path]);
  useEffect(load, [load]);
  return { ...s, reload: load };
}
const Err = ({ e }: { e?: string }) => (e ? <p role="alert" className="err">{e}</p> : null);
function useAction() {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string>();
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setErr(undefined);
    try { await fn(); after?.(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return { busy, err, run };
}

function NoteRow({ n, base, canWrite, done }: { n: Note; base: string; canWrite: boolean; done: () => void }) {
  const [edit, setEdit] = useState(false); const { busy, err, run } = useAction();
  if (edit) return (
    <li><form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); run(() => api(`${base}/notes/${n.id}`, 'PATCH', { title: f.get('title'), body: f.get('body') }), () => { setEdit(false); done(); }); }}>
      <input name="title" defaultValue={n.title} required /><br /><textarea name="body" defaultValue={n.body} rows={3} cols={50} /><br />
      <button disabled={busy}>{busy ? 'Saving…' : 'Save'}</button> <button type="button" onClick={() => setEdit(false)}>Cancel</button><Err e={err} />
    </form></li>
  );
  return (
    <li><b>{n.title}</b>: {n.body}{' '}
      {canWrite && <><button onClick={() => setEdit(true)}>Edit</button> <button className="danger" disabled={busy} onClick={() => run(() => api(`${base}/notes/${n.id}`, 'DELETE'), done)}>Delete</button></>}<Err e={err} /></li>
  );
}

function ProjectPanel({ wid, pid, canWrite, onChange }: { wid: string; pid: string; canWrite: boolean; onChange: () => void }) {
  const base = `/api/w/${wid}/projects/${pid}`;
  const p = useLoad<Project & { notes: Note[] }>(base);
  const a = useAction();
  if (p.loading && !p.data) return <p className="muted">Loading project…</p>;
  if (p.error) return <Err e={p.error} />;
  const d = p.data!;
  return (
    <section>
      <h2>{d.name}</h2>
      {canWrite && <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); a.run(() => api(base, 'PATCH', { name: f.get('name') }), () => { p.reload(); onChange(); }); }}>
        <input name="name" defaultValue={d.name} key={d.name} required /> <button disabled={a.busy}>Rename</button>{' '}
        <button type="button" className="danger" disabled={a.busy} onClick={() => a.run(() => api(base, 'DELETE'), onChange)}>Delete project</button>
      </form>}
      <h3>Notes</h3>
      {p.loading && <small>Refreshing…</small>}
      <ul>{d.notes.map((n) => <NoteRow key={n.id} n={n} base={base} canWrite={canWrite} done={p.reload} />)}</ul>
      {!d.notes.length && <p className="muted">No notes yet.</p>}
      {canWrite && <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); a.run(() => api(`${base}/notes`, 'POST', { title: f.get('title'), body: f.get('body') }), () => { form.reset(); p.reload(); }); }}>
        <input name="title" placeholder="Title" required /><br /><textarea name="body" placeholder="Body" rows={3} cols={50} /><br /><button disabled={a.busy}>Add note</button>
      </form>}
      {canWrite && <p><button className="primary" disabled={a.busy} onClick={() => a.run(() => api(`${base}/summarize`, 'POST', {}), () => { p.reload(); onChange(); })}>{a.busy ? 'Working…' : 'Summarize project'}</button></p>}
      <Err e={a.err} />
      {d.summary && <div className="summary">
        <b>Summary</b><p>{d.summary.summary}</p><ul>{d.summary.key_points.map((k, i) => <li key={i}>{k}</li>)}</ul>
        {d.summary.flagged_notes > 0 && <small>⚠ {d.summary.flagged_notes} note(s) look like prompt-injection attempts and were treated as plain data.</small>}
      </div>}
    </section>
  );
}

function Members({ wid, owner }: { wid: string; owner: boolean }) {
  const m = useLoad<{ id: string; name: string; email: string; role: string }[]>(`/api/w/${wid}/members`);
  const a = useAction();
  return (
    <section><h3>Members</h3>
      {m.loading && !m.data ? <p>Loading…</p> : <Err e={m.error} />}
      <ul>{m.data?.map((u) => <li key={u.id}>{u.name} ({u.email}) — {u.role}</li>)}</ul>
      {owner && <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); a.run(() => api(`/api/w/${wid}/members`, 'POST', { email: f.get('email'), role: f.get('role') }), () => { form.reset(); m.reload(); }); }}>
        <input name="email" type="email" placeholder="email" required /> <select name="role"><option>viewer</option><option>editor</option><option>owner</option></select> <button disabled={a.busy}>Invite</button><Err e={a.err} />
      </form>}
    </section>
  );
}

export default function WorkspacePage() {
  const { wid } = useParams<{ wid: string }>();
  const router = useRouter();
  const me = useLoad<{ user: { name: string }; workspaces: { id: string; name: string }[] }>('/api/me');
  const ws = useLoad<{ name: string; role: string }>(`/api/w/${wid}`);
  const projects = useLoad<Project[]>(`/api/w/${wid}/projects`);
  const [pid, setPid] = useState<string | null>(null);
  const a = useAction();
  useEffect(() => setPid(null), [wid]);
  const role = ws.data?.role; const canWrite = role === 'owner' || role === 'editor';
  if (ws.error) return <><Err e={ws.error} /><a href="/">Back</a></>;
  return (
    <main>
      <header className="topbar">
        <select className="select-div" value={wid} onChange={(e) => router.push(`/w/${e.target.value}`)} aria-label="Workspace" >
          {me.data?.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {ws.loading ? 'Loading…' : <>role: <b>{role}</b></>} · {me.data?.user.name}
        <button onClick={async () => { await fetch('/api/logout', { method: 'POST' }); router.push('/'); }}>Sign out</button>
      </header>
      <h1>Projects</h1>
      {projects.loading && !projects.data ? <p className="muted">Loading projects…</p> : <Err e={projects.error} />}
      <ul>{projects.data?.map((p) => <li key={p.id}><button className={p.id === pid ? 'proj active' : 'proj'} onClick={() => setPid(p.id)}>{p.name}</button></li>)}</ul>
      {projects.data && !projects.data.length && <p className="muted">No projects yet.</p>}
      {canWrite && <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); a.run(() => api(`/api/w/${wid}/projects`, 'POST', { name: f.get('name') }), () => { form.reset(); projects.reload(); }); }}>
        <input name="name" placeholder="New project name" required /> <button disabled={a.busy}>Create</button>
      </form>}
      <Err e={a.err} />
      {pid && <ProjectPanel key={pid} wid={wid} pid={pid} canWrite={canWrite} onChange={() => { projects.reload(); if (!projects.data?.some((p) => p.id === pid)) return; }} />}
      <Members wid={wid} owner={role === 'owner'} />
    </main>
  );
}
