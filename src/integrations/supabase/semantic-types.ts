import type { Database as GeneratedDatabase } from "./types";

export type { Json } from "./types";

type Simplify<T> = { [Key in keyof T]: T[Key] };
type Override<T, U> = Simplify<Omit<T, keyof U> & U>;
type GeneratedPublic = GeneratedDatabase["public"];
type GeneratedTables = GeneratedPublic["Tables"];
type GeneratedFunctions = GeneratedPublic["Functions"];

type AppointmentRow = Override<GeneratedTables["appointments"]["Row"], { capacity_range: string }>;
type AppointmentTable = Override<
  GeneratedTables["appointments"],
  {
    Row: AppointmentRow;
    Insert: Override<GeneratedTables["appointments"]["Insert"], { capacity_range: string }>;
    Update: Override<GeneratedTables["appointments"]["Update"], { capacity_range?: string }>;
  }
>;

type BeginSaasCheckout = Override<
  GeneratedFunctions["begin_saas_checkout"],
  {
    Args: Override<
      GeneratedFunctions["begin_saas_checkout"]["Args"],
      { p_website_id: string | null }
    >;
    Returns: Array<
      Override<
        GeneratedFunctions["begin_saas_checkout"]["Returns"][number],
        { provider_session_id: string | null }
      >
    >;
  }
>;

type IngestProviderEvent = Override<
  GeneratedFunctions["ingest_provider_event"],
  {
    Args: Override<
      GeneratedFunctions["ingest_provider_event"]["Args"],
      {
        p_account_context: string | null;
        p_api_version: string | null;
        p_destination: string | null;
        p_profile_id: string | null;
        p_signature_timestamp?: string | null;
      }
    >;
  }
>;

type AppointmentFunction<Name extends keyof GeneratedFunctions> = Override<
  GeneratedFunctions[Name],
  { Returns: AppointmentRow }
>;

/**
 * Application contract layered over raw Supabase output where PostgreSQL body semantics or
 * PostgREST transport types are not representable by the generator's catalog metadata.
 */
export type Database = Override<
  GeneratedDatabase,
  {
    public: Override<
      GeneratedPublic,
      {
        Tables: Override<GeneratedTables, { appointments: AppointmentTable }>;
        Functions: Override<
          GeneratedFunctions,
          {
            apply_provider_appointment_event: AppointmentFunction<"apply_provider_appointment_event">;
            begin_saas_checkout: BeginSaasCheckout;
            cancel_contractor_booking: AppointmentFunction<"cancel_contractor_booking">;
            complete_outbox_appointment_command: AppointmentFunction<"complete_outbox_appointment_command">;
            ingest_provider_event: IngestProviderEvent;
            rotate_saas_offer_contract: Override<
              GeneratedFunctions["rotate_saas_offer_contract"],
              {
                Args: Override<
                  GeneratedFunctions["rotate_saas_offer_contract"]["Args"],
                  { p_expected_current_price_id: string | null }
                >;
              }
            >;
            transition_appointment: AppointmentFunction<"transition_appointment">;
          }
        >;
      }
    >;
  }
>;
