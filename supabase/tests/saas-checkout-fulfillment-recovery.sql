\set ON_ERROR_STOP on
\echo 'saas-checkout-fulfillment-recovery: audited ambiguous-delivery resolution'
begin;
create or replace function pg_temp.assert_true(ok boolean,message text)returns void language plpgsql as $$begin if ok is not true then raise exception 'assertion failed: %',message;end if;end$$;

select pg_temp.assert_true(has_function_privilege('service_role','public.resolve_saas_checkout_fulfillment_delivery_unknown(uuid,bigint,text,text,text,jsonb)','EXECUTE'),'service may invoke the audited operator recovery boundary');
select pg_temp.assert_true(not has_function_privilege('anon','public.resolve_saas_checkout_fulfillment_delivery_unknown(uuid,bigint,text,text,text,jsonb)','EXECUTE'),'anonymous callers cannot resolve ambiguous OTP deliveries');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.resolve_saas_checkout_fulfillment_delivery_unknown(uuid,bigint,text,text,text,jsonb)','EXECUTE'),'ordinary clients cannot resolve ambiguous OTP deliveries');
select pg_temp.assert_true(not has_table_privilege('service_role','public.saas_checkout_fulfillment_resolution_audit','INSERT'),'service cannot forge recovery audit history');
select pg_temp.assert_true(has_function_privilege('service_role','public.begin_saas_checkout(text,uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,jsonb)','EXECUTE'),'service may establish the atomic checkout boundary');
select pg_temp.assert_true(not has_function_privilege('anon','public.begin_saas_checkout(text,uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,jsonb)','EXECUTE'),'anonymous callers cannot establish checkout state');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.begin_saas_checkout(text,uuid,text,text,text,text,text,text,uuid,timestamptz,text,text,jsonb)','EXECUTE'),'ordinary clients cannot establish checkout state');

do $runner$
declare first_result jsonb;replay_result jsonb;
begin
 perform pg_temp.assert_true((public.apply_repo_migration('saas-runner-replay-probe.sql','a1b2c3','create table public.saas_runner_replay_probe(id integer)','dry_run','test')->>'status')='dry_run_ok','runner accepts a rolled-back dry run');
 perform pg_temp.assert_true(to_regclass('public.saas_runner_replay_probe')is null,'runner dry run leaves no schema mutation');
 first_result:=public.apply_repo_migration('saas-runner-replay-probe.sql','a1b2c3','create table public.saas_runner_replay_probe(id integer)','apply','test');
 perform pg_temp.assert_true(first_result->>'status'='applied','runner applies only after matching dry run');
 perform pg_temp.assert_true(to_regclass('public.saas_runner_replay_probe')is not null,'runner apply executes approved SQL');
 replay_result:=public.apply_repo_migration('saas-runner-replay-probe.sql','a1b2c3','create table public.saas_runner_replay_probe(id integer)','apply','test');
 perform pg_temp.assert_true(replay_result->>'status'='already_applied','runner replay is ledger-protected');
end $runner$;

