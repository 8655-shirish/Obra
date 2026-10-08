create or replace function public.parse_background_job_retry_at(p_value text) returns timestamptz
language plpgsql stable set search_path = public as $$
begin
  if p_value is null then return null; end if;
  return p_value::timestamptz;
exception when others then
  return null;
end $$;

create or replace function public.sync_background_job_retry_at() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.payload_json is distinct from old.payload_json then
    new.next_retry_at := public.parse_background_job_retry_at(new.payload_json->>'next_retry_at');
  end if;
  return new;
end $$;