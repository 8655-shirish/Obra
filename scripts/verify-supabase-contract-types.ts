import type { Database, Json } from "../src/integrations/supabase/semantic-types";
import type { Database as SchemaDatabase } from "../src/integrations/supabase/types";

type Functions = Database["public"]["Functions"];
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type Has<K extends PropertyKey, O> = K extends keyof O ? true : false;
type _ClaimedBackgroundJobShape = Assert<
  Equal<
    SchemaDatabase["public"]["Functions"]["claim_next_background_job"]["Returns"][number],
    SchemaDatabase["public"]["Tables"]["background_jobs"]["Row"]
  >
>;
type _OwnedBackgroundJobShape = Assert<
  Equal<
    SchemaDatabase["public"]["Functions"]["require_epoch2_generation_media_owner"]["Returns"],
    SchemaDatabase["public"]["Tables"]["background_jobs"]["Row"]
  >
>;

type RequiredRpcs =
  | "begin_saas_checkout"
  | "reserve_booking_hold"
  | "transition_appointment"
  | "submit_starter_website_lead"
  | "acknowledge_booking_order"
  | "save_shared_booking_availability"
  | "reserve_checkout_intent"
  | "finalize_paid_checkout"
  | "expire_checkout_intent"
  | "grant_verified_website_entitlement"
  | "project_saas_subscription_status"
  | "apply_provider_appointment_event"
  | "apply_saas_provider_event"
  | "ingest_provider_event"
  | "complete_outbox_appointment_command"
  | "record_lead_governance_event"
  | "claim_outbox_command"
  | "complete_outbox_command"
  | "claim_provider_event"
  | "complete_provider_event"
  | "claim_booking_attachment_scan"
  | "complete_booking_attachment_scan"
  | "mark_booking_attachment_uploaded"
  | "offboard_starter_leads"
  | "purge_retained_leads"
  | "persist_google_calendar_configuration"
  | "reconcile_google_calendar_connection"
  | "clear_google_calendar_connection"
  | "requeue_booking_calendar_manual_repair";
type _AllRpcsExist = Assert<Equal<RequiredRpcs, Extract<RequiredRpcs, keyof Functions>>>;
type _TransitionArgs = Assert<
  Equal<
    Functions["transition_appointment"]["Args"],
    {
      p_appointment_id: string;
      p_profile_id: string;
      p_environment: string;
      p_expected_version: number;
      p_operation_type: string;
      p_client_request_id: string;
      p_request_hash: string;
      p_payload?: Json;
    }
  >
>;
type _TransitionReturns = Assert<
  Equal<
    Functions["transition_appointment"]["Returns"],
    Database["public"]["Tables"]["appointments"]["Row"]
  >
>;
type _SaveOverridesRequired = Assert<
  Equal<Functions["save_shared_booking_availability"]["Args"]["p_overrides"], Json>
>;
type _ExpiryReturns = Assert<Equal<Functions["expire_checkout_intent"]["Returns"], boolean>>;
type _BeginCheckoutArgs = Assert<
  Equal<
    Functions["begin_saas_checkout"]["Args"],
    {
      p_attempt_id: string;
      p_business_name: string;
      p_city: string;
      p_email: string;
      p_environment: string;
      p_full_name: string;
      p_legal_acceptance_ip_hash: string;
      p_legal_acceptance_user_agent: string;
      p_legal_accepted_at: string;
      p_legal_document_versions: Json;
      p_license_number: string;
      p_plan: string;
      p_website_id: string | null;
    }
  >
>;
type _BeginCheckoutReturns = Assert<
  Equal<
    Functions["begin_saas_checkout"]["Returns"][number],
    {
      checkout_email: string;
      checkout_plan: string;
      checkout_session_id: string;
      checkout_status: string;
      disposition: string;
      offer_contract_version: number;
      offer_currency: string;
      offer_interval: string;
      offer_interval_count: number;
      offer_price_id: string;
      offer_product_id: string;
      offer_unit_amount_minor: number;
      profile_id: string;
      provider_session_id: string | null;
      subscription_id: string;
      website_id: string;
    }
  >
>;
type _ProjectionReturns = Assert<
  Equal<Functions["project_saas_subscription_status"]["Returns"], boolean>
>;
type _AttachmentFence = Assert<
  Equal<Functions["claim_booking_attachment_scan"]["Returns"], number>
>;
type _SaasApplyArgs = Assert<
  Equal<
    Functions["apply_saas_provider_event"]["Args"],
    {
      p_event_id: string;
      p_fencing_token: number;
      p_lease_token: string;
      p_projection: Json;
      p_source_created_at: string;
    }
  >
