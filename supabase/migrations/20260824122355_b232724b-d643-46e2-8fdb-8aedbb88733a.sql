create table if not exists public.media_repair_events (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites(id) on delete cascade,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists media_repair_events_website_idx
  on public.media_repair_events(website_id, created_at desc);

grant all on public.media_repair_events to service_role;

alter table public.media_repair_events enable row level security;