do $offers$
declare starter_a uuid;starter_b uuid;pro_a uuid;observed_at timestamptz:='2026-09-04T12:00:00Z'::timestamptz;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('saas-offer-registry-write-v2',0));
 update public.saas_offer_contracts set active_for_new_sales=false where environment='test'and active_for_new_sales;
 perform pg_temp.assert_true(not exists(select 1 from public.saas_offer_contracts where environment='test'and active_for_new_sales),'offer fixture starts with isolated empty test routes');
 starter_a:=public.install_saas_offer_contract('test','starter','price_starter_a','prod_starter_a',7900,observed_at);
 pro_a:=public.install_saas_offer_contract('test','pro','price_pro_a','prod_pro_a',12900,observed_at);
 perform pg_temp.assert_true(public.rotate_saas_offer_contract('test','starter',starter_a,null::text),'first Starter activation succeeds');
 perform pg_temp.assert_true(public.rotate_saas_offer_contract('test','pro',pro_a,null::text),'first Pro activation succeeds');
 perform pg_temp.assert_true(public.assert_saas_offer_readiness('test'),'audited active Starter and Pro routes are ready');
 perform pg_temp.assert_true(public.install_saas_offer_contract('test','starter','price_starter_a','prod_starter_a',7900,observed_at)=starter_a,'audited offer installation is idempotent only with the same observation timestamp');
 starter_b:=public.install_saas_offer_contract('test','starter','price_starter_b','prod_starter_b',7900,observed_at+interval '1 second');
 perform pg_temp.assert_true(public.rotate_saas_offer_contract('test','starter',starter_b,'price_starter_a'),'atomic Starter rotation succeeds with explicit predecessor');
 perform pg_temp.assert_true((select count(*)=1 from public.saas_offer_contracts where environment='test'and plan='starter'and active_for_new_sales),'rotation retains one active Starter route');
 perform pg_temp.assert_true((select not active_for_new_sales from public.saas_offer_contracts where contract_id=starter_a),'rotation preserves historic offer A but retires it from new sales');
 perform pg_temp.assert_true(public.assert_saas_offer_readiness('test'),'audited readiness survives historical Price rotation');
 begin
  perform public.rotate_saas_offer_contract('test','starter',starter_a,null::text);
  raise exception 'stale offer rotation was accepted';
 exception when sqlstate 'P0001' then null;end;
 perform pg_temp.assert_true((select contract_id=starter_b from public.saas_offer_contracts where environment='test'and plan='starter'and active_for_new_sales),'stale rotation did not replace the reviewed active route');
 begin
  perform public.install_saas_offer_contract('test','starter','price_starter_a','prod_starter_a',7900,observed_at+interval '1 second');
  raise exception 'conflicting observation timestamp was accepted';
 exception when unique_violation then null;end;
 begin
  perform public.install_saas_offer_contract('test','starter','price_starter_a','prod_starter_conflict',7900,observed_at);
  raise exception 'conflicting installed price identity was accepted';
 exception when unique_violation then null;end;
end $offers$;

do $atomic_checkout$
declare
 v_profile_id uuid;
 v_website_id uuid;
 v_checkout_id uuid;
 v_replay_checkout_id uuid;
 v_subscription_id uuid;
 first_disposition text;
 replay_disposition text;