>;
type _OutboxApplyReturns = Assert<
  Equal<
    Functions["complete_outbox_appointment_command"]["Returns"],
    Database["public"]["Tables"]["appointments"]["Row"]
  >
>;
type _IngestArgs = Assert<
  Equal<
    Functions["ingest_provider_event"]["Args"],
    {
      p_account_context: string | null;
      p_api_version: string | null;
      p_destination: string | null;
      p_environment: string;
      p_event_family: string;
      p_event_id: string;
      p_event_type: string;
      p_livemode: boolean;
      p_payload: Json;
      p_payload_hash: string;
      p_profile_id: string | null;
      p_provider: string;
      p_signature_timestamp?: string | null;
    }
  >
>;
type _IngestReturns = Assert<Equal<Functions["ingest_provider_event"]["Returns"], string>>;
type _GovernanceReturns = Assert<
  Equal<Functions["record_lead_governance_event"]["Returns"], number>
>;
type _LegacySnapshotStatus = Assert<
  Equal<Database["public"]["Tables"]["leads"]["Row"]["snapshot_status"], string>
>;
type _LegacySnapshotVersion = Assert<
  Equal<Database["public"]["Tables"]["leads"]["Row"]["snapshot_version"], number | null>
>;
type _GoogleRevision = Assert<
  Equal<Database["public"]["Tables"]["calendar_connections"]["Row"]["connection_revision"], number>
>;
type _CalendarRepairArgs = Assert<
  Equal<
    Functions["requeue_booking_calendar_manual_repair"]["Args"],
    {
      p_link_id: string;
      p_expected_generation: number;
      p_actor_token_hash: string;
      p_reason: string;
      p_resolution?: Json;
    }
  >
>;
type _CalendarRepairReturns = Assert<
  Equal<Functions["requeue_booking_calendar_manual_repair"]["Returns"], boolean>
>;

type _BookingOutboxEnvironmentArgs = Assert<
  Equal<
    Functions["claim_due_booking_outbox"]["Args"],
    { p_environment: string; p_lease_token: string; p_limit?: number }
  >
>;

type _BookingSessionExpiryClaimArgs = Assert<
  Equal<
    Functions["claim_due_booking_session_expiries_v3"]["Args"],
    { p_environment: string; p_lease_token: string; p_limit?: number }
  >
>;
type _BookingSessionExpiryRenewArgs = Assert<
  Equal<
    Functions["renew_booking_session_expiry_v3"]["Args"],
    {
      p_payment_id: string;
      p_lease_token: string;
      p_fencing_token: number;
      p_lease_seconds?: number;
    }
  >
>;
type _BookingRefundFailureArgs = Assert<
  Equal<
    Functions["fail_booking_refund_command_v3"]["Args"],
    {
      p_command_id: string;
      p_lease_token: string;
      p_fencing_token: number;
      p_retry_delay_seconds?: number;
      p_retryable: boolean;
      p_safe_error: string;
    }
  >
>;
type _BookingRefundFailureReturns = Assert<
  Equal<Functions["fail_booking_refund_command_v3"]["Returns"], boolean>
>;
type _BookingPaymentFailureContract = Assert<
  Equal<
    Functions["fail_booking_payment_event_v3"],
    {
      Args: {
        p_event_id: string;
        p_fencing_token: number;
        p_lease_token: string;
        p_retry_delay_seconds?: number;
        p_retryable: boolean;
        p_safe_error: string;
      };
      Returns: boolean;
    }
  >
>;
type _BookingExpiryFailureContract = Assert<
  Equal<
    Functions["fail_booking_session_expiry_v3"],
    {
      Args: {
        p_fencing_token: number;
        p_lease_token: string;
        p_payment_id: string;
        p_retry_delay_seconds?: number;
        p_retryable: boolean;
        p_safe_error: string;
      };
      Returns: boolean;
    }
  >
>;
type _BookingAttachmentCleanupAuthorization = Assert<
  Equal<
    Functions["authorize_booking_attachment_cleanup_v3"]["Args"],
    {
      p_attachment_id: string;
      p_generation: number;
      p_environment: string;
      p_lease_token: string;
      p_fencing_token: number;
    }
  >
>;
type _BookingInboxRenewArgs = Assert<
  Equal<
    Functions["renew_booking_payment_event_v3"]["Args"],
    { p_event_id: string; p_lease_token: string; p_fencing_token: number; p_lease_seconds?: number }
  >
