-- Obra foundation schema (Bucket 1): profiles, websites, jobs, chat, leads, storage, RLS

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  license_number text not null unique,
  email text,
  full_name text,
  city text,
  trade text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_required_when_auth check (
    auth_user_id is null or email is not null
  )
);

create unique index profiles_license_email_uk
  on public.profiles (license_number, email)
  where auth_user_id is not null;

create index profiles_auth_user_id_idx on public.profiles (auth_user_id);
create index profiles_email_idx on public.profiles (email) where email is not null;

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan text not null default 'starter' check (plan in ('starter', 'pro')),
  status text not null default 'pending_activation' check (
    status in ('pending_activation', 'active', 'cancelled', 'past_due')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_user_id_idx on public.subscriptions (user_id);

create unique index subscriptions_one_active_per_profile
  on public.subscriptions (user_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- websites
-- ---------------------------------------------------------------------------
create table public.websites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'live', 'archived')),
  research_status text check (
    research_status in ('complete', 'partial', 'failed', 'no_results_found')
  ),
  active_version_id uuid,
  onboarding_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint websites_live_requires_active_version check (
    status <> 'live' or active_version_id is not null
  )
);

create index websites_user_id_idx on public.websites (user_id);
create index websites_status_idx on public.websites (status);

-- ---------------------------------------------------------------------------
-- contractor_profiles (enrichment)
-- ---------------------------------------------------------------------------
create table public.contractor_profiles (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null unique references public.websites (id) on delete cascade,
  business_name text,
  license_number text not null,
  city text,
  state text not null default 'CA',
  enrichment_json jsonb not null default '{}'::jsonb,
  research_status text check (
    research_status in ('complete', 'partial', 'failed', 'no_results_found')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contractor_profiles_license_number_idx on public.contractor_profiles (license_number);

-- ---------------------------------------------------------------------------
-- website_versions
-- ---------------------------------------------------------------------------
create table public.website_versions (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites (id) on delete cascade,
  version_number int not null,
  config_json jsonb not null default '{}'::jsonb,
  variant_key text not null,
  status text not null default 'draft' check (
    status in ('draft', 'selected', 'discarded', 'live')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (website_id, version_number)
);

create index website_versions_website_id_idx on public.website_versions (website_id);

alter table public.websites
  add constraint websites_active_version_id_fkey
  foreign key (active_version_id) references public.website_versions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- conversations + messages
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  website_id uuid not null references public.websites (id) on delete cascade,
  phase text not null default 'onboarding',
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index conversations_user_id_idx on public.conversations (user_id);
create index conversations_website_id_idx on public.conversations (website_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null default '',
  tool_calls jsonb,
  attachments jsonb,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- website_edit_events
-- ---------------------------------------------------------------------------
create table public.website_edit_events (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites (id) on delete cascade,
  version_id uuid references public.website_versions (id) on delete set null,
  category text not null,
  patch_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index website_edit_events_website_id_idx on public.website_edit_events (website_id, created_at desc);

-- ---------------------------------------------------------------------------
-- background_jobs (sequential chains)
-- ---------------------------------------------------------------------------
create table public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites (id) on delete cascade,
  chain_id uuid not null,
  job_type text not null check (job_type in ('enrichment_platform', 'site_generation')),
  sequence_index int not null default 0,
  platform text,
  status text not null default 'pending' check (
    status in ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),
  progress_pct int not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  status_message text,
  payload_json jsonb not null default '{}'::jsonb,
  result_json jsonb,
  error_message text,
  idempotency_key text,
  attempts int not null default 0,
  max_attempts int not null default 3,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index background_jobs_website_id_idx on public.background_jobs (website_id);
create index background_jobs_chain_id_idx on public.background_jobs (chain_id, sequence_index);
create unique index background_jobs_chain_sequence_uk on public.background_jobs (chain_id, sequence_index);
create index background_jobs_status_idx on public.background_jobs (status) where status in ('pending', 'running');
-- idempotency_key is chain-level; only the first job in a chain carries it
create unique index background_jobs_chain_idempotency_uk
  on public.background_jobs (website_id, idempotency_key)
  where idempotency_key is not null and sequence_index = 0;

alter table public.background_jobs replica identity full;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.websites (id) on delete cascade,
  license_number text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  form_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index leads_website_id_idx on public.leads (website_id, created_at desc);
create index leads_user_id_idx on public.leads (user_id);

-- ---------------------------------------------------------------------------
-- checkout_sessions (post-checkout context; Bucket 2 consumes)
-- ---------------------------------------------------------------------------
create table public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  license_number text not null,
  email text not null,
  full_name text,
  city text,
  context_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending_otp' check (
    status in ('pending_otp', 'completed', 'expired')
  ),
  subscription_id uuid references public.subscriptions (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index checkout_sessions_license_email_idx on public.checkout_sessions (license_number, email);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

drop trigger if exists websites_set_updated_at on public.websites;
create trigger websites_set_updated_at
  before update on public.websites
  for each row execute function public.set_updated_at();

drop trigger if exists contractor_profiles_set_updated_at on public.contractor_profiles;
create trigger contractor_profiles_set_updated_at
  before update on public.contractor_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists website_versions_set_updated_at on public.website_versions;
create trigger website_versions_set_updated_at
  before update on public.website_versions
  for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.websites enable row level security;
alter table public.contractor_profiles enable row level security;
alter table public.website_versions enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.website_edit_events enable row level security;
alter table public.background_jobs enable row level security;
alter table public.leads enable row level security;
alter table public.checkout_sessions enable row level security;

-- profiles: contractor reads/updates own row when auth linked
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- subscriptions
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

-- websites
drop policy if exists websites_select_own on public.websites;
create policy websites_select_own on public.websites
  for select to authenticated
  using (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

drop policy if exists websites_update_own on public.websites;
create policy websites_update_own on public.websites
  for update to authenticated
  using (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  )
  with check (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

drop policy if exists websites_insert_own on public.websites;
create policy websites_insert_own on public.websites
  for insert to authenticated
  with check (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

-- contractor_profiles (via website ownership)
drop policy if exists contractor_profiles_select_own on public.contractor_profiles;
create policy contractor_profiles_select_own on public.contractor_profiles
  for select to authenticated
  using (
    website_id in (
      select w.id from public.websites w
      join public.profiles p on p.id = w.user_id
      where p.auth_user_id = auth.uid()
    )
  );

-- website_versions: owner access + public read for live sites
drop policy if exists website_versions_select_own on public.website_versions;
create policy website_versions_select_own on public.website_versions
  for select to authenticated
  using (
    website_id in (
      select w.id from public.websites w
      join public.profiles p on p.id = w.user_id
      where p.auth_user_id = auth.uid()
    )
  );

drop policy if exists website_versions_select_live on public.website_versions;
create policy website_versions_select_live on public.website_versions
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.websites w
      where w.id = website_id
        and w.status = 'live'
        and w.active_version_id = website_versions.id
    )
  );

-- conversations + messages
drop policy if exists conversations_select_own on public.conversations;
create policy conversations_select_own on public.conversations
  for select to authenticated
  using (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

drop policy if exists conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations
  for insert to authenticated
  with check (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

drop policy if exists conversations_update_own on public.conversations;
create policy conversations_update_own on public.conversations
  for update to authenticated
  using (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  )
  with check (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select to authenticated
  using (
    conversation_id in (
      select c.id from public.conversations c
      join public.profiles p on p.id = c.user_id
      where p.auth_user_id = auth.uid()
    )
  );

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
  for insert to authenticated
  with check (
    conversation_id in (
      select c.id from public.conversations c
      join public.profiles p on p.id = c.user_id
      where p.auth_user_id = auth.uid()
    )
  );

-- website_edit_events
drop policy if exists website_edit_events_select_own on public.website_edit_events;
create policy website_edit_events_select_own on public.website_edit_events
  for select to authenticated
  using (
    website_id in (
      select w.id from public.websites w
      join public.profiles p on p.id = w.user_id
      where p.auth_user_id = auth.uid()
    )
  );

-- background_jobs: contractor read progress on own websites
drop policy if exists background_jobs_select_own on public.background_jobs;
create policy background_jobs_select_own on public.background_jobs
  for select to authenticated
  using (
    website_id in (
      select w.id from public.websites w
      join public.profiles p on p.id = w.user_id
      where p.auth_user_id = auth.uid()
    )
  );

-- leads: contractor reads own leads
drop policy if exists leads_select_own on public.leads;
create policy leads_select_own on public.leads
  for select to authenticated
  using (
    user_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

-- Admin kickoff, enrichment, generation, checkout: writes via service role only.
-- Contractor client policies above are read-mostly; mutations go through server functions.

-- checkout_sessions: service role only (no client policies)

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'chat-attachments',
    'chat-attachments',
    false,
    52428800,
    array[
      'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'video/hevc',
      'video/mp4', 'image/gif'
    ]
  ),
  (
    'site-media',
    'site-media',
    true,
    52428800,
    array[
      'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'video/hevc',
      'video/mp4', 'image/gif'
    ]
  ),
  (
    'journals',
    'journals',
    false,
    1048576,
    array['text/markdown', 'text/plain']
  )
on conflict (id) do nothing;

-- chat-attachments: owner folder = profiles.id
drop policy if exists chat_attachments_select_own on storage.objects;
create policy chat_attachments_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] in (
      select id::text from public.profiles where auth_user_id = auth.uid()
    )
  );

drop policy if exists chat_attachments_insert_own on storage.objects;
create policy chat_attachments_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] in (
      select id::text from public.profiles where auth_user_id = auth.uid()
    )
  );

drop policy if exists chat_attachments_update_own on storage.objects;
create policy chat_attachments_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] in (
      select id::text from public.profiles where auth_user_id = auth.uid()
    )
  );

drop policy if exists chat_attachments_delete_own on storage.objects;
create policy chat_attachments_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] in (
      select id::text from public.profiles where auth_user_id = auth.uid()
    )
  );

-- site-media: public read, owner write
drop policy if exists site_media_select_public on storage.objects;
create policy site_media_select_public on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'site-media');

drop policy if exists site_media_insert_own on storage.objects;
create policy site_media_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'site-media'
    and (storage.foldername(name))[1] in (
      select id::text from public.profiles where auth_user_id = auth.uid()
    )
  );

drop policy if exists site_media_update_own on storage.objects;
create policy site_media_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'site-media'
    and (storage.foldername(name))[1] in (
      select id::text from public.profiles where auth_user_id = auth.uid()
    )
  );

drop policy if exists site_media_delete_own on storage.objects;
create policy site_media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'site-media'
    and (storage.foldername(name))[1] in (
      select id::text from public.profiles where auth_user_id = auth.uid()
    )
  );

-- journals: service role only (no authenticated policies)

-- Realtime for job progress UI (idempotent for re-apply)
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'background_jobs'
  ) then
    alter publication supabase_realtime add table public.background_jobs;
  end if;
end $$;
