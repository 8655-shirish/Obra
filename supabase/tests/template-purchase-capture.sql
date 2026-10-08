-- Template purchase capture regression (migration 20260907090000).
-- Fixtures use 93-prefix ids to avoid the legacy 91/92 fixtures.
-- Sentinel failures use P9999 so the P0001 handlers below only catch trigger
-- violations, never the test's own assertions.

insert into public.profiles(id,license_number,email,full_name,business_name,city,environment) values
('93000000-0000-0000-0000-000000000001','TPL-SLUG-1','tpl-slug-1@example.com','Tpl Slug','Tpl Slug LLC','Austin','test');
insert into public.websites(id,user_id,status,onboarding_state,environment)values
('93000000-0000-0000-0000-000000000002','93000000-0000-0000-0000-000000000001','draft','{}','test');
insert into public.subscriptions(id,user_id,plan,status,environment)values
('93000000-0000-0000-0000-000000000005','93000000-0000-0000-0000-000000000001','pro','pending_activation','test');
insert into public.checkout_sessions(id,profile_id,website_id,environment,license_number,email,full_name,business_name,city,context_json,status,subscription_id,plan,stripe_checkout_session_id) values
('93000000-0000-0000-0000-000000000003','93000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000002','test','TPL-SLUG-1','tpl-slug-1@example.com','Tpl Slug','Tpl Slug LLC','Austin','{}','pending_otp','93000000-0000-0000-0000-000000000005','pro',null);

-- 1. New columns default to NULL so existing insert paths are untouched.
do $$
declare
  v_slug text;
begin
  select template_slug into v_slug from public.websites where id = '93000000-0000-0000-0000-000000000002';
  if v_slug is not null then
    raise exception 'websites.template_slug should default to null' using errcode = 'P9999';
  end if;
  select template_slug into v_slug from public.checkout_sessions where id = '93000000-0000-0000-0000-000000000003';
  if v_slug is not null then
    raise exception 'checkout_sessions.template_slug should default to null' using errcode = 'P9999';
  end if;
end $$;

-- 2. Set + read back on both tables.
update public.checkout_sessions set template_slug = 'painter11' where id = '93000000-0000-0000-0000-000000000003';
update public.websites set template_slug = 'painter11' where id = '93000000-0000-0000-0000-000000000002';
do $$
declare
  v_slug text;
begin
  select template_slug into v_slug from public.checkout_sessions where id = '93000000-0000-0000-0000-000000000003';
  if v_slug is distinct from 'painter11' then
    raise exception 'checkout slug readback mismatch' using errcode = 'P9999';
  end if;
  select template_slug into v_slug from public.websites where id = '93000000-0000-0000-0000-000000000002';
  if v_slug is distinct from 'painter11' then
    raise exception 'website slug readback mismatch' using errcode = 'P9999';
  end if;
end $$;

-- 3. Changing a set slug raises P0001 on both tables.
do $$
begin
  update public.checkout_sessions set template_slug = 'other' where id = '93000000-0000-0000-0000-000000000003';
  raise exception 'expected set-once violation (checkout_sessions)' using errcode = 'P9999';
exception
  when sqlstate 'P0001' then
    if sqlerrm not like '%immutable once set%' then
      raise;
    end if;
end $$;
do $$
begin
  update public.websites set template_slug = 'other' where id = '93000000-0000-0000-0000-000000000002';
  raise exception 'expected set-once violation (websites)' using errcode = 'P9999';
exception
  when sqlstate 'P0001' then
    if sqlerrm not like '%immutable once set%' then
      raise;
    end if;
end $$;

-- 4. Idempotent same-value re-set passes on both tables (retry-safe).
update public.checkout_sessions set template_slug = 'painter11' where id = '93000000-0000-0000-0000-000000000003';
update public.websites set template_slug = 'painter11' where id = '93000000-0000-0000-0000-000000000002';

-- 5. Paid-identity trigger regression: a verified row still rejects identity change.
insert into public.checkout_sessions(id,profile_id,website_id,environment,license_number,email,full_name,business_name,city,context_json,status,plan,stripe_checkout_session_id,payment_verified_at) values
('93000000-0000-0000-0000-000000000004','93000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000002','test','TPL-SLUG-1','tpl-slug-1@example.com','Tpl Slug','Tpl Slug LLC','Austin','{}','completed','pro',null,now());
do $$
begin
  update public.checkout_sessions set email = 'changed@example.com' where id = '93000000-0000-0000-0000-000000000004';
  raise exception 'expected paid identity violation' using errcode = 'P9999';
exception
  when sqlstate 'P0001' then
    null;
end $$;

-- 6. Cleanup fixtures (tables stay for later migrations; none reference these rows).
delete from public.checkout_sessions where id in ('93000000-0000-0000-0000-000000000003','93000000-0000-0000-0000-000000000004');
delete from public.subscriptions where id = '93000000-0000-0000-0000-000000000005';
delete from public.websites where id = '93000000-0000-0000-0000-000000000002';
delete from public.profiles where id = '93000000-0000-0000-0000-000000000001';