>;
type _BookingFamilyRenewArgs = Assert<
  Equal<
    Functions["renew_booking_worker_family_v3"]["Args"],
    {
      p_environment: string;
      p_family: string;
      p_lease_token: string;
      p_fencing_token: number;
      p_lease_seconds?: number;
    }
  >
>;

type _GooglePermissionEvidence = Assert<
  Equal<
    Database["public"]["Tables"]["calendar_selections"]["Row"]["permission_verified_at"],
    string | null
  >
>;
type _ProviderHealth = Assert<
  Equal<Database["public"]["Tables"]["pipedream_bindings"]["Row"]["last_health_at"], string | null>
>;
type _GovernanceTables = Assert<Has<"lead_governance_events", Database["public"]["Tables"]>>;
type _RetentionTables = Assert<Has<"data_retention_policies", Database["public"]["Tables"]>>;
type _SupersessionRpc = Assert<Has<"supersede_and_enqueue_site_generation_job_owned", Functions>>;
type _RetiredUnlinkedSupersession = Assert<
  Equal<Has<"supersede_site_generation_epoch", Functions>, false>
>;
type _ReadyReservationRequired = Assert<
  Equal<Functions["record_generation_media_slot_epoch"]["Args"]["p_reservation_id"], string>
>;
type _ReadySlotClaimRequired = Assert<
  Equal<Functions["record_generation_media_slot_epoch"]["Args"]["p_slot_claim_epoch"], number>
>;
type _AddVideoYieldWebsiteFence = Assert<
  Equal<Functions["yield_add_video_stage"]["Args"]["p_website_id"], string>
>;
type _BackgroundSettlementAttemptsArg = Assert<
  Equal<
    Functions["settle_background_job"]["Args"],
    {
      p_attempts: number;
      p_completed_at: string;
      p_error_message: string;
      p_job_id: string;
      p_payload_json: Json;
      p_progress_pct: number;
      p_result_json: Json;
      p_status: string;
      p_status_message: string;
    }
  >
>;

type _GlobalGenerationProviderLimit = Assert<
  Equal<
    Database["public"]["Tables"]["generation_media_provider_limits"]["Row"]["tenant_id"],
    string | null
  >
>;
type _InterruptAddVideoArgs = Assert<
  Equal<
    Functions["interrupt_add_video_job_epoch"]["Args"],
    {
      p_job_id: string;
      p_job_attempts: number;
      p_claim_epoch: number;
      p_runner_id: string;
      p_cause_code: string;
      p_retry_at: string;
    }
  >
>;

type _SupersededAt = Assert<
  Equal<Database["public"]["Tables"]["background_jobs"]["Row"]["superseded_at"], string | null>
>;

type _AppointmentCapacityRange = Assert<
  Equal<Database["public"]["Tables"]["appointments"]["Row"]["capacity_range"], string>
>;
type _AppointmentCapacityRangeInsert = Assert<
  Equal<Database["public"]["Tables"]["appointments"]["Insert"]["capacity_range"], string>
>;
type _AppointmentCapacityRangeUpdate = Assert<
  Equal<
    Database["public"]["Tables"]["appointments"]["Update"]["capacity_range"],
    string | undefined
  >
>;
type _ProviderAppointmentCapacityRange = Assert<
  Equal<Functions["apply_provider_appointment_event"]["Returns"]["capacity_range"], string>
>;
type _CancelAppointmentCapacityRange = Assert<
  Equal<Functions["cancel_contractor_booking"]["Returns"]["capacity_range"], string>
>;
type _OutboxAppointmentCapacityRange = Assert<
  Equal<Functions["complete_outbox_appointment_command"]["Returns"]["capacity_range"], string>
>;
type _TransitionAppointmentCapacityRange = Assert<
  Equal<Functions["transition_appointment"]["Returns"]["capacity_range"], string>
>;
type _BookingCutoverCapturedXid = Assert<
  Equal<
    Database["public"]["Tables"]["booking_cutover_preflights_v3"]["Row"]["captured_xid"],
    unknown
  >
>;
type BookingPaymentsAppointmentRelationship = Extract<
  Database["public"]["Tables"]["booking_payments"]["Relationships"][number],
  { foreignKeyName: "booking_payments_appointment_id_profile_id_environment_fkey" }
>;
type _BookingPaymentsAppointmentCardinality = Assert<
  Equal<BookingPaymentsAppointmentRelationship["isOneToOne"], false>
