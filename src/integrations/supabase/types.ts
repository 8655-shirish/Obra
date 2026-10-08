export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      add_video_observability_events: {
        Row: {
          details: Json
          event_type: string
          id: string
          job_id: string | null
          occurred_at: string
          request_id: string | null
          source_version_id: string | null
          target_version_id: string | null
          website_id: string | null
        }
        Insert: {
          details?: Json
          event_type: string
          id?: string
          job_id?: string | null
          occurred_at?: string
          request_id?: string | null
          source_version_id?: string | null
          target_version_id?: string | null
          website_id?: string | null
        }
        Update: {
          details?: Json
          event_type?: string
          id?: string
          job_id?: string | null
          occurred_at?: string
          request_id?: string | null
          source_version_id?: string | null
          target_version_id?: string | null
          website_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "add_video_observability_events_job_website_fkey"
            columns: ["job_id", "website_id"]
            isOneToOne: false
            referencedRelation: "background_jobs"
            referencedColumns: ["id", "website_id"]
          },
          {
            foreignKeyName: "add_video_observability_events_source_website_fkey"
            columns: ["source_version_id", "website_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id", "website_id"]
          },
          {
            foreignKeyName: "add_video_observability_events_target_website_fkey"
            columns: ["target_version_id", "website_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id", "website_id"]
          },
        ]
      }
      add_video_observability_runs: {
        Row: {
          as_of: string
          created_at: string
          id: string
          report: Json
        }
        Insert: {
          as_of: string
          created_at?: string
          id?: string
          report: Json
        }
        Update: {
          as_of?: string
          created_at?: string
          id?: string
          report?: Json
        }
        Relationships: []
      }
      admin_auth_audit_events: {
        Row: {
          actor_user_id: string | null
          event_type: string
          evidence: Json
          gotrue_session_id: string | null
          id: number
          occurred_at: string
          opaque_session_id: string | null
          subject_user_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          event_type: string
          evidence?: Json
          gotrue_session_id?: string | null
          id?: never
          occurred_at?: string
          opaque_session_id?: string | null
          subject_user_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          event_type?: string
          evidence?: Json
          gotrue_session_id?: string | null
          id?: never
          occurred_at?: string
          opaque_session_id?: string | null
          subject_user_id?: string | null
        }
        Relationships: []
      }
      admin_auth_handoffs: {
        Row: {
          auth_epoch: number
          consumed_at: string | null
          created_at: string
          expires_at: string
          factor_id: string
          gotrue_session_id: string
          opaque_session_token_hash: string
          recovery_attempt_token_hash: string | null
          recovery_code_hashes: string[] | null
          token_hash: string
          user_id: string
        }
        Insert: {
          auth_epoch: number
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          factor_id: string
          gotrue_session_id: string
          opaque_session_token_hash: string
          recovery_attempt_token_hash?: string | null
          recovery_code_hashes?: string[] | null
          token_hash: string
          user_id: string
        }
        Update: {
          auth_epoch?: number
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          factor_id?: string
          gotrue_session_id?: string
          opaque_session_token_hash?: string
          recovery_attempt_token_hash?: string | null
          recovery_code_hashes?: string[] | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_auth_handoff_recovery_attempt_fk"
            columns: ["recovery_attempt_token_hash"]
            isOneToOne: false
            referencedRelation: "admin_recovery_attempts"
            referencedColumns: ["token_hash"]
          },
          {
            foreignKeyName: "admin_auth_handoffs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_principals"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_bootstrap_state: {
        Row: {
          consumed_at: string | null
          consumed_by: string | null
          singleton: boolean
        }
        Insert: {
          consumed_at?: string | null
          consumed_by?: string | null
          singleton?: boolean
        }
        Update: {
          consumed_at?: string | null
          consumed_by?: string | null
          singleton?: boolean
        }
        Relationships: []
      }
      admin_login_throttle_buckets: {
        Row: {
          attempt_count: number
          bucket_hash: string
          bucket_kind: string
          last_attempt_at: string
          window_started_at: string
        }
        Insert: {
          attempt_count: number
          bucket_hash: string
          bucket_kind: string
          last_attempt_at: string
          window_started_at: string
        }
        Update: {
          attempt_count?: number
          bucket_hash?: string
          bucket_kind?: string
          last_attempt_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      admin_principals: {
        Row: {
          auth_epoch: number
          created_at: string
          enabled: boolean
          mfa_required: boolean
          recovery_code_hashes: string[]
          recovery_codes_issued_at: string | null
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_epoch?: number
          created_at?: string
          enabled?: boolean
          mfa_required?: boolean
          recovery_code_hashes?: string[]
          recovery_codes_issued_at?: string | null
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_epoch?: number
          created_at?: string
          enabled?: boolean
          mfa_required?: boolean
          recovery_code_hashes?: string[]
          recovery_codes_issued_at?: string | null
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_recovery_attempts: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string
          provider_reset_at: string | null
          recovery_code_hash: string
          token_hash: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at: string
          provider_reset_at?: string | null
          recovery_code_hash: string
          token_hash: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          provider_reset_at?: string | null
          recovery_code_hash?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_recovery_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_principals"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_sessions: {
        Row: {
          aal: string
          absolute_expires_at: string
          auth_epoch: number
          created_at: string
          id: string
          idle_expires_at: string
          impersonated_profile_id: string | null
          last_seen_at: string
          revoked_at: string | null
          role: string
          token_hash: string
          user_id: string
        }
        Insert: {
          aal: string
          absolute_expires_at: string
          auth_epoch?: number
          created_at?: string
          id?: string
          idle_expires_at: string
          impersonated_profile_id?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          role: string
          token_hash: string
          user_id: string
        }
        Update: {
          aal?: string
          absolute_expires_at?: string
          auth_epoch?: number
          created_at?: string
          id?: string
          idle_expires_at?: string
          impersonated_profile_id?: string | null
          last_seen_at?: string
          revoked_at?: string | null
          role?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_sessions_impersonated_profile_id_fkey"
            columns: ["impersonated_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_principals"
            referencedColumns: ["user_id"]
          },
        ]
      }
      agent_external_operations: {
        Row: {
          abandon_reason: string | null
          abandoned_by: string | null
          operation_key: string
          operation_type: string
          owner_token: string
          started_at: string
          status: string
          terminal_at: string | null
          trace_id: string
          website_id: string
        }
        Insert: {
          abandon_reason?: string | null
          abandoned_by?: string | null
          operation_key: string
          operation_type: string
          owner_token: string
          started_at?: string
          status?: string
          terminal_at?: string | null
          trace_id: string
          website_id: string
        }
        Update: {
          abandon_reason?: string | null
          abandoned_by?: string | null
          operation_key?: string
          operation_type?: string
          owner_token?: string
          started_at?: string
          status?: string
          terminal_at?: string | null
          trace_id?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_external_operations_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "agent_traces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_external_operations_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_journal_checkpoints: {
        Row: {
          conversation_id: string
          created_at: string
          message_count: number
          section_body: string
          section_title: string
          trace_id: string
          website_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          message_count: number
          section_body: string
          section_title: string
          trace_id: string
          website_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          message_count?: number
          section_body?: string
          section_title?: string
          trace_id?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_journal_checkpoints_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_journal_checkpoints_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: true
            referencedRelation: "agent_traces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_journal_checkpoints_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_traces: {
        Row: {
          completed_at: string | null
          conversation_id: string
          error_message: string | null
          heartbeat_at: string | null
          id: string
          intent_type: string | null
          lease_expires_at: string | null
          owner_token: string | null
          profile_id: string
          recovered_at: string | null
          recovered_by: string | null
          recovery_reason: string | null
          request_id: string | null
          request_payload_hash: string | null
          round_count: number
          source_revision: number | null
          source_version_id: string | null
          started_at: string
          status: string
          tool_call_count: number
          trigger_message: string | null
          website_id: string
        }
        Insert: {
          completed_at?: string | null
          conversation_id: string
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          intent_type?: string | null
          lease_expires_at?: string | null
          owner_token?: string | null
          profile_id: string
          recovered_at?: string | null
          recovered_by?: string | null
          recovery_reason?: string | null
          request_id?: string | null
          request_payload_hash?: string | null
          round_count?: number
          source_revision?: number | null
          source_version_id?: string | null
          started_at?: string
          status?: string
          tool_call_count?: number
          trigger_message?: string | null
          website_id: string
        }
        Update: {
          completed_at?: string | null
          conversation_id?: string
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          intent_type?: string | null
          lease_expires_at?: string | null
          owner_token?: string | null
          profile_id?: string
          recovered_at?: string | null
          recovered_by?: string | null
          recovery_reason?: string | null
          request_id?: string | null
          request_payload_hash?: string | null
          round_count?: number
          source_revision?: number | null
          source_version_id?: string | null
          started_at?: string
          status?: string
          tool_call_count?: number
          trigger_message?: string | null
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_traces_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_traces_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_traces_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_traces_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_turn_runtime_gate: {
        Row: {
          enabled: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      applied_repo_migrations: {
        Row: {
          actor: string
          applied_at: string
          checksum: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          actor?: string
          applied_at?: string
          checksum: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          actor?: string
          applied_at?: string
          checksum?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      appointment_operations: {
        Row: {
          appointment_id: string
          client_request_id: string
          completed_at: string | null
          created_at: string
          environment: string
          error_code: string | null
          fencing_token: number
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          operation_type: string
          profile_id: string
          request_capability_hash: string | null
          request_hash: string
          result: Json | null
          state: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          client_request_id: string
          completed_at?: string | null
          created_at?: string
          environment: string
          error_code?: string | null
          fencing_token?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          operation_type: string
          profile_id: string
          request_capability_hash?: string | null
          request_hash: string
          result?: Json | null
          state?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          client_request_id?: string
          completed_at?: string | null
          created_at?: string
          environment?: string
          error_code?: string | null
          fencing_token?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          operation_type?: string
          profile_id?: string
          request_capability_hash?: string | null
          request_hash?: string
          result?: Json | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_operations_appointment_id_profile_id_environme_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      appointments: {
        Row: {
          amount_minor: number
          appointment_reason: string | null
          appointment_state: string
          booking_contract_version: number | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          calendar_destination_epoch_id: string | null
          calendar_generation: number
          calendar_state: string
          cancellation_requested_at: string | null
          cancelled_at: string | null
          capacity_range: unknown
          checkout_generation: number
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_id: string
          customer_snapshot: Json
          duration_minutes: number
          end_at: string
          entitlement_id: string
          environment: string
          id: string
          local_date: string
          local_start: string
          location_snapshot: Json
          payment_state: string
          profile_id: string
          public_reference: string
          refund_generation: number
          refund_state: string
          reservation_expires_at: string | null
          review_state: string
          schedule_revision: number | null
          service_id: string
          service_snapshot: Json
          start_at: string
          time_zone: string
          updated_at: string
          version: number
          website_id: string
        }
        Insert: {
          amount_minor: number
          appointment_reason?: string | null
          appointment_state?: string
          booking_contract_version?: number | null
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          calendar_destination_epoch_id?: string | null
          calendar_generation?: number
          calendar_state?: string
          cancellation_requested_at?: string | null
          cancelled_at?: string | null
          capacity_range: unknown
          checkout_generation?: number
          confirmed_at?: string | null
          created_at?: string
          currency: string
          customer_id: string
          customer_snapshot: Json
          duration_minutes: number
          end_at: string
          entitlement_id: string
          environment: string
          id?: string
          local_date: string
          local_start: string
          location_snapshot: Json
          payment_state?: string
          profile_id: string
          public_reference?: string
          refund_generation?: number
          refund_state?: string
          reservation_expires_at?: string | null
          review_state?: string
          schedule_revision?: number | null
          service_id: string
          service_snapshot: Json
          start_at: string
          time_zone: string
          updated_at?: string
          version?: number
          website_id: string
        }
        Update: {
          amount_minor?: number
          appointment_reason?: string | null
          appointment_state?: string
          booking_contract_version?: number | null
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          calendar_destination_epoch_id?: string | null
          calendar_generation?: number
          calendar_state?: string
          cancellation_requested_at?: string | null
          cancelled_at?: string | null
          capacity_range?: unknown
          checkout_generation?: number
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          customer_snapshot?: Json
          duration_minutes?: number
          end_at?: string
          entitlement_id?: string
          environment?: string
          id?: string
          local_date?: string
          local_start?: string
          location_snapshot?: Json
          payment_state?: string
          profile_id?: string
          public_reference?: string
          refund_generation?: number
          refund_state?: string
          reservation_expires_at?: string | null
          review_state?: string
          schedule_revision?: number | null
          service_id?: string
          service_snapshot?: Json
          start_at?: string
          time_zone?: string
          updated_at?: string
          version?: number
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_calendar_destination_epoch_fk"
            columns: [
              "calendar_destination_epoch_id",
              "profile_id",
              "environment",
            ]
            isOneToOne: false
            referencedRelation: "calendar_destination_epochs"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "appointments_customer_id_profile_id_environment_fkey"
            columns: ["customer_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "booking_customers"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "appointments_customer_source_composition_fkey"
            columns: ["customer_id", "website_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "booking_customers"
            referencedColumns: [
              "id",
              "source_website_id",
              "profile_id",
              "environment",
            ]
          },
          {
            foreignKeyName: "appointments_entitlement_website_tenant_fkey"
            columns: [
              "entitlement_id",
              "website_id",
              "profile_id",
              "environment",
            ]
            isOneToOne: false
            referencedRelation: "website_entitlements"
            referencedColumns: ["id", "website_id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "appointments_service_id_profile_id_environment_fkey"
            columns: ["service_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "appointments_website_id_profile_id_environment_fkey"
            columns: ["website_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id", "user_id", "environment"]
          },
        ]
      }
      availability_intervals: {
        Row: {
          created_at: string
          environment: string
          id: string
          local_end: string
          local_start: string
          profile_id: string
          schedule_id: string
          sort_order: number
          weekday: number
        }
        Insert: {
          created_at?: string
          environment: string
          id?: string
          local_end: string
          local_start: string
          profile_id: string
          schedule_id: string
          sort_order?: number
          weekday: number
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          local_end?: string
          local_start?: string
          profile_id?: string
          schedule_id?: string
          sort_order?: number
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_intervals_schedule_id_profile_id_environment_fkey"
            columns: ["schedule_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      availability_override_intervals: {
        Row: {
          created_at: string
          environment: string
          id: string
          local_end: string
          local_start: string
          override_id: string
          profile_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          environment: string
          id?: string
          local_end: string
          local_start: string
          override_id: string
          profile_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          local_end?: string
          local_start?: string
          override_id?: string
          profile_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "availability_override_interva_override_id_profile_id_envir_fkey"
            columns: ["override_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "availability_overrides"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      availability_overrides: {
        Row: {
          created_at: string
          environment: string
          id: string
          local_date: string
          override_type: string
          profile_id: string
          reason: string | null
          schedule_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          environment: string
          id?: string
          local_date: string
          override_type: string
          profile_id: string
          reason?: string | null
          schedule_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          local_date?: string
          override_type?: string
          profile_id?: string
          reason?: string | null
          schedule_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_overrides_schedule_id_profile_id_environment_fkey"
            columns: ["schedule_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "availability_schedules"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      availability_schedules: {
        Row: {
          active: boolean
          created_at: string
          environment: string
          id: string
          profile_id: string
          revision: number
          service_id: string
          time_zone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          environment: string
          id?: string
          profile_id: string
          revision?: number
          service_id: string
          time_zone: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          environment?: string
          id?: string
          profile_id?: string
          revision?: number
          service_id?: string
          time_zone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_schedules_service_id_profile_id_environment_fkey"
            columns: ["service_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "booking_services"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      background_job_cron_requests: {
        Row: {
          error_message: string | null
          id: number
          request_id: number
          requested_at: string
          responded_at: string | null
          schedule_name: string
          status_code: number | null
          timed_out: boolean | null
          worker_counts: Json | null
          worker_outcome: string | null
        }
        Insert: {
          error_message?: string | null
          id?: never
          request_id: number
          requested_at?: string
          responded_at?: string | null
          schedule_name: string
          status_code?: number | null
          timed_out?: boolean | null
          worker_counts?: Json | null
          worker_outcome?: string | null
        }
        Update: {
          error_message?: string | null
          id?: never
          request_id?: number
          requested_at?: string
          responded_at?: string | null
          schedule_name?: string
          status_code?: number | null
          timed_out?: boolean | null
          worker_counts?: Json | null
          worker_outcome?: string | null
        }
        Relationships: []
      }
      background_job_dispatch_state: {
        Row: {
          dispatch_cursor: number
          dispatch_sequence: number
          singleton: boolean
          updated_at: string
        }
        Insert: {
          dispatch_cursor?: number
          dispatch_sequence?: number
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          dispatch_cursor?: number
          dispatch_sequence?: number
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      background_job_runner_capabilities: {
        Row: {
          browser_ready: boolean
          capability: number
          last_seen: string
          runner_id: string
        }
        Insert: {
          browser_ready: boolean
          capability: number
          last_seen: string
          runner_id: string
        }
        Update: {
          browser_ready?: boolean
          capability?: number
          last_seen?: string
          runner_id?: string
        }
        Relationships: []
      }
      background_jobs: {
        Row: {
          agent_trace_id: string | null
          attempts: number
          cancellation_actor: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          chain_id: string
          claim_epoch: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          failure_attempts: number
          finalization_attempts: number
          generation_accepted_at: string | null
          generation_checkpoint: Json | null
          generation_contract_epoch: number
          generation_contract_version: number | null
          generation_handoff_message_id: string | null
          generation_input_hash: string | null
          generation_input_snapshot: Json | null
          generation_input_version: number | null
          generation_kind: string | null
          generation_last_dispatched_at: string | null
          generation_last_scheduler_run_id: string | null
          generation_request_hash: string | null
          generation_request_id: string | null
          generation_result_version_id: string | null
          generation_stage: string | null
          generation_tenant_id: string | null
          generation_terminal_message_at: string | null
          generation_terminal_message_id: string | null
          generation_terminal_message_payload: Json | null
          id: string
          idempotency_key: string | null
          interruption_count: number
          job_type: string
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          next_retry_at: string | null
          payload_json: Json
          platform: string | null
          progress_pct: number
          repair_attempts: number
          request_id: string | null
          research_row_id: string | null
          result_json: Json | null
          scheduler_dispatch_sequence: number | null
          scheduler_last_dispatched_at: string | null
          scheduler_last_run_id: string | null
          sequence_index: number
          source_revision: number | null
          source_version_id: string | null
          stage_attempt_counts: Json
          stage_attempts: number
          started_at: string | null
          status: string
          status_message: string | null
          superseded_at: string | null
          superseded_by_job_id: string | null
          supersedes_job_id: string | null
          supersession_actor: string | null
          supersession_link_state: string
          supersession_reason: string | null
          target_version_id: string | null
          website_id: string | null
        }
        Insert: {
          agent_trace_id?: string | null
          attempts?: number
          cancellation_actor?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          chain_id: string
          claim_epoch?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failure_attempts?: number
          finalization_attempts?: number
          generation_accepted_at?: string | null
          generation_checkpoint?: Json | null
          generation_contract_epoch?: number
          generation_contract_version?: number | null
          generation_handoff_message_id?: string | null
          generation_input_hash?: string | null
          generation_input_snapshot?: Json | null
          generation_input_version?: number | null
          generation_kind?: string | null
          generation_last_dispatched_at?: string | null
          generation_last_scheduler_run_id?: string | null
          generation_request_hash?: string | null
          generation_request_id?: string | null
          generation_result_version_id?: string | null
          generation_stage?: string | null
          generation_tenant_id?: string | null
          generation_terminal_message_at?: string | null
          generation_terminal_message_id?: string | null
          generation_terminal_message_payload?: Json | null
          id?: string
          idempotency_key?: string | null
          interruption_count?: number
          job_type: string
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          payload_json?: Json
          platform?: string | null
          progress_pct?: number
          repair_attempts?: number
          request_id?: string | null
          research_row_id?: string | null
          result_json?: Json | null
          scheduler_dispatch_sequence?: number | null
          scheduler_last_dispatched_at?: string | null
          scheduler_last_run_id?: string | null
          sequence_index?: number
          source_revision?: number | null
          source_version_id?: string | null
          stage_attempt_counts?: Json
          stage_attempts?: number
          started_at?: string | null
          status?: string
          status_message?: string | null
          superseded_at?: string | null
          superseded_by_job_id?: string | null
          supersedes_job_id?: string | null
          supersession_actor?: string | null
          supersession_link_state?: string
          supersession_reason?: string | null
          target_version_id?: string | null
          website_id?: string | null
        }
        Update: {
          agent_trace_id?: string | null
          attempts?: number
          cancellation_actor?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          chain_id?: string
          claim_epoch?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          failure_attempts?: number
          finalization_attempts?: number
          generation_accepted_at?: string | null
          generation_checkpoint?: Json | null
          generation_contract_epoch?: number
          generation_contract_version?: number | null
          generation_handoff_message_id?: string | null
          generation_input_hash?: string | null
          generation_input_snapshot?: Json | null
          generation_input_version?: number | null
          generation_kind?: string | null
          generation_last_dispatched_at?: string | null
          generation_last_scheduler_run_id?: string | null
          generation_request_hash?: string | null
          generation_request_id?: string | null
          generation_result_version_id?: string | null
          generation_stage?: string | null
          generation_tenant_id?: string | null
          generation_terminal_message_at?: string | null
          generation_terminal_message_id?: string | null
          generation_terminal_message_payload?: Json | null
          id?: string
          idempotency_key?: string | null
          interruption_count?: number
          job_type?: string
          lease_expires_at?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          next_retry_at?: string | null
          payload_json?: Json
          platform?: string | null
          progress_pct?: number
          repair_attempts?: number
          request_id?: string | null
          research_row_id?: string | null
          result_json?: Json | null
          scheduler_dispatch_sequence?: number | null
          scheduler_last_dispatched_at?: string | null
          scheduler_last_run_id?: string | null
          sequence_index?: number
          source_revision?: number | null
          source_version_id?: string | null
          stage_attempt_counts?: Json
          stage_attempts?: number
          started_at?: string | null
          status?: string
          status_message?: string | null
          superseded_at?: string | null
          superseded_by_job_id?: string | null
          supersedes_job_id?: string | null
          supersession_actor?: string | null
          supersession_link_state?: string
          supersession_reason?: string | null
          target_version_id?: string | null
          website_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "background_jobs_agent_trace_id_fkey"
            columns: ["agent_trace_id"]
            isOneToOne: false
            referencedRelation: "agent_traces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_agent_trace_website_fkey"
            columns: ["agent_trace_id", "website_id"]
            isOneToOne: false
            referencedRelation: "agent_traces"
            referencedColumns: ["id", "website_id"]
          },
          {
            foreignKeyName: "background_jobs_generation_handoff_message_id_fkey"
            columns: ["generation_handoff_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_generation_result_version_fkey"
            columns: ["generation_result_version_id", "website_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id", "website_id"]
          },
          {
            foreignKeyName: "background_jobs_generation_tenant_id_fkey"
            columns: ["generation_tenant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_generation_terminal_message_id_fkey"
            columns: ["generation_terminal_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_research_row_id_fkey"
            columns: ["research_row_id"]
            isOneToOne: false
            referencedRelation: "contractor_research_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_source_version_website_fkey"
            columns: ["source_version_id", "website_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id", "website_id"]
          },
          {
            foreignKeyName: "background_jobs_superseded_by_job_fkey"
            columns: ["superseded_by_job_id"]
            isOneToOne: false
            referencedRelation: "background_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_supersedes_job_fkey"
            columns: ["supersedes_job_id"]
            isOneToOne: false
            referencedRelation: "background_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "background_jobs_target_version_website_fkey"
            columns: ["target_version_id", "website_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id", "website_id"]
          },
          {
            foreignKeyName: "background_jobs_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_attachment_audit_events: {
        Row: {
          actor_auth_user_id: string | null
          attachment_id: string | null
          environment: string
          event_type: string
          evidence: Json
          id: number
          occurred_at: string
          profile_id: string | null
        }
        Insert: {
          actor_auth_user_id?: string | null
          attachment_id?: string | null
          environment: string
          event_type: string
          evidence?: Json
          id?: never
          occurred_at?: string
          profile_id?: string | null
        }
        Update: {
          actor_auth_user_id?: string | null
          attachment_id?: string | null
          environment?: string
          event_type?: string
          evidence?: Json
          id?: never
          occurred_at?: string
          profile_id?: string | null
        }
        Relationships: []
      }
      booking_attachment_objects_v3: {
        Row: {
          attachment_id: string
          committed_legal_hold_epoch: number | null
          committed_policy_version: number | null
          created_at: string
          delete_attempts: number
          deleted_at: string | null
          deletion_authorized_at: string | null
          deletion_committed_at: string | null
          deletion_fencing_token: number
          deletion_lease_expires_at: string | null
          deletion_lease_token: string | null
          deletion_reason: string | null
          deletion_retry_at: string | null
          deletion_state: string
          environment: string
          expected_byte_size: number
          expected_checksum: string
          expected_mime_type: string
          generation: number
          object_state: string
          profile_id: string
          scan_attempts: number
          scan_config_fingerprint: string | null
          scan_fencing_token: number
          scan_lease_expires_at: string | null
          scan_lease_token: string | null
          scan_next_attempt_at: string
          scan_proven_at: string | null
          scanned_checksum: string | null
          scanner_verdict_id: string | null
          storage_object_key: string
          updated_at: string
        }
        Insert: {
          attachment_id: string
          committed_legal_hold_epoch?: number | null
          committed_policy_version?: number | null
          created_at?: string
          delete_attempts?: number
          deleted_at?: string | null
          deletion_authorized_at?: string | null
          deletion_committed_at?: string | null
          deletion_fencing_token?: number
          deletion_lease_expires_at?: string | null
          deletion_lease_token?: string | null
          deletion_reason?: string | null
          deletion_retry_at?: string | null
          deletion_state?: string
          environment: string
          expected_byte_size: number
          expected_checksum: string
          expected_mime_type: string
          generation: number
          object_state?: string
          profile_id: string
          scan_attempts?: number
          scan_config_fingerprint?: string | null
          scan_fencing_token?: number
          scan_lease_expires_at?: string | null
          scan_lease_token?: string | null
          scan_next_attempt_at?: string
          scan_proven_at?: string | null
          scanned_checksum?: string | null
          scanner_verdict_id?: string | null
          storage_object_key: string
          updated_at?: string
        }
        Update: {
          attachment_id?: string
          committed_legal_hold_epoch?: number | null
          committed_policy_version?: number | null
          created_at?: string
          delete_attempts?: number
          deleted_at?: string | null
          deletion_authorized_at?: string | null
          deletion_committed_at?: string | null
          deletion_fencing_token?: number
          deletion_lease_expires_at?: string | null
          deletion_lease_token?: string | null
          deletion_reason?: string | null
          deletion_retry_at?: string | null
          deletion_state?: string
          environment?: string
          expected_byte_size?: number
          expected_checksum?: string
          expected_mime_type?: string
          generation?: number
          object_state?: string
          profile_id?: string
          scan_attempts?: number
          scan_config_fingerprint?: string | null
          scan_fencing_token?: number
          scan_lease_expires_at?: string | null
          scan_lease_token?: string | null
          scan_next_attempt_at?: string
          scan_proven_at?: string | null
          scanned_checksum?: string | null
          scanner_verdict_id?: string | null
          storage_object_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_attachment_objects_v3_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "booking_attachments"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_attachment_security: {
        Row: {
          clean_probe_checksum: string | null
          clean_proven_at: string | null
          eicar_probe_checksum: string | null
          eicar_proven_at: string | null
          proof_expires_at: string | null
          scanner_config_fingerprint: string | null
          scanner_environment: string | null
          scanner_proven_at: string | null
          scanner_provider: string | null
          singleton: boolean
          updated_at: string
          upload_enabled: boolean
        }
        Insert: {
          clean_probe_checksum?: string | null
          clean_proven_at?: string | null
          eicar_probe_checksum?: string | null
          eicar_proven_at?: string | null
          proof_expires_at?: string | null
          scanner_config_fingerprint?: string | null
          scanner_environment?: string | null
          scanner_proven_at?: string | null
          scanner_provider?: string | null
          singleton?: boolean
          updated_at?: string
          upload_enabled?: boolean
        }
        Update: {
          clean_probe_checksum?: string | null
          clean_proven_at?: string | null
          eicar_probe_checksum?: string | null
          eicar_proven_at?: string | null
          proof_expires_at?: string | null
          scanner_config_fingerprint?: string | null
          scanner_environment?: string | null
          scanner_proven_at?: string | null
          scanner_provider?: string | null
          singleton?: boolean
          updated_at?: string
          upload_enabled?: boolean
        }
        Relationships: []
      }
      booking_attachment_security_v3: {
        Row: {
          clean_probe_checksum: string
          clean_proven_at: string
          config_fingerprint: string
          created_at: string
          eicar_probe_checksum: string
          eicar_proven_at: string
          environment: string
          proof_expires_at: string
          scanner_provider: string
          updated_at: string
          upload_enabled: boolean
        }
        Insert: {
          clean_probe_checksum: string
          clean_proven_at: string
          config_fingerprint: string
          created_at?: string
          eicar_probe_checksum: string
          eicar_proven_at: string
          environment: string
          proof_expires_at: string
          scanner_provider: string
          updated_at?: string
          upload_enabled?: boolean
        }
        Update: {
          clean_probe_checksum?: string
          clean_proven_at?: string
          config_fingerprint?: string
          created_at?: string
          eicar_probe_checksum?: string
          eicar_proven_at?: string
          environment?: string
          proof_expires_at?: string
          scanner_provider?: string
          updated_at?: string
          upload_enabled?: boolean
        }
        Relationships: []
      }
      booking_attachments: {
        Row: {
          appointment_id: string
          byte_size: number
          checksum: string
          cleanup_fencing_token: number
          cleanup_lease_expires_at: string | null
          cleanup_lease_token: string | null
          cleanup_reason: string | null
          created_at: string
          current_object_generation: number
          customer_id: string
          deleted_at: string | null
          display_filename: string
          environment: string
          finalized_at: string | null
          height: number | null
          id: string
          legal_hold_at: string | null
          legal_hold_epoch: number
          legal_hold_reason: string | null
          mime_type: string
          original_filename: string
          profile_id: string
          quota_slot: number
          scan_attempts: number
          scan_config_fingerprint: string | null
          scan_error: string | null
          scan_fencing_token: number
          scan_lease_expires_at: string | null
          scan_lease_token: string | null
          scan_proven_at: string | null
          scanned_checksum: string | null
          scanner_verdict_id: string | null
          state_version: number
          storage_object_key: string
          upload_state: string
          website_id: string
          width: number | null
        }
        Insert: {
          appointment_id: string
          byte_size: number
          checksum: string
          cleanup_fencing_token?: number
          cleanup_lease_expires_at?: string | null
          cleanup_lease_token?: string | null
          cleanup_reason?: string | null
          created_at?: string
          current_object_generation?: number
          customer_id: string
          deleted_at?: string | null
          display_filename: string
          environment: string
          finalized_at?: string | null
          height?: number | null
          id?: string
          legal_hold_at?: string | null
          legal_hold_epoch?: number
          legal_hold_reason?: string | null
          mime_type: string
          original_filename: string
          profile_id: string
          quota_slot: number
          scan_attempts?: number
          scan_config_fingerprint?: string | null
          scan_error?: string | null
          scan_fencing_token?: number
          scan_lease_expires_at?: string | null
          scan_lease_token?: string | null
          scan_proven_at?: string | null
          scanned_checksum?: string | null
          scanner_verdict_id?: string | null
          state_version?: number
          storage_object_key: string
          upload_state?: string
          website_id: string
          width?: number | null
        }
        Update: {
          appointment_id?: string
          byte_size?: number
          checksum?: string
          cleanup_fencing_token?: number
          cleanup_lease_expires_at?: string | null
          cleanup_lease_token?: string | null
          cleanup_reason?: string | null
          created_at?: string
          current_object_generation?: number
          customer_id?: string
          deleted_at?: string | null
          display_filename?: string
          environment?: string
          finalized_at?: string | null
          height?: number | null
          id?: string
          legal_hold_at?: string | null
          legal_hold_epoch?: number
          legal_hold_reason?: string | null
          mime_type?: string
          original_filename?: string
          profile_id?: string
          quota_slot?: number
          scan_attempts?: number
          scan_config_fingerprint?: string | null
          scan_error?: string | null
          scan_fencing_token?: number
          scan_lease_expires_at?: string | null
          scan_lease_token?: string | null
          scan_proven_at?: string | null
          scanned_checksum?: string | null
          scanner_verdict_id?: string | null
          state_version?: number
          storage_object_key?: string
          upload_state?: string
          website_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_attachments_exact_appointment_fkey"
            columns: [
              "appointment_id",
              "customer_id",
              "website_id",
              "profile_id",
              "environment",
            ]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: [
              "id",
              "customer_id",
              "website_id",
              "profile_id",
              "environment",
            ]
          },
        ]
      }
      booking_availability_cache: {
        Row: {
          availability_generation: number
          busy_ranges: Json
          cache_key: string
          calendar_set_hash: string
          connection_id: string
          created_at: string
          environment: string
          expires_at: string
          observed_at: string
          profile_id: string
          range_end: string
          range_start: string
          schedule_revision: number
          service_revision: number
        }
        Insert: {
          availability_generation: number
          busy_ranges: Json
          cache_key: string
          calendar_set_hash: string
          connection_id: string
          created_at?: string
          environment: string
          expires_at: string
          observed_at: string
          profile_id: string
          range_end: string
          range_start: string
          schedule_revision: number
          service_revision: number
        }
        Update: {
          availability_generation?: number
          busy_ranges?: Json
          cache_key?: string
          calendar_set_hash?: string
          connection_id?: string
          created_at?: string
          environment?: string
          expires_at?: string
          observed_at?: string
          profile_id?: string
          range_end?: string
          range_start?: string
          schedule_revision?: number
          service_revision?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_availability_cache_connection_id_profile_id_enviro_fkey"
            columns: ["connection_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      booking_calendar_effect_attempts: {
        Row: {
          action: string
          appointment_id: string
          appointment_version: number
          completed_at: string | null
          connection_revision: number | null
          desired_generation: number
          destination_epoch_id: string
          environment: string
          fencing_token: number
          google_event_id: string
          id: string
          intended_content_sha256: string | null
          lease_token: string
          link_id: string
          outcome: string | null
          outcome_sha256: string | null
          profile_id: string
          provider_status: number | null
          started_at: string
        }
        Insert: {
          action: string
          appointment_id: string
          appointment_version: number
          completed_at?: string | null
          connection_revision?: number | null
          desired_generation: number
          destination_epoch_id: string
          environment: string
          fencing_token: number
          google_event_id: string
          id?: string
          intended_content_sha256?: string | null
          lease_token: string
          link_id: string
          outcome?: string | null
          outcome_sha256?: string | null
          profile_id: string
          provider_status?: number | null
          started_at?: string
        }
        Update: {
          action?: string
          appointment_id?: string
          appointment_version?: number
          completed_at?: string | null
          connection_revision?: number | null
          desired_generation?: number
          destination_epoch_id?: string
          environment?: string
          fencing_token?: number
          google_event_id?: string
          id?: string
          intended_content_sha256?: string | null
          lease_token?: string
          link_id?: string
          outcome?: string | null
          outcome_sha256?: string | null
          profile_id?: string
          provider_status?: number | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_calendar_effect_attem_appointment_id_profile_id_en_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_calendar_effect_attempts_destination_epoch_id_fkey"
            columns: ["destination_epoch_id"]
            isOneToOne: false
            referencedRelation: "calendar_destination_epochs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_calendar_effect_attempts_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "calendar_event_links"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_calendar_observations: {
        Row: {
          appointment_id: string
          appointment_version: number
          created_at: string
          desired_generation: number
          desired_state: string
          destination_epoch_id: string
          environment: string
          fencing_token: number
          google_event_id: string
          id: string
          lease_token: string
          link_id: string
          observation_sha256: string
          observed_at: string
          observed_state: string
          phase: string
          profile_id: string
        }
        Insert: {
          appointment_id: string
          appointment_version: number
          created_at?: string
          desired_generation: number
          desired_state: string
          destination_epoch_id: string
          environment: string
          fencing_token: number
          google_event_id: string
          id?: string
          lease_token: string
          link_id: string
          observation_sha256: string
          observed_at: string
          observed_state: string
          phase: string
          profile_id: string
        }
        Update: {
          appointment_id?: string
          appointment_version?: number
          created_at?: string
          desired_generation?: number
          desired_state?: string
          destination_epoch_id?: string
          environment?: string
          fencing_token?: number
          google_event_id?: string
          id?: string
          lease_token?: string
          link_id?: string
          observation_sha256?: string
          observed_at?: string
          observed_state?: string
          phase?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_calendar_observations_appointment_id_profile_id_en_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_calendar_observations_destination_epoch_id_fkey"
            columns: ["destination_epoch_id"]
            isOneToOne: false
            referencedRelation: "calendar_destination_epochs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_calendar_observations_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "calendar_event_links"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_calendar_repair_audit: {
        Row: {
          actor_user_id: string
          appointment_id: string | null
          created_at: string
          environment: string
          evidence: Json | null
          expected_generation: number
          id: number
          link_id: string
          prior_state: Json
          profile_id: string
          reason: string
          request_id: string | null
        }
        Insert: {
          actor_user_id: string
          appointment_id?: string | null
          created_at?: string
          environment: string
          evidence?: Json | null
          expected_generation: number
          id?: never
          link_id: string
          prior_state: Json
          profile_id: string
          reason: string
          request_id?: string | null
        }
        Update: {
          actor_user_id?: string
          appointment_id?: string | null
          created_at?: string
          environment?: string
          evidence?: Json | null
          expected_generation?: number
          id?: never
          link_id?: string
          prior_state?: Json
          profile_id?: string
          reason?: string
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_calendar_repair_audit_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_calendar_repair_audit_link_id_fkey"
            columns: ["link_id"]
            isOneToOne: false
            referencedRelation: "calendar_event_links"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_confirmation_capabilities: {
        Row: {
          appointment_id: string
          checkout_session_id: string
          consumed_at: string | null
          created_at: string
          environment: string
          expires_at: string
          id: string
          profile_id: string
          public_reference: string
          token_hash: string
        }
        Insert: {
          appointment_id: string
          checkout_session_id: string
          consumed_at?: string | null
          created_at?: string
          environment: string
          expires_at: string
          id?: string
          profile_id: string
          public_reference: string
          token_hash: string
        }
        Update: {
          appointment_id?: string
          checkout_session_id?: string
          consumed_at?: string | null
          created_at?: string
          environment?: string
          expires_at?: string
          id?: string
          profile_id?: string
          public_reference?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_confirmation_capabili_appointment_id_profile_id_en_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      booking_convergence_cutover_snapshots: {
        Row: {
          created_at: string
          environment: string
          id: string
          inventory: Json
          inventory_sha256: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          environment: string
          id?: string
          inventory: Json
          inventory_sha256: string
          profile_id: string
        }
        Update: {
          created_at?: string
          environment?: string
          id?: string
          inventory?: Json
          inventory_sha256?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_convergence_cutover_snapsho_profile_id_environment_fkey"
            columns: ["profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
        ]
      }
      booking_customers: {
        Row: {
          address_snapshot: Json
          consent_digest: string | null
          consent_document_id: string | null
          consent_version: string | null
          consented_at: string | null
          created_at: string
          email_normalized: string
          environment: string
          full_name: string
          id: string
          identity_fingerprint: string | null
          notes: string | null
          phone_normalized: string
          profile_id: string
          source_website_id: string
        }
        Insert: {
          address_snapshot: Json
          consent_digest?: string | null
          consent_document_id?: string | null
          consent_version?: string | null
          consented_at?: string | null
          created_at?: string
          email_normalized: string
          environment: string
          full_name: string
          id?: string
          identity_fingerprint?: string | null
          notes?: string | null
          phone_normalized: string
          profile_id: string
          source_website_id: string
        }
        Update: {
          address_snapshot?: Json
          consent_digest?: string | null
          consent_document_id?: string | null
          consent_version?: string | null
          consented_at?: string | null
          created_at?: string
          email_normalized?: string
          environment?: string
          full_name?: string
          id?: string
          identity_fingerprint?: string | null
          notes?: string | null
          phone_normalized?: string
          profile_id?: string
          source_website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_customers_profile_id_environment_fkey"
            columns: ["profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
          {
            foreignKeyName: "booking_customers_source_website_id_profile_id_environment_fkey"
            columns: ["source_website_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id", "user_id", "environment"]
          },
        ]
      }
      booking_cutover_preflight_items_v3: {
        Row: {
          blocker_count: number
          check_key: string
          evidence: Json
          evidence_sha256: string
          preflight_id: string
        }
        Insert: {
          blocker_count?: number
          check_key: string
          evidence: Json
          evidence_sha256: string
          preflight_id: string
        }
        Update: {
          blocker_count?: number
          check_key?: string
          evidence?: Json
          evidence_sha256?: string
          preflight_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_cutover_preflight_items_v3_preflight_id_fkey"
            columns: ["preflight_id"]
            isOneToOne: false
            referencedRelation: "booking_cutover_preflights_v3"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_cutover_preflights_v3: {
        Row: {
          captured_at: string
          captured_xid: unknown
          environment: string
          id: string
          inventory: Json
          inventory_sha256: string
          migration_marker: string
          profile_id: string
          target_contract_version: number
        }
        Insert: {
          captured_at?: string
          captured_xid?: unknown
          environment: string
          id?: string
          inventory: Json
          inventory_sha256: string
          migration_marker: string
          profile_id: string
          target_contract_version: number
        }
        Update: {
          captured_at?: string
          captured_xid?: unknown
          environment?: string
          id?: string
          inventory?: Json
          inventory_sha256?: string
          migration_marker?: string
          profile_id?: string
          target_contract_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_cutover_preflights_v3_profile_id_environment_fkey"
            columns: ["profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
        ]
      }
      booking_cutover_quarantine: {
        Row: {
          created_at: string
          entity_id: string
          entity_kind: string
          environment: string | null
          evidence_hash: string
          id: number
          profile_id: string | null
          reason_code: string
          resolution: string | null
          resolved_at: string | null
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_kind: string
          environment?: string | null
          evidence_hash: string
          id?: never
          profile_id?: string | null
          reason_code: string
          resolution?: string | null
          resolved_at?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_kind?: string
          environment?: string | null
          evidence_hash?: string
          id?: never
          profile_id?: string | null
          reason_code?: string
          resolution?: string | null
          resolved_at?: string | null
        }
        Relationships: []
      }
      booking_cutover_state: {
        Row: {
          accepted_preflight_id: string | null
          convergence_prepared_at: string | null
          convergence_snapshot_id: string | null
          enabled_at: string | null
          environment: string
          preflight_completed_at: string | null
          preflight_digest: string | null
          profile_id: string
          status: string
          target_contract_version: number
        }
        Insert: {
          accepted_preflight_id?: string | null
          convergence_prepared_at?: string | null
          convergence_snapshot_id?: string | null
          enabled_at?: string | null
          environment: string
          preflight_completed_at?: string | null
          preflight_digest?: string | null
          profile_id: string
          status?: string
          target_contract_version?: number
        }
        Update: {
          accepted_preflight_id?: string | null
          convergence_prepared_at?: string | null
          convergence_snapshot_id?: string | null
          enabled_at?: string | null
          environment?: string
          preflight_completed_at?: string | null
          preflight_digest?: string | null
          profile_id?: string
          status?: string
          target_contract_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_cutover_state_accepted_preflight_fk"
            columns: ["accepted_preflight_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "booking_cutover_preflights_v3"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_cutover_state_convergence_snapshot_fk"
            columns: ["convergence_snapshot_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "booking_convergence_cutover_snapshots"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      booking_late_payment_arbitrations: {
        Row: {
          appointment_id: string
          attempts: number
          claimed_at: string | null
          created_at: string
          deadline_at: string
          decided_at: string | null
          decision_code: string | null
          environment: string
          fencing_token: number
          generation: number
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          payment_id: string
          profile_id: string
          provider_event_id: string | null
          snapshot_appointment_version: number | null
          snapshot_availability_generation: number | null
          snapshot_calendar_ids: Json
          snapshot_calendar_set_hash: string | null
          snapshot_connection_id: string | null
          snapshot_generation: number
          snapshot_pipedream_account_id: string | null
          snapshot_schedule_revision: number | null
          snapshot_service_revision: number | null
          status: string
          updated_at: string
        }
        Insert: {
          appointment_id: string
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          deadline_at: string
          decided_at?: string | null
          decision_code?: string | null
          environment: string
          fencing_token?: number
          generation: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          payment_id: string
          profile_id: string
          provider_event_id?: string | null
          snapshot_appointment_version?: number | null
          snapshot_availability_generation?: number | null
          snapshot_calendar_ids?: Json
          snapshot_calendar_set_hash?: string | null
          snapshot_connection_id?: string | null
          snapshot_generation?: number
          snapshot_pipedream_account_id?: string | null
          snapshot_schedule_revision?: number | null
          snapshot_service_revision?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          appointment_id?: string
          attempts?: number
          claimed_at?: string | null
          created_at?: string
          deadline_at?: string
          decided_at?: string | null
          decision_code?: string | null
          environment?: string
          fencing_token?: number
          generation?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          payment_id?: string
          profile_id?: string
          provider_event_id?: string | null
          snapshot_appointment_version?: number | null
          snapshot_availability_generation?: number | null
          snapshot_calendar_ids?: Json
          snapshot_calendar_set_hash?: string | null
          snapshot_connection_id?: string | null
          snapshot_generation?: number
          snapshot_pipedream_account_id?: string | null
          snapshot_schedule_revision?: number | null
          snapshot_service_revision?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_late_payment_arbitrat_appointment_id_profile_id_en_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_late_payment_arbitrations_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_late_payment_arbitrations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "booking_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_late_payment_arbitrations_provider_event_id_fkey"
            columns: ["provider_event_id"]
            isOneToOne: true
            referencedRelation: "booking_provider_evidence"
            referencedColumns: ["event_id"]
          },
        ]
      }
      booking_late_payment_observations: {
        Row: {
          arbitration_id: string
          busy_ranges: Json
          created_at: string
          fencing_token: number
          id: string
          lease_token: string
          observation_state: string
          observed_at: string
          request_sha256: string
          response_sha256: string
          safe_error: string | null
          snapshot_generation: number
        }
        Insert: {
          arbitration_id: string
          busy_ranges?: Json
          created_at?: string
          fencing_token: number
          id?: string
          lease_token: string
          observation_state: string
          observed_at: string
          request_sha256: string
          response_sha256: string
          safe_error?: string | null
          snapshot_generation: number
        }
        Update: {
          arbitration_id?: string
          busy_ranges?: Json
          created_at?: string
          fencing_token?: number
          id?: string
          lease_token?: string
          observation_state?: string
          observed_at?: string
          request_sha256?: string
          response_sha256?: string
          safe_error?: string | null
          snapshot_generation?: number
        }
        Relationships: [
          {
            foreignKeyName: "booking_late_payment_observations_arbitration_id_fkey"
            columns: ["arbitration_id"]
            isOneToOne: false
            referencedRelation: "booking_late_payment_arbitrations"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notification_delivery_events: {
        Row: {
          delivery_rank: number
          environment: string | null
          event_type: string
          occurred_at: string
          provider_event_id: string
          provider_message_id: string
          received_at: string
        }
        Insert: {
          delivery_rank?: number
          environment?: string | null
          event_type: string
          occurred_at: string
          provider_event_id: string
          provider_message_id: string
          received_at?: string
        }
        Update: {
          delivery_rank?: number
          environment?: string | null
          event_type?: string
          occurred_at?: string
          provider_event_id?: string
          provider_message_id?: string
          received_at?: string
        }
        Relationships: []
      }
      booking_notification_delivery_review_v3: {
        Row: {
          appointment_id: string
          attempts: number
          environment: string
          notification_id: string
          profile_id: string
          queued_at: string
          reason_code: string
          resolved_at: string | null
          safe_error: string
        }
        Insert: {
          appointment_id: string
          attempts: number
          environment: string
          notification_id: string
          profile_id: string
          queued_at?: string
          reason_code: string
          resolved_at?: string | null
          safe_error: string
        }
        Update: {
          appointment_id?: string
          attempts?: number
          environment?: string
          notification_id?: string
          profile_id?: string
          queued_at?: string
          reason_code?: string
          resolved_at?: string | null
          safe_error?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_notification_delivery_review_v3_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "booking_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notification_projection_repairs_v3: {
        Row: {
          appointment_id: string
          attempts: number
          environment: string
          failed_at: string
          profile_id: string
          safe_error: string
          sqlstate: string
        }
        Insert: {
          appointment_id: string
          attempts?: number
          environment: string
          failed_at?: string
          profile_id: string
          safe_error: string
          sqlstate: string
        }
        Update: {
          appointment_id?: string
          attempts?: number
          environment?: string
          failed_at?: string
          profile_id?: string
          safe_error?: string
          sqlstate?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_notification_projection_repairs_v3_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: true
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notifications: {
        Row: {
          accepted_at: string | null
          appointment_id: string
          attempts: number
          audience: string
          created_at: string
          delivered_at: string | null
          delivery_rank: number
          dispatch_appointment: Json | null
          dispatch_payload: string | null
          environment: string
          failed_at: string | null
          fencing_token: number
          first_dispatch_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_provider_event_at: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          notification_type: string
          occurrence_version: number
          profile_id: string
          projected_at: string
          provider_destination: string
          provider_event_id: string | null
          provider_message_id: string | null
          recipient_email: string | null
          replay_deadline_at: string | null
          source_event_key: string
          state: string
          suppression_reason: string | null
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          appointment_id: string
          attempts?: number
          audience: string
          created_at?: string
          delivered_at?: string | null
          delivery_rank?: number
          dispatch_appointment?: Json | null
          dispatch_payload?: string | null
          environment: string
          failed_at?: string | null
          fencing_token?: number
          first_dispatch_at?: string | null
          id?: string
          idempotency_key: string
          last_error?: string | null
          last_provider_event_at?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          notification_type: string
          occurrence_version: number
          profile_id: string
          projected_at?: string
          provider_destination?: string
          provider_event_id?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          replay_deadline_at?: string | null
          source_event_key: string
          state?: string
          suppression_reason?: string | null
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          appointment_id?: string
          attempts?: number
          audience?: string
          created_at?: string
          delivered_at?: string | null
          delivery_rank?: number
          dispatch_appointment?: Json | null
          dispatch_payload?: string | null
          environment?: string
          failed_at?: string | null
          fencing_token?: number
          first_dispatch_at?: string | null
          id?: string
          idempotency_key?: string
          last_error?: string | null
          last_provider_event_at?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          notification_type?: string
          occurrence_version?: number
          profile_id?: string
          projected_at?: string
          provider_destination?: string
          provider_event_id?: string | null
          provider_message_id?: string | null
          recipient_email?: string | null
          replay_deadline_at?: string | null
          source_event_key?: string
          state?: string
          suppression_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_notifications_appointment_id_profile_id_environmen_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      booking_payments: {
        Row: {
          amount_paid_minor: number
          amount_refunded_minor: number
          appointment_id: string
          booking_contract_version: number | null
          charge_id: string | null
          checkout_expires_at: string | null
          checkout_fencing_token: number
          checkout_idempotency_key: string | null
          checkout_last_error: string | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_id: string | null
          checkout_provider_expires_at: string | null
          checkout_session_id: string | null
          confirmation_handoff_expires_at: string | null
          confirmation_nonce_hash: string | null
          connected_account_id: string | null
          created_at: string
          currency: string
          dispute_id: string | null
          dispute_provider_created: number
          dispute_state: string
          dispute_status_rank: number
          environment: string
          expected_amount_minor: number
          failed_at: string | null
          failure_code: string | null
          financial_event_rank: number
          financial_provider_created: number
          financial_provider_event_id: string | null
          id: string
          paid_at: string | null
          payment_intent_id: string | null
          payment_state: string
          profile_id: string
          provider_created_at: string | null
          provider_updated_at: string | null
          receipt_url: string | null
          refund_generation: number
          refund_id: string | null
          refund_idempotency_key: string | null
          refund_requested_at: string | null
          refund_state: string
          refunded_at: string | null
          session_expiry_attempts: number
          session_expiry_next_attempt_at: string
          stripe_account_id: string | null
          updated_at: string
        }
        Insert: {
          amount_paid_minor?: number
          amount_refunded_minor?: number
          appointment_id: string
          booking_contract_version?: number | null
          charge_id?: string | null
          checkout_expires_at?: string | null
          checkout_fencing_token?: number
          checkout_idempotency_key?: string | null
          checkout_last_error?: string | null
          checkout_lease_expires_at?: string | null
          checkout_lease_token?: string | null
          checkout_operation_id?: string | null
          checkout_provider_expires_at?: string | null
          checkout_session_id?: string | null
          confirmation_handoff_expires_at?: string | null
          confirmation_nonce_hash?: string | null
          connected_account_id?: string | null
          created_at?: string
          currency: string
          dispute_id?: string | null
          dispute_provider_created?: number
          dispute_state?: string
          dispute_status_rank?: number
          environment: string
          expected_amount_minor: number
          failed_at?: string | null
          failure_code?: string | null
          financial_event_rank?: number
          financial_provider_created?: number
          financial_provider_event_id?: string | null
          id?: string
          paid_at?: string | null
          payment_intent_id?: string | null
          payment_state?: string
          profile_id: string
          provider_created_at?: string | null
          provider_updated_at?: string | null
          receipt_url?: string | null
          refund_generation?: number
          refund_id?: string | null
          refund_idempotency_key?: string | null
          refund_requested_at?: string | null
          refund_state?: string
          refunded_at?: string | null
          session_expiry_attempts?: number
          session_expiry_next_attempt_at?: string
          stripe_account_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_paid_minor?: number
          amount_refunded_minor?: number
          appointment_id?: string
          booking_contract_version?: number | null
          charge_id?: string | null
          checkout_expires_at?: string | null
          checkout_fencing_token?: number
          checkout_idempotency_key?: string | null
          checkout_last_error?: string | null
          checkout_lease_expires_at?: string | null
          checkout_lease_token?: string | null
          checkout_operation_id?: string | null
          checkout_provider_expires_at?: string | null
          checkout_session_id?: string | null
          confirmation_handoff_expires_at?: string | null
          confirmation_nonce_hash?: string | null
          connected_account_id?: string | null
          created_at?: string
          currency?: string
          dispute_id?: string | null
          dispute_provider_created?: number
          dispute_state?: string
          dispute_status_rank?: number
          environment?: string
          expected_amount_minor?: number
          failed_at?: string | null
          failure_code?: string | null
          financial_event_rank?: number
          financial_provider_created?: number
          financial_provider_event_id?: string | null
          id?: string
          paid_at?: string | null
          payment_intent_id?: string | null
          payment_state?: string
          profile_id?: string
          provider_created_at?: string | null
          provider_updated_at?: string | null
          receipt_url?: string | null
          refund_generation?: number
          refund_id?: string | null
          refund_idempotency_key?: string | null
          refund_requested_at?: string | null
          refund_state?: string
          refunded_at?: string | null
          session_expiry_attempts?: number
          session_expiry_next_attempt_at?: string
          stripe_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_payments_appointment_id_profile_id_environment_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_payments_checkout_operation_fk"
            columns: ["checkout_operation_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointment_operations"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_payments_connected_account_id_profile_id_environme_fkey"
            columns: ["connected_account_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "stripe_connected_accounts"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      booking_provider_account_disconnects_v3: {
        Row: {
          actor_auth_user_id: string
          attempts: number
          completed_at: string | null
          connection_id: string | null
          dispatch_state: string
          dispatched_at: string | null
          environment: string
          failure_reason: string | null
          fencing_token: number
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          profile_id: string
          provider: string
          provider_account_id: string
          requested_at: string
          requested_connection_revision: number | null
          retry_at: string | null
          state: string
          unresolved_setup_calendar_id: string | null
          unresolved_setup_operation_id: string | null
        }
        Insert: {
          actor_auth_user_id: string
          attempts?: number
          completed_at?: string | null
          connection_id?: string | null
          dispatch_state?: string
          dispatched_at?: string | null
          environment: string
          failure_reason?: string | null
          fencing_token?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          profile_id: string
          provider: string
          provider_account_id: string
          requested_at?: string
          requested_connection_revision?: number | null
          retry_at?: string | null
          state?: string
          unresolved_setup_calendar_id?: string | null
          unresolved_setup_operation_id?: string | null
        }
        Update: {
          actor_auth_user_id?: string
          attempts?: number
          completed_at?: string | null
          connection_id?: string | null
          dispatch_state?: string
          dispatched_at?: string | null
          environment?: string
          failure_reason?: string | null
          fencing_token?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          profile_id?: string
          provider?: string
          provider_account_id?: string
          requested_at?: string
          requested_connection_revision?: number | null
          retry_at?: string | null
          state?: string
          unresolved_setup_calendar_id?: string | null
          unresolved_setup_operation_id?: string | null
        }
        Relationships: []
      }
      booking_provider_evidence: {
        Row: {
          appointment_id: string
          environment: string
          event_id: string
          event_type: string
          object_id: string
          observed_at: string
          payload_sha256: string
          profile_id: string
          provider_event_id: string
          stripe_account_id: string
        }
        Insert: {
          appointment_id: string
          environment: string
          event_id: string
          event_type: string
          object_id: string
          observed_at?: string
          payload_sha256: string
          profile_id: string
          provider_event_id: string
          stripe_account_id: string
        }
        Update: {
          appointment_id?: string
          environment?: string
          event_id?: string
          event_type?: string
          object_id?: string
          observed_at?: string
          payload_sha256?: string
          profile_id?: string
          provider_event_id?: string
          stripe_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_provider_evidence_appointment_id_profile_id_enviro_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_provider_evidence_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "provider_event_inbox"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_receipt_capabilities_v3: {
        Row: {
          access_count: number
          appointment_id: string
          checkout_session_id: string
          created_at: string
          environment: string
          expires_at: string
          first_accessed_at: string | null
          id: string
          issued_nonce_hash: string
          last_accessed_at: string | null
          profile_id: string
          public_reference: string
          token_hash: string
        }
        Insert: {
          access_count?: number
          appointment_id: string
          checkout_session_id: string
          created_at?: string
          environment: string
          expires_at: string
          first_accessed_at?: string | null
          id?: string
          issued_nonce_hash: string
          last_accessed_at?: string | null
          profile_id: string
          public_reference: string
          token_hash: string
        }
        Update: {
          access_count?: number
          appointment_id?: string
          checkout_session_id?: string
          created_at?: string
          environment?: string
          expires_at?: string
          first_accessed_at?: string | null
          id?: string
          issued_nonce_hash?: string
          last_accessed_at?: string | null
          profile_id?: string
          public_reference?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_receipt_capabilities__appointment_id_profile_id_en_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      booking_refunds: {
        Row: {
          amount_minor: number
          appointment_id: string
          created_at: string
          environment: string
          generation: number
          id: string
          idempotency_key: string
          payment_id: string
          payment_intent_id: string
          profile_id: string
          provider_created: number | null
          provider_updated_at: string | null
          settled_by_external: boolean
          state: string
          stripe_account_id: string
          stripe_refund_id: string | null
          updated_at: string
        }
        Insert: {
          amount_minor: number
          appointment_id: string
          created_at?: string
          environment: string
          generation: number
          id?: string
          idempotency_key: string
          payment_id: string
          payment_intent_id: string
          profile_id: string
          provider_created?: number | null
          provider_updated_at?: string | null
          settled_by_external?: boolean
          state?: string
          stripe_account_id: string
          stripe_refund_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          appointment_id?: string
          created_at?: string
          environment?: string
          generation?: number
          id?: string
          idempotency_key?: string
          payment_id?: string
          payment_intent_id?: string
          profile_id?: string
          provider_created?: number | null
          provider_updated_at?: string | null
          settled_by_external?: boolean
          state?: string
          stripe_account_id?: string
          stripe_refund_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_refunds_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_refunds_payment_correlation_fk"
            columns: [
              "payment_id",
              "appointment_id",
              "profile_id",
              "environment",
              "stripe_account_id",
              "payment_intent_id",
            ]
            isOneToOne: false
            referencedRelation: "booking_payments"
            referencedColumns: [
              "id",
              "appointment_id",
              "profile_id",
              "environment",
              "stripe_account_id",
              "payment_intent_id",
            ]
          },
          {
            foreignKeyName: "booking_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "booking_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_services: {
        Row: {
          active: boolean
          amount_minor: number
          booking_horizon_days: number
          buffer_after_minutes: number
          buffer_before_minutes: number
          created_at: string
          currency: string
          description: string | null
          duration_minutes: number
          environment: string
          id: string
          location_instructions: string | null
          location_type: string
          minimum_notice_minutes: number
          name: string
          payment_policy: string
          profile_id: string
          revision: number
          slot_interval_minutes: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          amount_minor: number
          booking_horizon_days?: number
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string
          currency?: string
          description?: string | null
          duration_minutes?: number
          environment: string
          id?: string
          location_instructions?: string | null
          location_type?: string
          minimum_notice_minutes?: number
          name?: string
          payment_policy?: string
          profile_id: string
          revision?: number
          slot_interval_minutes?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          amount_minor?: number
          booking_horizon_days?: number
          buffer_after_minutes?: number
          buffer_before_minutes?: number
          created_at?: string
          currency?: string
          description?: string | null
          duration_minutes?: number
          environment?: string
          id?: string
          location_instructions?: string | null
          location_type?: string
          minimum_notice_minutes?: number
          name?: string
          payment_policy?: string
          profile_id?: string
          revision?: number
          slot_interval_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_services_profile_id_environment_fkey"
            columns: ["profile_id", "environment"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
        ]
      }
      booking_stripe_observations_v3: {
        Row: {
          appointment_id: string
          authority_id: string
          authority_kind: string
          charge_id: string | null
          checkout_session_id: string | null
          command_id: string | null
          cumulative_refunded_minor: number | null
          envelope_sha256: string | null
          environment: string
          event_id: string | null
          event_type: string | null
          id: string
          observed_at: string
          payment_id: string
          payment_intent_id: string | null
          profile_id: string
          provider_created: number
          provider_event_id: string | null
          provider_snapshot: Json
          reduction_outcome: string
          snapshot_sha256: string
          stripe_account_id: string
        }
        Insert: {
          appointment_id: string
          authority_id: string
          authority_kind: string
          charge_id?: string | null
          checkout_session_id?: string | null
          command_id?: string | null
          cumulative_refunded_minor?: number | null
          envelope_sha256?: string | null
          environment: string
          event_id?: string | null
          event_type?: string | null
          id?: string
          observed_at?: string
          payment_id: string
          payment_intent_id?: string | null
          profile_id: string
          provider_created?: number
          provider_event_id?: string | null
          provider_snapshot: Json
          reduction_outcome: string
          snapshot_sha256: string
          stripe_account_id: string
        }
        Update: {
          appointment_id?: string
          authority_id?: string
          authority_kind?: string
          charge_id?: string | null
          checkout_session_id?: string | null
          command_id?: string | null
          cumulative_refunded_minor?: number | null
          envelope_sha256?: string | null
          environment?: string
          event_id?: string | null
          event_type?: string | null
          id?: string
          observed_at?: string
          payment_id?: string
          payment_intent_id?: string | null
          profile_id?: string
          provider_created?: number
          provider_event_id?: string | null
          provider_snapshot?: Json
          reduction_outcome?: string
          snapshot_sha256?: string
          stripe_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_stripe_observations_v_appointment_id_profile_id_en_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_stripe_observations_v3_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_stripe_observations_v3_command_id_fkey"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "integration_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_stripe_observations_v3_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "provider_event_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_stripe_observations_v3_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "booking_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_stripe_refund_observations_v3: {
        Row: {
          amount_minor: number
          currency: string
          metadata: Json
          observation_id: string
          payment_intent_id: string
          provider_created: number
          status: string
          stripe_charge_id: string
          stripe_refund_id: string
        }
        Insert: {
          amount_minor: number
          currency: string
          metadata?: Json
          observation_id: string
          payment_intent_id: string
          provider_created: number
          status: string
          stripe_charge_id: string
          stripe_refund_id: string
        }
        Update: {
          amount_minor?: number
          currency?: string
          metadata?: Json
          observation_id?: string
          payment_intent_id?: string
          provider_created?: number
          status?: string
          stripe_charge_id?: string
          stripe_refund_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_stripe_refund_observations_v3_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "booking_stripe_observations_v3"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_upload_contexts_v3: {
        Row: {
          appointment_id: string
          created_at: string
          environment: string
          expires_at: string
          id: string
          max_bytes: number
          max_files: number
          profile_id: string
          request_hash: string
          state: string
          token_hash: string
          website_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          environment: string
          expires_at: string
          id: string
          max_bytes?: number
          max_files?: number
          profile_id: string
          request_hash: string
          state?: string
          token_hash: string
          website_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          environment?: string
          expires_at?: string
          id?: string
          max_bytes?: number
          max_files?: number
          profile_id?: string
          request_hash?: string
          state?: string
          token_hash?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_upload_contexts_v3_appointment_id_profile_id_envir_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "booking_upload_contexts_v3_website_id_profile_id_environme_fkey"
            columns: ["website_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id", "user_id", "environment"]
          },
        ]
      }
      booking_upload_grants_v3: {
        Row: {
          attachment_id: string
          context_id: string
          created_at: string
          environment: string
          expires_at: string
          generation: number
          id: string
          profile_id: string
          quota_slot: number
          request_hash: string
          request_id: string
          result: Json | null
          state: string
          token_hash: string
        }
        Insert: {
          attachment_id: string
          context_id: string
          created_at?: string
          environment: string
          expires_at: string
          generation: number
          id: string
          profile_id: string
          quota_slot: number
          request_hash: string
          request_id: string
          result?: Json | null
          state?: string
          token_hash: string
        }
        Update: {
          attachment_id?: string
          context_id?: string
          created_at?: string
          environment?: string
          expires_at?: string
          generation?: number
          id?: string
          profile_id?: string
          quota_slot?: number
          request_hash?: string
          request_id?: string
          result?: Json | null
          state?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_upload_grants_v3_attachment_id_generation_fkey"
            columns: ["attachment_id", "generation"]
            isOneToOne: false
            referencedRelation: "booking_attachment_objects_v3"
            referencedColumns: ["attachment_id", "generation"]
          },
          {
            foreignKeyName: "booking_upload_grants_v3_context_id_profile_id_environment_fkey"
            columns: ["context_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "booking_upload_contexts_v3"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      booking_worker_family_leases_v3: {
        Row: {
          environment: string
          family: string
          fencing_token: number
          last_completed_at: string | null
          last_error: string | null
          last_started_at: string | null
          last_success: boolean | null
          lease_expires_at: string | null
          lease_token: string | null
        }
        Insert: {
          environment: string
          family: string
          fencing_token?: number
          last_completed_at?: string | null
          last_error?: string | null
          last_started_at?: string | null
          last_success?: boolean | null
          lease_expires_at?: string | null
          lease_token?: string | null
        }
        Update: {
          environment?: string
          family?: string
          fencing_token?: number
          last_completed_at?: string | null
          last_error?: string | null
          last_started_at?: string | null
          last_success?: boolean | null
          lease_expires_at?: string | null
          lease_token?: string | null
        }
        Relationships: []
      }
      calendar_connections: {
        Row: {
          account_display_name: string | null
          account_email: string | null
          action_notice: Json
          action_notice_due_at: string | null
          action_notice_fencing_token: number
          action_notice_lease_expires_at: string | null
          action_notice_lease_token: string | null
          app_slug: string
          availability_generation: number
          calendar_create_blocked_at: string | null
          calendar_create_verified_at: string | null
          calendar_delete_blocked_at: string | null
          calendar_delete_verified_at: string | null
          calendar_probe_insert_blocked_at: string | null
          calendar_probe_insert_verified_at: string | null
          calendar_write_blocked_at: string | null
          calendar_write_verified_at: string | null
          connect_actor_auth_user_id: string | null
          connect_completed_at: string | null
          connect_expected_revision: number | null
          connect_expected_setup_key: string | null
          connect_expires_at: string | null
          connect_operation_id: string | null
          connect_started_at: string | null
          connection_revision: number
          created_at: string
          disconnected_at: string | null
          environment: string
          external_user_id: string
          health_state: string
          id: string
          identity_metadata: Json
          last_synchronized_at: string | null
          last_verified_at: string | null
          owner_verification_requested_at: string | null
          pipedream_account_id: string | null
          profile_id: string
          reconnect_reason: string | null
          setup_account_display_name: string | null
          setup_account_email: string | null
          setup_account_id: string | null
          setup_actor_auth_user_id: string | null
          setup_attempts: number
          setup_calendar_id: string | null
          setup_calendars: Json | null
          setup_completed_at: string | null
          setup_connect_operation_id: string | null
          setup_expected_revision: number | null
          setup_failure_reason: string | null
          setup_fencing_token: number
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_id: string | null
          setup_probe_account_id: string | null
          setup_probe_calendar_id: string | null
          setup_probe_delete_started_at: string | null
          setup_probe_id: string | null
          setup_probe_started_at: string | null
          setup_probe_state: string
          setup_probe_write_verified_at: string | null
          setup_purpose: string
          setup_read_verified_at: string | null
          setup_retry_at: string | null
          setup_write_verified_at: string | null
          updated_at: string
          verification_reason: string | null
        }
        Insert: {
          account_display_name?: string | null
          account_email?: string | null
          action_notice?: Json
          action_notice_due_at?: string | null
          action_notice_fencing_token?: number
          action_notice_lease_expires_at?: string | null
          action_notice_lease_token?: string | null
          app_slug?: string
          availability_generation?: number
          calendar_create_blocked_at?: string | null
          calendar_create_verified_at?: string | null
          calendar_delete_blocked_at?: string | null
          calendar_delete_verified_at?: string | null
          calendar_probe_insert_blocked_at?: string | null
          calendar_probe_insert_verified_at?: string | null
          calendar_write_blocked_at?: string | null
          calendar_write_verified_at?: string | null
          connect_actor_auth_user_id?: string | null
          connect_completed_at?: string | null
          connect_expected_revision?: number | null
          connect_expected_setup_key?: string | null
          connect_expires_at?: string | null
          connect_operation_id?: string | null
          connect_started_at?: string | null
          connection_revision?: number
          created_at?: string
          disconnected_at?: string | null
          environment: string
          external_user_id: string
          health_state?: string
          id?: string
          identity_metadata?: Json
          last_synchronized_at?: string | null
          last_verified_at?: string | null
          owner_verification_requested_at?: string | null
          pipedream_account_id?: string | null
          profile_id: string
          reconnect_reason?: string | null
          setup_account_display_name?: string | null
          setup_account_email?: string | null
          setup_account_id?: string | null
          setup_actor_auth_user_id?: string | null
          setup_attempts?: number
          setup_calendar_id?: string | null
          setup_calendars?: Json | null
          setup_completed_at?: string | null
          setup_connect_operation_id?: string | null
          setup_expected_revision?: number | null
          setup_failure_reason?: string | null
          setup_fencing_token?: number
          setup_lease_expires_at?: string | null
          setup_lease_token?: string | null
          setup_operation_id?: string | null
          setup_probe_account_id?: string | null
          setup_probe_calendar_id?: string | null
          setup_probe_delete_started_at?: string | null
          setup_probe_id?: string | null
          setup_probe_started_at?: string | null
          setup_probe_state?: string
          setup_probe_write_verified_at?: string | null
          setup_purpose?: string
          setup_read_verified_at?: string | null
          setup_retry_at?: string | null
          setup_write_verified_at?: string | null
          updated_at?: string
          verification_reason?: string | null
        }
        Update: {
          account_display_name?: string | null
          account_email?: string | null
          action_notice?: Json
          action_notice_due_at?: string | null
          action_notice_fencing_token?: number
          action_notice_lease_expires_at?: string | null
          action_notice_lease_token?: string | null
          app_slug?: string
          availability_generation?: number
          calendar_create_blocked_at?: string | null
          calendar_create_verified_at?: string | null
          calendar_delete_blocked_at?: string | null
          calendar_delete_verified_at?: string | null
          calendar_probe_insert_blocked_at?: string | null
          calendar_probe_insert_verified_at?: string | null
          calendar_write_blocked_at?: string | null
          calendar_write_verified_at?: string | null
          connect_actor_auth_user_id?: string | null
          connect_completed_at?: string | null
          connect_expected_revision?: number | null
          connect_expected_setup_key?: string | null
          connect_expires_at?: string | null
          connect_operation_id?: string | null
          connect_started_at?: string | null
          connection_revision?: number
          created_at?: string
          disconnected_at?: string | null
          environment?: string
          external_user_id?: string
          health_state?: string
          id?: string
          identity_metadata?: Json
          last_synchronized_at?: string | null
          last_verified_at?: string | null
          owner_verification_requested_at?: string | null
          pipedream_account_id?: string | null
          profile_id?: string
          reconnect_reason?: string | null
          setup_account_display_name?: string | null
          setup_account_email?: string | null
          setup_account_id?: string | null
          setup_actor_auth_user_id?: string | null
          setup_attempts?: number
          setup_calendar_id?: string | null
          setup_calendars?: Json | null
          setup_completed_at?: string | null
          setup_connect_operation_id?: string | null
          setup_expected_revision?: number | null
          setup_failure_reason?: string | null
          setup_fencing_token?: number
          setup_lease_expires_at?: string | null
          setup_lease_token?: string | null
          setup_operation_id?: string | null
          setup_probe_account_id?: string | null
          setup_probe_calendar_id?: string | null
          setup_probe_delete_started_at?: string | null
          setup_probe_id?: string | null
          setup_probe_started_at?: string | null
          setup_probe_state?: string
          setup_probe_write_verified_at?: string | null
          setup_purpose?: string
          setup_read_verified_at?: string | null
          setup_retry_at?: string | null
          setup_write_verified_at?: string | null
          updated_at?: string
          verification_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_profile_id_environment_fkey"
            columns: ["profile_id", "environment"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
        ]
      }
      calendar_destination_epochs: {
        Row: {
          calendar_selection_id: string
          connection_id: string
          connection_revision: number
          created_at: string
          environment: string
          google_calendar_id: string
          id: string
          pipedream_account_id: string
          profile_id: string
          retired_at: string | null
        }
        Insert: {
          calendar_selection_id: string
          connection_id: string
          connection_revision: number
          created_at?: string
          environment: string
          google_calendar_id: string
          id?: string
          pipedream_account_id: string
          profile_id: string
          retired_at?: string | null
        }
        Update: {
          calendar_selection_id?: string
          connection_id?: string
          connection_revision?: number
          created_at?: string
          environment?: string
          google_calendar_id?: string
          id?: string
          pipedream_account_id?: string
          profile_id?: string
          retired_at?: string | null
        }
        Relationships: []
      }
      calendar_event_links: {
        Row: {
          ambiguity_started_at: string | null
          appointment_id: string
          calendar_selection_id: string
          connection_id: string
          created_at: string
          desired_appointment_version: number
          desired_generation: number
          desired_state: string
          destination_epoch_id: string | null
          drift_scan_count: number
          environment: string
          etag: string | null
          failure_code: string | null
          failure_kind: string | null
          failure_observed_at: string | null
          google_event_id: string
          ical_uid: string | null
          id: string
          last_attempt_at: string | null
          last_observation_sha256: string | null
          last_observed_at: string | null
          manual_repair_at: string | null
          manual_repair_reason: string | null
          observed_state: string
          profile_id: string
          reconcile_attempts: number
          reconcile_fencing_token: number
          reconcile_lease_expires_at: string | null
          reconcile_lease_token: string | null
          reconcile_next_attempt_at: string
          reconcile_status: string
          safe_error: string | null
          snapshot_appointment_version: number | null
          snapshot_connection_revision: number | null
          snapshot_desired_generation: number | null
          stability_scan_until: string | null
          sync_state: string
          updated_at: string
        }
        Insert: {
          ambiguity_started_at?: string | null
          appointment_id: string
          calendar_selection_id: string
          connection_id: string
          created_at?: string
          desired_appointment_version: number
          desired_generation: number
          desired_state: string
          destination_epoch_id?: string | null
          drift_scan_count?: number
          environment: string
          etag?: string | null
          failure_code?: string | null
          failure_kind?: string | null
          failure_observed_at?: string | null
          google_event_id: string
          ical_uid?: string | null
          id?: string
          last_attempt_at?: string | null
          last_observation_sha256?: string | null
          last_observed_at?: string | null
          manual_repair_at?: string | null
          manual_repair_reason?: string | null
          observed_state?: string
          profile_id: string
          reconcile_attempts?: number
          reconcile_fencing_token?: number
          reconcile_lease_expires_at?: string | null
          reconcile_lease_token?: string | null
          reconcile_next_attempt_at?: string
          reconcile_status?: string
          safe_error?: string | null
          snapshot_appointment_version?: number | null
          snapshot_connection_revision?: number | null
          snapshot_desired_generation?: number | null
          stability_scan_until?: string | null
          sync_state?: string
          updated_at?: string
        }
        Update: {
          ambiguity_started_at?: string | null
          appointment_id?: string
          calendar_selection_id?: string
          connection_id?: string
          created_at?: string
          desired_appointment_version?: number
          desired_generation?: number
          desired_state?: string
          destination_epoch_id?: string | null
          drift_scan_count?: number
          environment?: string
          etag?: string | null
          failure_code?: string | null
          failure_kind?: string | null
          failure_observed_at?: string | null
          google_event_id?: string
          ical_uid?: string | null
          id?: string
          last_attempt_at?: string | null
          last_observation_sha256?: string | null
          last_observed_at?: string | null
          manual_repair_at?: string | null
          manual_repair_reason?: string | null
          observed_state?: string
          profile_id?: string
          reconcile_attempts?: number
          reconcile_fencing_token?: number
          reconcile_lease_expires_at?: string | null
          reconcile_lease_token?: string | null
          reconcile_next_attempt_at?: string
          reconcile_status?: string
          safe_error?: string | null
          snapshot_appointment_version?: number | null
          snapshot_connection_revision?: number | null
          snapshot_desired_generation?: number | null
          stability_scan_until?: string | null
          sync_state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_event_links_appointment_id_profile_id_environment_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "calendar_event_links_calendar_selection_id_profile_id_envi_fkey"
            columns: ["calendar_selection_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "calendar_selections"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "calendar_event_links_connection_id_profile_id_environment_fkey"
            columns: ["connection_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "calendar_event_links_destination_epoch_fk"
            columns: ["destination_epoch_id"]
            isOneToOne: false
            referencedRelation: "calendar_destination_epochs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_links_selection_connection_tenant_fkey"
            columns: [
              "calendar_selection_id",
              "connection_id",
              "profile_id",
              "environment",
            ]
            isOneToOne: false
            referencedRelation: "calendar_selections"
            referencedColumns: [
              "id",
              "connection_id",
              "profile_id",
              "environment",
            ]
          },
        ]
      }
      calendar_selections: {
        Row: {
          access_role: string | null
          active: boolean
          blocks_availability: boolean
          connection_id: string
          created_at: string
          display_name: string
          environment: string
          google_calendar_id: string
          id: string
          permission_verified_at: string | null
          profile_id: string
          receives_bookings: boolean
          time_zone: string | null
          updated_at: string
        }
        Insert: {
          access_role?: string | null
          active?: boolean
          blocks_availability?: boolean
          connection_id: string
          created_at?: string
          display_name: string
          environment: string
          google_calendar_id: string
          id?: string
          permission_verified_at?: string | null
          profile_id: string
          receives_bookings?: boolean
          time_zone?: string | null
          updated_at?: string
        }
        Update: {
          access_role?: string | null
          active?: boolean
          blocks_availability?: boolean
          connection_id?: string
          created_at?: string
          display_name?: string
          environment?: string
          google_calendar_id?: string
          id?: string
          permission_verified_at?: string | null
          profile_id?: string
          receives_bookings?: boolean
          time_zone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_selections_connection_id_profile_id_environment_fkey"
            columns: ["connection_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      checkout_sessions: {
        Row: {
          business_name: string | null
          city: string | null
          completed_at: string | null
          context_json: Json
          created_at: string
          email: string
          environment: string | null
          full_name: string | null
          id: string
          legacy_evidence_version: number | null
          legal_acceptance_ip_hash: string | null
          legal_acceptance_user_agent: string | null
          legal_accepted_at: string | null
          legal_document_versions: Json | null
          license_number: string
          otp_delivery_claimed_at: string | null
          payment_evidence_kind: string | null
          payment_price_id: string | null
          payment_provider_session_id: string | null
          payment_verified_at: string | null
          plan: string
          profile_id: string | null
          provider_completion_event_id: string | null
          provider_completion_evidence: Json | null
          provider_completion_payload_hash: string | null
          provider_offer_contract_digest: string | null
          provider_offer_contract_id: string | null
          provider_offer_snapshot: Json | null
          status: string
          stripe_checkout_session_id: string | null
          subscription_id: string | null
          template_id: string | null
          template_slug: string | null
          website_id: string | null
        }
        Insert: {
          business_name?: string | null
          city?: string | null
          completed_at?: string | null
          context_json?: Json
          created_at?: string
          email: string
          environment?: string | null
          full_name?: string | null
          id?: string
          legacy_evidence_version?: number | null
          legal_acceptance_ip_hash?: string | null
          legal_acceptance_user_agent?: string | null
          legal_accepted_at?: string | null
          legal_document_versions?: Json | null
          license_number: string
          otp_delivery_claimed_at?: string | null
          payment_evidence_kind?: string | null
          payment_price_id?: string | null
          payment_provider_session_id?: string | null
          payment_verified_at?: string | null
          plan?: string
          profile_id?: string | null
          provider_completion_event_id?: string | null
          provider_completion_evidence?: Json | null
          provider_completion_payload_hash?: string | null
          provider_offer_contract_digest?: string | null
          provider_offer_contract_id?: string | null
          provider_offer_snapshot?: Json | null
          status?: string
          stripe_checkout_session_id?: string | null
          subscription_id?: string | null
          template_id?: string | null
          template_slug?: string | null
          website_id?: string | null
        }
        Update: {
          business_name?: string | null
          city?: string | null
          completed_at?: string | null
          context_json?: Json
          created_at?: string
          email?: string
          environment?: string | null
          full_name?: string | null
          id?: string
          legacy_evidence_version?: number | null
          legal_acceptance_ip_hash?: string | null
          legal_acceptance_user_agent?: string | null
          legal_accepted_at?: string | null
          legal_document_versions?: Json | null
          license_number?: string
          otp_delivery_claimed_at?: string | null
          payment_evidence_kind?: string | null
          payment_price_id?: string | null
          payment_provider_session_id?: string | null
          payment_verified_at?: string | null
          plan?: string
          profile_id?: string | null
          provider_completion_event_id?: string | null
          provider_completion_evidence?: Json | null
          provider_completion_payload_hash?: string | null
          provider_offer_contract_digest?: string | null
          provider_offer_contract_id?: string | null
          provider_offer_snapshot?: Json | null
          status?: string
          stripe_checkout_session_id?: string | null
          subscription_id?: string | null
          template_id?: string | null
          template_slug?: string | null
          website_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checkout_sessions_offer_contract_fk"
            columns: ["provider_offer_contract_id"]
            isOneToOne: false
            referencedRelation: "saas_offer_contracts"
            referencedColumns: ["contract_id"]
          },
          {
            foreignKeyName: "checkout_sessions_provider_completion_event_id_fkey"
            columns: ["provider_completion_event_id"]
            isOneToOne: false
            referencedRelation: "provider_event_inbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_sessions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_sessions_subscription_tenant_fkey"
            columns: ["subscription_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id", "user_id", "environment"]
          },
          {
            foreignKeyName: "checkout_sessions_website_tenant_fkey"
            columns: ["website_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id", "user_id", "environment"]
          },
        ]
      }
      contractor_profiles: {
        Row: {
          business_name: string | null
          city: string | null
          created_at: string
          enrichment_json: Json
          id: string
          license_number: string
          research_status: string | null
          state: string
          updated_at: string
          website_id: string
        }
        Insert: {
          business_name?: string | null
          city?: string | null
          created_at?: string
          enrichment_json?: Json
          id?: string
          license_number: string
          research_status?: string | null
          state?: string
          updated_at?: string
          website_id: string
        }
        Update: {
          business_name?: string | null
          city?: string | null
          created_at?: string
          enrichment_json?: Json
          id?: string
          license_number?: string
          research_status?: string | null
          state?: string
          updated_at?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_profiles_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: true
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_research_rows: {
        Row: {
          cells: Json
          chain_id: string | null
          comment: string
          created_at: string
          enrichment_json: Json
          id: string
          research_status: string | null
          sheet_id: string
          sort_index: number
          updated_at: string
        }
        Insert: {
          cells?: Json
          chain_id?: string | null
          comment?: string
          created_at?: string
          enrichment_json?: Json
          id?: string
          research_status?: string | null
          sheet_id: string
          sort_index: number
          updated_at?: string
        }
        Update: {
          cells?: Json
          chain_id?: string | null
          comment?: string
          created_at?: string
          enrichment_json?: Json
          id?: string
          research_status?: string | null
          sheet_id?: string
          sort_index?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contractor_research_rows_sheet_id_fkey"
            columns: ["sheet_id"]
            isOneToOne: false
            referencedRelation: "contractor_research_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      contractor_research_sheets: {
        Row: {
          created_at: string
          headers: Json
          id: string
          original_filename: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          headers?: Json
          id?: string
          original_filename?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          headers?: Json
          id?: string
          original_filename?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          phase: string
          summary: string | null
          updated_at: string
          user_id: string
          website_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          phase?: string
          summary?: string | null
          updated_at?: string
          user_id: string
          website_id: string
        }
        Update: {
          created_at?: string
          id?: string
          phase?: string
          summary?: string | null
          updated_at?: string
          user_id?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      data_retention_policies: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          data_class: string
          deletion_mode: string
          policy_digest: string | null
          policy_version: number
          production_approved: boolean
          retention_days: number | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          data_class: string
          deletion_mode: string
          policy_digest?: string | null
          policy_version?: number
          production_approved?: boolean
          retention_days?: number | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          data_class?: string
          deletion_mode?: string
          policy_digest?: string | null
          policy_version?: number
          production_approved?: boolean
          retention_days?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      deferred_unbound_subscription: {
        Row: {
          accepted_order: number
          applied_at: string | null
          cancel_at_period_end: boolean
          current_period_end: string
          deferred_at: string
          environment: string
          price_id: string
          product_id: string
          projected_status: string
          projection_hash: string
          projection_version: number
          provider_event_id: string
          provider_event_inbox_id: string
          provider_event_type: string
          provider_payload_hash: string
          provider_subscription_id: string
          quantity: number
          source_created_at: string
          state: string
        }
        Insert: {
          accepted_order?: never
          applied_at?: string | null
          cancel_at_period_end: boolean
          current_period_end: string
          deferred_at?: string
          environment: string
          price_id: string
          product_id: string
          projected_status: string
          projection_hash: string
          projection_version?: number
          provider_event_id: string
          provider_event_inbox_id: string
          provider_event_type: string
          provider_payload_hash: string
          provider_subscription_id: string
          quantity: number
          source_created_at: string
          state?: string
        }
        Update: {
          accepted_order?: never
          applied_at?: string | null
          cancel_at_period_end?: boolean
          current_period_end?: string
          deferred_at?: string
          environment?: string
          price_id?: string
          product_id?: string
          projected_status?: string
          projection_hash?: string
          projection_version?: number
          provider_event_id?: string
          provider_event_inbox_id?: string
          provider_event_type?: string
          provider_payload_hash?: string
          provider_subscription_id?: string
          quantity?: number
          source_created_at?: string
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "deferred_unbound_subscription_provider_event_inbox_id_fkey"
            columns: ["provider_event_inbox_id"]
            isOneToOne: true
            referencedRelation: "provider_event_inbox"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_media_provider_limits: {
        Row: {
          max_in_flight: number
          provider: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          max_in_flight: number
          provider: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          max_in_flight?: number
          provider?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_media_provider_limits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_outbox: {
        Row: {
          appointment_id: string
          attempts: number
          command_type: string
          completed_at: string | null
          created_at: string
          desired_appointment_version: number
          destination_epoch_id: string | null
          effect_contract_version: number | null
          effect_generation: number
          environment: string
          fencing_token: number
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          payload: Json
          profile_id: string
          safe_error: string | null
          state: string
          terminal_at: string | null
        }
        Insert: {
          appointment_id: string
          attempts?: number
          command_type: string
          completed_at?: string | null
          created_at?: string
          desired_appointment_version: number
          destination_epoch_id?: string | null
          effect_contract_version?: number | null
          effect_generation?: number
          environment: string
          fencing_token?: number
          id?: string
          idempotency_key: string
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          payload?: Json
          profile_id: string
          safe_error?: string | null
          state?: string
          terminal_at?: string | null
        }
        Update: {
          appointment_id?: string
          attempts?: number
          command_type?: string
          completed_at?: string | null
          created_at?: string
          desired_appointment_version?: number
          destination_epoch_id?: string | null
          effect_contract_version?: number | null
          effect_generation?: number
          environment?: string
          fencing_token?: number
          id?: string
          idempotency_key?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          payload?: Json
          profile_id?: string
          safe_error?: string | null
          state?: string
          terminal_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "integration_outbox_appointment_id_profile_id_environment_fkey"
            columns: ["appointment_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "integration_outbox_destination_epoch_fk"
            columns: ["destination_epoch_id"]
            isOneToOne: false
            referencedRelation: "calendar_destination_epochs"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_governance_events: {
        Row: {
          action: string
          actor_user_id: string
          id: number
          lead_id: string | null
          occurred_at: string
          profile_id: string
          reason: string
        }
        Insert: {
          action: string
          actor_user_id: string
          id?: never
          lead_id?: string | null
          occurred_at?: string
          profile_id: string
          reason: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          id?: never
          lead_id?: string | null
          occurred_at?: string
          profile_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_governance_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_submission_attempts: {
        Row: {
          created_at: string
          id: number
          rate_limit_key: string
          website_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          rate_limit_key: string
          website_id: string
        }
        Update: {
          created_at?: string
          id?: never
          rate_limit_key?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_submission_attempts_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          field_snapshot: Json
          form_data: Json
          id: string
          license_number: string
          payload_hash: string | null
          rate_limit_key: string | null
          snapshot_status: string
          snapshot_version: number | null
          source_snapshot: Json
          submission_fingerprint: string | null
          submitted_at: string
          user_id: string
          website_id: string
        }
        Insert: {
          created_at?: string
          field_snapshot?: Json
          form_data?: Json
          id?: string
          license_number: string
          payload_hash?: string | null
          rate_limit_key?: string | null
          snapshot_status?: string
          snapshot_version?: number | null
          source_snapshot?: Json
          submission_fingerprint?: string | null
          submitted_at?: string
          user_id: string
          website_id: string
        }
        Update: {
          created_at?: string
          field_snapshot?: Json
          form_data?: Json
          id?: string
          license_number?: string
          payload_hash?: string | null
          rate_limit_key?: string | null
          snapshot_status?: string
          snapshot_version?: number | null
          source_snapshot?: Json
          submission_fingerprint?: string | null
          submitted_at?: string
          user_id?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_website_user_ownership_fk"
            columns: ["website_id", "user_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      media_repair_events: {
        Row: {
          created_at: string
          id: string
          payload_json: Json
          website_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload_json?: Json
          website_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload_json?: Json
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_repair_events_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          sequence_id: number
          tool_calls: Json | null
          trace_id: string | null
        }
        Insert: {
          attachments?: Json | null
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          sequence_id: number
          tool_calls?: Json | null
          trace_id?: string | null
        }
        Update: {
          attachments?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          sequence_id?: number
          tool_calls?: Json | null
          trace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "agent_traces"
            referencedColumns: ["id"]
          },
        ]
      }
      migration_runs: {
        Row: {
          actor: string
          checksum: string
          created_at: string
          error_message: string | null
          id: string
          mode: string
          name: string
          result: string
          sqlstate: string | null
        }
        Insert: {
          actor?: string
          checksum: string
          created_at?: string
          error_message?: string | null
          id?: string
          mode: string
          name: string
          result: string
          sqlstate?: string | null
        }
        Update: {
          actor?: string
          checksum?: string
          created_at?: string
          error_message?: string | null
          id?: string
          mode?: string
          name?: string
          result?: string
          sqlstate?: string | null
        }
        Relationships: []
      }
      otp_send_log: {
        Row: {
          created_at: string
          email: string
          id: string
          purpose: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          purpose: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          purpose?: string
        }
        Relationships: []
      }
      pipedream_bindings: {
        Row: {
          component_key: string
          component_version: string
          configuration_revision: number
          connection_id: string
          created_at: string
          deployed_trigger_id: string | null
          deployment_candidate_trigger_id: string | null
          deployment_dispatch_fencing_token: number | null
          deployment_dispatch_lease_token: string | null
          deployment_dispatched_at: string | null
          deployment_expected_connection_revision: number | null
          deployment_lease_expires_at: string | null
          deployment_operation_id: string | null
          deployment_receipt: Json | null
          environment: string
          id: string
          last_event_at: string | null
          last_health_at: string | null
          observed_component_key: string | null
          observed_component_version: string | null
          pending_trigger_deletions: string[]
          pipedream_account_id: string
          profile_id: string
          provider_updated_at: string | null
          reconciliation_allow_repair: boolean
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_reason: string | null
          retired_deployment: Json | null
          retired_trigger_ids: string[]
          safe_error: string | null
          selected_calendar_ids: Json
          signing_secret_name: string | null
          trigger_state: string
          updated_at: string
          webhook_correlation_id: string
          webhook_id: string | null
        }
        Insert: {
          component_key: string
          component_version: string
          configuration_revision?: number
          connection_id: string
          created_at?: string
          deployed_trigger_id?: string | null
          deployment_candidate_trigger_id?: string | null
          deployment_dispatch_fencing_token?: number | null
          deployment_dispatch_lease_token?: string | null
          deployment_dispatched_at?: string | null
          deployment_expected_connection_revision?: number | null
          deployment_lease_expires_at?: string | null
          deployment_operation_id?: string | null
          deployment_receipt?: Json | null
          environment: string
          id?: string
          last_event_at?: string | null
          last_health_at?: string | null
          observed_component_key?: string | null
          observed_component_version?: string | null
          pending_trigger_deletions?: string[]
          pipedream_account_id: string
          profile_id: string
          provider_updated_at?: string | null
          reconciliation_allow_repair?: boolean
          reconciliation_attempts?: number
          reconciliation_due_at?: string | null
          reconciliation_fencing_token?: number
          reconciliation_last_attempt_at?: string | null
          reconciliation_lease_expires_at?: string | null
          reconciliation_lease_token?: string | null
          reconciliation_reason?: string | null
          retired_deployment?: Json | null
          retired_trigger_ids?: string[]
          safe_error?: string | null
          selected_calendar_ids?: Json
          signing_secret_name?: string | null
          trigger_state?: string
          updated_at?: string
          webhook_correlation_id?: string
          webhook_id?: string | null
        }
        Update: {
          component_key?: string
          component_version?: string
          configuration_revision?: number
          connection_id?: string
          created_at?: string
          deployed_trigger_id?: string | null
          deployment_candidate_trigger_id?: string | null
          deployment_dispatch_fencing_token?: number | null
          deployment_dispatch_lease_token?: string | null
          deployment_dispatched_at?: string | null
          deployment_expected_connection_revision?: number | null
          deployment_lease_expires_at?: string | null
          deployment_operation_id?: string | null
          deployment_receipt?: Json | null
          environment?: string
          id?: string
          last_event_at?: string | null
          last_health_at?: string | null
          observed_component_key?: string | null
          observed_component_version?: string | null
          pending_trigger_deletions?: string[]
          pipedream_account_id?: string
          profile_id?: string
          provider_updated_at?: string | null
          reconciliation_allow_repair?: boolean
          reconciliation_attempts?: number
          reconciliation_due_at?: string | null
          reconciliation_fencing_token?: number
          reconciliation_last_attempt_at?: string | null
          reconciliation_lease_expires_at?: string | null
          reconciliation_lease_token?: string | null
          reconciliation_reason?: string | null
          retired_deployment?: Json | null
          retired_trigger_ids?: string[]
          safe_error?: string | null
          selected_calendar_ids?: Json
          signing_secret_name?: string | null
          trigger_state?: string
          updated_at?: string
          webhook_correlation_id?: string
          webhook_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipedream_bindings_connection_id_profile_id_environment_fkey"
            columns: ["connection_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id", "profile_id", "environment"]
          },
        ]
      }
      plan_inquiries: {
        Row: {
          city: string
          created_at: string
          email: string
          id: string
          name: string
          phone: string
          plan: string
        }
        Insert: {
          city: string
          created_at?: string
          email: string
          id?: string
          name: string
          phone: string
          plan: string
        }
        Update: {
          city?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          phone?: string
          plan?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          business_name: string | null
          checkout_claim_email: string | null
          checkout_claimable_at: string | null
          city: string | null
          created_at: string
          email: string | null
          environment: string
          full_name: string | null
          id: string
          license_number: string
          trade: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          business_name?: string | null
          checkout_claim_email?: string | null
          checkout_claimable_at?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          environment?: string
          full_name?: string | null
          id?: string
          license_number: string
          trade?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          business_name?: string | null
          checkout_claim_email?: string | null
          checkout_claimable_at?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          environment?: string
          full_name?: string | null
          id?: string
          license_number?: string
          trade?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      provider_event_inbox: {
        Row: {
          account_context: string
          api_version: string
          attempts: number
          destination: string
          environment: string
          event_family: string
          event_id: string
          event_type: string
          fencing_token: number
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          livemode: boolean
          next_attempt_at: string
          payload: Json
          payload_hash: string
          pipedream_binding_id: string | null
          pipedream_trigger_id: string | null
          processed_at: string | null
          processing_state: string
          profile_id: string | null
          provider: string
          received_at: string
          safe_error: string | null
          signature_timestamp: string | null
        }
        Insert: {
          account_context?: string
          api_version?: string
          attempts?: number
          destination?: string
          environment: string
          event_family: string
          event_id: string
          event_type: string
          fencing_token?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          livemode: boolean
          next_attempt_at?: string
          payload?: Json
          payload_hash: string
          pipedream_binding_id?: string | null
          pipedream_trigger_id?: string | null
          processed_at?: string | null
          processing_state?: string
          profile_id?: string | null
          provider: string
          received_at?: string
          safe_error?: string | null
          signature_timestamp?: string | null
        }
        Update: {
          account_context?: string
          api_version?: string
          attempts?: number
          destination?: string
          environment?: string
          event_family?: string
          event_id?: string
          event_type?: string
          fencing_token?: number
          id?: string
          lease_expires_at?: string | null
          lease_token?: string | null
          livemode?: boolean
          next_attempt_at?: string
          payload?: Json
          payload_hash?: string
          pipedream_binding_id?: string | null
          pipedream_trigger_id?: string | null
          processed_at?: string | null
          processing_state?: string
          profile_id?: string | null
          provider?: string
          received_at?: string
          safe_error?: string | null
          signature_timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_event_inbox_pipedream_binding_fkey"
            columns: ["pipedream_binding_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "pipedream_bindings"
            referencedColumns: ["id", "profile_id", "environment"]
          },
          {
            foreignKeyName: "provider_event_inbox_profile_id_environment_fkey"
            columns: ["profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
        ]
      }
      public_booking_rate_limits: {
        Row: {
          action: string
          attempt_count: number
          client_bucket: string
          scope_key: string
          window_started_at: string
        }
        Insert: {
          action: string
          attempt_count: number
          client_bucket: string
          scope_key: string
          window_started_at: string
        }
        Update: {
          action?: string
          attempt_count?: number
          client_bucket?: string
          scope_key?: string
          window_started_at?: string
        }
        Relationships: []
      }
      saas_checkout_fulfillment_outbox: {
        Row: {
          accepted_at: string | null
          attempts: number
          checkout_session_id: string
          created_at: string
          environment: string
          failed_at: string | null
          fencing_token: number
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          profile_id: string
          provider_attempts: number
          provider_dispatch_started_at: string | null
          recipient_email: string
          redrive_count: number
          state: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          attempts?: number
          checkout_session_id: string
          created_at?: string
          environment: string
          failed_at?: string | null
          fencing_token?: number
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          profile_id: string
          provider_attempts?: number
          provider_dispatch_started_at?: string | null
          recipient_email: string
          redrive_count?: number
          state?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          attempts?: number
          checkout_session_id?: string
          created_at?: string
          environment?: string
          failed_at?: string | null
          fencing_token?: number
          id?: string
          last_error?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          next_attempt_at?: string
          profile_id?: string
          provider_attempts?: number
          provider_dispatch_started_at?: string | null
          recipient_email?: string
          redrive_count?: number
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_checkout_fulfillment_outbox_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: true
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saas_checkout_fulfillment_outbox_profile_id_environment_fkey"
            columns: ["profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
        ]
      }
      saas_checkout_fulfillment_resolution_audit: {
        Row: {
          action: string
          actor_user_id: string
          evidence: Json
          expected_fencing_token: number
          fulfillment_id: string
          id: string
          prior_state: Json
          reason: string
          resolved_at: string
        }
        Insert: {
          action: string
          actor_user_id: string
          evidence: Json
          expected_fencing_token: number
          fulfillment_id: string
          id?: string
          prior_state: Json
          reason: string
          resolved_at?: string
        }
        Update: {
          action?: string
          actor_user_id?: string
          evidence?: Json
          expected_fencing_token?: number
          fulfillment_id?: string
          id?: string
          prior_state?: Json
          reason?: string
          resolved_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_checkout_fulfillment_resolution_audit_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "admin_principals"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "saas_checkout_fulfillment_resolution_audit_fulfillment_id_fkey"
            columns: ["fulfillment_id"]
            isOneToOne: false
            referencedRelation: "saas_checkout_fulfillment_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      saas_offer_contract_installations: {
        Row: {
          contract_id: string
          id: string
          installed_at: string
          observed_digest: string
        }
        Insert: {
          contract_id: string
          id?: string
          installed_at?: string
          observed_digest: string
        }
        Update: {
          contract_id?: string
          id?: string
          installed_at?: string
          observed_digest?: string
        }
        Relationships: [
          {
            foreignKeyName: "saas_offer_contract_installations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "saas_offer_contracts"
            referencedColumns: ["contract_id"]
          },
        ]
      }
      saas_offer_contracts: {
        Row: {
          active_for_new_sales: boolean
          contract_digest: string
          contract_id: string
          created_at: string
          currency: string
          environment: string
          interval: string
          interval_count: number
          plan: string
          price_id: string
          product_id: string
          unit_amount_minor: number
          verified_at: string
        }
        Insert: {
          active_for_new_sales?: boolean
          contract_digest: string
          contract_id?: string
          created_at?: string
          currency: string
          environment: string
          interval: string
          interval_count: number
          plan: string
          price_id: string
          product_id: string
          unit_amount_minor: number
          verified_at: string
        }
        Update: {
          active_for_new_sales?: boolean
          contract_digest?: string
          contract_id?: string
          created_at?: string
          currency?: string
          environment?: string
          interval?: string
          interval_count?: number
          plan?: string
          price_id?: string
          product_id?: string
          unit_amount_minor?: number
          verified_at?: string
        }
        Relationships: []
      }
      site_generation_attempt_events: {
        Row: {
          blocking: boolean
          budget_after: number | null
          budget_before: number | null
          budget_type: string | null
          cause_code: string | null
          claim_epoch: number
          completed_at: string | null
          contract_epoch: number
          created_at: string
          deployment_id: string | null
          details: Json
          disposition: string
          effect_certainty: string
          event_fingerprint: string
          event_key: string
          event_type: string
          id: number
          input_checkpoint_hash: string | null
          invocation_id: string | null
          job_id: string
          output_checkpoint_hash: string | null
          request_id: string
          runner_id: string | null
          severity: string
          stage: string
          stage_attempt: number
          started_at: string | null
          unit_id: string | null
          website_id: string
        }
        Insert: {
          blocking?: boolean
          budget_after?: number | null
          budget_before?: number | null
          budget_type?: string | null
          cause_code?: string | null
          claim_epoch: number
          completed_at?: string | null
          contract_epoch: number
          created_at?: string
          deployment_id?: string | null
          details?: Json
          disposition: string
          effect_certainty?: string
          event_fingerprint: string
          event_key: string
          event_type: string
          id?: never
          input_checkpoint_hash?: string | null
          invocation_id?: string | null
          job_id: string
          output_checkpoint_hash?: string | null
          request_id: string
          runner_id?: string | null
          severity?: string
          stage: string
          stage_attempt?: number
          started_at?: string | null
          unit_id?: string | null
          website_id: string
        }
        Update: {
          blocking?: boolean
          budget_after?: number | null
          budget_before?: number | null
          budget_type?: string | null
          cause_code?: string | null
          claim_epoch?: number
          completed_at?: string | null
          contract_epoch?: number
          created_at?: string
          deployment_id?: string | null
          details?: Json
          disposition?: string
          effect_certainty?: string
          event_fingerprint?: string
          event_key?: string
          event_type?: string
          id?: never
          input_checkpoint_hash?: string | null
          invocation_id?: string | null
          job_id?: string
          output_checkpoint_hash?: string | null
          request_id?: string
          runner_id?: string | null
          severity?: string
          stage?: string
          stage_attempt?: number
          started_at?: string | null
          unit_id?: string | null
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_generation_attempt_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "background_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_generation_attempt_events_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      site_generation_attempt_events_archive: {
        Row: {
          archive_run_id: string
          archived_at: string
          event_created_at: string
          event_data: Json
          event_fingerprint: string
          event_key: string
          source_event_id: number
        }
        Insert: {
          archive_run_id: string
          archived_at?: string
          event_created_at: string
          event_data: Json
          event_fingerprint: string
          event_key: string
          source_event_id: number
        }
        Update: {
          archive_run_id?: string
          archived_at?: string
          event_created_at?: string
          event_data?: Json
          event_fingerprint?: string
          event_key?: string
          source_event_id?: number
        }
        Relationships: []
      }
      site_generation_media_slots: {
        Row: {
          abandoned_at: string | null
          asset_id: string | null
          audio_codec: string | null
          byte_size: number | null
          claim_attempt: number | null
          claim_epoch: number | null
          claimed_at: string | null
          cleanup_completed_at: string | null
          cleanup_required: boolean
          content_hash: string | null
          created_at: string
          duration_ms: number | null
          effect_certainty: string
          error_message: string | null
          has_audio: boolean | null
          height: number | null
          id: string
          job_id: string
          kind: string
          mime_type: string | null
          plan_hash: string | null
          poster_slot_id: string | null
          proof_eligible: boolean
          provenance: string
          provider_create_count: number
          provider_idempotency_key: string | null
          provider_name: string | null
          provider_operation_id: string | null
          provider_request_hash: string | null
          provider_reservation_id: string | null
          provider_reserved_at: string | null
          reconciled_at: string | null
          reconciliation_action_key: string | null
          reconciliation_actor: string | null
          reconciliation_deadline: string | null
          reconciliation_evidence: Json | null
          reconciliation_reason: string | null
          reconciliation_required_at: string | null
          required: boolean
          retired_provider_operation_ids: Json
          role: string
          slot_claim_epoch: number
          slot_id: string
          slot_lease_expires_at: string | null
          slot_locked_by: string | null
          source_slot_id: string | null
          status: string
          storage_path: string | null
          updated_at: string
          validator_version: string | null
          version_id: string | null
          video_codec: string | null
          video_profile: string | null
          website_id: string
          width: number | null
        }
        Insert: {
          abandoned_at?: string | null
          asset_id?: string | null
          audio_codec?: string | null
          byte_size?: number | null
          claim_attempt?: number | null
          claim_epoch?: number | null
          claimed_at?: string | null
          cleanup_completed_at?: string | null
          cleanup_required?: boolean
          content_hash?: string | null
          created_at?: string
          duration_ms?: number | null
          effect_certainty?: string
          error_message?: string | null
          has_audio?: boolean | null
          height?: number | null
          id?: string
          job_id: string
          kind: string
          mime_type?: string | null
          plan_hash?: string | null
          poster_slot_id?: string | null
          proof_eligible?: boolean
          provenance: string
          provider_create_count?: number
          provider_idempotency_key?: string | null
          provider_name?: string | null
          provider_operation_id?: string | null
          provider_request_hash?: string | null
          provider_reservation_id?: string | null
          provider_reserved_at?: string | null
          reconciled_at?: string | null
          reconciliation_action_key?: string | null
          reconciliation_actor?: string | null
          reconciliation_deadline?: string | null
          reconciliation_evidence?: Json | null
          reconciliation_reason?: string | null
          reconciliation_required_at?: string | null
          required?: boolean
          retired_provider_operation_ids?: Json
          role: string
          slot_claim_epoch?: number
          slot_id: string
          slot_lease_expires_at?: string | null
          slot_locked_by?: string | null
          source_slot_id?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          validator_version?: string | null
          version_id?: string | null
          video_codec?: string | null
          video_profile?: string | null
          website_id: string
          width?: number | null
        }
        Update: {
          abandoned_at?: string | null
          asset_id?: string | null
          audio_codec?: string | null
          byte_size?: number | null
          claim_attempt?: number | null
          claim_epoch?: number | null
          claimed_at?: string | null
          cleanup_completed_at?: string | null
          cleanup_required?: boolean
          content_hash?: string | null
          created_at?: string
          duration_ms?: number | null
          effect_certainty?: string
          error_message?: string | null
          has_audio?: boolean | null
          height?: number | null
          id?: string
          job_id?: string
          kind?: string
          mime_type?: string | null
          plan_hash?: string | null
          poster_slot_id?: string | null
          proof_eligible?: boolean
          provenance?: string
          provider_create_count?: number
          provider_idempotency_key?: string | null
          provider_name?: string | null
          provider_operation_id?: string | null
          provider_request_hash?: string | null
          provider_reservation_id?: string | null
          provider_reserved_at?: string | null
          reconciled_at?: string | null
          reconciliation_action_key?: string | null
          reconciliation_actor?: string | null
          reconciliation_deadline?: string | null
          reconciliation_evidence?: Json | null
          reconciliation_reason?: string | null
          reconciliation_required_at?: string | null
          required?: boolean
          retired_provider_operation_ids?: Json
          role?: string
          slot_claim_epoch?: number
          slot_id?: string
          slot_lease_expires_at?: string | null
          slot_locked_by?: string | null
          source_slot_id?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          validator_version?: string | null
          version_id?: string | null
          video_codec?: string | null
          video_profile?: string | null
          website_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "site_generation_media_slots_job_website_fkey"
            columns: ["job_id", "website_id"]
            isOneToOne: false
            referencedRelation: "background_jobs"
            referencedColumns: ["id", "website_id"]
          },
          {
            foreignKeyName: "site_generation_media_slots_version_website_fkey"
            columns: ["version_id", "website_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id", "website_id"]
          },
        ]
      }
      stripe_connected_accounts: {
        Row: {
          account_type: string
          application_fee_bps: number
          capabilities: Json
          charge_model: string
          charges_enabled: boolean
          configuration: Json
          country: string
          created_at: string
          creation_key: string | null
          details_submitted: boolean
          environment: string
          id: string
          last_verified_at: string | null
          onboarding_state: string
          payouts_enabled: boolean
          profile_id: string
          provider_created_at: string | null
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_generation: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_safe_error: string | null
          reconnect_reason: string | null
          requirements: Json
          stripe_account_id: string | null
          updated_at: string
        }
        Insert: {
          account_type?: string
          application_fee_bps?: number
          capabilities?: Json
          charge_model?: string
          charges_enabled?: boolean
          configuration?: Json
          country?: string
          created_at?: string
          creation_key?: string | null
          details_submitted?: boolean
          environment: string
          id?: string
          last_verified_at?: string | null
          onboarding_state?: string
          payouts_enabled?: boolean
          profile_id: string
          provider_created_at?: string | null
          reconciliation_attempts?: number
          reconciliation_due_at?: string | null
          reconciliation_fencing_token?: number
          reconciliation_generation?: number
          reconciliation_last_attempt_at?: string | null
          reconciliation_lease_expires_at?: string | null
          reconciliation_lease_token?: string | null
          reconciliation_safe_error?: string | null
          reconnect_reason?: string | null
          requirements?: Json
          stripe_account_id?: string | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          application_fee_bps?: number
          capabilities?: Json
          charge_model?: string
          charges_enabled?: boolean
          configuration?: Json
          country?: string
          created_at?: string
          creation_key?: string | null
          details_submitted?: boolean
          environment?: string
          id?: string
          last_verified_at?: string | null
          onboarding_state?: string
          payouts_enabled?: boolean
          profile_id?: string
          provider_created_at?: string | null
          reconciliation_attempts?: number
          reconciliation_due_at?: string | null
          reconciliation_fencing_token?: number
          reconciliation_generation?: number
          reconciliation_last_attempt_at?: string | null
          reconciliation_lease_expires_at?: string | null
          reconciliation_lease_token?: string | null
          reconciliation_safe_error?: string | null
          reconnect_reason?: string | null
          requirements?: Json
          stripe_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_connected_accounts_profile_id_environment_fkey"
            columns: ["profile_id", "environment"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          entitlement_ends_at: string | null
          environment: string
          id: string
          last_provider_event_at: string | null
          last_provider_event_id: string | null
          plan: string
          provider_customer_id: string | null
          provider_offer_contract_digest: string | null
          provider_offer_contract_id: string | null
          provider_offer_snapshot: Json | null
          provider_status: string | null
          provider_subscription_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          entitlement_ends_at?: string | null
          environment?: string
          id?: string
          last_provider_event_at?: string | null
          last_provider_event_id?: string | null
          plan?: string
          provider_customer_id?: string | null
          provider_offer_contract_digest?: string | null
          provider_offer_contract_id?: string | null
          provider_offer_snapshot?: Json | null
          provider_status?: string | null
          provider_subscription_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          entitlement_ends_at?: string | null
          environment?: string
          id?: string
          last_provider_event_at?: string | null
          last_provider_event_id?: string | null
          plan?: string
          provider_customer_id?: string | null
          provider_offer_contract_digest?: string | null
          provider_offer_contract_id?: string | null
          provider_offer_snapshot?: Json | null
          provider_status?: string | null
          provider_subscription_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_offer_contract_fk"
            columns: ["provider_offer_contract_id"]
            isOneToOne: false
            referencedRelation: "saas_offer_contracts"
            referencedColumns: ["contract_id"]
          },
          {
            foreignKeyName: "subscriptions_user_environment_fkey"
            columns: ["user_id", "environment"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      website_edit_events: {
        Row: {
          category: string
          created_at: string
          id: string
          patch_json: Json
          version_id: string | null
          website_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          patch_json?: Json
          version_id?: string | null
          website_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          patch_json?: Json
          version_id?: string | null
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_edit_events_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_edit_events_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      website_entitlements: {
        Row: {
          booking_admission: boolean
          checkout_session_id: string | null
          created_at: string
          effective_at: string | null
          ends_at: string | null
          environment: string
          id: string
          order_confirmed_at: string | null
          plan: string
          profile_id: string
          purchased_at: string
          quote_admission: boolean
          state: string
          subscription_id: string | null
          updated_at: string
          website_id: string
        }
        Insert: {
          booking_admission?: boolean
          checkout_session_id?: string | null
          created_at?: string
          effective_at?: string | null
          ends_at?: string | null
          environment: string
          id?: string
          order_confirmed_at?: string | null
          plan: string
          profile_id: string
          purchased_at?: string
          quote_admission?: boolean
          state?: string
          subscription_id?: string | null
          updated_at?: string
          website_id: string
        }
        Update: {
          booking_admission?: boolean
          checkout_session_id?: string | null
          created_at?: string
          effective_at?: string | null
          ends_at?: string | null
          environment?: string
          id?: string
          order_confirmed_at?: string | null
          plan?: string
          profile_id?: string
          purchased_at?: string
          quote_admission?: boolean
          state?: string
          subscription_id?: string | null
          updated_at?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_entitlements_checkout_session_id_fkey"
            columns: ["checkout_session_id"]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_entitlements_checkout_tenant_fkey"
            columns: [
              "checkout_session_id",
              "profile_id",
              "website_id",
              "environment",
              "subscription_id",
            ]
            isOneToOne: false
            referencedRelation: "checkout_sessions"
            referencedColumns: [
              "id",
              "profile_id",
              "website_id",
              "environment",
              "subscription_id",
            ]
          },
          {
            foreignKeyName: "website_entitlements_subscription_tenant_fkey"
            columns: ["subscription_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id", "user_id", "environment"]
          },
          {
            foreignKeyName: "website_entitlements_website_tenant_fkey"
            columns: ["website_id", "profile_id", "environment"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id", "user_id", "environment"]
          },
        ]
      }
      website_version_media_slots: {
        Row: {
          asset_id: string
          mime_type: string
          poster_slot_id: string | null
          proof_eligible: boolean
          provenance: string
          required: boolean
          role: string
          slot_id: string
          source_slot_id: string | null
          storage_path: string
          version_id: string
          website_id: string
        }
        Insert: {
          asset_id: string
          mime_type: string
          poster_slot_id?: string | null
          proof_eligible?: boolean
          provenance: string
          required: boolean
          role: string
          slot_id: string
          source_slot_id?: string | null
          storage_path: string
          version_id: string
          website_id: string
        }
        Update: {
          asset_id?: string
          mime_type?: string
          poster_slot_id?: string | null
          proof_eligible?: boolean
          provenance?: string
          required?: boolean
          role?: string
          slot_id?: string
          source_slot_id?: string | null
          storage_path?: string
          version_id?: string
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_version_media_slots_version_id_website_id_fkey"
            columns: ["version_id", "website_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id", "website_id"]
          },
        ]
      }
      website_versions: {
        Row: {
          config_json: Json
          created_at: string
          generation_job_id: string | null
          id: string
          revision: number
          status: string
          updated_at: string
          variant_key: string
          version_number: number
          website_id: string
        }
        Insert: {
          config_json?: Json
          created_at?: string
          generation_job_id?: string | null
          id?: string
          revision?: number
          status?: string
          updated_at?: string
          variant_key: string
          version_number: number
          website_id: string
        }
        Update: {
          config_json?: Json
          created_at?: string
          generation_job_id?: string | null
          id?: string
          revision?: number
          status?: string
          updated_at?: string
          variant_key?: string
          version_number?: number
          website_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "website_versions_generation_job_id_fkey"
            columns: ["generation_job_id"]
            isOneToOne: false
            referencedRelation: "background_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "website_versions_website_id_fkey"
            columns: ["website_id"]
            isOneToOne: false
            referencedRelation: "websites"
            referencedColumns: ["id"]
          },
        ]
      }
      websites: {
        Row: {
          active_version_id: string | null
          created_at: string
          environment: string
          id: string
          onboarding_state: Json
          research_status: string | null
          status: string
          template_id: string | null
          template_slug: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active_version_id?: string | null
          created_at?: string
          environment?: string
          id?: string
          onboarding_state?: Json
          research_status?: string | null
          status?: string
          template_id?: string | null
          template_slug?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active_version_id?: string | null
          created_at?: string
          environment?: string
          id?: string
          onboarding_state?: Json
          research_status?: string | null
          status?: string
          template_id?: string | null
          template_slug?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "websites_active_version_id_fkey"
            columns: ["active_version_id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "websites_active_version_ownership_fk"
            columns: ["active_version_id", "id"]
            isOneToOne: false
            referencedRelation: "website_versions"
            referencedColumns: ["id", "website_id"]
          },
          {
            foreignKeyName: "websites_user_environment_fkey"
            columns: ["user_id", "environment"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "environment"]
          },
          {
            foreignKeyName: "websites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      background_job_cron_health: {
        Row: {
          error_message: string | null
          outcome: string | null
          request_id: number | null
          requested_at: string | null
          responded_at: string | null
          schedule_name: string | null
          status_code: number | null
          timed_out: boolean | null
          transport_outcome: string | null
          worker_counts: Json | null
          worker_outcome: string | null
        }
        Insert: {
          error_message?: string | null
          outcome?: never
          request_id?: number | null
          requested_at?: string | null
          responded_at?: string | null
          schedule_name?: string | null
          status_code?: number | null
          timed_out?: boolean | null
          transport_outcome?: never
          worker_counts?: Json | null
          worker_outcome?: string | null
        }
        Update: {
          error_message?: string | null
          outcome?: never
          request_id?: number | null
          requested_at?: string | null
          responded_at?: string | null
          schedule_name?: string | null
          status_code?: number | null
          timed_out?: boolean | null
          transport_outcome?: never
          worker_counts?: Json | null
          worker_outcome?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acknowledge_booking_order: {
        Args: {
          p_auth_user_id: string
          p_environment: string
          p_profile_id: string
          p_website_id: string
        }
        Returns: {
          booking_admission: boolean
          checkout_session_id: string | null
          created_at: string
          effective_at: string | null
          ends_at: string | null
          environment: string
          id: string
          order_confirmed_at: string | null
          plan: string
          profile_id: string
          purchased_at: string
          quote_admission: boolean
          state: string
          subscription_id: string | null
          updated_at: string
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "website_entitlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      activate_booking_cutover: {
        Args: {
          p_environment: string
          p_preflight_digest: string
          p_profile_id: string
        }
        Returns: boolean
      }
      activate_booking_cutover_v3: {
        Args: { p_preflight_id: string }
        Returns: boolean
      }
      activate_pro_booking_admission: {
        Args: { p_environment: string; p_website_id: string }
        Returns: boolean
      }
      add_video_set_stage_failure: {
        Args: { p_count: number; p_payload: Json; p_stage: string }
        Returns: Json
      }
      add_video_stage_failure_count: {
        Args: { p_payload: Json }
        Returns: number
      }
      add_video_storage_object_is_referenced: {
        Args: {
          p_content_hash: string
          p_eligible_before: string
          p_storage_path: string
        }
        Returns: boolean
      }
      admin_abandon_agent_external_operation: {
        Args: {
          p_admin_actor_id: string
          p_expected_owner_token: string
          p_expected_trace_id: string
          p_operation_key: string
          p_reason: string
        }
        Returns: boolean
      }
      admin_auth_lock_v4: { Args: { p_user_id: string }; Returns: undefined }
      admin_delete_gotrue_sessions_v4: {
        Args: { p_user_id: string }
        Returns: number
      }
      admin_recover_agent_turn: {
        Args: {
          p_admin_actor_id: string
          p_expected_owner_token: string
          p_reason: string
          p_status: string
          p_trace_id: string
        }
        Returns: boolean
      }
      adopt_pipedream_trigger_candidate: {
        Args: {
          p_binding_id: string
          p_component_id?: string
          p_deployed_trigger_id: string
          p_deployment_operation_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: boolean
      }
      apply_booking_money_mirror_event: {
        Args: {
          p_amount_refunded: number
          p_charge_id: string
          p_dispute_id: string
          p_dispute_state: string
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_payment_intent_id: string
          p_provider_created?: number
          p_refund_id: string
        }
        Returns: boolean
      }
      apply_booking_payment_event: {
        Args: {
          p_amount: number
          p_appointment_id: string
          p_charge_id: string
          p_checkout_session_id: string
          p_currency: string
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_paid: boolean
          p_payment_intent_id: string
        }
        Returns: boolean
      }
      apply_booking_provider_evidence: {
        Args: {
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: boolean
      }
      apply_leased_stripe_connect_account_projection: {
        Args: {
          p_capabilities: Json
          p_charges_enabled: boolean
          p_details_submitted: boolean
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_observed_at: string
          p_payouts_enabled: boolean
          p_profile_id: string
          p_provider_created_at: string
          p_reconciliation_generation: number
          p_requirements: Json
          p_stripe_account_id: string
        }
        Returns: {
          account_type: string
          application_fee_bps: number
          capabilities: Json
          charge_model: string
          charges_enabled: boolean
          configuration: Json
          country: string
          created_at: string
          creation_key: string | null
          details_submitted: boolean
          environment: string
          id: string
          last_verified_at: string | null
          onboarding_state: string
          payouts_enabled: boolean
          profile_id: string
          provider_created_at: string | null
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_generation: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_safe_error: string | null
          reconnect_reason: string | null
          requirements: Json
          stripe_account_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "stripe_connected_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_pipedream_calendar_event: {
        Args: {
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_occurred_at: string
        }
        Returns: boolean
      }
      apply_pipedream_trigger_projection: {
        Args: {
          p_active: boolean
          p_binding_id: string
          p_component_key: string
          p_component_version: string
          p_connection_id: string
          p_deployed_trigger_id: string
          p_deployment_operation_id: string
          p_environment: string
          p_expected_connection_revision: number
          p_fencing_token: number
          p_lease_token: string
          p_observed_component_key: string
          p_observed_component_version: string
          p_pipedream_account_id: string
          p_profile_id: string
          p_provider_updated_at: string
          p_safe_error: string
          p_selected_calendar_ids: Json
          p_signing_key: string
          p_webhook_correlation_id: string
          p_webhook_id: string
        }
        Returns: {
          component_key: string
          component_version: string
          configuration_revision: number
          connection_id: string
          created_at: string
          deployed_trigger_id: string | null
          deployment_candidate_trigger_id: string | null
          deployment_dispatch_fencing_token: number | null
          deployment_dispatch_lease_token: string | null
          deployment_dispatched_at: string | null
          deployment_expected_connection_revision: number | null
          deployment_lease_expires_at: string | null
          deployment_operation_id: string | null
          deployment_receipt: Json | null
          environment: string
          id: string
          last_event_at: string | null
          last_health_at: string | null
          observed_component_key: string | null
          observed_component_version: string | null
          pending_trigger_deletions: string[]
          pipedream_account_id: string
          profile_id: string
          provider_updated_at: string | null
          reconciliation_allow_repair: boolean
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_reason: string | null
          retired_deployment: Json | null
          retired_trigger_ids: string[]
          safe_error: string | null
          selected_calendar_ids: Json
          signing_secret_name: string | null
          trigger_state: string
          updated_at: string
          webhook_correlation_id: string
          webhook_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "pipedream_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_provider_appointment_event: {
        Args: {
          p_appointment_id: string
          p_client_request_id: string
          p_environment: string
          p_event_id: string
          p_expected_version: number
          p_fencing_token: number
          p_lease_token: string
          p_operation_type: string
          p_payload?: Json
          p_profile_id: string
          p_request_hash: string
        }
        Returns: {
          amount_minor: number
          appointment_reason: string | null
          appointment_state: string
          booking_contract_version: number | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          calendar_destination_epoch_id: string | null
          calendar_generation: number
          calendar_state: string
          cancellation_requested_at: string | null
          cancelled_at: string | null
          capacity_range: unknown
          checkout_generation: number
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_id: string
          customer_snapshot: Json
          duration_minutes: number
          end_at: string
          entitlement_id: string
          environment: string
          id: string
          local_date: string
          local_start: string
          location_snapshot: Json
          payment_state: string
          profile_id: string
          public_reference: string
          refund_generation: number
          refund_state: string
          reservation_expires_at: string | null
          review_state: string
          schedule_revision: number | null
          service_id: string
          service_snapshot: Json
          start_at: string
          time_zone: string
          updated_at: string
          version: number
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_repo_migration: {
        Args: {
          p_actor?: string
          p_checksum: string
          p_mode: string
          p_name: string
          p_sql: string
        }
        Returns: Json
      }
      apply_saas_provider_event: {
        Args: {
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_projection: Json
          p_source_created_at: string
        }
        Returns: boolean
      }
      apply_site_generation_interruption: {
        Args: {
          p_allow_expired: boolean
          p_cause_code: string
          p_claim_epoch: number
          p_deployment_id: string
          p_details: Json
          p_effect_certainty: string
          p_event_key: string
          p_invocation_id: string
          p_job_id: string
          p_retry_at: string
          p_runner_id: string
          p_status_message: string
        }
        Returns: boolean
      }
      apply_stripe_connect_account_projection: {
        Args: {
          p_capabilities: Json
          p_charges_enabled: boolean
          p_details_submitted: boolean
          p_environment: string
          p_observed_at: string
          p_payouts_enabled: boolean
          p_profile_id: string
          p_provider_created_at: string
          p_reconciliation_generation: number
          p_requirements: Json
          p_stripe_account_id: string
        }
        Returns: {
          account_type: string
          application_fee_bps: number
          capabilities: Json
          charge_model: string
          charges_enabled: boolean
          configuration: Json
          country: string
          created_at: string
          creation_key: string | null
          details_submitted: boolean
          environment: string
          id: string
          last_verified_at: string | null
          onboarding_state: string
          payouts_enabled: boolean
          profile_id: string
          provider_created_at: string | null
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_generation: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_safe_error: string | null
          reconnect_reason: string | null
          requirements: Json
          stripe_account_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "stripe_connected_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_stripe_connect_inbox_projection: {
        Args: {
          p_capabilities: Json
          p_charges_enabled: boolean
          p_details_submitted: boolean
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_observed_at: string
          p_payouts_enabled: boolean
          p_provider_created_at: string
          p_reconciliation_generation: number
          p_requirements: Json
        }
        Returns: boolean
      }
      archive_site_generation_attempt_events: {
        Args: {
          p_archive_before?: string
          p_batch_size?: number
          p_purge_before?: string
        }
        Returns: {
          archived_count: number
          purged_count: number
        }[]
      }
      assert_add_video_source_eligible: {
        Args: { p_config: Json; p_version_id: string; p_website_id: string }
        Returns: undefined
      }
      assert_add_video_v4_candidate_anchor: {
        Args: { p_config_json: Json; p_job_id: string }
        Returns: undefined
      }
      assert_agent_turn_owned: {
        Args: {
          p_owner_token: string
          p_trace_id: string
          p_website_id: string
        }
        Returns: undefined
      }
      assert_calendar_worker_cron_privileges: {
        Args: { p_require_schedule?: boolean }
        Returns: undefined
      }
      assert_google_calendar_owner: {
        Args: {
          p_actor_auth_user_id: string
          p_environment: string
          p_profile_id: string
          p_require_pro: boolean
        }
        Returns: undefined
      }
      assert_google_calendar_selection_invariants: {
        Args: {
          p_connection_id: string
          p_environment: string
          p_profile_id: string
        }
        Returns: undefined
      }
      assert_legacy_media_job_allowed: {
        Args: { p_job_id: string }
        Returns: undefined
      }
      assert_saas_offer_readiness: {
        Args: { p_environment: string }
        Returns: boolean
      }
      attach_saas_checkout_provider_session: {
        Args: { p_checkout_session_id: string; p_provider_session_id: string }
        Returns: string
      }
      authorize_admin_session_handoff_v4: {
        Args: {
          p_factor_id: string
          p_handoff_token_hash: string
          p_opaque_session_token_hash: string
          p_recovery_attempt_token_hash?: string
          p_recovery_code_hashes?: string[]
        }
        Returns: boolean
      }
      authorize_booking_attachment_cleanup_v3: {
        Args: {
          p_attachment_id: string
          p_environment: string
          p_fencing_token: number
          p_generation: number
          p_lease_token: string
        }
        Returns: boolean
      }
      authorize_booking_attachment_download: {
        Args: { p_actor_auth_user_id: string; p_attachment_id: string }
        Returns: {
          display_filename: string
          mime_type: string
          storage_object_key: string
        }[]
      }
      authorize_booking_attachment_download_v3: {
        Args: {
          p_actor_auth_user_id: string
          p_attachment_id: string
          p_generation?: number
        }
        Returns: {
          checksum: string
          display_filename: string
          generation: number
          mime_type: string
          storage_object_key: string
        }[]
      }
      authorize_booking_notification_dispatch_v3: {
        Args: {
          p_environment: string
          p_expected_appointment: Json
          p_fencing_token: number
          p_lease_token: string
          p_notification_id: string
          p_payload: string
        }
        Returns: Json
      }
      authorize_google_calendar_connect_completion: {
        Args: {
          p_actor_auth_user_id: string
          p_environment: string
          p_operation_id: string
          p_profile_id: string
        }
        Returns: {
          account_display_name: string | null
          account_email: string | null
          action_notice: Json
          action_notice_due_at: string | null
          action_notice_fencing_token: number
          action_notice_lease_expires_at: string | null
          action_notice_lease_token: string | null
          app_slug: string
          availability_generation: number
          calendar_create_blocked_at: string | null
          calendar_create_verified_at: string | null
          calendar_delete_blocked_at: string | null
          calendar_delete_verified_at: string | null
          calendar_probe_insert_blocked_at: string | null
          calendar_probe_insert_verified_at: string | null
          calendar_write_blocked_at: string | null
          calendar_write_verified_at: string | null
          connect_actor_auth_user_id: string | null
          connect_completed_at: string | null
          connect_expected_revision: number | null
          connect_expected_setup_key: string | null
          connect_expires_at: string | null
          connect_operation_id: string | null
          connect_started_at: string | null
          connection_revision: number
          created_at: string
          disconnected_at: string | null
          environment: string
          external_user_id: string
          health_state: string
          id: string
          identity_metadata: Json
          last_synchronized_at: string | null
          last_verified_at: string | null
          owner_verification_requested_at: string | null
          pipedream_account_id: string | null
          profile_id: string
          reconnect_reason: string | null
          setup_account_display_name: string | null
          setup_account_email: string | null
          setup_account_id: string | null
          setup_actor_auth_user_id: string | null
          setup_attempts: number
          setup_calendar_id: string | null
          setup_calendars: Json | null
          setup_completed_at: string | null
          setup_connect_operation_id: string | null
          setup_expected_revision: number | null
          setup_failure_reason: string | null
          setup_fencing_token: number
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_id: string | null
          setup_probe_account_id: string | null
          setup_probe_calendar_id: string | null
          setup_probe_delete_started_at: string | null
          setup_probe_id: string | null
          setup_probe_started_at: string | null
          setup_probe_state: string
          setup_probe_write_verified_at: string | null
          setup_purpose: string
          setup_read_verified_at: string | null
          setup_retry_at: string | null
          setup_write_verified_at: string | null
          updated_at: string
          verification_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      authorize_google_calendar_connect_start: {
        Args: {
          p_actor_auth_user_id: string
          p_environment: string
          p_operation_id: string
          p_profile_id: string
        }
        Returns: Json
      }
      authorize_google_calendar_setup_effect: {
        Args: {
          p_action: string
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_operation_id: string
          p_profile_id: string
        }
        Returns: boolean
      }
      authorize_google_calendar_setup_read: {
        Args: {
          p_account_id: string
          p_environment: string
          p_expected_revision: number
          p_expected_setup_key?: string
          p_profile_id: string
        }
        Returns: boolean
      }
      authorize_pipedream_trigger_cleanup: {
        Args: {
          p_binding_id: string
          p_deployed_trigger_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: boolean
      }
      begin_admin_recovery_v4: {
        Args: {
          p_attempt_token_hash: string
          p_code_hash: string
          p_user_id: string
        }
        Returns: string
      }
      begin_agent_external_operation: {
        Args: {
          p_operation_key: string
          p_operation_type: string
          p_owner_token: string
          p_trace_id: string
          p_website_id: string
        }
        Returns: boolean
      }
      begin_booking_attachment_upload_v3: {
        Args: {
          p_request_hash: string
          p_request_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      begin_booking_calendar_effect: {
        Args: {
          p_action: string
          p_expected_appointment_version: number
          p_expected_generation: number
          p_fencing_token: number
          p_lease_token: string
          p_link_id: string
        }
        Returns: string
      }
      begin_booking_provider_account_disconnect_v3: {
        Args: {
          p_disconnect_id: string
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_profile_id: string
          p_provider_account_id: string
        }
        Returns: boolean
      }
      begin_leased_stripe_connect_reconciliation: {
        Args: {
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_profile_id: string
          p_stripe_account_id: string
        }
        Returns: number
      }
      begin_pipedream_trigger_deployment_effect: {
        Args: {
          p_binding_id: string
          p_deployment_operation_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: boolean
      }
      begin_saas_checkout: {
        Args: {
          p_attempt_id: string
          p_business_name: string
          p_city: string
          p_email: string
          p_environment: string
          p_full_name: string
          p_legal_acceptance_ip_hash: string
          p_legal_acceptance_user_agent: string
          p_legal_accepted_at: string
          p_legal_document_versions: Json
          p_license_number: string
          p_plan: string
          p_website_id: string
        }
        Returns: {
          checkout_email: string
          checkout_plan: string
          checkout_session_id: string
          checkout_status: string
          disposition: string
          offer_contract_version: number
          offer_currency: string
          offer_interval: string
          offer_interval_count: number
          offer_price_id: string
          offer_product_id: string
          offer_unit_amount_minor: number
          profile_id: string
          provider_session_id: string
          subscription_id: string
          website_id: string
        }[]
      }
      begin_saas_checkout_fulfillment_dispatch: {
        Args: { p_fencing_token: number; p_id: string; p_lease_token: string }
        Returns: boolean
      }
      begin_stripe_connect_inbox_reconciliation: {
        Args: {
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: number
      }
      begin_stripe_connect_reconciliation: {
        Args: {
          p_environment: string
          p_profile_id: string
          p_stripe_account_id: string
        }
        Returns: number
      }
      bind_booking_calendar_intent: {
        Args: {
          p_command_id: string
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: {
          calendar_selection_id: string
          connection_id: string
          connection_revision: number
          created_at: string
          environment: string
          google_calendar_id: string
          id: string
          pipedream_account_id: string
          profile_id: string
          retired_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_destination_epochs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bind_booking_confirmation_nonce: {
        Args: {
          p_fencing_token: number
          p_lease_token: string
          p_nonce_hash: string
          p_payment_id: string
        }
        Returns: boolean
      }
      bind_stripe_connect_account: {
        Args: {
          p_creation_key: string
          p_environment: string
          p_profile_id: string
          p_stripe_account_id: string
        }
        Returns: number
      }
      booking_attachment_scanner_ready: {
        Args: { p_config_fingerprint: string; p_environment: string }
        Returns: boolean
      }
      booking_attachment_scanner_ready_v3: {
        Args: { p_config_fingerprint: string; p_environment: string }
        Returns: boolean
      }
      booking_calendar_content_sha256: {
        Args: {
          p_appointment: Database["public"]["Tables"]["appointments"]["Row"]
        }
        Returns: string
      }
      booking_confirmation_projection_v3: {
        Args: { p_appointment_id: string }
        Returns: Json
      }
      booking_convergence_cutover_inventory: {
        Args: { p_environment: string; p_profile_id: string }
        Returns: Json
      }
      booking_cutover_enabled: {
        Args: { p_environment: string; p_profile_id: string }
        Returns: boolean
      }
      booking_cutover_inventory_v3: {
        Args: { p_environment: string; p_profile_id: string }
        Returns: Json
      }
      booking_financial_guard_token_v3: { Args: never; Returns: string }
      booking_notification_email_valid_v3: {
        Args: { p_email: string }
        Returns: boolean
      }
      booking_notification_event_current_v4: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      bootstrap_admin_principal_v4: {
        Args: { p_user_id: string }
        Returns: boolean
      }
      bucket1_assert_schema_v4_publish_attestation: {
        Args: {
          p_config_json: Json
          p_expected_revision: number
          p_generation_job_id: string
          p_validation_attestation: Json
        }
        Returns: undefined
      }
      bucket1_canonical_hash: { Args: { p_value: Json }; Returns: string }
      bucket1_canonical_json: { Args: { p_value: Json }; Returns: string }
      bump_admin_auth_epoch_v2: {
        Args: { p_reason: string; p_user_id: string }
        Returns: number
      }
      calendar_action_notice_scope: {
        Args: {
          p_connection: Database["public"]["Tables"]["calendar_connections"]["Row"]
        }
        Returns: Json
      }
      can_read_clean_booking_attachment: {
        Args: { p_object_key: string }
        Returns: boolean
      }
      cancel_add_video_job: {
        Args: { p_chain_id: string; p_request_id: string; p_website_id: string }
        Returns: {
          chain_id: string
          error_code: string
          job_id: string
          result: Json
          source_version_id: string
          status: string
          target_version_id: string
        }[]
      }
      cancel_contractor_booking: {
        Args: {
          p_actor_auth_user_id: string
          p_appointment_id: string
          p_client_request_id: string
          p_environment: string
          p_profile_id: string
          p_request_hash: string
        }
        Returns: {
          amount_minor: number
          appointment_reason: string | null
          appointment_state: string
          booking_contract_version: number | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          calendar_destination_epoch_id: string | null
          calendar_generation: number
          calendar_state: string
          cancellation_requested_at: string | null
          cancelled_at: string | null
          capacity_range: unknown
          checkout_generation: number
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_id: string
          customer_snapshot: Json
          duration_minutes: number
          end_at: string
          entitlement_id: string
          environment: string
          id: string
          local_date: string
          local_start: string
          location_snapshot: Json
          payment_state: string
          profile_id: string
          public_reference: string
          refund_generation: number
          refund_state: string
          reservation_expires_at: string | null
          review_state: string
          schedule_revision: number | null
          service_id: string
          service_snapshot: Json
          start_at: string
          time_zone: string
          updated_at: string
          version: number
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_site_generation_request:
        | {
            Args: {
              p_chain_id: string
              p_claim_epoch: number
              p_request_id: string
              p_website_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              p_actor: string
              p_chain_id: string
              p_contract_epoch: number
              p_expected_claim_epoch?: number
              p_reason: string
              p_request_id: string
              p_website_id: string
            }
            Returns: boolean
          }
      cancel_workspace_background_jobs: {
        Args: { p_website_id: string }
        Returns: number
      }
      capture_booking_cutover_preflight_v3: {
        Args: { p_environment: string; p_profile_id: string }
        Returns: string
      }
      check_admin_login_rate_limit: {
        Args: {
          p_client_hash: string
          p_pair_hash: string
          p_principal_hash: string
        }
        Returns: boolean
      }
      check_public_booking_rate_limit: {
        Args: {
          p_action: string
          p_client_bucket: string
          p_limit: number
          p_scope_key: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      checkpoint_add_video_plan: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_plan: Json
          p_plan_hash: string
          p_poster_slot_id: string
          p_slot_id: string
          p_source_slot_id: string
          p_website_id: string
        }
        Returns: string
      }
      claim_add_video_media_slot_epoch: {
        Args: {
          p_claim_epoch: number
          p_job_attempts: number
          p_job_id: string
          p_kind: string
          p_poster_slot_id: string
          p_proof_eligible: boolean
          p_provenance: string
          p_required: boolean
          p_role: string
          p_runner_id: string
          p_slot_id: string
          p_source_slot_id: string
          p_website_id: string
        }
        Returns: string
      }
      claim_agent_turn: {
        Args: {
          p_intent_type: string
          p_lease_seconds?: number
          p_owner_token: string
          p_profile_id: string
          p_request_id: string
          p_request_payload_hash: string
          p_source_revision: number
          p_source_version_id: string
          p_trigger_message: string
          p_website_id: string
        }
        Returns: Json
      }
      claim_ambiguous_booking_checkouts: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          appointment_id: string
          checkout_fencing_token: number
          checkout_idempotency_key: string
          checkout_operation_id: string
          checkout_provider_expires_at: string
          currency: string
          customer_snapshot: Json
          environment: string
          expected_amount_minor: number
          payment_id: string
          profile_id: string
          service_snapshot: Json
          stripe_account_id: string
          website_id: string
        }[]
      }
      claim_booking_attachment_cleanup: {
        Args: { p_lease_token: string; p_limit?: number }
        Returns: {
          cleanup_fencing_token: number
          cleanup_reason: string
          id: string
          storage_object_key: string
        }[]
      }
      claim_booking_attachment_cleanup_v3: {
        Args: {
          p_discover?: boolean
          p_environment: string
          p_lease_token: string
          p_limit?: number
        }
        Returns: {
          attachment_id: string
          deletion_fencing_token: number
          deletion_reason: string
          generation: number
          storage_object_key: string
        }[]
      }
      claim_booking_attachment_scan: {
        Args: {
          p_attachment_id: string
          p_lease_seconds: number
          p_lease_token: string
        }
        Returns: number
      }
      claim_booking_calendar_reconciliation: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          appointment: Json
          epoch: Json
          link: Json
        }[]
      }
      claim_booking_checkout: {
        Args: {
          p_appointment_id: string
          p_lease_token: string
          p_operation_id: string
        }
        Returns: {
          amount_paid_minor: number
          amount_refunded_minor: number
          appointment_id: string
          booking_contract_version: number | null
          charge_id: string | null
          checkout_expires_at: string | null
          checkout_fencing_token: number
          checkout_idempotency_key: string | null
          checkout_last_error: string | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_id: string | null
          checkout_provider_expires_at: string | null
          checkout_session_id: string | null
          confirmation_handoff_expires_at: string | null
          confirmation_nonce_hash: string | null
          connected_account_id: string | null
          created_at: string
          currency: string
          dispute_id: string | null
          dispute_provider_created: number
          dispute_state: string
          dispute_status_rank: number
          environment: string
          expected_amount_minor: number
          failed_at: string | null
          failure_code: string | null
          financial_event_rank: number
          financial_provider_created: number
          financial_provider_event_id: string | null
          id: string
          paid_at: string | null
          payment_intent_id: string | null
          payment_state: string
          profile_id: string
          provider_created_at: string | null
          provider_updated_at: string | null
          receipt_url: string | null
          refund_generation: number
          refund_id: string | null
          refund_idempotency_key: string | null
          refund_requested_at: string | null
          refund_state: string
          refunded_at: string | null
          session_expiry_attempts: number
          session_expiry_next_attempt_at: string
          stripe_account_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_booking_late_payment_arbitrations: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          appointment: Json
          arbitration: Json
          provider_context: Json
        }[]
      }
      claim_booking_provider_account_disconnect_v3: {
        Args: {
          p_disconnect_id?: string
          p_environment: string
          p_exclude_ids?: string[]
          p_lease_token: string
        }
        Returns: Json
      }
      claim_booking_worker_family_v3: {
        Args: {
          p_environment: string
          p_family: string
          p_lease_seconds?: number
          p_lease_token: string
        }
        Returns: number
      }
      claim_calendar_action_notice: {
        Args: { p_environment: string; p_lease_token: string }
        Returns: Json
      }
      claim_due_booking_attachment_scans_v3: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          attachment_id: string
          byte_size: number
          checksum: string
          generation: number
          mime_type: string
          scan_fencing_token: number
          storage_object_key: string
        }[]
      }
      claim_due_booking_notifications: {
        Args: { p_lease_token: string; p_limit?: number }
        Returns: {
          accepted_at: string | null
          appointment_id: string
          attempts: number
          audience: string
          created_at: string
          delivered_at: string | null
          delivery_rank: number
          dispatch_appointment: Json | null
          dispatch_payload: string | null
          environment: string
          failed_at: string | null
          fencing_token: number
          first_dispatch_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_provider_event_at: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          notification_type: string
          occurrence_version: number
          profile_id: string
          projected_at: string
          provider_destination: string
          provider_event_id: string | null
          provider_message_id: string | null
          recipient_email: string | null
          replay_deadline_at: string | null
          source_event_key: string
          state: string
          suppression_reason: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "booking_notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_booking_notifications_v3: {
        Args: {
          p_dispatch_contract?: number
          p_environment: string
          p_lease_token: string
          p_limit?: number
        }
        Returns: {
          accepted_at: string | null
          appointment_id: string
          attempts: number
          audience: string
          created_at: string
          delivered_at: string | null
          delivery_rank: number
          dispatch_appointment: Json | null
          dispatch_payload: string | null
          environment: string
          failed_at: string | null
          fencing_token: number
          first_dispatch_at: string | null
          id: string
          idempotency_key: string
          last_error: string | null
          last_provider_event_at: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          notification_type: string
          occurrence_version: number
          profile_id: string
          projected_at: string
          provider_destination: string
          provider_event_id: string | null
          provider_message_id: string | null
          recipient_email: string | null
          replay_deadline_at: string | null
          source_event_key: string
          state: string
          suppression_reason: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "booking_notifications"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_booking_outbox: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          appointment_id: string
          attempts: number
          command_type: string
          completed_at: string | null
          created_at: string
          desired_appointment_version: number
          destination_epoch_id: string | null
          effect_contract_version: number | null
          effect_generation: number
          environment: string
          fencing_token: number
          id: string
          idempotency_key: string
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          payload: Json
          profile_id: string
          safe_error: string | null
          state: string
          terminal_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "integration_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_booking_payment_events: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          account_context: string
          api_version: string
          attempts: number
          destination: string
          environment: string
          event_family: string
          event_id: string
          event_type: string
          fencing_token: number
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          livemode: boolean
          next_attempt_at: string
          payload: Json
          payload_hash: string
          pipedream_binding_id: string | null
          pipedream_trigger_id: string | null
          processed_at: string | null
          processing_state: string
          profile_id: string | null
          provider: string
          received_at: string
          safe_error: string | null
          signature_timestamp: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "provider_event_inbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_booking_session_expiries_v3: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          amount_paid_minor: number
          amount_refunded_minor: number
          appointment_id: string
          booking_contract_version: number | null
          charge_id: string | null
          checkout_expires_at: string | null
          checkout_fencing_token: number
          checkout_idempotency_key: string | null
          checkout_last_error: string | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_id: string | null
          checkout_provider_expires_at: string | null
          checkout_session_id: string | null
          confirmation_handoff_expires_at: string | null
          confirmation_nonce_hash: string | null
          connected_account_id: string | null
          created_at: string
          currency: string
          dispute_id: string | null
          dispute_provider_created: number
          dispute_state: string
          dispute_status_rank: number
          environment: string
          expected_amount_minor: number
          failed_at: string | null
          failure_code: string | null
          financial_event_rank: number
          financial_provider_created: number
          financial_provider_event_id: string | null
          id: string
          paid_at: string | null
          payment_intent_id: string | null
          payment_state: string
          profile_id: string
          provider_created_at: string | null
          provider_updated_at: string | null
          receipt_url: string | null
          refund_generation: number
          refund_id: string | null
          refund_idempotency_key: string | null
          refund_requested_at: string | null
          refund_state: string
          refunded_at: string | null
          session_expiry_attempts: number
          session_expiry_next_attempt_at: string
          stripe_account_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "booking_payments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_booking_sessions: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          amount_paid_minor: number
          amount_refunded_minor: number
          appointment_id: string
          booking_contract_version: number | null
          charge_id: string | null
          checkout_expires_at: string | null
          checkout_fencing_token: number
          checkout_idempotency_key: string | null
          checkout_last_error: string | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_id: string | null
          checkout_provider_expires_at: string | null
          checkout_session_id: string | null
          confirmation_handoff_expires_at: string | null
          confirmation_nonce_hash: string | null
          connected_account_id: string | null
          created_at: string
          currency: string
          dispute_id: string | null
          dispute_provider_created: number
          dispute_state: string
          dispute_status_rank: number
          environment: string
          expected_amount_minor: number
          failed_at: string | null
          failure_code: string | null
          financial_event_rank: number
          financial_provider_created: number
          financial_provider_event_id: string | null
          id: string
          paid_at: string | null
          payment_intent_id: string | null
          payment_state: string
          profile_id: string
          provider_created_at: string | null
          provider_updated_at: string | null
          receipt_url: string | null
          refund_generation: number
          refund_id: string | null
          refund_idempotency_key: string | null
          refund_requested_at: string | null
          refund_state: string
          refunded_at: string | null
          session_expiry_attempts: number
          session_expiry_next_attempt_at: string
          stripe_account_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "booking_payments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_pipedream_bindings: {
        Args: {
          p_environment: string
          p_exclude_binding_ids?: string[]
          p_lease_seconds?: number
          p_lease_token: string
          p_limit?: number
        }
        Returns: Json[]
      }
      claim_due_saas_checkout_fulfillment: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          accepted_at: string | null
          attempts: number
          checkout_session_id: string
          created_at: string
          environment: string
          failed_at: string | null
          fencing_token: number
          id: string
          last_error: string | null
          lease_expires_at: string | null
          lease_token: string | null
          next_attempt_at: string
          profile_id: string
          provider_attempts: number
          provider_dispatch_started_at: string | null
          recipient_email: string
          redrive_count: number
          state: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "saas_checkout_fulfillment_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_due_stripe_connect_accounts: {
        Args: { p_environment: string; p_lease_token: string; p_limit?: number }
        Returns: {
          account_type: string
          application_fee_bps: number
          capabilities: Json
          charge_model: string
          charges_enabled: boolean
          configuration: Json
          country: string
          created_at: string
          creation_key: string | null
          details_submitted: boolean
          environment: string
          id: string
          last_verified_at: string | null
          onboarding_state: string
          payouts_enabled: boolean
          profile_id: string
          provider_created_at: string | null
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_generation: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_safe_error: string | null
          reconnect_reason: string | null
          requirements: Json
          stripe_account_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "stripe_connected_accounts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_generation_media_slot: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_kind: string
          p_poster_slot_id?: string
          p_proof_eligible?: boolean
          p_provenance?: string
          p_required?: boolean
          p_role: string
          p_slot_id: string
          p_source_slot_id?: string
          p_website_id: string
        }
        Returns: string
      }
      claim_generation_media_slot_epoch: {
        Args: {
          p_claim_epoch: number
          p_job_id: string
          p_kind: string
          p_poster_slot_id?: string
          p_proof_eligible?: boolean
          p_provenance?: string
          p_required?: boolean
          p_role: string
          p_runner_id?: string
          p_slot_id: string
          p_source_slot_id?: string
          p_website_id: string
        }
        Returns: string
      }
      claim_generation_media_slot_legacy_attempt: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_kind: string
          p_poster_slot_id?: string
          p_proof_eligible?: boolean
          p_provenance?: string
          p_required?: boolean
          p_role: string
          p_slot_id: string
          p_source_slot_id?: string
          p_website_id: string
        }
        Returns: string
      }
      claim_google_calendar_setup_probe: {
        Args: {
          p_environment: string
          p_exclude_operation_ids?: string[]
          p_lease_token: string
          p_profile_id?: string
        }
        Returns: Json
      }
      claim_next_background_job: {
        Args: {
          p_generation_contract_epoch: number
          p_runner_id: string
          p_scheduler_run_id: string
          p_stale_before: string
        }
        Returns: {
          agent_trace_id: string | null
          attempts: number
          cancellation_actor: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          chain_id: string
          claim_epoch: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          failure_attempts: number
          finalization_attempts: number
          generation_accepted_at: string | null
          generation_checkpoint: Json | null
          generation_contract_epoch: number
          generation_contract_version: number | null
          generation_handoff_message_id: string | null
          generation_input_hash: string | null
          generation_input_snapshot: Json | null
          generation_input_version: number | null
          generation_kind: string | null
          generation_last_dispatched_at: string | null
          generation_last_scheduler_run_id: string | null
          generation_request_hash: string | null
          generation_request_id: string | null
          generation_result_version_id: string | null
          generation_stage: string | null
          generation_tenant_id: string | null
          generation_terminal_message_at: string | null
          generation_terminal_message_id: string | null
          generation_terminal_message_payload: Json | null
          id: string
          idempotency_key: string | null
          interruption_count: number
          job_type: string
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          next_retry_at: string | null
          payload_json: Json
          platform: string | null
          progress_pct: number
          repair_attempts: number
          request_id: string | null
          research_row_id: string | null
          result_json: Json | null
          scheduler_dispatch_sequence: number | null
          scheduler_last_dispatched_at: string | null
          scheduler_last_run_id: string | null
          sequence_index: number
          source_revision: number | null
          source_version_id: string | null
          stage_attempt_counts: Json
          stage_attempts: number
          started_at: string | null
          status: string
          status_message: string | null
          superseded_at: string | null
          superseded_by_job_id: string | null
          supersedes_job_id: string | null
          supersession_actor: string | null
          supersession_link_state: string
          supersession_reason: string | null
          target_version_id: string | null
          website_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "background_jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_outbox_command: {
        Args: {
          p_command_id: string
          p_lease_seconds: number
          p_lease_token: string
        }
        Returns: number
      }
      claim_provider_event: {
        Args: {
          p_event_id: string
          p_lease_seconds: number
          p_lease_token: string
        }
        Returns: number
      }
      claim_saved_google_calendar_verification: {
        Args: {
          p_allow_repair?: boolean
          p_environment: string
          p_lease_seconds?: number
          p_lease_token: string
          p_profile_id: string
        }
        Returns: Json
      }
      claim_stripe_connect_account_refresh: {
        Args: {
          p_environment: string
          p_lease_token: string
          p_profile_id: string
        }
        Returns: {
          account_type: string
          application_fee_bps: number
          capabilities: Json
          charge_model: string
          charges_enabled: boolean
          configuration: Json
          country: string
          created_at: string
          creation_key: string | null
          details_submitted: boolean
          environment: string
          id: string
          last_verified_at: string | null
          onboarding_state: string
          payouts_enabled: boolean
          profile_id: string
          provider_created_at: string | null
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_generation: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_safe_error: string | null
          reconnect_reason: string | null
          requirements: Json
          stripe_account_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "stripe_connected_accounts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_google_calendar_connection: {
        Args: {
          p_actor_auth_user_id: string
          p_environment: string
          p_expected_revision: number
          p_profile_id: string
        }
        Returns: {
          account_display_name: string | null
          account_email: string | null
          action_notice: Json
          action_notice_due_at: string | null
          action_notice_fencing_token: number
          action_notice_lease_expires_at: string | null
          action_notice_lease_token: string | null
          app_slug: string
          availability_generation: number
          calendar_create_blocked_at: string | null
          calendar_create_verified_at: string | null
          calendar_delete_blocked_at: string | null
          calendar_delete_verified_at: string | null
          calendar_probe_insert_blocked_at: string | null
          calendar_probe_insert_verified_at: string | null
          calendar_write_blocked_at: string | null
          calendar_write_verified_at: string | null
          connect_actor_auth_user_id: string | null
          connect_completed_at: string | null
          connect_expected_revision: number | null
          connect_expected_setup_key: string | null
          connect_expires_at: string | null
          connect_operation_id: string | null
          connect_started_at: string | null
          connection_revision: number
          created_at: string
          disconnected_at: string | null
          environment: string
          external_user_id: string
          health_state: string
          id: string
          identity_metadata: Json
          last_synchronized_at: string | null
          last_verified_at: string | null
          owner_verification_requested_at: string | null
          pipedream_account_id: string | null
          profile_id: string
          reconnect_reason: string | null
          setup_account_display_name: string | null
          setup_account_email: string | null
          setup_account_id: string | null
          setup_actor_auth_user_id: string | null
          setup_attempts: number
          setup_calendar_id: string | null
          setup_calendars: Json | null
          setup_completed_at: string | null
          setup_connect_operation_id: string | null
          setup_expected_revision: number | null
          setup_failure_reason: string | null
          setup_fencing_token: number
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_id: string | null
          setup_probe_account_id: string | null
          setup_probe_calendar_id: string | null
          setup_probe_delete_started_at: string | null
          setup_probe_id: string | null
          setup_probe_started_at: string | null
          setup_probe_state: string
          setup_probe_write_verified_at: string | null
          setup_purpose: string
          setup_read_verified_at: string | null
          setup_retry_at: string | null
          setup_write_verified_at: string | null
          updated_at: string
          verification_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_add_video_terminal_children: {
        Args: { p_job_id: string; p_now?: string; p_reason: string }
        Returns: number
      }
      commit_add_video_to_version: {
        Args: {
          p_candidate_hash: string
          p_config_json: Json
          p_edit_event_payload: Json
          p_expected_revision: number
          p_job_attempts: number
          p_job_id: string
          p_media_slot_id: string
          p_target_version_id: string
          p_website_id: string
        }
        Returns: Json
      }
      commit_add_video_to_version_epoch: {
        Args: {
          p_candidate_hash: string
          p_claim_epoch: number
          p_config_json: Json
          p_edit_event_payload: Json
          p_expected_revision: number
          p_job_attempts: number
          p_job_id: string
          p_media_slot_id: string
          p_runner_id: string
          p_target_version_id: string
          p_website_id: string
        }
        Returns: Json
      }
      commit_add_video_to_version_historical_body: {
        Args: {
          p_candidate_hash: string
          p_config_json: Json
          p_edit_event_payload: Json
          p_expected_revision: number
          p_job_attempts: number
          p_job_id: string
          p_media_slot_id: string
          p_target_version_id: string
          p_website_id: string
        }
        Returns: Json
      }
      complete_admin_recovery_provider_reset_v4: {
        Args: { p_attempt_token_hash: string }
        Returns: boolean
      }
      complete_agent_turn: {
        Args: {
          p_error_message?: string
          p_owner_token: string
          p_round_count: number
          p_status: string
          p_tool_call_count: number
          p_trace_id: string
        }
        Returns: boolean
      }
      complete_booking_attachment_cleanup: {
        Args: {
          p_attachment_id: string
          p_fencing_token: number
          p_lease_token: string
          p_object_removed: boolean
        }
        Returns: boolean
      }
      complete_booking_attachment_cleanup_v3: {
        Args: {
          p_attachment_id: string
          p_environment: string
          p_fencing_token: number
          p_generation: number
          p_lease_token: string
          p_object_removed: boolean
        }
        Returns: boolean
      }
      complete_booking_attachment_scan: {
        Args: {
          p_attachment_id: string
          p_fencing_token: number
          p_lease_token: string
          p_outcome: string
          p_safe_error?: string
        }
        Returns: {
          appointment_id: string
          byte_size: number
          checksum: string
          cleanup_fencing_token: number
          cleanup_lease_expires_at: string | null
          cleanup_lease_token: string | null
          cleanup_reason: string | null
          created_at: string
          current_object_generation: number
          customer_id: string
          deleted_at: string | null
          display_filename: string
          environment: string
          finalized_at: string | null
          height: number | null
          id: string
          legal_hold_at: string | null
          legal_hold_epoch: number
          legal_hold_reason: string | null
          mime_type: string
          original_filename: string
          profile_id: string
          quota_slot: number
          scan_attempts: number
          scan_config_fingerprint: string | null
          scan_error: string | null
          scan_fencing_token: number
          scan_lease_expires_at: string | null
          scan_lease_token: string | null
          scan_proven_at: string | null
          scanned_checksum: string | null
          scanner_verdict_id: string | null
          state_version: number
          storage_object_key: string
          upload_state: string
          website_id: string
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "booking_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_booking_attachment_scan_v3: {
        Args: {
          p_attachment_id: string
          p_config_fingerprint: string
          p_environment: string
          p_fencing_token: number
          p_generation: number
          p_lease_token: string
          p_outcome: string
          p_safe_error: string
          p_scanned_checksum: string
          p_scanner_verdict_id?: string
        }
        Returns: boolean
      }
      complete_booking_notification: {
        Args: {
          p_fencing_token: number
          p_lease_token: string
          p_notification_id: string
          p_provider_message_id: string
        }
        Returns: boolean
      }
      complete_booking_notification_v3: {
        Args: {
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_notification_id: string
          p_provider_destination: string
          p_provider_message_id: string
        }
        Returns: boolean
      }
      complete_booking_outbox: {
        Args: {
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
          p_provider_result: Json
        }
        Returns: boolean
      }
      complete_booking_provider_account_disconnect_v3: {
        Args: {
          p_disconnect_id: string
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_profile_id: string
          p_provider_account_id: string
        }
        Returns: boolean
      }
      complete_booking_worker_family_v3: {
        Args: {
          p_environment: string
          p_family: string
          p_fencing_token: number
          p_lease_token: string
          p_safe_error?: string
          p_success: boolean
        }
        Returns: boolean
      }
      complete_generation_media_cleanup: {
        Args: { p_actor: string; p_storage_path: string }
        Returns: number
      }
      complete_outbox_appointment_command: {
        Args: {
          p_client_request_id: string
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
          p_outcome: string
          p_provider_result?: Json
          p_request_hash: string
          p_safe_error?: string
        }
        Returns: {
          amount_minor: number
          appointment_reason: string | null
          appointment_state: string
          booking_contract_version: number | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          calendar_destination_epoch_id: string | null
          calendar_generation: number
          calendar_state: string
          cancellation_requested_at: string | null
          cancelled_at: string | null
          capacity_range: unknown
          checkout_generation: number
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_id: string
          customer_snapshot: Json
          duration_minutes: number
          end_at: string
          entitlement_id: string
          environment: string
          id: string
          local_date: string
          local_start: string
          location_snapshot: Json
          payment_state: string
          profile_id: string
          public_reference: string
          refund_generation: number
          refund_state: string
          reservation_expires_at: string | null
          review_state: string
          schedule_revision: number | null
          service_id: string
          service_snapshot: Json
          start_at: string
          time_zone: string
          updated_at: string
          version: number
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_outbox_command: {
        Args: {
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
          p_safe_error?: string
          p_succeeded: boolean
        }
        Returns: boolean
      }
      complete_pipedream_stale_trigger_cleanup: {
        Args: {
          p_binding_id: string
          p_deployed_trigger_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: boolean
      }
      complete_provider_event: {
        Args: {
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_safe_error?: string
          p_succeeded: boolean
        }
        Returns: boolean
      }
      complete_saas_checkout_fulfillment: {
        Args: {
          p_fencing_token: number
          p_id: string
          p_lease_token: string
          p_retryable: boolean
          p_safe_error?: string
          p_succeeded: boolean
        }
        Returns: boolean
      }
      consume_admin_session_handoff_v4: {
        Args: { p_handoff_token_hash: string }
        Returns: string
      }
      consume_booking_confirmation_capability:
        | { Args: { p_token_hash: string }; Returns: Json }
        | { Args: { p_reference: string; p_token_hash: string }; Returns: Json }
      consume_booking_confirmation_capability_v3: {
        Args: { p_reference: string; p_token_hash: string }
        Returns: Json
      }
      converge_booking_full_refund_v3: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      create_booking_attachment_record: {
        Args: {
          p_appointment_id: string
          p_attachment_id: string
          p_byte_size: number
          p_checksum: string
          p_display_filename: string
          p_environment: string
          p_mime_type: string
          p_original_filename: string
          p_profile_id: string
          p_quota_slot: number
        }
        Returns: {
          appointment_id: string
          byte_size: number
          checksum: string
          cleanup_fencing_token: number
          cleanup_lease_expires_at: string | null
          cleanup_lease_token: string | null
          cleanup_reason: string | null
          created_at: string
          current_object_generation: number
          customer_id: string
          deleted_at: string | null
          display_filename: string
          environment: string
          finalized_at: string | null
          height: number | null
          id: string
          legal_hold_at: string | null
          legal_hold_epoch: number
          legal_hold_reason: string | null
          mime_type: string
          original_filename: string
          profile_id: string
          quota_slot: number
          scan_attempts: number
          scan_config_fingerprint: string | null
          scan_error: string | null
          scan_fencing_token: number
          scan_lease_expires_at: string | null
          scan_lease_token: string | null
          scan_proven_at: string | null
          scanned_checksum: string | null
          scanner_verdict_id: string | null
          state_version: number
          storage_object_key: string
          upload_state: string
          website_id: string
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "booking_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_public_booking_attachment_record: {
        Args: {
          p_appointment_id: string
          p_attachment_id: string
          p_byte_size: number
          p_checksum: string
          p_display_filename: string
          p_mime_type: string
          p_original_filename: string
          p_quota_slot: number
        }
        Returns: {
          appointment_id: string
          byte_size: number
          checksum: string
          cleanup_fencing_token: number
          cleanup_lease_expires_at: string | null
          cleanup_lease_token: string | null
          cleanup_reason: string | null
          created_at: string
          current_object_generation: number
          customer_id: string
          deleted_at: string | null
          display_filename: string
          environment: string
          finalized_at: string | null
          height: number | null
          id: string
          legal_hold_at: string | null
          legal_hold_epoch: number
          legal_hold_reason: string | null
          mime_type: string
          original_filename: string
          profile_id: string
          quota_slot: number
          scan_attempts: number
          scan_config_fingerprint: string | null
          scan_error: string | null
          scan_fencing_token: number
          scan_lease_expires_at: string | null
          scan_lease_token: string | null
          scan_proven_at: string | null
          scanned_checksum: string | null
          scanner_verdict_id: string | null
          state_version: number
          storage_object_key: string
          upload_state: string
          website_id: string
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "booking_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      defer_saas_checkout_fulfillment: {
        Args: {
          p_fencing_token: number
          p_id: string
          p_lease_token: string
          p_safe_error: string
        }
        Returns: boolean
      }
      direct_upload_storage_object_is_referenced: {
        Args: { p_storage_path: string }
        Returns: boolean
      }
      discard_website_versions_atomic: {
        Args: { p_expected_versions: Json; p_website_id: string }
        Returns: number
      }
      dispatch_calendar_worker_schedule: {
        Args: { p_environment: string; p_worker: string }
        Returns: number
      }
      enqueue_add_video_job: {
        Args: {
          p_expected_revision: number
          p_request_id: string
          p_source_version_id: string
          p_website_id: string
        }
        Returns: {
          chain_id: string
          error_code: string
          job_id: string
          result: Json
          source_version_id: string
          status: string
          target_version_id: string
        }[]
      }
      enqueue_add_video_job_unchecked: {
        Args: {
          p_expected_revision: number
          p_request_id: string
          p_source_version_id: string
          p_website_id: string
        }
        Returns: {
          chain_id: string
          error_code: string
          job_id: string
          result: Json
          source_version_id: string
          status: string
          target_version_id: string
        }[]
      }
      enqueue_booking_calendar_create: {
        Args: { p_appointment_id: string }
        Returns: boolean
      }
      enqueue_booking_notification: {
        Args: { p_appointment_id: string; p_notification_type: string }
        Returns: number
      }
      enqueue_enrichment_chain_owned: {
        Args: {
          p_chain_id: string
          p_idempotency_key: string
          p_owner_token: string
          p_rows: Json
          p_trace_id: string
          p_website_id: string
        }
        Returns: undefined
      }
      enqueue_saas_checkout_fulfillment: {
        Args: { p_checkout_session_id: string }
        Returns: boolean
      }
      enqueue_site_generation_job: {
        Args: {
          p_idempotency_key: string
          p_payload_json: Json
          p_replay_completed?: boolean
          p_website_id: string
        }
        Returns: string
      }
      enqueue_site_generation_job_owned: {
        Args: {
          p_idempotency_key: string
          p_owner_token: string
          p_payload_json: Json
          p_replay_completed?: boolean
          p_trace_id: string
          p_website_id: string
        }
        Returns: {
          assistant_message_id: string
          chain_id: string
        }[]
      }
      enqueue_site_generation_job_unchecked: {
        Args: {
          p_idempotency_key: string
          p_payload_json: Json
          p_replay_completed?: boolean
          p_website_id: string
        }
        Returns: string
      }
      ensure_agent_conversation: {
        Args: { p_profile_id: string; p_website_id: string }
        Returns: {
          created_at: string
          id: string
          phase: string
          summary: string | null
          updated_at: string
          user_id: string
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "conversations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_booking_refund_submission: {
        Args: { p_appointment_id: string; p_generation: number }
        Returns: {
          amount_minor: number
          appointment_id: string
          created_at: string
          environment: string
          generation: number
          id: string
          idempotency_key: string
          payment_id: string
          payment_intent_id: string
          profile_id: string
          provider_created: number | null
          provider_updated_at: string | null
          settled_by_external: boolean
          state: string
          stripe_account_id: string
          stripe_refund_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_refunds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_calendar_destination_epoch: {
        Args: {
          p_connection_id: string
          p_environment: string
          p_profile_id: string
          p_selection_id: string
        }
        Returns: {
          calendar_selection_id: string
          connection_id: string
          connection_revision: number
          created_at: string
          environment: string
          google_calendar_id: string
          id: string
          pipedream_account_id: string
          profile_id: string
          retired_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_destination_epochs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ensure_checkout_website: {
        Args: { p_profile_id: string }
        Returns: string
      }
      expire_abandoned_booking_checkout_creations_v3: {
        Args: { p_environment: string; p_limit?: number }
        Returns: number
      }
      expire_checkout_intent: {
        Args: {
          p_checkout_session_id: string
          p_stripe_checkout_session_id: string
        }
        Returns: boolean
      }
      expire_due_booking_holds: { Args: { p_limit?: number }; Returns: number }
      expire_due_booking_holds_v3: {
        Args: { p_environment: string; p_limit?: number }
        Returns: number
      }
      fail_booking_calendar_convergence: {
        Args: {
          p_expected_appointment_version: number
          p_expected_generation: number
          p_failure_code?: string
          p_failure_kind?: string
          p_fencing_token: number
          p_lease_token: string
          p_link_id: string
          p_retryable: boolean
          p_safe_error: string
        }
        Returns: boolean
      }
      fail_booking_notification: {
        Args: {
          p_fencing_token: number
          p_lease_token: string
          p_notification_id: string
          p_retryable: boolean
          p_safe_error: string
        }
        Returns: boolean
      }
      fail_booking_notification_v3: {
        Args: {
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_notification_id: string
          p_retryable: boolean
          p_safe_error: string
        }
        Returns: boolean
      }
      fail_booking_outbox: {
        Args: {
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
          p_retryable: boolean
          p_safe_error: string
        }
        Returns: boolean
      }
      fail_booking_payment_event: {
        Args: {
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_safe_error: string
        }
        Returns: boolean
      }
      fail_booking_payment_event_v3: {
        Args: {
          p_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_retry_delay_seconds?: number
          p_retryable: boolean
          p_safe_error: string
        }
        Returns: boolean
      }
      fail_booking_provider_account_disconnect_v3: {
        Args: {
          p_disconnect_id: string
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_profile_id: string
          p_provider_account_id: string
          p_reason: string
        }
        Returns: boolean
      }
      fail_booking_refund_command_v3: {
        Args: {
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
          p_retry_delay_seconds?: number
          p_retryable: boolean
          p_safe_error: string
        }
        Returns: boolean
      }
      fail_booking_session_expiry_v3: {
        Args: {
          p_fencing_token: number
          p_lease_token: string
          p_payment_id: string
          p_retry_delay_seconds?: number
          p_retryable: boolean
          p_safe_error: string
        }
        Returns: boolean
      }
      fail_pipedream_binding_reconciliation: {
        Args: {
          p_binding_id: string
          p_deployment_definitely_rejected?: boolean
          p_fencing_token: number
          p_lease_token: string
          p_observed_trigger?: Json
          p_safe_error: string
        }
        Returns: boolean
      }
      finalize_booking_attachment_upload_v3: {
        Args: {
          p_request_hash: string
          p_request_id: string
          p_token_hash: string
        }
        Returns: Json
      }
      finalize_paid_checkout:
        | {
            Args: {
              p_checkout_session_id: string
              p_plan: string
              p_price_id: string
              p_provider_customer_id: string
              p_provider_subscription_id: string
              p_stripe_checkout_session_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_checkout_session_id: string
              p_plan: string
              p_price_id: string
              p_provider_customer_id: string
              p_provider_event_id: string
              p_provider_offer_evidence: Json
              p_provider_subscription_id: string
              p_stripe_checkout_session_id: string
            }
            Returns: string
          }
      finish_agent_external_operation: {
        Args: {
          p_operation_key: string
          p_owner_token: string
          p_status: string
          p_trace_id: string
        }
        Returns: boolean
      }
      fork_website_version_with_media: {
        Args: {
          p_expected_revision: number
          p_source_version_id: string
          p_website_id: string
        }
        Returns: {
          config_json: Json
          created_at: string
          generation_job_id: string | null
          id: string
          revision: number
          status: string
          updated_at: string
          variant_key: string
          version_number: number
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "website_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      fork_website_version_with_media_owned: {
        Args: {
          p_expected_revision: number
          p_owner_token: string
          p_source_version_id: string
          p_trace_id: string
          p_website_id: string
        }
        Returns: {
          config_json: Json
          created_at: string
          generation_job_id: string | null
          id: string
          revision: number
          status: string
          updated_at: string
          variant_key: string
          version_number: number
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "website_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_add_video_observability_report: {
        Args: { p_as_of?: string }
        Returns: Json
      }
      get_booking_calendar_repair_context: {
        Args: { p_actor_token_hash: string; p_appointment_id: string }
        Returns: Json
      }
      get_booking_notification_context: {
        Args: { p_notification_id: string }
        Returns: Json
      }
      get_booking_notification_context_v3: {
        Args: {
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_notification_id: string
        }
        Returns: Json
      }
      get_booking_outbox_context: {
        Args: {
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: Json
      }
      get_calendar_action_notice_health: {
        Args: { p_environment: string }
        Returns: Json
      }
      get_calendar_worker_health: {
        Args: { p_environment: string }
        Returns: Json
      }
      get_pending_google_calendar_setup: {
        Args: {
          p_environment: string
          p_expected_revision: number
          p_profile_id: string
        }
        Returns: Json
      }
      get_website_version_media_snapshot: {
        Args: { p_revision: number; p_version_id: string; p_website_id: string }
        Returns: {
          config_json: Json
          media_slots: Json
          revision: number
        }[]
      }
      global_admin_signout_v4: {
        Args: { p_token_hash: string }
        Returns: boolean
      }
      google_calendar_setup_claim: {
        Args: {
          p_connection: Database["public"]["Tables"]["calendar_connections"]["Row"]
        }
        Returns: Json
      }
      google_calendar_setup_configuration_key: {
        Args: {
          p_connection: Database["public"]["Tables"]["calendar_connections"]["Row"]
        }
        Returns: string
      }
      grant_verified_website_entitlement: {
        Args: {
          p_auth_user_id: string
          p_checkout_session_id: string
          p_website_id: string
        }
        Returns: {
          booking_admission: boolean
          checkout_session_id: string | null
          created_at: string
          effective_at: string | null
          ends_at: string | null
          environment: string
          id: string
          order_confirmed_at: string | null
          plan: string
          profile_id: string
          purchased_at: string
          quote_admission: boolean
          state: string
          subscription_id: string | null
          updated_at: string
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "website_entitlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      has_fresh_epoch2_generation_runner: { Args: never; Returns: boolean }
      heartbeat_background_job_runner_capability: {
        Args: {
          p_browser_ready: boolean
          p_capability: number
          p_runner_id: string
        }
        Returns: string
      }
      ingest_booking_notification_delivery: {
        Args: {
          p_event_type: string
          p_occurred_at: string
          p_provider_event_id: string
          p_provider_message_id: string
        }
        Returns: boolean
      }
      ingest_pipedream_calendar_event: {
        Args: {
          p_account_id: string
          p_binding_id: string
          p_correlation_id: string
          p_environment: string
          p_event_id: string
          p_event_type: string
          p_payload: Json
          p_payload_hash: string
          p_signature_timestamp: string
          p_trigger_id: string
        }
        Returns: string
      }
      ingest_provider_event: {
        Args: {
          p_account_context: string
          p_api_version: string
          p_destination: string
          p_environment: string
          p_event_family: string
          p_event_id: string
          p_event_type: string
          p_livemode: boolean
          p_payload: Json
          p_payload_hash: string
          p_profile_id: string
          p_provider: string
          p_signature_timestamp?: string
        }
        Returns: string
      }
      insert_agent_message_owned: {
        Args: {
          p_attachments?: Json
          p_content: string
          p_conversation_id: string
          p_owner_token: string
          p_role: string
          p_tool_calls?: Json
          p_trace_id: string
        }
        Returns: string
      }
      insert_generated_website_version_with_slots: {
        Args: {
          p_claim_epoch: number
          p_config_json: Json
          p_job_id: string
          p_media_slot_ids: string[]
          p_website_id: string
        }
        Returns: {
          id: string
          variant_key: string
          version_number: number
        }[]
      }
      install_saas_offer_contract: {
        Args: {
          p_environment: string
          p_plan: string
          p_price_id: string
          p_product_id: string
          p_unit_amount_minor: number
          p_verified_at: string
        }
        Returns: string
      }
      interrupt_add_video_job_epoch: {
        Args: {
          p_cause_code: string
          p_claim_epoch: number
          p_job_attempts: number
          p_job_id: string
          p_retry_at: string
          p_runner_id: string
        }
        Returns: boolean
      }
      interrupt_site_generation_epoch: {
        Args: {
          p_cause_code: string
          p_claim_epoch: number
          p_contract_epoch: number
          p_deployment_id?: string
          p_details?: Json
          p_effect_certainty: string
          p_event_key: string
          p_invocation_id?: string
          p_job_id: string
          p_retry_at: string
          p_runner_id?: string
          p_status_message: string
        }
        Returns: boolean
      }
      invalidate_admin_provider_sessions_v4: {
        Args: { p_reason: string; p_user_id: string }
        Returns: boolean
      }
      is_profile_owner: { Args: { p_profile_id: string }; Returns: boolean }
      issue_booking_confirmation_capability: {
        Args: {
          p_checkout_session_id: string
          p_nonce_hash: string
          p_token_hash: string
        }
        Returns: string
      }
      issue_booking_confirmation_capability_v3: {
        Args: {
          p_checkout_session_id: string
          p_nonce_hash: string
          p_token_hash: string
        }
        Returns: string
      }
      list_add_video_orphan_candidates: {
        Args: { p_eligible_before: string }
        Returns: {
          content_hash: string
          oldest_at: string
          storage_path: string
        }[]
      }
      list_ambiguous_booking_checkouts: {
        Args: { p_environment: string; p_limit?: number }
        Returns: {
          appointment_id: string
          checkout_idempotency_key: string
          checkout_provider_expires_at: string
          environment: string
          payment_id: string
          stripe_account_id: string
        }[]
      }
      list_booking_calendar_reconciliation: {
        Args: { p_limit?: number }
        Returns: {
          appointment_state: string
          epoch: Json
          link: Json
        }[]
      }
      list_clean_contractor_booking_attachments: {
        Args: { p_actor_auth_user_id: string; p_appointment_ids: string[] }
        Returns: {
          appointment_id: string
          byte_size: number
          display_filename: string
          finalized_at: string
          id: string
          mime_type: string
        }[]
      }
      list_clean_contractor_booking_attachments_v3: {
        Args: { p_actor_auth_user_id: string; p_appointment_ids: string[] }
        Returns: {
          appointment_id: string
          byte_size: number
          display_filename: string
          finalized_at: string
          generation: number
          id: string
          mime_type: string
        }[]
      }
      list_cross_website_layout_fingerprints: {
        Args: { p_limit?: number; p_website_id: string }
        Returns: {
          id: string
          layout_fingerprint: string
          version_number: number
        }[]
      }
      list_due_booking_attachment_scans: {
        Args: { p_limit?: number }
        Returns: {
          appointment_id: string
          byte_size: number
          checksum: string
          cleanup_fencing_token: number
          cleanup_lease_expires_at: string | null
          cleanup_lease_token: string | null
          cleanup_reason: string | null
          created_at: string
          current_object_generation: number
          customer_id: string
          deleted_at: string | null
          display_filename: string
          environment: string
          finalized_at: string | null
          height: number | null
          id: string
          legal_hold_at: string | null
          legal_hold_epoch: number
          legal_hold_reason: string | null
          mime_type: string
          original_filename: string
          profile_id: string
          quota_slot: number
          scan_attempts: number
          scan_config_fingerprint: string | null
          scan_error: string | null
          scan_fencing_token: number
          scan_lease_expires_at: string | null
          scan_lease_token: string | null
          scan_proven_at: string | null
          scanned_checksum: string | null
          scanner_verdict_id: string | null
          state_version: number
          storage_object_key: string
          upload_state: string
          website_id: string
          width: number | null
        }[]
        SetofOptions: {
          from: "*"
          to: "booking_attachments"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      lock_booking_calendar_claim: {
        Args: {
          p_expected_appointment_version: number
          p_expected_generation: number
          p_fencing_token: number
          p_lease_token: string
          p_link_id: string
        }
        Returns: {
          ambiguity_started_at: string | null
          appointment_id: string
          calendar_selection_id: string
          connection_id: string
          created_at: string
          desired_appointment_version: number
          desired_generation: number
          desired_state: string
          destination_epoch_id: string | null
          drift_scan_count: number
          environment: string
          etag: string | null
          failure_code: string | null
          failure_kind: string | null
          failure_observed_at: string | null
          google_event_id: string
          ical_uid: string | null
          id: string
          last_attempt_at: string | null
          last_observation_sha256: string | null
          last_observed_at: string | null
          manual_repair_at: string | null
          manual_repair_reason: string | null
          observed_state: string
          profile_id: string
          reconcile_attempts: number
          reconcile_fencing_token: number
          reconcile_lease_expires_at: string | null
          reconcile_lease_token: string | null
          reconcile_next_attempt_at: string
          reconcile_status: string
          safe_error: string | null
          snapshot_appointment_version: number | null
          snapshot_connection_revision: number | null
          snapshot_desired_generation: number | null
          stability_scan_until: string | null
          sync_state: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "calendar_event_links"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_google_calendar_binding: {
        Args: {
          p_allow_cleanup?: boolean
          p_binding_id: string
          p_fencing_token: number
          p_lease_token: string
          p_require_repair?: boolean
        }
        Returns: {
          component_key: string
          component_version: string
          configuration_revision: number
          connection_id: string
          created_at: string
          deployed_trigger_id: string | null
          deployment_candidate_trigger_id: string | null
          deployment_dispatch_fencing_token: number | null
          deployment_dispatch_lease_token: string | null
          deployment_dispatched_at: string | null
          deployment_expected_connection_revision: number | null
          deployment_lease_expires_at: string | null
          deployment_operation_id: string | null
          deployment_receipt: Json | null
          environment: string
          id: string
          last_event_at: string | null
          last_health_at: string | null
          observed_component_key: string | null
          observed_component_version: string | null
          pending_trigger_deletions: string[]
          pipedream_account_id: string
          profile_id: string
          provider_updated_at: string | null
          reconciliation_allow_repair: boolean
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_reason: string | null
          retired_deployment: Json | null
          retired_trigger_ids: string[]
          safe_error: string | null
          selected_calendar_ids: Json
          signing_secret_name: string | null
          trigger_state: string
          updated_at: string
          webhook_correlation_id: string
          webhook_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "pipedream_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      lock_google_calendar_disconnect: {
        Args: {
          p_disconnect_id: string
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_profile_id: string
          p_provider_account_id: string
        }
        Returns: {
          actor_auth_user_id: string
          attempts: number
          completed_at: string | null
          connection_id: string | null
          dispatch_state: string
          dispatched_at: string | null
          environment: string
          failure_reason: string | null
          fencing_token: number
          id: string
          lease_expires_at: string | null
          lease_token: string | null
          profile_id: string
          provider: string
          provider_account_id: string
          requested_at: string
          requested_connection_revision: number | null
          retry_at: string | null
          state: string
          unresolved_setup_calendar_id: string | null
          unresolved_setup_operation_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "booking_provider_account_disconnects_v3"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      maintain_background_job_lifecycle: {
        Args: {
          p_limit?: number
          p_scheduler_run_id: string
          p_stale_before: string
        }
        Returns: {
          reconciliation_count: number
          requeued_count: number
          terminalized_count: number
        }[]
      }
      mark_booking_attachment_uploaded: {
        Args: {
          p_attachment_id: string
          p_byte_size: number
          p_checksum: string
          p_environment: string
          p_profile_id: string
          p_storage_object_key: string
        }
        Returns: {
          appointment_id: string
          byte_size: number
          checksum: string
          cleanup_fencing_token: number
          cleanup_lease_expires_at: string | null
          cleanup_lease_token: string | null
          cleanup_reason: string | null
          created_at: string
          current_object_generation: number
          customer_id: string
          deleted_at: string | null
          display_filename: string
          environment: string
          finalized_at: string | null
          height: number | null
          id: string
          legal_hold_at: string | null
          legal_hold_epoch: number
          legal_hold_reason: string | null
          mime_type: string
          original_filename: string
          profile_id: string
          quota_slot: number
          scan_attempts: number
          scan_config_fingerprint: string | null
          scan_error: string | null
          scan_fencing_token: number
          scan_lease_expires_at: string | null
          scan_lease_token: string | null
          scan_proven_at: string | null
          scanned_checksum: string | null
          scanner_verdict_id: string | null
          state_version: number
          storage_object_key: string
          upload_state: string
          website_id: string
          width: number | null
        }
        SetofOptions: {
          from: "*"
          to: "booking_attachments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_google_calendar_connection_unhealthy: {
        Args: {
          p_binding_id: string
          p_disconnected: boolean
          p_fencing_token: number
          p_lease_token: string
          p_reason: string
        }
        Returns: boolean
      }
      mark_google_calendar_connection_verified: {
        Args: {
          p_binding_id: string
          p_calendars: Json
          p_fencing_token: number
          p_lease_token: string
          p_verified_at: string
        }
        Returns: boolean
      }
      mark_saas_checkout_fulfillment_delivery_unknown: {
        Args: {
          p_fencing_token: number
          p_id: string
          p_lease_token: string
          p_safe_error: string
        }
        Returns: boolean
      }
      mint_fixed_admin_session_v1: {
        Args: { p_email: string; p_token_hash: string }
        Returns: string
      }
      offboard_starter_leads: {
        Args: {
          p_actor_user_id: string
          p_profile_id: string
          p_reason: string
        }
        Returns: number
      }
      parse_background_job_retry_at: {
        Args: { p_value: string }
        Returns: string
      }
      persist_google_calendar_configuration: {
        Args: {
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_profile_id: string
          p_setup_operation_id: string
        }
        Returns: {
          account_display_name: string | null
          account_email: string | null
          action_notice: Json
          action_notice_due_at: string | null
          action_notice_fencing_token: number
          action_notice_lease_expires_at: string | null
          action_notice_lease_token: string | null
          app_slug: string
          availability_generation: number
          calendar_create_blocked_at: string | null
          calendar_create_verified_at: string | null
          calendar_delete_blocked_at: string | null
          calendar_delete_verified_at: string | null
          calendar_probe_insert_blocked_at: string | null
          calendar_probe_insert_verified_at: string | null
          calendar_write_blocked_at: string | null
          calendar_write_verified_at: string | null
          connect_actor_auth_user_id: string | null
          connect_completed_at: string | null
          connect_expected_revision: number | null
          connect_expected_setup_key: string | null
          connect_expires_at: string | null
          connect_operation_id: string | null
          connect_started_at: string | null
          connection_revision: number
          created_at: string
          disconnected_at: string | null
          environment: string
          external_user_id: string
          health_state: string
          id: string
          identity_metadata: Json
          last_synchronized_at: string | null
          last_verified_at: string | null
          owner_verification_requested_at: string | null
          pipedream_account_id: string | null
          profile_id: string
          reconnect_reason: string | null
          setup_account_display_name: string | null
          setup_account_email: string | null
          setup_account_id: string | null
          setup_actor_auth_user_id: string | null
          setup_attempts: number
          setup_calendar_id: string | null
          setup_calendars: Json | null
          setup_completed_at: string | null
          setup_connect_operation_id: string | null
          setup_expected_revision: number | null
          setup_failure_reason: string | null
          setup_fencing_token: number
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_id: string | null
          setup_probe_account_id: string | null
          setup_probe_calendar_id: string | null
          setup_probe_delete_started_at: string | null
          setup_probe_id: string | null
          setup_probe_started_at: string | null
          setup_probe_state: string
          setup_probe_write_verified_at: string | null
          setup_purpose: string
          setup_read_verified_at: string | null
          setup_retry_at: string | null
          setup_write_verified_at: string | null
          updated_at: string
          verification_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      plan_generation_media_slot: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_kind: string
          p_poster_slot_id?: string
          p_proof_eligible: boolean
          p_provenance: string
          p_required: boolean
          p_role: string
          p_slot_id: string
          p_source_slot_id?: string
          p_website_id: string
        }
        Returns: string
      }
      plan_generation_media_slot_legacy_attempt: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_kind: string
          p_poster_slot_id?: string
          p_proof_eligible: boolean
          p_provenance: string
          p_required: boolean
          p_role: string
          p_slot_id: string
          p_source_slot_id?: string
          p_website_id: string
        }
        Returns: string
      }
      plan_generation_media_slots_epoch: {
        Args: {
          p_claim_epoch: number
          p_job_id: string
          p_runner_id?: string
          p_slots: Json
          p_website_id: string
        }
        Returns: string[]
      }
      prepare_booking_attachment_uploads_v3: {
        Args: {
          p_appointment_id: string
          p_context_id: string
          p_context_token_hash: string
          p_manifest: Json
          p_request_hash: string
        }
        Returns: Json
      }
      prepare_booking_checkout_handoff_v3: {
        Args: {
          p_fencing_token: number
          p_handoff_expires_at: string
          p_lease_token: string
          p_nonce_hash: string
          p_payment_id: string
          p_provider_expires_at: string
        }
        Returns: Json
      }
      prepare_booking_convergence_cutover: {
        Args: { p_environment: string; p_profile_id: string }
        Returns: {
          created_at: string
          environment: string
          id: string
          inventory: Json
          inventory_sha256: string
          profile_id: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_convergence_cutover_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      prepare_booking_refund_snapshot_v3: {
        Args: {
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
          p_provider_snapshot: Json
        }
        Returns: Json
      }
      project_booking_notifications_v3: {
        Args: { p_appointment_id: string }
        Returns: number
      }
      project_saas_subscription_status: {
        Args: {
          p_cancel_at_period_end: boolean
          p_current_period_end: string
          p_environment: string
          p_price_id: string
          p_product_id: string
          p_provider_event_at: string
          p_provider_event_id: string
          p_provider_subscription_id: string
          p_quantity: number
          p_status: string
        }
        Returns: boolean
      }
      provision_admin_principal_v4: {
        Args: { p_actor_token_hash: string; p_target_user_id: string }
        Returns: boolean
      }
      publish_website_version_atomic: {
        Args: {
          p_expected_config_json: Json
          p_expected_media_slots: Json
          p_expected_revision: number
          p_validation_attestation: Json
          p_version_id: string
          p_website_id: string
        }
        Returns: number
      }
      publish_website_version_owned: {
        Args: {
          p_expected_config_json: Json
          p_expected_media_slots: Json
          p_expected_revision: number
          p_owner_token: string
          p_trace_id: string
          p_validation_attestation: Json
          p_version_id: string
          p_website_id: string
        }
        Returns: number
      }
      purge_retained_leads: {
        Args: {
          p_actor_user_id: string
          p_profile_id: string
          p_reason: string
        }
        Returns: number
      }
      queue_booking_late_payment_refund: {
        Args: { p_arbitration_id: string; p_reason: string }
        Returns: boolean
      }
      reapply_deferred_unbound_subscription: {
        Args: { p_environment: string; p_provider_subscription_id: string }
        Returns: number
      }
      reconcile_booking_notification_projection_v3: {
        Args: { p_environment: string; p_limit?: number }
        Returns: number
      }
      reconcile_due_add_video_media: {
        Args: { p_actor?: string; p_limit?: number }
        Returns: number
      }
      reconcile_due_generation_media: {
        Args: { p_actor?: string; p_limit?: number }
        Returns: {
          processed_count: number
          requeued_count: number
          terminalized_count: number
        }[]
      }
      reconcile_generation_media_slot_epoch: {
        Args: {
          p_action: string
          p_action_key: string
          p_actor: string
          p_evidence: Json
          p_job_id: string
          p_reason: string
          p_reservation_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: string
      }
      reconcile_google_calendar_connection: {
        Args: {
          p_actor_auth_user_id: string
          p_environment: string
          p_expected_revision: number
          p_health_state: string
          p_profile_id: string
          p_reason: string
          p_verified_at: string
        }
        Returns: {
          account_display_name: string | null
          account_email: string | null
          action_notice: Json
          action_notice_due_at: string | null
          action_notice_fencing_token: number
          action_notice_lease_expires_at: string | null
          action_notice_lease_token: string | null
          app_slug: string
          availability_generation: number
          calendar_create_blocked_at: string | null
          calendar_create_verified_at: string | null
          calendar_delete_blocked_at: string | null
          calendar_delete_verified_at: string | null
          calendar_probe_insert_blocked_at: string | null
          calendar_probe_insert_verified_at: string | null
          calendar_write_blocked_at: string | null
          calendar_write_verified_at: string | null
          connect_actor_auth_user_id: string | null
          connect_completed_at: string | null
          connect_expected_revision: number | null
          connect_expected_setup_key: string | null
          connect_expires_at: string | null
          connect_operation_id: string | null
          connect_started_at: string | null
          connection_revision: number
          created_at: string
          disconnected_at: string | null
          environment: string
          external_user_id: string
          health_state: string
          id: string
          identity_metadata: Json
          last_synchronized_at: string | null
          last_verified_at: string | null
          owner_verification_requested_at: string | null
          pipedream_account_id: string | null
          profile_id: string
          reconnect_reason: string | null
          setup_account_display_name: string | null
          setup_account_email: string | null
          setup_account_id: string | null
          setup_actor_auth_user_id: string | null
          setup_attempts: number
          setup_calendar_id: string | null
          setup_calendars: Json | null
          setup_completed_at: string | null
          setup_connect_operation_id: string | null
          setup_expected_revision: number | null
          setup_failure_reason: string | null
          setup_fencing_token: number
          setup_lease_expires_at: string | null
          setup_lease_token: string | null
          setup_operation_id: string | null
          setup_probe_account_id: string | null
          setup_probe_calendar_id: string | null
          setup_probe_delete_started_at: string | null
          setup_probe_id: string | null
          setup_probe_started_at: string | null
          setup_probe_state: string
          setup_probe_write_verified_at: string | null
          setup_purpose: string
          setup_read_verified_at: string | null
          setup_retry_at: string | null
          setup_write_verified_at: string | null
          updated_at: string
          verification_reason: string | null
        }
        SetofOptions: {
          from: "*"
          to: "calendar_connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      record_add_video_media_operation: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_provider_operation_id: string
          p_reservation_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: boolean
      }
      record_add_video_media_operation_epoch: {
        Args: {
          p_claim_epoch: number
          p_job_attempts: number
          p_job_id: string
          p_provider_operation_id: string
          p_reservation_id: string
          p_runner_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: boolean
      }
      record_add_video_observability_event: {
        Args: {
          p_details?: Json
          p_event_type: string
          p_job_id?: string
          p_request_id?: string
          p_source_version_id?: string
          p_target_version_id?: string
          p_website_id?: string
        }
        Returns: string
      }
      record_agent_journal_checkpoint_owned: {
        Args: {
          p_conversation_id: string
          p_message_count: number
          p_owner_token: string
          p_section_body: string
          p_section_title: string
          p_trace_id: string
          p_website_id: string
        }
        Returns: undefined
      }
      record_booking_attachment_scanner_proof: {
        Args: {
          p_clean_checksum: string
          p_clean_verdict_id: string
          p_clean_was_clean: boolean
          p_config_fingerprint: string
          p_eicar_checksum: string
          p_eicar_verdict_id: string
          p_eicar_was_rejected: boolean
          p_environment: string
          p_provider: string
        }
        Returns: boolean
      }
      record_booking_attachment_scanner_proof_v3: {
        Args: {
          p_clean_checksum: string
          p_clean_verdict_id: string
          p_clean_was_clean: boolean
          p_config_fingerprint: string
          p_eicar_checksum: string
          p_eicar_verdict_id: string
          p_eicar_was_rejected: boolean
          p_environment: string
          p_provider: string
        }
        Returns: boolean
      }
      record_booking_calendar_effect_result: {
        Args: {
          p_effect_id: string
          p_evidence?: Json
          p_fencing_token: number
          p_lease_token: string
          p_outcome: string
          p_provider_status: number
        }
        Returns: boolean
      }
      record_booking_calendar_observation: {
        Args: {
          p_evidence?: Json
          p_expected_appointment_version: number
          p_expected_generation: number
          p_fencing_token: number
          p_lease_token: string
          p_link_id: string
          p_observed_at: string
          p_observed_state: string
          p_phase: string
        }
        Returns: Json
      }
      record_booking_calendar_setup_denial: {
        Args: {
          p_action: string
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_observed_at: string
          p_operation_id: string
          p_profile_id: string
        }
        Returns: boolean
      }
      record_booking_calendar_write_denial: {
        Args: {
          p_effect: Database["public"]["Tables"]["booking_calendar_effect_attempts"]["Row"]
        }
        Returns: undefined
      }
      record_booking_late_payment_observation: {
        Args: {
          p_arbitration_id: string
          p_busy_ranges: Json
          p_fencing_token: number
          p_lease_token: string
          p_observation_state: string
          p_observed_at: string
          p_safe_error?: string
          p_snapshot_generation: number
        }
        Returns: string
      }
      record_booking_refund_provider_result: {
        Args: {
          p_absolute_refunded: number
          p_appointment_id: string
          p_generation: number
          p_provider_created: number
          p_refund_id: string
          p_state: string
        }
        Returns: boolean
      }
      record_created_booking_checkout: {
        Args: {
          p_expires_at: string
          p_payment_id: string
          p_session_id: string
        }
        Returns: boolean
      }
      record_generation_media_operation: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_provider_operation_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: boolean
      }
      record_generation_media_operation_epoch: {
        Args: {
          p_claim_epoch: number
          p_effect_certainty: string
          p_job_id: string
          p_provider_operation_id: string
          p_reservation_id: string
          p_runner_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: boolean
      }
      record_generation_media_operation_legacy_attempt: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_provider_operation_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: boolean
      }
      record_generation_media_slot: {
        Args: {
          p_audio_codec?: string
          p_byte_size?: number
          p_content_hash?: string
          p_duration_ms?: number
          p_has_audio?: boolean
          p_height?: number
          p_job_attempts: number
          p_job_id: string
          p_kind: string
          p_mime_type: string
          p_poster_slot_id?: string
          p_proof_eligible: boolean
          p_provenance: string
          p_required: boolean
          p_role: string
          p_slot_id: string
          p_source_slot_id?: string
          p_storage_path: string
          p_validator_version?: string
          p_video_codec?: string
          p_video_profile?: string
          p_website_id: string
          p_width?: number
        }
        Returns: string
      }
      record_generation_media_slot_epoch: {
        Args: {
          p_audio_codec?: string
          p_byte_size?: number
          p_claim_epoch: number
          p_content_hash?: string
          p_duration_ms?: number
          p_effect_certainty?: string
          p_has_audio?: boolean
          p_height?: number
          p_job_id: string
          p_kind: string
          p_mime_type: string
          p_poster_slot_id?: string
          p_proof_eligible: boolean
          p_provenance: string
          p_required: boolean
          p_reservation_id: string
          p_role: string
          p_runner_id?: string
          p_slot_claim_epoch: number
          p_slot_id: string
          p_source_slot_id?: string
          p_storage_path: string
          p_validator_version?: string
          p_video_codec?: string
          p_video_profile?: string
          p_website_id: string
          p_width?: number
        }
        Returns: string
      }
      record_generation_media_slot_legacy_attempt: {
        Args: {
          p_audio_codec?: string
          p_byte_size?: number
          p_content_hash?: string
          p_duration_ms?: number
          p_has_audio?: boolean
          p_height?: number
          p_job_attempts: number
          p_job_id: string
          p_kind: string
          p_mime_type: string
          p_poster_slot_id?: string
          p_proof_eligible: boolean
          p_provenance: string
          p_required: boolean
          p_role: string
          p_slot_id: string
          p_source_slot_id?: string
          p_storage_path: string
          p_validator_version?: string
          p_video_codec?: string
          p_video_profile?: string
          p_website_id: string
          p_width?: number
        }
        Returns: string
      }
      record_google_calendar_setup_read: {
        Args: {
          p_calendars: Json
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_operation_id: string
          p_profile_id: string
          p_verified_at: string
        }
        Returns: boolean
      }
      record_lead_governance_event: {
        Args: {
          p_action: string
          p_actor_user_id: string
          p_lead_id: string
          p_profile_id: string
          p_reason: string
        }
        Returns: number
      }
      record_pipedream_trigger_deployment_result: {
        Args: {
          p_binding_id: string
          p_definitely_rejected?: boolean
          p_deployed_trigger_id: string
          p_deployment_operation_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: boolean
      }
      record_ready_add_video_media: {
        Args: {
          p_audio_codec: string
          p_byte_size: number
          p_content_hash: string
          p_duration_ms: number
          p_has_audio: boolean
          p_height: number
          p_job_attempts: number
          p_job_id: string
          p_provider_operation_id: string
          p_reservation_id: string
          p_slot_id: string
          p_source_slot_id: string
          p_storage_path: string
          p_validator_version: string
          p_video_codec: string
          p_video_profile: string
          p_website_id: string
          p_width: number
        }
        Returns: string
      }
      record_ready_add_video_media_epoch: {
        Args: {
          p_audio_codec: string
          p_byte_size: number
          p_claim_epoch: number
          p_content_hash: string
          p_duration_ms: number
          p_has_audio: boolean
          p_height: number
          p_job_attempts: number
          p_job_id: string
          p_provider_operation_id: string
          p_reservation_id: string
          p_runner_id: string
          p_slot_id: string
          p_source_slot_id: string
          p_storage_path: string
          p_validator_version: string
          p_video_codec: string
          p_video_profile: string
          p_website_id: string
          p_width: number
        }
        Returns: string
      }
      recover_booking_checkout_handoff_v3: {
        Args: { p_appointment_id: string; p_nonce_hash: string }
        Returns: Json
      }
      recover_stale_add_video_jobs: {
        Args: { p_scheduler_run_id: string; p_stale_before: string }
        Returns: {
          failed_count: number
          reconciliation_count: number
          requeued_count: number
        }[]
      }
      recover_stale_background_jobs: {
        Args: { p_scheduler_run_id: string; p_stale_before: string }
        Returns: {
          failed_count: number
          reconciliation_count: number
          requeued_count: number
        }[]
      }
      redrive_saas_checkout_fulfillment: {
        Args: { p_id: string }
        Returns: boolean
      }
      reduce_booking_financial_evidence_v3: {
        Args: {
          p_authority_id: string
          p_authority_kind: string
          p_fencing_token: number
          p_lease_token: string
          p_provider_snapshot?: Json
        }
        Returns: Json
      }
      reduce_booking_notification_delivery_v3: {
        Args: { p_notification_id: string }
        Returns: boolean
      }
      register_calendar_worker_schedules: {
        Args: { p_environment: string }
        Returns: {
          active: boolean
          job_id: number
          schedule_name: string
        }[]
      }
      release_stripe_connect_reconciliation_claim: {
        Args: {
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_profile_id: string
          p_succeeded?: boolean
        }
        Returns: boolean
      }
      renew_agent_turn: {
        Args: {
          p_lease_seconds?: number
          p_owner_token: string
          p_trace_id: string
        }
        Returns: boolean
      }
      renew_booking_calendar_reconciliation_v3: {
        Args: {
          p_expected_appointment_version: number
          p_expected_generation: number
          p_fencing_token: number
          p_lease_seconds?: number
          p_lease_token: string
          p_link_id: string
        }
        Returns: boolean
      }
      renew_booking_late_payment_arbitration_v3: {
        Args: {
          p_arbitration_id: string
          p_fencing_token: number
          p_lease_seconds?: number
          p_lease_token: string
          p_snapshot_generation: number
        }
        Returns: boolean
      }
      renew_booking_payment_event_v3: {
        Args: {
          p_event_id: string
          p_fencing_token: number
          p_lease_seconds?: number
          p_lease_token: string
        }
        Returns: boolean
      }
      renew_booking_refund_command_v3: {
        Args: {
          p_command_id: string
          p_fencing_token: number
          p_lease_seconds?: number
          p_lease_token: string
        }
        Returns: boolean
      }
      renew_booking_session_expiry_v3: {
        Args: {
          p_fencing_token: number
          p_lease_seconds?: number
          p_lease_token: string
          p_payment_id: string
        }
        Returns: boolean
      }
      renew_booking_worker_family_v3: {
        Args: {
          p_environment: string
          p_family: string
          p_fencing_token: number
          p_lease_seconds?: number
          p_lease_token: string
        }
        Returns: boolean
      }
      renew_saas_checkout_fulfillment: {
        Args: { p_fencing_token: number; p_id: string; p_lease_token: string }
        Returns: boolean
      }
      renew_site_generation_lease: {
        Args: {
          p_claim_epoch: number
          p_job_id: string
          p_lease_seconds?: number
          p_runner_id: string
        }
        Returns: boolean
      }
      request_google_calendar_verification: {
        Args: {
          p_actor_auth_user_id: string
          p_environment: string
          p_profile_id: string
        }
        Returns: boolean
      }
      requeue_booking_calendar_manual_repair: {
        Args: {
          p_actor_token_hash: string
          p_expected_generation: number
          p_link_id: string
          p_reason: string
          p_resolution?: Json
        }
        Returns: boolean
      }
      require_epoch2_generation_media_owner: {
        Args: {
          p_claim_epoch: number
          p_job_id: string
          p_runner_id?: string
          p_website_id: string
        }
        Returns: {
          agent_trace_id: string | null
          attempts: number
          cancellation_actor: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          chain_id: string
          claim_epoch: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          failure_attempts: number
          finalization_attempts: number
          generation_accepted_at: string | null
          generation_checkpoint: Json | null
          generation_contract_epoch: number
          generation_contract_version: number | null
          generation_handoff_message_id: string | null
          generation_input_hash: string | null
          generation_input_snapshot: Json | null
          generation_input_version: number | null
          generation_kind: string | null
          generation_last_dispatched_at: string | null
          generation_last_scheduler_run_id: string | null
          generation_request_hash: string | null
          generation_request_id: string | null
          generation_result_version_id: string | null
          generation_stage: string | null
          generation_tenant_id: string | null
          generation_terminal_message_at: string | null
          generation_terminal_message_id: string | null
          generation_terminal_message_payload: Json | null
          id: string
          idempotency_key: string | null
          interruption_count: number
          job_type: string
          lease_expires_at: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          next_retry_at: string | null
          payload_json: Json
          platform: string | null
          progress_pct: number
          repair_attempts: number
          request_id: string | null
          research_row_id: string | null
          result_json: Json | null
          scheduler_dispatch_sequence: number | null
          scheduler_last_dispatched_at: string | null
          scheduler_last_run_id: string | null
          sequence_index: number
          source_revision: number | null
          source_version_id: string | null
          stage_attempt_counts: Json
          stage_attempts: number
          started_at: string | null
          status: string
          status_message: string | null
          superseded_at: string | null
          superseded_by_job_id: string | null
          supersedes_job_id: string | null
          supersession_actor: string | null
          supersession_link_state: string
          supersession_reason: string | null
          target_version_id: string | null
          website_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "background_jobs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_add_video_media_create: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_provider: string
          p_request_hash: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: Json
      }
      reserve_add_video_media_create_epoch: {
        Args: {
          p_claim_epoch: number
          p_job_attempts: number
          p_job_id: string
          p_provider: string
          p_request_hash: string
          p_runner_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: Json
      }
      reserve_booking_hold: {
        Args: {
          p_client_request_id: string
          p_customer_id: string
          p_environment: string
          p_local_date: string
          p_local_start: string
          p_profile_id: string
          p_request_hash: string
          p_service_id: string
          p_start_at: string
          p_time_zone: string
          p_website_id: string
        }
        Returns: Json
      }
      reserve_booking_provider_account_disconnect_v3: {
        Args: {
          p_actor_auth_user_id: string
          p_environment: string
          p_expected_connection_revision: number
          p_profile_id: string
          p_provider_account_id: string
        }
        Returns: string
      }
      reserve_checkout_intent:
        | {
            Args: {
              p_business_name: string
              p_city: string
              p_email: string
              p_environment: string
              p_full_name: string
              p_legal_acceptance_ip_hash: string
              p_legal_acceptance_user_agent: string
              p_legal_accepted_at: string
              p_legal_document_versions: Json
              p_license_number: string
              p_plan: string
              p_profile_id: string
              p_status: string
              p_website_id: string
            }
            Returns: {
              checkout_email: string
              checkout_plan: string
              checkout_session_id: string
              checkout_status: string
              disposition: string
              replaced_stripe_checkout_session_id: string
              subscription_id: string
            }[]
          }
        | {
            Args: {
              p_business_name: string
              p_city: string
              p_email: string
              p_environment: string
              p_full_name: string
              p_legal_acceptance_ip_hash: string
              p_legal_acceptance_user_agent: string
              p_legal_accepted_at: string
              p_legal_document_versions: Json
              p_license_number: string
              p_plan: string
              p_profile_id: string
              p_provider_offer_snapshot: Json
              p_status: string
              p_website_id: string
            }
            Returns: {
              checkout_email: string
              checkout_plan: string
              checkout_session_id: string
              checkout_status: string
              disposition: string
              subscription_id: string
            }[]
          }
      reserve_generation_media_create: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: number
      }
      reserve_generation_media_create_epoch: {
        Args: {
          p_claim_epoch: number
          p_job_id: string
          p_provider: string
          p_request_hash: string
          p_runner_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: Json
      }
      reserve_generation_media_create_legacy_attempt: {
        Args: {
          p_job_attempts: number
          p_job_id: string
          p_slot_id: string
          p_website_id: string
        }
        Returns: number
      }
      reserve_google_calendar_setup_probe: {
        Args: {
          p_account_display_name?: string
          p_account_email?: string
          p_account_id: string
          p_actor_auth_user_id: string
          p_calendar_id: string
          p_calendars: Json
          p_connect_operation_id?: string
          p_environment: string
          p_expected_revision: number
          p_expected_setup_key?: string
          p_lease_token: string
          p_profile_id: string
          p_read_verified_at: string
        }
        Returns: Json
      }
      reserve_live_booking: {
        Args: {
          p_availability_generation: number
          p_calendar_set_hash: string
          p_client_request_id: string
          p_consent_digest: string
          p_consent_document_id: string
          p_consent_version: string
          p_customer: Json
          p_environment: string
          p_freebusy_observed_at: string
          p_local_date: string
          p_local_start: string
          p_rate_limit_key: string
          p_request_capability_hash: string
          p_request_hash: string
          p_start_at: string
          p_time_zone: string
          p_website_id: string
        }
        Returns: Json
      }
      reserve_live_booking_before_calendar_lifetime: {
        Args: {
          p_availability_generation: number
          p_calendar_set_hash: string
          p_client_request_id: string
          p_consent_digest: string
          p_consent_document_id: string
          p_consent_version: string
          p_customer: Json
          p_environment: string
          p_freebusy_observed_at: string
          p_local_date: string
          p_local_start: string
          p_rate_limit_key: string
          p_request_capability_hash: string
          p_request_hash: string
          p_start_at: string
          p_time_zone: string
          p_website_id: string
        }
        Returns: Json
      }
      reserve_otp_send: {
        Args: {
          p_email: string
          p_max_sends: number
          p_purpose: string
          p_window_seconds: number
        }
        Returns: undefined
      }
      reserve_pipedream_trigger_deployment: {
        Args: {
          p_binding_id: string
          p_component_version: string
          p_connection_id: string
          p_environment: string
          p_expected_connection_revision: number
          p_fencing_token: number
          p_lease_token: string
          p_pipedream_account_id: string
          p_profile_id: string
        }
        Returns: {
          component_key: string
          component_version: string
          configuration_revision: number
          connection_id: string
          created_at: string
          deployed_trigger_id: string | null
          deployment_candidate_trigger_id: string | null
          deployment_dispatch_fencing_token: number | null
          deployment_dispatch_lease_token: string | null
          deployment_dispatched_at: string | null
          deployment_expected_connection_revision: number | null
          deployment_lease_expires_at: string | null
          deployment_operation_id: string | null
          deployment_receipt: Json | null
          environment: string
          id: string
          last_event_at: string | null
          last_health_at: string | null
          observed_component_key: string | null
          observed_component_version: string | null
          pending_trigger_deletions: string[]
          pipedream_account_id: string
          profile_id: string
          provider_updated_at: string | null
          reconciliation_allow_repair: boolean
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_reason: string | null
          retired_deployment: Json | null
          retired_trigger_ids: string[]
          safe_error: string | null
          selected_calendar_ids: Json
          signing_secret_name: string | null
          trigger_state: string
          updated_at: string
          webhook_correlation_id: string
          webhook_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "pipedream_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_stripe_connect_account: {
        Args: {
          p_auth_user_id: string
          p_environment: string
          p_profile_id: string
          p_website_id: string
        }
        Returns: {
          account_type: string
          application_fee_bps: number
          capabilities: Json
          charge_model: string
          charges_enabled: boolean
          configuration: Json
          country: string
          created_at: string
          creation_key: string | null
          details_submitted: boolean
          environment: string
          id: string
          last_verified_at: string | null
          onboarding_state: string
          payouts_enabled: boolean
          profile_id: string
          provider_created_at: string | null
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_generation: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_safe_error: string | null
          reconnect_reason: string | null
          requirements: Json
          stripe_account_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "stripe_connected_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_booking_calendar_destination: {
        Args: { p_appointment_id: string }
        Returns: Json
      }
      resolve_pipedream_trigger_signing_key: {
        Args: {
          p_account_id: string
          p_binding_id: string
          p_correlation_id: string
          p_environment: string
          p_trigger_id: string
        }
        Returns: string
      }
      resolve_saas_checkout_fulfillment_delivery_unknown: {
        Args: {
          p_action: string
          p_actor_token_hash: string
          p_evidence: Json
          p_expected_fencing_token: number
          p_id: string
          p_reason: string
        }
        Returns: boolean
      }
      resolve_stripe_connect_account: {
        Args: { p_environment: string; p_stripe_account_id: string }
        Returns: {
          environment: string
          profile_id: string
        }[]
      }
      restart_google_calendar_setup_probe: {
        Args: {
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_operation_id: string
          p_profile_id: string
        }
        Returns: Json
      }
      restore_website_version_atomic: {
        Args: {
          p_expected_revision: number
          p_version_id: string
          p_website_id: string
        }
        Returns: number
      }
      retire_pipedream_trigger: {
        Args: {
          p_binding_id: string
          p_deployed_trigger_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: {
          component_key: string
          component_version: string
          configuration_revision: number
          connection_id: string
          created_at: string
          deployed_trigger_id: string | null
          deployment_candidate_trigger_id: string | null
          deployment_dispatch_fencing_token: number | null
          deployment_dispatch_lease_token: string | null
          deployment_dispatched_at: string | null
          deployment_expected_connection_revision: number | null
          deployment_lease_expires_at: string | null
          deployment_operation_id: string | null
          deployment_receipt: Json | null
          environment: string
          id: string
          last_event_at: string | null
          last_health_at: string | null
          observed_component_key: string | null
          observed_component_version: string | null
          pending_trigger_deletions: string[]
          pipedream_account_id: string
          profile_id: string
          provider_updated_at: string | null
          reconciliation_allow_repair: boolean
          reconciliation_attempts: number
          reconciliation_due_at: string | null
          reconciliation_fencing_token: number
          reconciliation_last_attempt_at: string | null
          reconciliation_lease_expires_at: string | null
          reconciliation_lease_token: string | null
          reconciliation_reason: string | null
          retired_deployment: Json | null
          retired_trigger_ids: string[]
          safe_error: string | null
          selected_calendar_ids: Json
          signing_secret_name: string | null
          trigger_state: string
          updated_at: string
          webhook_correlation_id: string
          webhook_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "pipedream_bindings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retry_enrichment_finalization: {
        Args: {
          p_error_message: string
          p_job_attempts: number
          p_job_id: string
        }
        Returns: string
      }
      revoke_admin_principal_v4: {
        Args: { p_actor_token_hash: string; p_target_user_id: string }
        Returns: boolean
      }
      revoke_admin_session_v4: {
        Args: { p_token_hash: string }
        Returns: boolean
      }
      rotate_saas_offer_contract: {
        Args: {
          p_environment: string
          p_expected_current_price_id: string
          p_new_contract_id: string
          p_plan: string
        }
        Returns: boolean
      }
      run_add_video_observability_check: {
        Args: { p_as_of?: string; p_dry_run?: boolean }
        Returns: Json
      }
      save_onboarding_field_owned: {
        Args: {
          p_expected_state: Json
          p_expected_versions: Json
          p_next_state: Json
          p_owner_token: string
          p_trace_id: string
          p_website_id: string
        }
        Returns: undefined
      }
      save_shared_booking_availability: {
        Args: {
          p_auth_user_id: string
          p_environment: string
          p_intervals: Json
          p_overrides: Json
          p_profile_id: string
          p_schedule: Json
          p_schedule_revision: number
          p_service: Json
          p_service_revision: number
          p_website_id: string
        }
        Returns: Json
      }
      save_shared_booking_availability_base: {
        Args: {
          p_auth_user_id: string
          p_environment: string
          p_intervals: Json
          p_profile_id: string
          p_schedule: Json
          p_schedule_revision: number
          p_service: Json
          p_service_revision: number
          p_website_id: string
        }
        Returns: Json
      }
      select_website_version_atomic: {
        Args: {
          p_expected_revision: number
          p_version_id: string
          p_website_id: string
        }
        Returns: number
      }
      set_admin_session_impersonation_v4: {
        Args: { p_profile_id: string; p_token_hash: string }
        Returns: boolean
      }
      set_agent_turn_runtime_enabled: {
        Args: { p_enabled: boolean }
        Returns: undefined
      }
      set_booking_attachment_legal_hold_v3: {
        Args: {
          p_admin_token_hash: string
          p_attachment_id: string
          p_held: boolean
          p_reason: string
        }
        Returns: boolean
      }
      set_booking_checkout_provider_deadline: {
        Args: {
          p_fencing_token: number
          p_lease_token: string
          p_payment_id: string
          p_provider_expires_at: string
        }
        Returns: string
      }
      set_calendar_worker_schedules_active: {
        Args: { p_active?: boolean; p_environment: string }
        Returns: number
      }
      settle_add_video_job_epoch: {
        Args: {
          p_claim_epoch: number
          p_completed_at: string
          p_error_message: string
          p_job_attempts: number
          p_job_id: string
          p_payload_json: Json
          p_progress_pct: number
          p_result_json: Json
          p_runner_id: string
          p_status: string
          p_status_message: string
          p_website_id: string
        }
        Returns: boolean
      }
      settle_add_video_media_slot: {
        Args: {
          p_effect_certainty: string
          p_error_message: string
          p_job_attempts: number
          p_job_id: string
          p_provider_operation_id: string
          p_reservation_id: string
          p_slot_id: string
          p_status: string
          p_website_id: string
        }
        Returns: boolean
      }
      settle_add_video_media_slot_epoch: {
        Args: {
          p_claim_epoch: number
          p_effect_certainty: string
          p_error_message: string
          p_job_attempts: number
          p_job_id: string
          p_provider_operation_id: string
          p_reservation_id: string
          p_runner_id: string
          p_slot_id: string
          p_status: string
          p_website_id: string
        }
        Returns: boolean
      }
      settle_agent_site_generation_message: {
        Args: { p_chain_id: string; p_website_id: string }
        Returns: boolean
      }
      settle_background_job: {
        Args: {
          p_attempts: number
          p_completed_at: string
          p_error_message: string
          p_job_id: string
          p_payload_json: Json
          p_progress_pct: number
          p_result_json: Json
          p_status: string
          p_status_message: string
        }
        Returns: boolean
      }
      settle_background_job_historical_body: {
        Args: {
          p_completed_at: string
          p_error_message: string
          p_job_attempts: number
          p_job_id: string
          p_payload_json: Json
          p_progress_pct: number
          p_result_json: Json
          p_status: string
          p_status_message: string
        }
        Returns: boolean
      }
      settle_booking_calendar_claim: {
        Args: {
          p_expected_event_id: string
          p_fencing_token: number
          p_lease_token: string
          p_link_id: string
          p_state: string
        }
        Returns: boolean
      }
      settle_booking_calendar_reconciliation: {
        Args: {
          p_expected_event_id: string
          p_link_id: string
          p_state: string
        }
        Returns: boolean
      }
      settle_booking_calendar_setup_capability: {
        Args: {
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_operation_id: string
          p_profile_id: string
        }
        Returns: boolean
      }
      settle_booking_checkout: {
        Args: {
          p_ambiguous: boolean
          p_expires_at: string
          p_fencing_token: number
          p_lease_token: string
          p_payment_id: string
          p_safe_error: string
          p_session_id: string
          p_succeeded: boolean
        }
        Returns: {
          amount_paid_minor: number
          amount_refunded_minor: number
          appointment_id: string
          booking_contract_version: number | null
          charge_id: string | null
          checkout_expires_at: string | null
          checkout_fencing_token: number
          checkout_idempotency_key: string | null
          checkout_last_error: string | null
          checkout_lease_expires_at: string | null
          checkout_lease_token: string | null
          checkout_operation_id: string | null
          checkout_provider_expires_at: string | null
          checkout_session_id: string | null
          confirmation_handoff_expires_at: string | null
          confirmation_nonce_hash: string | null
          connected_account_id: string | null
          created_at: string
          currency: string
          dispute_id: string | null
          dispute_provider_created: number
          dispute_state: string
          dispute_status_rank: number
          environment: string
          expected_amount_minor: number
          failed_at: string | null
          failure_code: string | null
          financial_event_rank: number
          financial_provider_created: number
          financial_provider_event_id: string | null
          id: string
          paid_at: string | null
          payment_intent_id: string | null
          payment_state: string
          profile_id: string
          provider_created_at: string | null
          provider_updated_at: string | null
          receipt_url: string | null
          refund_generation: number
          refund_id: string | null
          refund_idempotency_key: string | null
          refund_requested_at: string | null
          refund_state: string
          refunded_at: string | null
          session_expiry_attempts: number
          session_expiry_next_attempt_at: string
          stripe_account_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "booking_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_booking_refund_command: {
        Args: {
          p_absolute_refunded: number
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
          p_provider_created: number
          p_refund_id: string
          p_state: string
        }
        Returns: boolean
      }
      settle_booking_refund_snapshot_v3: {
        Args: {
          p_command_id: string
          p_fencing_token: number
          p_lease_token: string
          p_provider_snapshot: Json
        }
        Returns: Json
      }
      settle_due_booking_session: {
        Args: {
          p_amount: number
          p_charge_id: string
          p_currency: string
          p_expired: boolean
          p_fencing_token: number
          p_lease_token: string
          p_paid: boolean
          p_payment_id: string
          p_payment_intent_id: string
        }
        Returns: boolean
      }
      settle_enrichment_job: {
        Args: {
          p_completed_at: string
          p_error_message: string
          p_job_attempts: number
          p_job_id: string
          p_payload_json: Json
          p_result_json: Json
          p_status: string
          p_status_message: string
        }
        Returns: {
          finalize_chain: boolean
          settled: boolean
        }[]
      }
      settle_generation_media_slot: {
        Args: {
          p_error_message?: string
          p_job_attempts: number
          p_job_id: string
          p_slot_id: string
          p_status: string
          p_website_id: string
        }
        Returns: boolean
      }
      settle_generation_media_slot_epoch: {
        Args: {
          p_claim_epoch: number
          p_effect_certainty: string
          p_error_message: string
          p_job_id: string
          p_reservation_id: string
          p_runner_id: string
          p_slot_id: string
          p_status: string
          p_website_id: string
        }
        Returns: boolean
      }
      settle_generation_media_slot_legacy_attempt: {
        Args: {
          p_error_message?: string
          p_job_attempts: number
          p_job_id: string
          p_slot_id: string
          p_status: string
          p_website_id: string
        }
        Returns: boolean
      }
      settle_google_calendar_setup_probe: {
        Args: {
          p_denied_action?: string
          p_environment: string
          p_failure_observed_at?: string
          p_fencing_token: number
          p_lease_token: string
          p_operation_id: string
          p_probe_state?: string
          p_profile_id: string
          p_reason: string
          p_success: boolean
          p_write_verified: boolean
        }
        Returns: Json
      }
      settle_pipedream_binding_cleanup: {
        Args: {
          p_binding_id: string
          p_fencing_token: number
          p_lease_token: string
        }
        Returns: boolean
      }
      settle_site_generation_epoch: {
        Args: {
          p_budget_type: string
          p_cause_code: string
          p_checkpoint: Json
          p_claim_epoch: number
          p_contract_epoch: number
          p_deployment_id?: string
          p_effect_certainty: string
          p_error_message: string
          p_event_key: string
          p_invocation_id?: string
          p_job_id: string
          p_next_retry_at: string
          p_progress_pct: number
          p_result_json: Json
          p_runner_id?: string
          p_status: string
          p_status_message: string
        }
        Returns: boolean
      }
      signal_saas_provider_event_retry: {
        Args: { p_event_id: string }
        Returns: boolean
      }
      site_generation_event_fingerprint: {
        Args: { p_event: Json }
        Returns: string
      }
      store_booking_availability_cache: {
        Args: {
          p_busy_ranges: Json
          p_cache_key: string
          p_calendar_set_hash: string
          p_connection_id: string
          p_environment: string
          p_expected_generation: number
          p_expires_at: string
          p_observed_at: string
          p_profile_id: string
          p_range_end: string
          p_range_start: string
          p_schedule_revision: number
          p_service_revision: number
        }
        Returns: boolean
      }
      submit_starter_website_lead: {
        Args: {
          p_field_snapshot: Json
          p_form_data: Json
          p_payload_hash: string
          p_rate_limit_key: string
          p_source_snapshot: Json
          p_submission_fingerprint: string
          p_version_id: string
          p_website_id: string
        }
        Returns: string
      }
      supersede_and_enqueue_site_generation_job_owned: {
        Args: {
          p_actor: string
          p_predecessor_claim_epoch: number
          p_predecessor_job_id: string
          p_predecessor_request_id: string
          p_reason: string
          p_successor_idempotency_key: string
          p_successor_owner_token: string
          p_successor_payload_json: Json
          p_successor_trace_id: string
          p_website_id: string
        }
        Returns: {
          assistant_message_id: string
          chain_id: string
          successor_job_id: string
        }[]
      }
      supersede_site_generation_epoch_internal: {
        Args: {
          p_actor: string
          p_claim_epoch: number
          p_job_id: string
          p_reason: string
          p_request_id: string
          p_website_id: string
        }
        Returns: boolean
      }
      suppress_noncanonical_booking_notifications_v4: {
        Args: { p_environment: string; p_limit?: number }
        Returns: number
      }
      terminalize_add_video_job_internal: {
        Args: {
          p_actor: string
          p_error_code: string
          p_job_id: string
          p_status_message: string
        }
        Returns: boolean
      }
      terminalize_add_video_retry_state: {
        Args: {
          p_error_code: string
          p_job_id: string
          p_scheduler_run_id: string
          p_status_message: string
        }
        Returns: boolean
      }
      terminalize_unclaimable_epoch2_job: {
        Args: { p_actor: string; p_job_id: string }
        Returns: boolean
      }
      transition_appointment: {
        Args: {
          p_appointment_id: string
          p_client_request_id: string
          p_environment: string
          p_expected_version: number
          p_operation_type: string
          p_payload?: Json
          p_profile_id: string
          p_request_hash: string
        }
        Returns: {
          amount_minor: number
          appointment_reason: string | null
          appointment_state: string
          booking_contract_version: number | null
          buffer_after_minutes: number
          buffer_before_minutes: number
          calendar_destination_epoch_id: string | null
          calendar_generation: number
          calendar_state: string
          cancellation_requested_at: string | null
          cancelled_at: string | null
          capacity_range: unknown
          checkout_generation: number
          confirmed_at: string | null
          created_at: string
          currency: string
          customer_id: string
          customer_snapshot: Json
          duration_minutes: number
          end_at: string
          entitlement_id: string
          environment: string
          id: string
          local_date: string
          local_start: string
          location_snapshot: Json
          payment_state: string
          profile_id: string
          public_reference: string
          refund_generation: number
          refund_state: string
          reservation_expires_at: string | null
          review_state: string
          schedule_revision: number | null
          service_id: string
          service_snapshot: Json
          start_at: string
          time_zone: string
          updated_at: string
          version: number
          website_id: string
        }
        SetofOptions: {
          from: "*"
          to: "appointments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_calendar_action_notice: {
        Args: {
          p_action: string
          p_connection_id: string
          p_environment: string
          p_fencing_token: number
          p_lease_token: string
          p_notice_id: string
          p_payload?: string
          p_provider_message_id?: string
        }
        Returns: Json
      }
      update_website_version_config_atomic: {
        Args: {
          p_category: string
          p_config_json: Json
          p_expected_revision: number
          p_patch_json?: Json
          p_version_id: string
          p_website_id: string
        }
        Returns: number
      }
      update_website_version_config_owned: {
        Args: {
          p_category: string
          p_config_json: Json
          p_expected_revision: number
          p_owner_token: string
          p_patch_json: Json
          p_trace_id: string
          p_version_id: string
          p_website_id: string
        }
        Returns: number
      }
      update_website_version_config_with_media_atomic: {
        Args: {
          p_category: string
          p_config_json: Json
          p_expected_revision: number
          p_media_slots: Json
          p_patch_json: Json
          p_version_id: string
          p_website_id: string
        }
        Returns: number
      }
      update_website_version_config_with_media_owned: {
        Args: {
          p_category: string
          p_config_json: Json
          p_expected_revision: number
          p_media_slots: Json
          p_owner_token: string
          p_patch_json: Json
          p_trace_id: string
          p_version_id: string
          p_website_id: string
        }
        Returns: number
      }
      validate_admin_session_v4: {
        Args: { p_token_hash: string; p_touch?: boolean }
        Returns: {
          impersonated_profile_id: string
          role: string
          session_id: string
          user_id: string
        }[]
      }
      validate_booking_refund_snapshot_v3: {
        Args: {
          p_charge_id: string
          p_currency: string
          p_intent_id: string
          p_paid_minor: number
          p_refunds: Json
        }
        Returns: undefined
      }
      validate_calendar_worker_cron_configuration: {
        Args: { p_environment: string }
        Returns: undefined
      }
      yield_add_video_stage: {
        Args: {
          p_checkpoint_patch: Json
          p_claim_epoch: number
          p_expected_stage: string
          p_job_attempts: number
          p_job_id: string
          p_next_stage: string
          p_progress_pct: number
          p_retry_at: string
          p_runner_id: string
          p_status_message: string
          p_website_id: string
        }
        Returns: boolean
      }
      yield_add_video_stage_pre_lifecycle_audit: {
        Args: {
          p_checkpoint_patch: Json
          p_claim_epoch: number
          p_expected_stage: string
          p_job_attempts: number
          p_job_id: string
          p_next_stage: string
          p_progress_pct: number
          p_retry_at: string
          p_runner_id: string
          p_status_message: string
          p_website_id: string
        }
        Returns: boolean
      }
      yield_site_generation_stage_epoch: {
        Args: {
          p_checkpoint: Json
          p_claim_epoch: number
          p_contract_epoch: number
          p_deployment_id?: string
          p_event_key: string
          p_invocation_id?: string
          p_job_id: string
          p_progress_pct: number
          p_runner_id?: string
          p_stage: string
          p_status_message: string
        }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
