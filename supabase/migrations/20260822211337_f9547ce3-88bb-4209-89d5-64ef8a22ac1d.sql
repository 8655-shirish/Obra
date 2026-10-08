-- Explicitly lock down service-role-only SECURITY DEFINER functions.
-- The previous migration already granted execute only to service_role and revoked
-- from public, but the Supabase linter flags these unless anon/authenticated are
-- explicitly denied execute as well.

revoke execute on function public.enqueue_site_generation_job(uuid, text, jsonb, boolean) from anon, authenticated;
revoke execute on function public.fork_website_version_with_media(uuid, uuid) from anon, authenticated;
revoke execute on function public.publish_website_version_atomic(uuid, uuid, jsonb, jsonb) from anon, authenticated;
revoke execute on function public.plan_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) from anon, authenticated;
revoke execute on function public.settle_generation_media_slot(uuid, uuid, integer, text, text, text) from anon, authenticated;
revoke execute on function public.claim_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text) from anon, authenticated;
revoke execute on function public.record_generation_media_operation(uuid, uuid, integer, text, text) from anon, authenticated;
revoke execute on function public.insert_generated_website_version(uuid, jsonb, uuid, integer) from anon, authenticated;
revoke execute on function public.insert_generated_website_version_with_slots(uuid, jsonb, uuid, integer, uuid[]) from anon, authenticated;
revoke execute on function public.record_generation_media_slot(uuid, uuid, integer, text, text, text, text, boolean, boolean, text, text, integer, integer, text, text, text) from anon, authenticated;