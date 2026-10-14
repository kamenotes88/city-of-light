-- City of Light community backend v1. Reviewed installation SQL, not applied automatically.
-- Scope: only col_private objects and explicitly named public.col_* RPC wrappers.
-- Prerequisite: Supabase Auth. Do not expose col_private in Data API settings.
-- All account, invitation and city access is checked inside private definer functions.
-- No billing, entitlement, email export, private world upload or legacy claim import.
begin;

create schema if not exists col_private;
revoke all on schema col_private from public, anon, authenticated;
grant usage on schema col_private to authenticated;

create table if not exists col_private.schema_state (
  singleton boolean primary key default true check (singleton),
  version integer not null check (version = 1)
);
insert into col_private.schema_state(singleton, version) values (true, 1)
on conflict (singleton) do nothing;
do $guard$ begin
  if not exists (select 1 from col_private.schema_state where singleton and version = 1)
  then raise exception 'Unsupported City of Light schema version'; end if;
end $guard$;

create table if not exists col_private.accounts (
  -- Identity is verified on every API call. No FK may block deletion in shared Auth.
  id uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 60),
  referral_code text not null unique default replace(gen_random_uuid()::text, '-', '')
    check (referral_code ~ '^[a-f0-9]{32}$'),
  terms_version text not null check (terms_version = 'community-v1'),
  consented_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists col_private.admins (
  account_id uuid primary key references col_private.accounts(id),
  granted_at timestamptz not null default now()
);
-- A deployment operator seeds only a hash of a private short-lived setup capability.
-- No token or bootstrap row is shipped with this SQL or generated automatically.
create table if not exists col_private.admin_bootstrap (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references col_private.accounts(id),
  check ((consumed_at is null) = (consumed_by is null))
);
create table if not exists col_private.attributions (
  invitee_id uuid primary key references col_private.accounts(id),
  inviter_id uuid not null references col_private.accounts(id),
  accepted_at timestamptz not null default now(),
  terms_version text not null default 'community-v1',
  check (invitee_id <> inviter_id)
);
create index if not exists col_attributions_inviter on col_private.attributions(inviter_id, accepted_at);
create table if not exists col_private.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references col_private.accounts(id),
  event text not null,
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists col_audit_actor_date on col_private.audit_events(actor_id, created_at);
create table if not exists col_private.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  owner_id uuid not null references col_private.accounts(id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);
create index if not exists col_teams_owner on col_private.teams(owner_id);
create table if not exists col_private.members (
  team_id uuid not null references col_private.teams(id),
  account_id uuid not null references col_private.accounts(id),
  role text not null check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (team_id, account_id)
);
create index if not exists col_members_account on col_private.members(account_id, team_id);
create table if not exists col_private.team_invites (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  team_id uuid not null references col_private.teams(id),
  role text not null check (role in ('editor','viewer')),
  issued_by uuid not null references col_private.accounts(id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_by uuid references col_private.accounts(id),
  used_at timestamptz
);
create index if not exists col_team_invites_team on col_private.team_invites(team_id, expires_at);
create table if not exists col_private.entries (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references col_private.teams(id),
  owner_id uuid not null references col_private.accounts(id),
  x integer not null check (x between 0 and 31),
  y integer not null check (y between 0 and 31),
  title text not null check (char_length(title) between 1 and 120),
  status text not null check (status in ('planned','active','blocked','completed')),
  kind text not null check (kind in ('task','project','habit','goal')),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (team_id, x, y)
);
create index if not exists col_entries_owner on col_private.entries(owner_id);

-- Default deny: clients have no table/sequence privileges or RLS policies.
alter table col_private.schema_state enable row level security;
alter table col_private.accounts enable row level security;
alter table col_private.admins enable row level security;
alter table col_private.admin_bootstrap enable row level security;
alter table col_private.attributions enable row level security;
alter table col_private.audit_events enable row level security;
alter table col_private.teams enable row level security;
alter table col_private.members enable row level security;
alter table col_private.team_invites enable row level security;
alter table col_private.entries enable row level security;
revoke all on all tables in schema col_private from public, anon, authenticated;
revoke all on all sequences in schema col_private from public, anon, authenticated;
alter default privileges in schema col_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema col_private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema col_private revoke execute on functions from public, anon, authenticated;

create or replace function col_private.actor() returns uuid
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := auth.uid(); v_session text := auth.jwt()->>'session_id';
begin
  if v_uid is null or not exists (
    select 1 from auth.users u where u.id = v_uid
    and not coalesce(u.is_anonymous, false) and u.email_confirmed_at is not null
  ) then raise exception 'A verified nonanonymous email account is required'; end if;
  if v_session is null or v_session !~ '^[0-9a-fA-F-]{36}$'
     or not exists (select 1 from auth.sessions s where s.id = v_session::uuid and s.user_id = v_uid)
  then raise exception 'A current verified sign-in session is required'; end if;
  return v_uid;
end $function$;

create or replace function col_private.registered_actor() returns uuid
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.actor();
begin
  if not exists(select 1 from col_private.accounts where id = v_uid)
  then raise exception 'Complete community registration first'; end if;
  return v_uid;
end $function$;

create or replace function col_private.team_role(p_team_id uuid, p_actor uuid) returns text
language plpgsql security definer set search_path = '' as $function$
declare v_role text;
begin
  select role into v_role from col_private.members where team_id = p_team_id and account_id = p_actor;
  if v_role is null then raise exception 'You do not have access to this team city'; end if;
  return v_role;
end $function$;

create or replace function col_private.dashboard() returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_result jsonb;
begin
  select jsonb_build_object(
    'account', jsonb_build_object('id',a.id,'display_name',a.display_name,'referral_code',a.referral_code,
      'created_at',a.created_at,'is_admin',exists(select 1 from col_private.admins where account_id = v_uid),
      'erasure_requested_at',(select min(created_at) from col_private.audit_events
        where actor_id = v_uid and event = 'erasure_requested')),
    'inviter', (select jsonb_build_object('id',i.id,'display_name',i.display_name)
      from col_private.attributions r join col_private.accounts i on i.id = r.inviter_id where r.invitee_id = v_uid),
    'invitees', coalesce((select jsonb_agg(page.item order by page.accepted_at desc,page.id) from (
      select i.id,r.accepted_at,jsonb_build_object('id',i.id,'display_name',i.display_name,
        'created_at',i.created_at,'accepted_at',r.accepted_at) item
      from col_private.attributions r join col_private.accounts i on i.id = r.invitee_id
      where r.inviter_id = v_uid order by r.accepted_at desc,i.id limit 100
    ) page), '[]'::jsonb),
    'invitees_truncated', (select count(*) > 100 from col_private.attributions where inviter_id = v_uid),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'role',m.role,'version',t.version)
      order by t.created_at,t.id) from col_private.members m join col_private.teams t on t.id = m.team_id
      where m.account_id = v_uid), '[]'::jsonb),
    'counts', jsonb_build_object('direct_invitees',(select count(*) from col_private.attributions where inviter_id = v_uid))
  ) into v_result from col_private.accounts a where a.id = v_uid;
  return v_result;