begin
 select b.profile_id,b.website_id,b.checkout_session_id,b.subscription_id,b.disposition
 into strict v_profile_id,v_website_id,v_checkout_id,v_subscription_id,first_disposition
 from public.begin_saas_checkout(
  'test',gen_random_uuid(),' atomic-checkout-1 ','atomic-checkout@example.test',
  'Atomic Owner','Atomic Co','Portland','starter',null,
  pg_catalog.clock_timestamp(),repeat('a',64),'atomic-checkout-test',
  pg_catalog.jsonb_build_object('schema',1,'documents',pg_catalog.jsonb_build_array())
 )b;
 perform pg_temp.assert_true(first_disposition='created','first atomic checkout creates the durable boundary');
 perform pg_temp.assert_true((select license_number='ATOMIC-CHECKOUT-1'and checkout_claim_email='atomic-checkout@example.test'from public.profiles where id=v_profile_id),'profile is normalized and claimed in the transaction');
 perform pg_temp.assert_true((select user_id=v_profile_id and environment='test'and status='draft'from public.websites where id=v_website_id),'website is created in the same tenant transaction');
 perform pg_temp.assert_true((select profile_id=v_profile_id and website_id=v_website_id and subscription_id=v_subscription_id and status='pending_payment'and provider_offer_snapshot->>'priceId'='price_starter_b'and provider_offer_snapshot->>'productId'='prod_starter_b'from public.checkout_sessions where id=v_checkout_id),'checkout freezes the active audited offer before any provider call');

 select b.checkout_session_id,b.disposition
 into strict v_replay_checkout_id,replay_disposition
 from public.begin_saas_checkout(
  'test',gen_random_uuid(),'ATOMIC-CHECKOUT-1','atomic-checkout@example.test',
  'Atomic Owner','Atomic Co','Portland','starter',null,
  pg_catalog.clock_timestamp()+interval'1 second',repeat('a',64),'atomic-checkout-test',
  pg_catalog.jsonb_build_object('schema',1,'documents',pg_catalog.jsonb_build_array())
 )b;
 perform pg_temp.assert_true(v_replay_checkout_id=v_checkout_id and replay_disposition='reused_pending_payment','lost responses replay to the same durable checkout');
 perform pg_temp.assert_true((select count(*)=1 from public.profiles where license_number='ATOMIC-CHECKOUT-1'),'replay does not duplicate the profile');
 perform pg_temp.assert_true((select count(*)=1 from public.websites where user_id=v_profile_id and environment='test'),'replay does not duplicate the website');
 perform pg_temp.assert_true((select count(*)=1 from public.checkout_sessions where website_id=v_website_id and environment='test'and status='pending_payment'),'replay does not duplicate the active checkout');

 update public.checkout_sessions set stripe_checkout_session_id='cs_atomic_replay' where id=v_checkout_id;
 perform pg_temp.assert_true((select provider_session_id='cs_atomic_replay'from public.begin_saas_checkout(
  'test',gen_random_uuid(),'ATOMIC-CHECKOUT-1','atomic-checkout@example.test',
  'Atomic Owner','Atomic Co','Portland','starter',null,
  pg_catalog.clock_timestamp()+interval'2 seconds',repeat('a',64),'atomic-checkout-test',
  pg_catalog.jsonb_build_object('schema',1,'documents',pg_catalog.jsonb_build_array())
 )),'provider-attached replay returns the existing session for retrieval rather than recreation');

 begin
  perform public.begin_saas_checkout(
   'test',gen_random_uuid(),'ATOMIC-CHECKOUT-1','different@example.test',
   'Atomic Owner','Atomic Co','Portland','starter',null,
   pg_catalog.clock_timestamp(),repeat('a',64),'atomic-checkout-test','{}'::jsonb
  );
  raise exception 'conflicting checkout identity was accepted';
 exception when unique_violation then
  perform pg_temp.assert_true(sqlerrm='provider checkout already active for different intent','provider-attached checkout identity cannot be taken over');
 end;

 begin
  perform public.begin_saas_checkout(
   'test',gen_random_uuid(),'ATOMIC-CHECKOUT-ROLLBACK','rollback@example.test',
   'Rollback Owner','Rollback Co','Portland','starter',gen_random_uuid(),
   pg_catalog.clock_timestamp(),repeat('b',64),'atomic-checkout-test','{}'::jsonb
  );
  raise exception 'missing supplied website was accepted';
 exception when sqlstate'P0001' then
  perform pg_temp.assert_true(sqlerrm='website not found for checkout','supplied website identity fails closed');
 end;
 perform pg_temp.assert_true(not exists(select 1 from public.profiles where license_number='ATOMIC-CHECKOUT-ROLLBACK'),'failed atomic begin leaves no orphan profile');
end $atomic_checkout$;

-- Model the narrow initial live activation: both routes begin empty and use an explicit null predecessor.
do $live_activation$
declare starter_live uuid;pro_live uuid;confirmed_at timestamptz:='2026-09-04T14:15:42Z'::timestamptz;
begin
 starter_live:=public.install_saas_offer_contract('live','starter','price_1UBv1wEjgAPzsVsT16jTWfoX','prod_VCJf9cb38DrMux',7900,confirmed_at);
 pro_live:=public.install_saas_offer_contract('live','pro','price_1UBv4REjgAPzsVsTgJaCJbzu','prod_VCJhFaSe0Jrofq',12900,confirmed_at);
 perform pg_temp.assert_true(public.rotate_saas_offer_contract('live','starter',starter_live,null::text),'initial live Starter activation succeeds from no route');
 perform pg_temp.assert_true(public.rotate_saas_offer_contract('live','pro',pro_live,null::text),'initial live Pro activation succeeds from no route');
 perform pg_temp.assert_true(public.assert_saas_offer_readiness('live'),'initial live routes meet audited readiness');
 perform pg_temp.assert_true((select count(*)=2 from public.saas_offer_contracts where environment='live'and active_for_new_sales),'exactly two initial live routes are active');
