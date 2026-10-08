DO $$
DECLARE
  v_profile uuid := '20b8ab75-faaf-405d-bfc1-68f45830d43e';
  v_website uuid := '84c1b709-c922-490a-b792-930f54382837';
  v_sub uuid := '81759016-1825-46dc-896b-df31b0ab6cf6';
  v_auth uuid := '2ad70a40-d76b-4e57-bf3e-e9d1e7874895';
  v_checkout uuid;
BEGIN
  ALTER TABLE public.checkout_sessions DISABLE TRIGGER USER;

  INSERT INTO public.checkout_sessions(
    profile_id, website_id, environment, license_number, email, full_name, business_name, city,
    plan, subscription_id, status, payment_evidence_kind, template_slug, context_json
  ) VALUES (
    v_profile, v_website, 'live', 'C-9900001', 'crce.8655.it@gmail.com',
    'Test Landscaper', 'Test Landscaping Co', 'San Diego',
    'pro', v_sub, 'pending_otp', 'legacy_post_payment', 'landscape',
    jsonb_build_object('source', 'post_checkout', 'websiteId', v_website::text)
  ) RETURNING id INTO v_checkout;

  ALTER TABLE public.checkout_sessions ENABLE TRIGGER USER;

  PERFORM public.grant_verified_website_entitlement(v_checkout, v_website, v_auth);

  UPDATE public.websites SET template_slug = 'landscape' WHERE id = v_website;

  PERFORM public.acknowledge_booking_order(v_website, v_profile, 'live', v_auth);
END $$;