\set ON_ERROR_STOP on
\echo 'video-cta: deterministic fixtures'
begin;
create or replace function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is not true then raise exception 'assertion failed: %', message; end if; end $$;

insert into public.profiles (id,license_number,email) values ('10000000-0000-0000-0000-000000000001','VIDEO-CTA-TEST','video-cta@example.invalid');
insert into public.websites (id,user_id,status) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','draft');
insert into public.website_versions (id,website_id,version_number,config_json,variant_key,status) values
('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,
'{"generator":"unified-site-agent","generatorSchemaVersion":3,"mediaManifest":{"slots":[{"slotId":"hero-still","assetId":"still-sha256","mimeType":"image/webp","role":"hero","origin":"generated","required":true,"proofEligible":false,"storagePath":"site-media/still.webp"}]}}','v1','selected');
insert into public.website_version_media_slots (version_id,website_id,slot_id,asset_id,mime_type,role,provenance,required,storage_path,proof_eligible) values
('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','hero-still','still-sha256','image/webp','hero','generated',true,'site-media/still.webp',false);

create temporary table first_enqueue as select * from public.enqueue_add_video_job('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',0);
create temporary table replay_enqueue as select * from public.enqueue_add_video_job('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001',0);
select pg_temp.assert_true((select f.job_id=r.job_id and f.chain_id=r.chain_id and f.target_version_id=r.target_version_id from first_enqueue f cross join replay_enqueue r),'enqueue replay identities');
select pg_temp.assert_true((select count(*)=1 from public.background_jobs where request_id='40000000-0000-0000-0000-000000000001'),'enqueue replay row count');
update public.background_jobs set status='running',attempts=1,locked_by='db-test',locked_at=now() where id=(select job_id from first_enqueue);

create temporary table video_slot as select public.checkpoint_add_video_plan((select job_id from first_enqueue),'20000000-0000-0000-0000-000000000001',1,'{"sourceSlotId":"hero-still","placement":"inline","motionPreset":"subtle-pan","targetSection":"hero"}','plan-sha256','hero-video','hero-still','hero-still') id;
select pg_temp.assert_true((select id=public.checkpoint_add_video_plan((select job_id from first_enqueue),'20000000-0000-0000-0000-000000000001',1,'{"sourceSlotId":"hero-still","placement":"inline","motionPreset":"subtle-pan","targetSection":"hero"}','plan-sha256','hero-video','hero-still','hero-still') from video_slot),'checkpoint replay identity');
select public.claim_generation_media_slot((select job_id from first_enqueue),'20000000-0000-0000-0000-000000000001',1,'hero-video','video','atmosphere','generated',true,false,'hero-still','hero-still');
select public.record_generation_media_slot((select job_id from first_enqueue),'20000000-0000-0000-0000-000000000001',1,'hero-video','video','atmosphere','generated',true,false,'site-media/video.mp4','video/mp4',1280,720,'video-sha256','hero-still','hero-still',1048576,4000,'h264','high',false,null,'mp4box-2.4.1');

