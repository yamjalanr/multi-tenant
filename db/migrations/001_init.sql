do $$ begin
  if not exists (select from pg_roles where rolname = 'app_user') then
    create role app_user login password 'app_user' nosuperuser nobypassrls;
  end if;
end $$;

create table users (id uuid primary key default gen_random_uuid(), email text unique not null, name text not null, password_hash text not null);
create table workspaces (id uuid primary key default gen_random_uuid(), name text not null);
create table memberships (
  workspace_id uuid not null references workspaces on delete cascade,
  user_id uuid not null references users on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  primary key (workspace_id, user_id));
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null, summary jsonb, summarized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, workspace_id));
create table notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null, project_id uuid not null,
  title text not null, body text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references projects (id, workspace_id) on delete cascade);

create function app_uid() returns uuid language sql stable
  as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
create function app_role(ws uuid) returns text language sql stable security definer set search_path = public
  as $$ select role from memberships where workspace_id = ws and user_id = app_uid() $$;
create function auth_user(e text) returns table (id uuid, password_hash text) language sql stable security definer set search_path = public
  as $$ select u.id, u.password_hash from users u where u.email = lower(e) $$;
create function app_invite(ws uuid, invitee_email text, new_role text) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if app_role(ws) is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if new_role not in ('owner','editor','viewer') then raise exception 'bad role' using errcode = '22023'; end if;
  select id into uid from users where email = lower(invitee_email);
  if uid is not null then
    insert into memberships values (ws, uid, new_role) on conflict (workspace_id, user_id) do update set role = excluded.role;
  end if;
end $$;

do $$ declare t text; begin
  foreach t in array array['users','workspaces','memberships','projects','notes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- No policy = no access. Only the policies below allow anything.
create policy users_select on users for select using (id = app_uid() or id in (select user_id from memberships));
create policy ws_select on workspaces for select using (app_role(id) is not null);
create policy mem_select on memberships for select using (app_role(workspace_id) is not null);

create policy proj_select on projects for select using (app_role(workspace_id) is not null);
create policy proj_insert on projects for insert with check (app_role(workspace_id) in ('owner','editor'));
create policy proj_update on projects for update using (app_role(workspace_id) in ('owner','editor')) with check (app_role(workspace_id) in ('owner','editor'));
create policy proj_delete on projects for delete using (app_role(workspace_id) in ('owner','editor'));

create policy note_select on notes for select using (app_role(workspace_id) is not null);
create policy note_insert on notes for insert with check (app_role(workspace_id) in ('owner','editor'));
create policy note_update on notes for update using (app_role(workspace_id) in ('owner','editor')) with check (app_role(workspace_id) in ('owner','editor'));
create policy note_delete on notes for delete using (app_role(workspace_id) in ('owner','editor'));

grant usage on schema public to app_user;
grant select on users, workspaces, memberships to app_user;
grant select, insert, update, delete on projects, notes to app_user;
revoke all on all functions in schema public from public;
grant execute on function app_uid(), app_role(uuid), auth_user(text), app_invite(uuid, text, text) to app_user;