>;
type _RotateOfferExpectedPrice = Assert<
  Equal<
    Functions["rotate_saas_offer_contract"]["Args"]["p_expected_current_price_id"],
    string | null
  >
>;

// Column-name verification cannot check SQL nullability, defaults, arrays, or RPC overloads.
type SchemaTables = SchemaDatabase["public"]["Tables"];
type SchemaFunctions = SchemaDatabase["public"]["Functions"];
type LifetimeColumns = {
  appointments: { calendar_destination_epoch_id: string | null };
  background_job_cron_requests: { worker_counts: Json | null; worker_outcome: string | null };
  booking_calendar_effect_attempts: {
    connection_revision: number | null;
    intended_content_sha256: string | null;
  };
  booking_calendar_repair_audit: {
    appointment_id: string | null;
    evidence: Json | null;
    request_id: string | null;
  };
  booking_notifications: {
    dispatch_appointment: Json | null;
    dispatch_payload: string | null;
    first_dispatch_at: string | null;
    replay_deadline_at: string | null;
  };
  booking_provider_account_disconnects_v3: {
    attempts: number;
    connection_id: string | null;
    dispatch_state: string;
    dispatched_at: string | null;
    failure_reason: string | null;
    fencing_token: number;
    lease_expires_at: string | null;
    lease_token: string | null;
    requested_connection_revision: number | null;
    retry_at: string | null;
    unresolved_setup_calendar_id: string | null;
    unresolved_setup_operation_id: string | null;
  };
  calendar_connections: {
    action_notice: Json;
    action_notice_due_at: string | null;
    action_notice_fencing_token: number;
    action_notice_lease_expires_at: string | null;
    action_notice_lease_token: string | null;
    calendar_create_blocked_at: string | null;
    calendar_create_verified_at: string | null;
    calendar_delete_blocked_at: string | null;
    calendar_delete_verified_at: string | null;
    calendar_probe_insert_blocked_at: string | null;
    calendar_probe_insert_verified_at: string | null;
    calendar_write_blocked_at: string | null;
    calendar_write_verified_at: string | null;
    connect_actor_auth_user_id: string | null;
    connect_completed_at: string | null;
    connect_expected_revision: number | null;
    connect_expected_setup_key: string | null;
    connect_expires_at: string | null;
    connect_operation_id: string | null;
    connect_started_at: string | null;
    owner_verification_requested_at: string | null;
    setup_account_display_name: string | null;
    setup_account_email: string | null;
    setup_account_id: string | null;
    setup_actor_auth_user_id: string | null;
    setup_attempts: number;
    setup_calendar_id: string | null;
    setup_calendars: Json | null;
    setup_completed_at: string | null;
    setup_connect_operation_id: string | null;
    setup_expected_revision: number | null;
    setup_failure_reason: string | null;
    setup_fencing_token: number;
    setup_lease_expires_at: string | null;
    setup_lease_token: string | null;
    setup_operation_id: string | null;
    setup_probe_account_id: string | null;
    setup_probe_calendar_id: string | null;
    setup_probe_delete_started_at: string | null;
    setup_probe_id: string | null;
    setup_probe_started_at: string | null;
    setup_probe_state: string;
    setup_probe_write_verified_at: string | null;
    setup_purpose: string;
    setup_read_verified_at: string | null;
    setup_retry_at: string | null;
    setup_write_verified_at: string | null;
  };
  calendar_event_links: {
    failure_code: string | null;
    failure_kind: string | null;
    failure_observed_at: string | null;
    snapshot_connection_revision: number | null;
  };
  pipedream_bindings: {
    deployment_candidate_trigger_id: string | null;
    deployment_dispatch_fencing_token: number | null;
    deployment_dispatch_lease_token: string | null;
    deployment_dispatched_at: string | null;
    deployment_receipt: Json | null;
    observed_component_key: string | null;
    observed_component_version: string | null;
    pending_trigger_deletions: string[];
    reconciliation_allow_repair: boolean;
    reconciliation_last_attempt_at: string | null;
    reconciliation_reason: string | null;
    retired_deployment: Json | null;
    retired_trigger_ids: string[];
  };
  stripe_connected_accounts: {
    reconciliation_attempts: number;
    reconciliation_last_attempt_at: string | null;
    reconciliation_safe_error: string | null;
  };
};
type LifetimeShape<Shape extends "Row" | "Insert" | "Update"> = {
  [Table in keyof LifetimeColumns]: Pick<
    SchemaTables[Table][Shape],
    Extract<keyof LifetimeColumns[Table], keyof SchemaTables[Table][Shape]>
  >;
};
type _LifetimeRows = Assert<Equal<LifetimeShape<"Row">, LifetimeColumns>>;
type _LifetimeInsertDefaults = Assert<
  Equal<
    LifetimeShape<"Insert">,
    { [Table in keyof LifetimeColumns]: Partial<LifetimeColumns[Table]> }
  >