end $live_activation$;

-- A stopped worker can prove Auth was never contacted despite a persisted intent.
-- Its existing retry settlement must remain claimable without operator redrive.
do $unsent$
declare owner_id uuid:=gen_random_uuid();site_id uuid:=gen_random_uuid();checkout_id uuid;
 fulfillment_id uuid:=gen_random_uuid();lease_id uuid:=gen_random_uuid();retry_lease uuid:=gen_random_uuid();
 claimed public.saas_checkout_fulfillment_outbox;retried public.saas_checkout_fulfillment_outbox;attempt integer;
begin
 insert into public.profiles(id,license_number,email,environment)values(owner_id,'OTP-UNSENT','otp-unsent@example.test','test');
 insert into public.websites(id,user_id,status,environment)values(site_id,owner_id,'draft','test');
 select r.checkout_session_id into strict checkout_id from public.reserve_checkout_intent(owner_id,site_id,'test','OTP-UNSENT','otp-unsent@example.test','Unsent Owner','Unsent Co','Portland','starter','pending_otp',null::timestamptz,null::text,null::text,null::jsonb,null::jsonb)r;
 insert into public.saas_checkout_fulfillment_outbox(id,checkout_session_id,profile_id,environment,recipient_email)
 values(fulfillment_id,checkout_id,owner_id,'test','otp-unsent@example.test');
 for attempt in 1..12 loop
  select * into strict claimed from public.claim_due_saas_checkout_fulfillment('test',lease_id,100) where id=fulfillment_id;
  if attempt%3<>0 then
   perform pg_temp.assert_true(public.begin_saas_checkout_fulfillment_dispatch(claimed.id,lease_id,claimed.fencing_token),'unsent attempt records its intent under the claim even if the reply is lost');
  end if;
  perform pg_temp.assert_true(not public.defer_saas_checkout_fulfillment(claimed.id,retry_lease,claimed.fencing_token,'wrong lease'),'another owner cannot settle the unsent attempt');
  perform pg_temp.assert_true(public.defer_saas_checkout_fulfillment(claimed.id,lease_id,claimed.fencing_token,'OTP dispatch stopped before provider call'),'known-unsent attempt defers with or without committed begin intent');
  perform pg_temp.assert_true(not public.defer_saas_checkout_fulfillment(claimed.id,lease_id,claimed.fencing_token,'duplicate settlement'),'duplicate settlement cannot return the provider budget twice');
  perform pg_temp.assert_true((select state='retry_wait' and provider_attempts=0 and provider_dispatch_started_at is null and accepted_at is null and failed_at is null and next_attempt_at>clock_timestamp() and isfinite(next_attempt_at) and lease_token is null and redrive_count=0 from public.saas_checkout_fulfillment_outbox where id=fulfillment_id),'repeated unsent attempts retain cooldown and do not exhaust provider budget');
  -- Advance only the fixture's due time; recovery state/fences are written by the real RPCs.
  update public.saas_checkout_fulfillment_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where id=fulfillment_id;
 end loop;
 select * into strict retried from public.claim_due_saas_checkout_fulfillment('test',retry_lease,100) where id=fulfillment_id;
 perform pg_temp.assert_true(retried.fencing_token=claimed.fencing_token+1 and retried.provider_dispatch_started_at is null,'retry owns a fresh fence without inherited dispatch evidence');
 perform pg_temp.assert_true(public.begin_saas_checkout_fulfillment_dispatch(retried.id,retry_lease,retried.fencing_token),'retry begins once through the original obligation');
 perform pg_temp.assert_true(public.complete_saas_checkout_fulfillment(retried.id,retry_lease,retried.fencing_token,true,true,null),'later confirmed Auth acceptance settles normally');
 perform pg_temp.assert_true((select state='accepted' and accepted_at is not null and redrive_count=0 from public.saas_checkout_fulfillment_outbox where id=fulfillment_id),'automatic recovery needs no operator decision');
