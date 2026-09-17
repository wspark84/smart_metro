-- Smart Metro only. Does not change other projects or remove existing data.
-- Run in the NEW smart_metro project's SQL Editor, not another project.
begin;

create table if not exists public.smart_metro_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  document_key text not null check (document_key in (
    'app-state', 'domain-store', 'device-profile', 'bus-accuracy',
    'bus-accuracy-runtime', 'alarm-runtime', 'alarm-delivery', 'alarm-events',
    'dispatch-queue', 'dispatch-executions', 'push-gateway-state'
  )),
  payload jsonb not null check (jsonb_typeof(payload) in ('object', 'array')),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, document_key)
);

alter table public.smart_metro_documents enable row level security;
alter table public.smart_metro_documents force row level security;
revoke all on public.smart_metro_documents from public, anon, authenticated;
grant select, insert, update on public.smart_metro_documents to authenticated;

-- Policies are recreated only on this application's new table for rerun safety.
drop policy if exists smart_metro_select_own on public.smart_metro_documents;
create policy smart_metro_select_own on public.smart_metro_documents
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists smart_metro_insert_own on public.smart_metro_documents;
create policy smart_metro_insert_own on public.smart_metro_documents
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists smart_metro_update_own on public.smart_metro_documents;
create policy smart_metro_update_own on public.smart_metro_documents
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.save_smart_metro_document(
  p_document_key text, p_payload jsonb, p_expected_revision bigint
) returns public.smart_metro_documents
language plpgsql security invoker set search_path = '' as $$
declare
  saved public.smart_metro_documents;
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid revision' using errcode = '22023';
  end if;
  if p_expected_revision = 0 then
    insert into public.smart_metro_documents(user_id, document_key, payload)
      values (owner_id, p_document_key, p_payload) returning * into saved;
  else
    update public.smart_metro_documents
      set payload = p_payload, revision = revision + 1, updated_at = now()
      where user_id = owner_id and document_key = p_document_key
        and revision = p_expected_revision returning * into saved;
    if not found then
      raise exception 'Document changed; reload before saving' using errcode = '40001';
    end if;
  end if;
  return saved;
end;
$$;
revoke all on function public.save_smart_metro_document(text, jsonb, bigint) from public, anon;
grant execute on function public.save_smart_metro_document(text, jsonb, bigint) to authenticated;
commit;