>;
type _LifetimeUpdates = Assert<Equal<LifetimeShape<"Update">, LifetimeShape<"Insert">>>;

type LifetimeRowRpcs = {
  apply_leased_stripe_connect_account_projection: "stripe_connected_accounts";
  apply_pipedream_trigger_projection: "pipedream_bindings";
  apply_provider_appointment_event: "appointments";
  apply_stripe_connect_account_projection: "stripe_connected_accounts";
  authorize_google_calendar_connect_completion: "calendar_connections";
  cancel_contractor_booking: "appointments";
  clear_google_calendar_connection: "calendar_connections";
  complete_outbox_appointment_command: "appointments";
  lock_booking_calendar_claim: "calendar_event_links";
  lock_google_calendar_binding: "pipedream_bindings";
  lock_google_calendar_disconnect: "booking_provider_account_disconnects_v3";
  persist_google_calendar_configuration: "calendar_connections";
  reconcile_google_calendar_connection: "calendar_connections";
  reserve_pipedream_trigger_deployment: "pipedream_bindings";
  reserve_stripe_connect_account: "stripe_connected_accounts";
  retire_pipedream_trigger: "pipedream_bindings";
  transition_appointment: "appointments";
};
type _LifetimeCompositeReturns = Assert<
  Equal<
    { [Rpc in keyof LifetimeRowRpcs]: SchemaFunctions[Rpc]["Returns"] },
    { [Rpc in keyof LifetimeRowRpcs]: SchemaTables[LifetimeRowRpcs[Rpc]]["Row"] }
  >
>;
type _StripeRefreshRows = Assert<
  Equal<
    Functions["claim_stripe_connect_account_refresh"]["Returns"],
    SchemaTables["stripe_connected_accounts"]["Row"][]
  >
>;
type _StripeDueRefreshRows = Assert<
  Equal<
    Functions["claim_due_stripe_connect_accounts"]["Returns"],
    SchemaTables["stripe_connected_accounts"]["Row"][]
  >
>;
type _ScopedGoogleClaim = Assert<
  Equal<
    Functions["claim_due_pipedream_bindings"],
    {
      Args: {
        p_environment: string;
        p_exclude_binding_ids?: string[];
        p_lease_seconds?: number;
        p_lease_token: string;
        p_limit?: number;
      };
      Returns: Json[];
    }
  >
