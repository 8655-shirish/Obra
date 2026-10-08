import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database as SemanticDatabase } from "./semantic-types";
import type { Database as GeneratedDatabase } from "./types";

/** Apply SQL-backed semantic refinements at the few RPCs the raw generator cannot represent. */
export function withSemanticTypes(client: SupabaseClient<GeneratedDatabase>) {
  return client as unknown as SupabaseClient<SemanticDatabase>;
}
