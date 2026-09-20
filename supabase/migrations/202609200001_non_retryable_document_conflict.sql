-- Run only in the smart_metro project, after migrations 001 and 002.
-- Preserves data, revision checks, RLS, function ownership and existing grants.
-- Existing looping PostgREST backends must be stopped separately after this fix.
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regprocedure('public.save_smart_metro_document(text,jsonb,bigint)') is null then
    raise exception 'Missing Smart Metro setup; stop and verify the project';
  end if;
end;
$$;

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
      -- A stale application revision cannot succeed by replaying the same request.
      -- 40001 can trigger unbounded PostgREST transaction retries; PT409 cannot.
      raise exception 'Document changed; reload before saving' using errcode = 'PT409';
    end if;
  end if;
  return saved;
end;
$$;

commit;