>;
type LifetimeRpcArgs = {
  apply_pipedream_trigger_projection: {
    p_active: boolean;
    p_binding_id: string;
    p_component_key: string;
    p_component_version: string;
    p_connection_id: string;
    p_deployed_trigger_id: string;
    p_deployment_operation_id: string;
    p_environment: string;
    p_expected_connection_revision: number;
    p_fencing_token: number;
    p_lease_token: string;
    p_observed_component_key: string;
    p_observed_component_version: string;
    p_pipedream_account_id: string;
    p_profile_id: string;
    p_provider_updated_at: string;
    p_safe_error: string;
    p_selected_calendar_ids: Json;
    p_signing_key: string;
    p_webhook_correlation_id: string;
    p_webhook_id: string;
  };
  claim_google_calendar_setup_probe: {
    p_environment: string;
    p_exclude_operation_ids?: string[];
    p_lease_token: string;
    p_profile_id?: string;
  };
  claim_saved_google_calendar_verification: {
    p_allow_repair?: boolean;
    p_environment: string;
    p_lease_seconds?: number;
    p_lease_token: string;
    p_profile_id: string;
  };
  complete_booking_provider_account_disconnect_v3: {
    p_disconnect_id: string;
    p_environment: string;
    p_fencing_token: number;
    p_lease_token: string;
    p_profile_id: string;
    p_provider_account_id: string;
  };
  complete_pipedream_stale_trigger_cleanup: {
    p_binding_id: string;
    p_deployed_trigger_id: string;
    p_fencing_token: number;
    p_lease_token: string;
  };
  fail_booking_calendar_convergence: {
    p_expected_appointment_version: number;
    p_expected_generation: number;
    p_failure_code?: string;
    p_failure_kind?: string;
    p_fencing_token: number;
    p_lease_token: string;
    p_link_id: string;
    p_retryable: boolean;
    p_safe_error: string;
  };
  fail_pipedream_binding_reconciliation: {
    p_binding_id: string;
    p_deployment_definitely_rejected?: boolean;
    p_fencing_token: number;
    p_lease_token: string;
    p_observed_trigger?: Json;
    p_safe_error: string;
  };
  mark_google_calendar_connection_verified: {
    p_binding_id: string;
    p_calendars: Json;
    p_fencing_token: number;
    p_lease_token: string;
    p_verified_at: string;
  };
  persist_google_calendar_configuration: {
    p_environment: string;
    p_fencing_token: number;
    p_lease_token: string;
    p_profile_id: string;
    p_setup_operation_id: string;
  };
  record_google_calendar_setup_read: {
    p_calendars: Json;
    p_environment: string;
    p_fencing_token: number;
    p_lease_token: string;
    p_operation_id: string;
    p_profile_id: string;
    p_verified_at: string;
  };
  record_pipedream_trigger_deployment_result: {
    p_binding_id: string;
    p_definitely_rejected?: boolean;
    p_deployed_trigger_id: string;
    p_deployment_operation_id: string;
    p_fencing_token: number;
    p_lease_token: string;
  };
  release_stripe_connect_reconciliation_claim: {
    p_environment: string;
    p_fencing_token: number;
    p_lease_token: string;
    p_profile_id: string;
    p_succeeded?: boolean;
  };
  request_google_calendar_verification: {
    p_actor_auth_user_id: string;
    p_environment: string;
    p_profile_id: string;
  };
  reserve_booking_provider_account_disconnect_v3: {
    p_actor_auth_user_id: string;
    p_environment: string;
    p_expected_connection_revision: number;
    p_profile_id: string;
    p_provider_account_id: string;
  };
  reserve_google_calendar_setup_probe: {
    p_account_display_name?: string;
    p_account_email?: string;
    p_account_id: string;
    p_actor_auth_user_id: string;
    p_calendar_id: string;
    p_calendars: Json;
    p_connect_operation_id?: string;
    p_environment: string;
    p_expected_revision: number;
    p_expected_setup_key?: string;
    p_lease_token: string;
    p_profile_id: string;
    p_read_verified_at: string;
  };
  reserve_pipedream_trigger_deployment: {
    p_binding_id: string;
    p_component_version: string;
    p_connection_id: string;
    p_environment: string;
    p_expected_connection_revision: number;
    p_fencing_token: number;
    p_lease_token: string;
    p_pipedream_account_id: string;
    p_profile_id: string;
  };
  restart_google_calendar_setup_probe: {
    p_environment: string;
    p_fencing_token: number;
    p_lease_token: string;
    p_operation_id: string;
    p_profile_id: string;
  };
  settle_booking_calendar_setup_capability: {
    p_environment: string;
    p_fencing_token: number;
    p_lease_token: string;
    p_operation_id: string;
    p_profile_id: string;
  };
};
type _LifetimeExactArgs = Assert<
  Equal<{ [Rpc in keyof LifetimeRpcArgs]: Functions[Rpc]["Args"] }, LifetimeRpcArgs>
>;
type _PipedreamAdoptionReceiptContract = Assert<
  Equal<
    Functions["adopt_pipedream_trigger_candidate"],
    {
      Args: {
        p_binding_id: string;
        p_component_id?: string;
        p_deployed_trigger_id: string;
        p_deployment_operation_id: string;
        p_fencing_token: number;
        p_lease_token: string;
      };
      Returns: boolean;
    }
  >
>;
type _RetiredUnfencedDeployment = Assert<
  Equal<Has<"fail_pipedream_trigger_deployment", Functions>, false>
>;
type _RetiredMutableEffectRevision = Assert<
  Equal<Has<"effect_connection_revision", SchemaTables["calendar_event_links"]["Row"]>, false>
>;
type _ConnectOperationArgs = Assert<
  Equal<
    Functions["authorize_google_calendar_connect_start"]["Args"],
    {
      p_actor_auth_user_id: string;
      p_environment: string;
      p_operation_id: string;
      p_profile_id: string;
    }
  >
>;
type _ConnectCompletionArgs = Assert<
  Equal<
    Functions["authorize_google_calendar_connect_completion"]["Args"],
    Functions["authorize_google_calendar_connect_start"]["Args"]
  >
>;
type _ConnectOperationReturns = Assert<
  Equal<Functions["authorize_google_calendar_connect_start"]["Returns"], Json>
