create table public.plan_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  city text not null,
  plan text not null check (plan in ('starter', 'pro')),
  created_at timestamptz not null default now()
);

alter table public.plan_inquiries enable row level security;

create index plan_inquiries_created_at_idx on public.plan_inquiries (created_at desc);
