-- Persist refund/payment correlation anomalies in a separately committed preflight.
-- The subsequent money-authority closure aborts while unresolved rows remain.
insert into public.booking_cutover_quarantine(profile_id,environment,entity_kind,entity_id,reason_code,evidence_hash)
select r.profile_id,r.environment,'booking_refund',r.id::text,'refund_payment_correlation_mismatch',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.to_jsonb(r)::text,'UTF8'),'sha256'),'hex')
from public.booking_refunds r left join public.booking_payments p on p.id=r.payment_id and p.appointment_id=r.appointment_id and p.profile_id=r.profile_id and p.environment=r.environment and p.stripe_account_id=r.stripe_account_id and p.payment_intent_id=r.payment_intent_id
where p.id is null and not exists(select 1 from public.booking_cutover_quarantine q where q.entity_kind='booking_refund'and q.entity_id=r.id::text and q.reason_code='refund_payment_correlation_mismatch'and q.resolved_at is null);