>;
type _SetupReadRevision = Assert<
  Equal<
    Functions["authorize_google_calendar_setup_read"]["Args"],
    {
      p_account_id: string;
      p_environment: string;
      p_expected_revision: number;
      p_expected_setup_key?: string;
      p_profile_id: string;
    }
  >
>;
type _SetupEffectAction = Assert<
  Equal<
    Functions["authorize_google_calendar_setup_effect"]["Args"],
    {
      p_action: string;
      p_environment: string;
      p_fencing_token: number;
      p_lease_token: string;
      p_operation_id: string;
      p_profile_id: string;
    }
  >
>;
type _SetupSettlementContract = Assert<
  Equal<
    Functions["settle_google_calendar_setup_probe"],
    {
      Args: {
        p_denied_action?: string;
        p_environment: string;
        p_failure_observed_at?: string;
        p_fencing_token: number;
        p_lease_token: string;
        p_operation_id: string;
        p_probe_state?: string;
        p_profile_id: string;
        p_reason: string;
        p_success: boolean;
        p_write_verified: boolean;
      };
      Returns: Json;
    }
  >
>;
type _SetupConfigurationKeyContract = Assert<
  Equal<
    Functions["google_calendar_setup_configuration_key"],
    {
      Args: { p_connection: SchemaTables["calendar_connections"]["Row"] };
      Returns: string;
    }
  >
>;
type _PendingGoogleSetupContract = Assert<
  Equal<
    Functions["get_pending_google_calendar_setup"],
    {
      Args: { p_environment: string; p_expected_revision: number; p_profile_id: string };
      Returns: Json;
    }
  >
>;
type _CalendarWriteDenialEffect = Assert<
  Equal<
    Functions["record_booking_calendar_write_denial"],
    {
      Args: { p_effect: SchemaTables["booking_calendar_effect_attempts"]["Row"] };
      Returns: undefined;
    }
  >
>;
type _FullRefundConvergence = Assert<
  Equal<
    Functions["converge_booking_full_refund_v3"],
    { Args: { p_appointment_id: string }; Returns: boolean }
  >
>;
type _CalendarCronPrivilegesContract = Assert<
  Equal<
    Functions["assert_calendar_worker_cron_privileges"],
    { Args: { p_require_schedule?: boolean }; Returns: undefined }
  >
>;
type _SetupWriteDenialContract = Assert<
  Equal<
    Functions["record_booking_calendar_setup_denial"],
    {
      Args: {
        p_action: string;
        p_environment: string;
        p_fencing_token: number;
        p_lease_token: string;
        p_observed_at: string;
        p_operation_id: string;
        p_profile_id: string;
      };
      Returns: boolean;
    }
  >
>;
type _NotificationDispatchClaim = Assert<
  Equal<
    Functions["claim_due_booking_notifications_v3"]["Args"],
    { p_dispatch_contract?: number; p_environment: string; p_lease_token: string; p_limit?: number }
  >
>;
type _NotificationDispatchRows = Assert<
  Equal<
    Functions["claim_due_booking_notifications_v3"]["Returns"],
    SchemaTables["booking_notifications"]["Row"][]
  >
>;
type _NotificationDispatchAuthorization = Assert<
  Equal<
    Functions["authorize_booking_notification_dispatch_v3"],
    {
      Args: {
        p_environment: string;
        p_expected_appointment: Json;
        p_fencing_token: number;
        p_lease_token: string;
        p_notification_id: string;
        p_payload: string;
      };
      Returns: Json;
    }
  >
>;
type _CalendarRepairContext = Assert<
  Equal<
    Functions["get_booking_calendar_repair_context"],
    { Args: { p_actor_token_hash: string; p_appointment_id: string }; Returns: Json }
  >
>;
type _CalendarActionNoticeClaim = Assert<
  Equal<
    Functions["claim_calendar_action_notice"],
    { Args: { p_environment: string; p_lease_token: string }; Returns: Json }
  >
>;
type _CalendarActionNoticeTransition = Assert<
  Equal<
    Functions["transition_calendar_action_notice"],
    {
      Args: {
        p_action: string;
        p_connection_id: string;
        p_environment: string;
        p_fencing_token: number;
        p_lease_token: string;
        p_notice_id: string;
        p_payload?: string;
        p_provider_message_id?: string;
      };
      Returns: Json;
    }
  >
>;
type _CalendarActionNoticeHealth = Assert<
  Equal<
    Functions["get_calendar_action_notice_health"],
    { Args: { p_environment: string }; Returns: Json }
  >
