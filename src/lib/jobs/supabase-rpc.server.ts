import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type RpcClient = Pick<SupabaseClient<Database>, "rpc">;

export type SupabaseRpcResult<T = unknown> = {
  data: T | null;
  error: { code?: string; message?: string } | null;
};

/**
 * Invoke PostgREST RPC as a method. `const rpc = supabase.rpc; rpc(name, args)`
 * drops `this` and throws `Cannot read properties of undefined (reading 'rest')`.
 */
export function callSupabaseRpc<T = unknown>(
  supabase: RpcClient,
  name: string,
  args: Record<string, unknown>,
): PromiseLike<SupabaseRpcResult<T>> {
  return supabase.rpc(name as never, args as never) as PromiseLike<SupabaseRpcResult<T>>;
}
