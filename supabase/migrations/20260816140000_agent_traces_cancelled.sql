-- Allow agent_traces.status = cancelled when user stops an in-flight turn.

alter table public.agent_traces
  drop constraint if exists agent_traces_status_check;

alter table public.agent_traces
  add constraint agent_traces_status_check
  check (status in ('running', 'completed', 'error', 'cancelled'));