>;
type _ReservedDestinationRelationship = Assert<
  Equal<
    Extract<
      SchemaTables["appointments"]["Relationships"][number],
      { foreignKeyName: "appointments_calendar_destination_epoch_fk" }
    >,
    {
      foreignKeyName: "appointments_calendar_destination_epoch_fk";
      columns: ["calendar_destination_epoch_id", "profile_id", "environment"];
      isOneToOne: false;
      referencedRelation: "calendar_destination_epochs";
      referencedColumns: ["id", "profile_id", "environment"];
    }
  >
>;
type _CalendarScheduleRegistration = Assert<
  Equal<
    Functions["register_calendar_worker_schedules"],
    {
      Args: { p_environment: string };
      Returns: { active: boolean; job_id: number; schedule_name: string }[];
    }
  >
>;
type _CalendarScheduleActivation = Assert<
  Equal<
    Functions["set_calendar_worker_schedules_active"],
    { Args: { p_active?: boolean; p_environment: string }; Returns: number }
  >
>;
type _CalendarCronHealthRow = Assert<
  Equal<
    Pick<
      SchemaDatabase["public"]["Views"]["background_job_cron_health"]["Row"],
      "outcome" | "transport_outcome" | "worker_counts" | "worker_outcome"
    >,
    {
      outcome: string | null;
      transport_outcome: string | null;
      worker_counts: Json | null;
      worker_outcome: string | null;
    }
  >
>;
type _CalendarWorkerHealthContract = Assert<
  Equal<Functions["get_calendar_worker_health"], { Args: { p_environment: string }; Returns: Json }>
>;
type _CalendarWorkerDispatchContract = Assert<
  Equal<
    Functions["dispatch_calendar_worker_schedule"],
    { Args: { p_environment: string; p_worker: string }; Returns: number }
  >
>;
type _CalendarWorkerCronConfigContract = Assert<
  Equal<
    Functions["validate_calendar_worker_cron_configuration"],
    { Args: { p_environment: string }; Returns: undefined }
  >
>;
type _NotificationSettlementContracts = Assert<
  Equal<
    Functions["complete_booking_notification_v3"],
    {
      Args: {
        p_environment: string;
        p_fencing_token: number;
        p_lease_token: string;
        p_notification_id: string;
        p_provider_destination: string;
        p_provider_message_id: string;
      };
      Returns: boolean;
    }
  >
>;
type _NotificationFailureContract = Assert<
  Equal<
    Functions["fail_booking_notification_v3"],
    {
      Args: {
        p_environment: string;
        p_fencing_token: number;
        p_lease_token: string;
        p_notification_id: string;
        p_retryable: boolean;
        p_safe_error: string;
      };
      Returns: boolean;
    }
  >
>;
type _NotificationSuppressionContract = Assert<
  Equal<
    Functions["suppress_noncanonical_booking_notifications_v4"],
    { Args: { p_environment: string; p_limit?: number }; Returns: number }
  >
>;
type _NotificationCurrentContract = Assert<
  Equal<
    Functions["booking_notification_event_current_v4"],
    { Args: { p_notification_id: string }; Returns: boolean }
  >
>;
type _NotificationProjectionContracts = Assert<
  Equal<
    Functions["project_booking_notifications_v3"],
    { Args: { p_appointment_id: string }; Returns: number }
  >
>;
type _NotificationReconcileContract = Assert<
  Equal<
    Functions["reconcile_booking_notification_projection_v3"],
    { Args: { p_environment: string; p_limit?: number }; Returns: number }
  >
>;
type _ReserveLiveBookingContract = Assert<
  Equal<
    Functions["reserve_live_booking"],
    {
      Args: {
        p_availability_generation: number;
        p_calendar_set_hash: string;
        p_client_request_id: string;
        p_consent_digest: string;
        p_consent_document_id: string;
        p_consent_version: string;
        p_customer: Json;
        p_environment: string;
        p_freebusy_observed_at: string;
        p_local_date: string;
        p_local_start: string;
        p_rate_limit_key: string;
        p_request_capability_hash: string;
        p_request_hash: string;
        p_start_at: string;
        p_time_zone: string;
        p_website_id: string;
      };
      Returns: Json;
    }
  >
>;
type _ResolveBookingDestinationContract = Assert<
  Equal<
    Functions["resolve_booking_calendar_destination"],
    { Args: { p_appointment_id: string }; Returns: Json }
  >
>;
type _EnqueueBookingCalendarContract = Assert<
  Equal<
    Functions["enqueue_booking_calendar_create"],
    { Args: { p_appointment_id: string }; Returns: boolean }
  >
>;

export {};