do $$ declare rev bigint; attachments bigint; events bigint; slot_status text; begin
 select revision into rev from public.website_versions where id='30000000-0000-0000-0000-000000000001';
 select count(*) into attachments from public.website_version_media_slots where version_id='30000000-0000-0000-0000-000000000001';
 select count(*) into events from public.website_edit_events where version_id='30000000-0000-0000-0000-000000000001';
 select status into slot_status from public.site_generation_media_slots where id=(select id from video_slot);
 begin
  perform public.commit_add_video_to_version((select job_id from first_enqueue),'20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,99,'candidate-sha256','{"generator":"unified-site-agent","generatorSchemaVersion":3,"mediaManifest":{"slots":[]}}',(select id from video_slot),'{}');
  raise exception 'expected revision conflict';
 exception when others then if sqlerrm not like '%revision conflict%' then raise; end if; end;
 perform pg_temp.assert_true((select revision=rev from public.website_versions where id='30000000-0000-0000-0000-000000000001'),'stale call changed revision');
 perform pg_temp.assert_true((select count(*)=attachments from public.website_version_media_slots where version_id='30000000-0000-0000-0000-000000000001'),'stale call changed attachments');
 perform pg_temp.assert_true((select count(*)=events from public.website_edit_events where version_id='30000000-0000-0000-0000-000000000001'),'stale call wrote event');
 perform pg_temp.assert_true((select status=slot_status from public.site_generation_media_slots where id=(select id from video_slot)),'stale call changed ledger');
end $$;

-- Force a failure at the final job update, after all other aggregate writes, and prove the RPC rolls them back.
create function pg_temp.reject_completion() returns trigger language plpgsql as $$ begin
 if new.request_id='40000000-0000-0000-0000-000000000001' and new.status='completed' then raise exception 'forced late finalizer failure'; end if;
 return new;
end $$;
create trigger reject_video_cta_completion before update on public.background_jobs for each row execute function pg_temp.reject_completion();
do $$ begin
 begin
  perform public.commit_add_video_to_version((select job_id from first_enqueue),'20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,0,'candidate-sha256','{"generator":"unified-site-agent","generatorSchemaVersion":3,"mediaManifest":{"slots":[{"slotId":"hero-still","assetId":"still-sha256","mimeType":"image/webp","role":"hero","origin":"generated","required":true,"proofEligible":false,"storagePath":"site-media/still.webp"},{"slotId":"hero-video","assetId":"video-sha256","mimeType":"video/mp4","role":"atmosphere","origin":"generated","required":true,"proofEligible":false,"sourceSlotId":"hero-still","posterSlotId":"hero-still","storagePath":"site-media/video.mp4","placement":"inline","motionPreset":"subtle-pan","targetSection":"hero"}]}}',(select id from video_slot),'{"test":"rollback"}');
  raise exception 'expected forced finalizer failure';
 exception when others then if sqlerrm not like '%forced late finalizer failure%' then raise; end if; end;
 perform pg_temp.assert_true((select revision=0 from public.website_versions where id='30000000-0000-0000-0000-000000000001'),'late failure changed revision');
 perform pg_temp.assert_true((select count(*)=1 from public.website_version_media_slots where version_id='30000000-0000-0000-0000-000000000001'),'late failure attached video');
 perform pg_temp.assert_true((select count(*)=0 from public.website_edit_events where version_id='30000000-0000-0000-0000-000000000001'),'late failure wrote event');
 perform pg_temp.assert_true((select status='ready' and version_id is null from public.site_generation_media_slots where id=(select id from video_slot)),'late failure changed ledger');
 perform pg_temp.assert_true((select status='running' and result_json is null from public.background_jobs where id=(select job_id from first_enqueue)),'late failure settled job');
end $$;
drop trigger reject_video_cta_completion on public.background_jobs;

create temporary table final_result as select public.commit_add_video_to_version((select job_id from first_enqueue),'20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,0,'candidate-sha256','{"generator":"unified-site-agent","generatorSchemaVersion":3,"mediaManifest":{"slots":[{"slotId":"hero-still","assetId":"still-sha256","mimeType":"image/webp","role":"hero","origin":"generated","required":true,"proofEligible":false,"storagePath":"site-media/still.webp"},{"slotId":"hero-video","assetId":"video-sha256","mimeType":"video/mp4","role":"atmosphere","origin":"generated","required":true,"proofEligible":false,"sourceSlotId":"hero-still","posterSlotId":"hero-still","storagePath":"site-media/video.mp4","placement":"inline","motionPreset":"subtle-pan","targetSection":"hero"}]}}',(select id from video_slot),'{"test":"finalize"}') result;
create temporary table final_replay as select public.commit_add_video_to_version((select job_id from first_enqueue),'20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,0,'candidate-sha256','{}',(select id from video_slot),'{}') result;
select pg_temp.assert_true((select a.result=b.result from final_result a cross join final_replay b),'finalizer replay result');
select pg_temp.assert_true((select revision=1 from public.website_versions where id='30000000-0000-0000-0000-000000000001'),'finalizer revision once');
select pg_temp.assert_true((select count(*)=2 from public.website_version_media_slots where version_id='30000000-0000-0000-0000-000000000001'),'finalizer attachment once');
select pg_temp.assert_true((select count(*)=1 from public.website_edit_events where version_id='30000000-0000-0000-0000-000000000001' and category='add_video'),'finalizer event once');
select pg_temp.assert_true((select status='completed' from public.background_jobs where id=(select job_id from first_enqueue)),'finalizer job completion');

select pg_temp.assert_true(has_function_privilege('service_role','public.enqueue_add_video_job(uuid,uuid,uuid,bigint)','EXECUTE'),'service enqueue grant');
select pg_temp.assert_true(not has_function_privilege('anon','public.enqueue_add_video_job(uuid,uuid,uuid,bigint)','EXECUTE'),'anon enqueue revoke');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.enqueue_add_video_job(uuid,uuid,uuid,bigint)','EXECUTE'),'authenticated enqueue revoke');
select pg_temp.assert_true(has_function_privilege('service_role','public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)','EXECUTE'),'service finalizer grant');
select pg_temp.assert_true(not has_function_privilege('anon','public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)','EXECUTE'),'anon finalizer revoke');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.commit_add_video_to_version(uuid,uuid,uuid,integer,bigint,text,jsonb,uuid,jsonb)','EXECUTE'),'authenticated finalizer revoke');
select pg_temp.assert_true(has_table_privilege('service_role','public.site_generation_media_slots','SELECT,INSERT,UPDATE,DELETE'),'service ledger grants');
select pg_temp.assert_true(not has_table_privilege('anon','public.site_generation_media_slots','SELECT'),'anon ledger revoke');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.website_version_media_slots','SELECT'),'authenticated attachment revoke');
rollback;
do $$ begin
 if exists(select 1 from public.profiles where id='10000000-0000-0000-0000-000000000001') then raise exception 'assertion failed: fixture rollback'; end if;
end $$;
\echo 'video-cta: all assertions passed'