end $function$;

create or replace function col_private.request_erasure() returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor();
begin
  perform 1 from col_private.accounts where id = v_uid for update;
  if not exists(select 1 from col_private.audit_events where actor_id = v_uid and event = 'erasure_requested') then
    insert into col_private.audit_events(actor_id,event,subject_id) values(v_uid,'erasure_requested',v_uid);
  end if;
  -- A review request is not destructive deletion of shared Auth or other members' artifacts.
  return col_private.dashboard();
end $function$;

create or replace function col_private.direct_invitees(p_offset integer,p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor();
begin
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 100
  then raise exception 'Use a nonnegative offset and a page size from 1 to 100'; end if;
  return jsonb_build_object('total',(select count(*) from col_private.attributions where inviter_id = v_uid),
    'offset',p_offset,'limit',p_limit,'invitees',coalesce((select jsonb_agg(page.item order by page.accepted_at desc,page.id)
    from (select i.id,r.accepted_at,jsonb_build_object('id',i.id,'display_name',i.display_name,
      'created_at',i.created_at,'accepted_at',r.accepted_at) item
      from col_private.attributions r join col_private.accounts i on i.id = r.invitee_id
      where r.inviter_id = v_uid order by r.accepted_at desc,i.id offset p_offset limit p_limit) page),'[]'::jsonb));
end $function$;

create or replace function col_private.claim_owner(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_hash text; v_setup col_private.admin_bootstrap%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Owner setup link is invalid or unavailable'; end if;
  v_hash := encode(sha256(convert_to(p_token,'UTF8')),'hex');
  -- Serializes different bootstrap rows too: only the initial owner can be established.
  perform 1 from col_private.schema_state where singleton for update;
  select * into v_setup from col_private.admin_bootstrap where token_hash = v_hash for update;
  if v_setup.token_hash is null or v_setup.expires_at <= now()
  then raise exception 'Owner setup link is invalid or unavailable'; end if;
  if v_setup.consumed_at is not null then
    if v_setup.consumed_by = v_uid and exists(select 1 from col_private.admins where account_id = v_uid)
    then return col_private.dashboard(); end if;
    raise exception 'Owner setup link is invalid or unavailable';
  end if;
  if exists(select 1 from col_private.admins) then raise exception 'Initial owner setup is already complete'; end if;
  insert into col_private.admins(account_id) values(v_uid);
  update col_private.admin_bootstrap set consumed_at = now(),consumed_by = v_uid where token_hash = v_hash;
  insert into col_private.audit_events(actor_id,event,subject_id) values(v_uid,'initial_owner_claimed',v_uid);
  return col_private.dashboard();
end $function$;

create or replace function col_private.register(p_display_name text, p_ref text, p_consent boolean) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.actor(); v_name text := btrim(p_display_name);
  v_ref text := nullif(btrim(p_ref),''); v_inviter uuid; v_previous uuid;
begin
  if p_consent is distinct from true then raise exception 'Accept community-v1 terms to register'; end if;
  if v_name is null or char_length(v_name) not between 1 and 60
  then raise exception 'Display name must contain 1 to 60 characters'; end if;
  -- Serialize the only referral-edge writer; unique PK is additional protection.
  perform pg_catalog.pg_advisory_xact_lock(17031011, 1);
  if v_ref is not null then
    if v_ref !~ '^[a-f0-9]{32}$' then raise exception 'Invalid referral code'; end if;
    select id into v_inviter from col_private.accounts where referral_code = v_ref;
    if v_inviter is null then raise exception 'Referral code was not issued by this service'; end if;
    if v_inviter = v_uid then raise exception 'You cannot invite yourself'; end if;
    select inviter_id into v_previous from col_private.attributions where invitee_id = v_uid;
    if v_previous is not null and v_previous <> v_inviter
    then raise exception 'Your direct inviter is already recorded and cannot be replaced'; end if;
    if v_previous is null and not exists (
      select 1 from auth.users u where u.id = v_inviter
      and not coalesce(u.is_anonymous,false) and u.email_confirmed_at is not null
    ) then raise exception 'This referral account is no longer active'; end if;
    if exists (with recursive ancestry(id) as (
      select v_inviter union select r.inviter_id from col_private.attributions r join ancestry a on r.invitee_id = a.id
    ) select 1 from ancestry where id = v_uid)
    then raise exception 'A referral cannot create a cycle'; end if;
  end if;
  insert into col_private.accounts(id,display_name,terms_version) values(v_uid,v_name,'community-v1')
  on conflict(id) do update set display_name = excluded.display_name;
  if v_inviter is not null and v_previous is null then
    insert into col_private.attributions(invitee_id,inviter_id) values(v_uid,v_inviter);
    insert into col_private.audit_events(actor_id,event,subject_id,details)
      values(v_uid,'direct_inviter_recorded',v_uid,jsonb_build_object('inviter_id',v_inviter,'terms_version','community-v1'));
  end if;
  return col_private.dashboard();
end $function$;

create or replace function col_private.team(p_team_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_role text := col_private.team_role(p_team_id,v_uid);
begin
  return (select jsonb_build_object('id',t.id,'name',t.name,'role',v_role,'version',t.version,
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'display_name',a.display_name,'role',m.role)
      order by m.joined_at,a.id) from col_private.members m join col_private.accounts a on a.id = m.account_id
      where m.team_id = t.id),'[]'::jsonb),
    'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'owner_id',e.owner_id,'x',e.x,'y',e.y,
      'title',e.title,'status',e.status,'kind',e.kind,'version',e.version) order by e.y,e.x)
      from col_private.entries e where e.team_id = t.id),'[]'::jsonb))
    from col_private.teams t where t.id = p_team_id);
