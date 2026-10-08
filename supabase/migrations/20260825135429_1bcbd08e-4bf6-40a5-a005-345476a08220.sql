-- Preserve historical chronology while giving new messages a database-owned causal order.
create sequence if not exists public.messages_sequence_id_seq;

alter table public.messages
  add column if not exists sequence_id bigint;

with historical_order as (
  select id, row_number() over (order by created_at, id) as sequence_id
  from public.messages
  where sequence_id is null
)
update public.messages as message
set sequence_id = historical_order.sequence_id
from historical_order
where message.id = historical_order.id;

select setval(
  'public.messages_sequence_id_seq',
  coalesce((select max(sequence_id) from public.messages), 1),
  exists (select 1 from public.messages)
);

alter sequence public.messages_sequence_id_seq
  owned by public.messages.sequence_id;

revoke all on sequence public.messages_sequence_id_seq from public, anon, authenticated;

create or replace function public.assign_message_sequence_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.sequence_id := nextval('public.messages_sequence_id_seq');
  else
    new.sequence_id := old.sequence_id;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_message_sequence_id() from public, anon, authenticated;

drop trigger if exists messages_assign_sequence_id on public.messages;
create trigger messages_assign_sequence_id
before insert or update on public.messages
for each row execute function public.assign_message_sequence_id();

alter table public.messages
  alter column sequence_id set default null,
  alter column sequence_id set not null;

create unique index if not exists messages_sequence_id_uk
  on public.messages (sequence_id);

create index if not exists messages_conversation_sequence_idx
  on public.messages (conversation_id, sequence_id desc);