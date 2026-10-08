-- Admin trace viewer: group agent turns into inspectable "traces" (LangSmith-style)

create table public.agent_traces (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  intent_type text,
  trigger_message text,
  status text not null default 'running' check (status in ('running', 'completed', 'error')),
  error_message text,
  tool_call_count int not null default 0,
  round_count int not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

grant all on public.agent_traces to service_role;

create index agent_traces_website_id_idx on public.agent_traces (website_id, started_at desc);
create index agent_traces_profile_id_idx on public.agent_traces (profile_id, started_at desc);

alter table public.messages add column if not exists trace_id uuid references public.agent_traces (id) on delete set null;

create index messages_trace_id_idx on public.messages (trace_id);

alter table public.agent_traces enable row level security;

-- Admin-only table: no client policies. Read exclusively via supabaseAdmin (service role)
-- from the /admin/traces viewer, matching background_jobs/checkout_sessions conventions.
