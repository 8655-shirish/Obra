-- Recovery audit rows are written only inside the AAL2-admin-gated SECURITY DEFINER RPC.
-- A later blanket grant accidentally reopened direct service-role DML and allowed forged history.
revoke all on table public.saas_checkout_fulfillment_resolution_audit
from public, anon, authenticated, service_role, booking_worker;