end $unsent$;

do $rejected_budget$
declare owner_id uuid:=gen_random_uuid();site_id uuid:=gen_random_uuid();checkout_id uuid;
 fulfillment_id uuid:=gen_random_uuid();lease_id uuid:=gen_random_uuid();claimed public.saas_checkout_fulfillment_outbox;attempt integer;
begin
 insert into public.profiles(id,license_number,email,environment)values(owner_id,'OTP-REJECTED','otp-rejected@example.test','test');
 insert into public.websites(id,user_id,status,environment)values(site_id,owner_id,'draft','test');
 select r.checkout_session_id into strict checkout_id from public.reserve_checkout_intent(owner_id,site_id,'test','OTP-REJECTED','otp-rejected@example.test','Rejected Owner','Rejected Co','Portland','starter','pending_otp',null::timestamptz,null::text,null::text,null::jsonb,null::jsonb)r;
 insert into public.saas_checkout_fulfillment_outbox(id,checkout_session_id,profile_id,environment,recipient_email)
 values(fulfillment_id,checkout_id,owner_id,'test','otp-rejected@example.test');
 for attempt in 1..8 loop
  select * into strict claimed from public.claim_due_saas_checkout_fulfillment('test',lease_id,100) where id=fulfillment_id;
  perform pg_temp.assert_true(public.begin_saas_checkout_fulfillment_dispatch(claimed.id,lease_id,claimed.fencing_token),'real send reserves a provider attempt');
  perform pg_temp.assert_true(public.complete_saas_checkout_fulfillment(claimed.id,lease_id,claimed.fencing_token,false,true,'provider rejected OTP request'),'real rejection consumes the attempt');
  perform pg_temp.assert_true((select provider_attempts=attempt and state=case when attempt<8 then 'retry_wait' else 'failed' end from public.saas_checkout_fulfillment_outbox where id=fulfillment_id),'real sends keep the eight-attempt limit');
  update public.saas_checkout_fulfillment_outbox set next_attempt_at=clock_timestamp()-interval '1 second' where id=fulfillment_id;
 end loop;
 perform pg_temp.assert_true(not exists(select 1 from public.claim_due_saas_checkout_fulfillment('test',lease_id,100)where id=fulfillment_id),'exhausted actual sends are not automatically reclaimed');
end $rejected_budget$;