end $function$;

create or replace function col_private.create_team(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_name text := btrim(p_name); v_id uuid;
begin
  if v_name is null or char_length(v_name) not between 1 and 60
  then raise exception 'City name must contain 1 to 60 characters'; end if;
  perform 1 from col_private.accounts where id = v_uid for update;
  if (select count(*) from col_private.teams where owner_id = v_uid) >= 20
  then raise exception 'The initial limit is 20 owned team cities'; end if;
  insert into col_private.teams(name,owner_id) values(v_name,v_uid) returning id into v_id;
  insert into col_private.members(team_id,account_id,role) values(v_id,v_uid,'owner');
  insert into col_private.audit_events(actor_id,event,subject_id) values(v_uid,'team_created',v_id);
  return col_private.dashboard();
end $function$;

create or replace function col_private.issue_team_invite(p_team_id uuid,p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_token text; v_expires timestamptz := now() + interval '48 hours';
begin
  perform 1 from col_private.teams where id = p_team_id for update;
  if col_private.team_role(p_team_id,v_uid) <> 'owner' then raise exception 'Only the city owner may invite members'; end if;
  if p_role is null or p_role not in ('editor','viewer') then raise exception 'Choose editor or viewer access'; end if;
  if (select count(*) from col_private.team_invites where team_id = p_team_id and revoked_at is null
    and used_at is null and expires_at > now()) >= 10
  then raise exception 'A city may have at most 10 active invitation links'; end if;
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into col_private.team_invites(token_hash,team_id,role,issued_by,expires_at)
    values(encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_team_id,p_role,v_uid,v_expires);
  update col_private.teams set version = version + 1 where id = p_team_id;
  insert into col_private.audit_events(actor_id,event,subject_id,details)
    values(v_uid,'team_invite_issued',p_team_id,jsonb_build_object('role',p_role,'expires_at',v_expires));
  return jsonb_build_object('token',v_token,'expires_at',v_expires);
end $function$;

create or replace function col_private.join_team(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_hash text; v_team uuid; v_invite col_private.team_invites%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid team invitation'; end if;
  v_hash := encode(sha256(convert_to(p_token,'UTF8')),'hex');
  select team_id into v_team from col_private.team_invites where token_hash = v_hash;
  if v_team is null then raise exception 'Invitation was not issued by this service'; end if;
  -- Team lock first, then invitation lock: every team mutation has the same lock order.
  perform 1 from col_private.teams where id = v_team for update;
  select * into v_invite from col_private.team_invites where token_hash = v_hash for update;
  if v_invite.revoked_at is not null or v_invite.expires_at <= now()
  then raise exception 'This invitation was revoked or has expired'; end if;
  if v_invite.used_at is not null then
    if v_invite.used_by = v_uid and exists(select 1 from col_private.members where team_id = v_team and account_id = v_uid)
    then return col_private.dashboard(); end if;
    raise exception 'This invitation has already been used';
  end if;
  if exists(select 1 from col_private.members where team_id = v_team and account_id = v_uid)
  then raise exception 'You are already a member; existing access is unchanged'; end if;
  if (select count(*) from col_private.members where team_id = v_team) >= 50
  then raise exception 'The initial city limit is 50 members'; end if;
  if (select count(*) from col_private.members where account_id = v_uid) >= 100
  then raise exception 'The initial account limit is 100 team memberships'; end if;
  insert into col_private.members(team_id,account_id,role) values(v_team,v_uid,v_invite.role);
  update col_private.team_invites set used_by = v_uid,used_at = now() where token_hash = v_hash;
  update col_private.teams set version = version + 1 where id = v_team;
  insert into col_private.audit_events(actor_id,event,subject_id,details)
    values(v_uid,'team_joined',v_team,jsonb_build_object('role',v_invite.role));
  return col_private.dashboard();
end $function$;

create or replace function col_private.revoke_team_invite(p_team_id uuid,p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_hash text;
begin
  perform 1 from col_private.teams where id = p_team_id for update;
  if col_private.team_role(p_team_id,v_uid) <> 'owner' then raise exception 'Only the city owner may revoke invitations'; end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid team invitation'; end if;
  v_hash := encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not exists(select 1 from col_private.team_invites where token_hash = v_hash and team_id = p_team_id)
  then raise exception 'This invitation does not belong to the selected city'; end if;
  update col_private.team_invites set revoked_at = coalesce(revoked_at,now()) where token_hash = v_hash and team_id = p_team_id;
  update col_private.teams set version = version + 1 where id = p_team_id;
  insert into col_private.audit_events(actor_id,event,subject_id) values(v_uid,'team_invite_revoked',p_team_id);
  return col_private.team(p_team_id);
end $function$;

create or replace function col_private.remove_member(p_team_id uuid,p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_role text;
begin
  perform 1 from col_private.teams where id = p_team_id for update;
  if col_private.team_role(p_team_id,v_uid) <> 'owner' then raise exception 'Only the city owner may remove members'; end if;
  select role into v_role from col_private.members where team_id = p_team_id and account_id = p_user_id;
  if v_role = 'owner' then raise exception 'The city owner cannot be removed'; end if;
  if v_role is null then raise exception 'This account is not a city member'; end if;
  delete from col_private.members where team_id = p_team_id and account_id = p_user_id;
  -- Shared artifacts are preserved, but removed members lose all city access immediately.
  update col_private.teams set version = version + 1 where id = p_team_id;
  insert into col_private.audit_events(actor_id,event,subject_id,details)
    values(v_uid,'team_member_removed',p_team_id,jsonb_build_object('account_id',p_user_id));
  return col_private.team(p_team_id);
end $function$;

create or replace function col_private.revoke_team_invites(p_team_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_count integer;
begin
  perform 1 from col_private.teams where id = p_team_id for update;
  if col_private.team_role(p_team_id,v_uid) <> 'owner' then raise exception 'Only the city owner may revoke invitations'; end if;
  update col_private.team_invites set revoked_at = now()
    where team_id = p_team_id and revoked_at is null and used_at is null;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    update col_private.teams set version = version + 1 where id = p_team_id;
    insert into col_private.audit_events(actor_id,event,subject_id,details)
      values(v_uid,'pending_team_invites_revoked',p_team_id,jsonb_build_object('revoked_count',v_count));
  end if;
  return col_private.team(p_team_id);
end $function$;

create or replace function col_private.put_entry(p_team_id uuid,p_entry_id uuid,p_x integer,p_y integer,
  p_title text,p_status text,p_kind text,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_role text; v_entry col_private.entries%rowtype;
  v_title text := btrim(p_title);
begin
  perform 1 from col_private.teams where id = p_team_id for update;
  v_role := col_private.team_role(p_team_id,v_uid);
  if v_role not in ('owner','editor') then raise exception 'Viewers cannot change a city'; end if;
  if p_x is null or p_y is null or p_x not between 0 and 31 or p_y not between 0 and 31
  then raise exception 'Choose a grid cell from 0 to 31'; end if;
  if v_title is null or char_length(v_title) not between 1 and 120
  then raise exception 'Entry title must contain 1 to 120 characters'; end if;
  if p_status is null or p_status not in ('planned','active','blocked','completed')
  then raise exception 'Invalid entry status'; end if;
  if p_kind is null or p_kind not in ('task','project','habit','goal') then raise exception 'Invalid entry kind'; end if;
  if p_entry_id is null then
    if p_expected_version is distinct from 0 then raise exception 'New entries require expected version 0'; end if;
    if (select count(*) from col_private.entries where team_id = p_team_id) >= 1024
    then raise exception 'The city grid is full'; end if;
  else
    select * into v_entry from col_private.entries where id = p_entry_id and team_id = p_team_id for update;
    if v_entry.id is null then raise exception 'The selected entry does not exist in this city'; end if;
    if v_role <> 'owner' and v_entry.owner_id <> v_uid then raise exception 'Editors may change only their own entries'; end if;
    if p_expected_version is distinct from v_entry.version then raise exception 'This entry changed; refresh before saving'; end if;
  end if;
  if exists(select 1 from col_private.entries where team_id = p_team_id and x = p_x and y = p_y
    and (p_entry_id is null or id <> p_entry_id)) then raise exception 'This grid cell is already occupied'; end if;
  if p_entry_id is null then
    insert into col_private.entries(team_id,owner_id,x,y,title,status,kind)
      values(p_team_id,v_uid,p_x,p_y,v_title,p_status,p_kind) returning * into v_entry;
  else
    update col_private.entries set x = p_x,y = p_y,title = v_title,status = p_status,kind = p_kind,
      version = version + 1,updated_at = now() where id = p_entry_id returning * into v_entry;
  end if;
  update col_private.teams set version = version + 1 where id = p_team_id;
  insert into col_private.audit_events(actor_id,event,subject_id,details)
    values(v_uid,'city_entry_saved',p_team_id,jsonb_build_object('entry_id',v_entry.id,'version',v_entry.version));
  return col_private.team(p_team_id);
end $function$;

create or replace function col_private.delete_entry(p_team_id uuid,p_entry_id uuid,p_expected_version integer) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor(); v_role text; v_entry col_private.entries%rowtype;
begin
  perform 1 from col_private.teams where id = p_team_id for update;
  v_role := col_private.team_role(p_team_id,v_uid);
  if v_role not in ('owner','editor') then raise exception 'Viewers cannot change a city'; end if;
  select * into v_entry from col_private.entries where id = p_entry_id and team_id = p_team_id for update;
  if v_entry.id is null then raise exception 'The selected entry does not exist in this city'; end if;
  if v_role <> 'owner' and v_entry.owner_id <> v_uid then raise exception 'Editors may remove only their own entries'; end if;
  if p_expected_version is distinct from v_entry.version then raise exception 'This entry changed; refresh before removing'; end if;
  delete from col_private.entries where id = p_entry_id;
  update col_private.teams set version = version + 1 where id = p_team_id;
  insert into col_private.audit_events(actor_id,event,subject_id,details)
    values(v_uid,'city_entry_removed',p_team_id,jsonb_build_object('entry_id',p_entry_id,'last_version',v_entry.version));
  return col_private.team(p_team_id);
end $function$;

create or replace function col_private.admin_accounts(p_offset integer,p_limit integer) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_uid uuid := col_private.registered_actor();
begin
  if not exists(select 1 from col_private.admins where account_id = v_uid)
  then raise exception 'Owner administration access is required'; end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 100
  then raise exception 'Use a nonnegative offset and a page size from 1 to 100'; end if;
  return jsonb_build_object('registered_accounts',(select count(*) from col_private.accounts),
    'attributed_accounts',(select count(*) from col_private.attributions),
    'accounts',coalesce((select jsonb_agg(row_data order by created_at,id) from (
      select a.created_at,a.id,jsonb_build_object('id',a.id,'display_name',a.display_name,'created_at',a.created_at,
        'inviter_id',r.inviter_id,'direct_invitees',(select count(*) from col_private.attributions where inviter_id = a.id),
        'erasure_requested_at',(select min(created_at) from col_private.audit_events
          where actor_id = a.id and event = 'erasure_requested')) row_data
      from col_private.accounts a left join col_private.attributions r on r.invitee_id = a.id
      order by a.created_at,a.id offset p_offset limit p_limit) page),'[]'::jsonb));
end $function$;

-- Only these stateless wrappers are exposed through Supabase public RPC.
create or replace function public.col_register(p_display_name text,p_ref text,p_consent boolean) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.register(p_display_name,p_ref,p_consent)$$;
create or replace function public.col_dashboard() returns jsonb
language sql security invoker set search_path = '' as $$select col_private.dashboard()$$;
create or replace function public.col_request_erasure() returns jsonb
language sql security invoker set search_path = '' as $$select col_private.request_erasure()$$;
create or replace function public.col_direct_invitees(p_offset integer,p_limit integer) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.direct_invitees(p_offset,p_limit)$$;
create or replace function public.col_claim_owner(p_token text) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.claim_owner(p_token)$$;
create or replace function public.col_create_team(p_name text) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.create_team(p_name)$$;
create or replace function public.col_team(p_team_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.team(p_team_id)$$;
create or replace function public.col_issue_team_invite(p_team_id uuid,p_role text) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.issue_team_invite(p_team_id,p_role)$$;
create or replace function public.col_join_team(p_token text) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.join_team(p_token)$$;
create or replace function public.col_revoke_team_invite(p_team_id uuid,p_token text) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.revoke_team_invite(p_team_id,p_token)$$;
create or replace function public.col_remove_member(p_team_id uuid,p_user_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.remove_member(p_team_id,p_user_id)$$;
create or replace function public.col_revoke_team_invites(p_team_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.revoke_team_invites(p_team_id)$$;
create or replace function public.col_put_entry(p_team_id uuid,p_entry_id uuid,p_x integer,p_y integer,
  p_title text,p_status text,p_kind text,p_expected_version integer) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.put_entry(p_team_id,p_entry_id,p_x,p_y,p_title,p_status,p_kind,p_expected_version)$$;
create or replace function public.col_delete_entry(p_team_id uuid,p_entry_id uuid,p_expected_version integer) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.delete_entry(p_team_id,p_entry_id,p_expected_version)$$;
create or replace function public.col_admin_accounts(p_offset integer,p_limit integer) returns jsonb
language sql security invoker set search_path = '' as $$select col_private.admin_accounts(p_offset,p_limit)$$;

-- Revoke default function EXECUTE before selectively granting the RPC contract.
revoke all on all functions in schema col_private from public,anon,authenticated;
do $grants$
declare fn text;
begin
  foreach fn in array array[
    'register(text,text,boolean)','dashboard()','request_erasure()','direct_invitees(integer,integer)','claim_owner(text)','create_team(text)','team(uuid)',
    'issue_team_invite(uuid,text)','join_team(text)','revoke_team_invite(uuid,text)',
    'remove_member(uuid,uuid)','revoke_team_invites(uuid)','put_entry(uuid,uuid,integer,integer,text,text,text,integer)',
    'delete_entry(uuid,uuid,integer)','admin_accounts(integer,integer)'
  ] loop
    execute 'grant execute on function col_private.' || fn || ' to authenticated';
  end loop;
  foreach fn in array array[
    'col_register(text,text,boolean)','col_dashboard()','col_request_erasure()','col_direct_invitees(integer,integer)','col_claim_owner(text)','col_create_team(text)','col_team(uuid)',
    'col_issue_team_invite(uuid,text)','col_join_team(text)','col_revoke_team_invite(uuid,text)',
    'col_remove_member(uuid,uuid)','col_revoke_team_invites(uuid)','col_put_entry(uuid,uuid,integer,integer,text,text,text,integer)',
    'col_delete_entry(uuid,uuid,integer)','col_admin_accounts(integer,integer)'
  ] loop
    execute 'revoke all on function public.' || fn || ' from public,anon,authenticated';
    execute 'grant execute on function public.' || fn || ' to authenticated';
  end loop;
end $grants$;
notify pgrst, 'reload schema';
commit;