do $recovery$
declare owner_accepted uuid:=gen_random_uuid();owner_retry uuid:=gen_random_uuid();site_accepted uuid:=gen_random_uuid();site_retry uuid:=gen_random_uuid();checkout_accepted uuid;checkout_retry uuid;fulfillment_accepted uuid:=gen_random_uuid();fulfillment_retry uuid:=gen_random_uuid();operator_id uuid:=gen_random_uuid();operator_token text:=repeat('f',64);claim_lease uuid:=gen_random_uuid();
begin
 insert into public.profiles(id,license_number,email,environment)values(owner_accepted,'OTP-RECOVERY-ACCEPT','otp-recovery-accept@example.test','test'),(owner_retry,'OTP-RECOVERY-RETRY','otp-recovery-retry@example.test','test');
 insert into public.websites(id,user_id,status,environment)values(site_accepted,owner_accepted,'draft','test'),(site_retry,owner_retry,'draft','test');
 select r.checkout_session_id into strict checkout_accepted from public.reserve_checkout_intent(owner_accepted,site_accepted,'test','OTP-RECOVERY-ACCEPT','otp-recovery-accept@example.test','Accept Owner','Accept Co','Portland','starter','pending_otp',null::timestamptz,null::text,null::text,null::jsonb,null::jsonb)r;
 select r.checkout_session_id into strict checkout_retry from public.reserve_checkout_intent(owner_retry,site_retry,'test','OTP-RECOVERY-RETRY','otp-recovery-retry@example.test','Retry Owner','Retry Co','Portland','starter','pending_otp',null::timestamptz,null::text,null::text,null::jsonb,null::jsonb)r;
 insert into auth.users(id,email,confirmed_at)values(operator_id,'otp-recovery-admin@example.test',pg_catalog.clock_timestamp());
 insert into public.admin_principals(user_id,role,enabled,mfa_required)values(operator_id,'admin',true,true);
 insert into public.admin_sessions(token_hash,user_id,role,aal,auth_epoch,idle_expires_at,absolute_expires_at)values(operator_token,operator_id,'admin','aal2',1,pg_catalog.clock_timestamp()+interval '30 minutes',pg_catalog.clock_timestamp()+interval '12 hours');
 insert into public.saas_checkout_fulfillment_outbox(id,checkout_session_id,profile_id,environment,recipient_email,state,fencing_token,provider_attempts,provider_dispatch_started_at)values(fulfillment_accepted,checkout_accepted,owner_accepted,'test','otp-recovery-accept@example.test','delivery_unknown',10,1,pg_catalog.clock_timestamp()),(fulfillment_retry,checkout_retry,owner_retry,'test','otp-recovery-retry@example.test','delivery_unknown',20,1,pg_catalog.clock_timestamp());
 perform pg_temp.assert_true(not exists(select 1 from public.claim_due_saas_checkout_fulfillment('test',claim_lease,1)where id=fulfillment_retry),'delivery_unknown is excluded from automatic worker claims');
 perform pg_temp.assert_true((select state='delivery_unknown'and fencing_token=20 from public.saas_checkout_fulfillment_outbox where id=fulfillment_retry),'automatic claim left ambiguous delivery untouched');
 perform pg_temp.assert_true(public.resolve_saas_checkout_fulfillment_delivery_unknown(fulfillment_accepted,10,'accepted',operator_token,'Provider audit confirms that the OTP request was accepted.',pg_catalog.jsonb_build_object('provider','supabase-auth','decision','accepted')),'operator may record confirmed provider acceptance');
 perform pg_temp.assert_true((select state='accepted'and accepted_at is not null and provider_dispatch_started_at is not null and lease_token is null and lease_expires_at is null from public.saas_checkout_fulfillment_outbox where id=fulfillment_accepted),'acceptance resolution settles without a resend');
 perform pg_temp.assert_true(public.resolve_saas_checkout_fulfillment_delivery_unknown(fulfillment_retry,20,'retry',operator_token,'Provider audit cannot establish acceptance; authorize one controlled resend.',pg_catalog.jsonb_build_object('provider','supabase-auth','decision','retry','ticket','OTP-1')),'operator may authorize a bounded resend after reconciliation');
 perform pg_temp.assert_true((select state='retry_wait'and redrive_count=1 and provider_dispatch_started_at is null and accepted_at is null and lease_token is null and lease_expires_at is null from public.saas_checkout_fulfillment_outbox where id=fulfillment_retry),'retry resolution clears the prior ambiguous dispatch and remains worker-owned');
 perform pg_temp.assert_true((select count(*)=2 from public.saas_checkout_fulfillment_resolution_audit where fulfillment_id in(fulfillment_accepted,fulfillment_retry)and actor_user_id=operator_id),'each resolution writes immutable operator audit evidence');
 perform pg_temp.assert_true(exists(select 1 from public.claim_due_saas_checkout_fulfillment('test',claim_lease,1)where id=fulfillment_retry and fencing_token=21),'only an explicit resolution returns a delivery to the worker under a new fence');
 perform pg_temp.assert_true((select state='processing'and fencing_token=21 and provider_dispatch_started_at is null from public.saas_checkout_fulfillment_outbox where id=fulfillment_retry),'reclaimed resolved delivery has no inherited provider dispatch intent');
end $recovery$;
rollback;
\echo 'saas-checkout-fulfillment-recovery: passed'
