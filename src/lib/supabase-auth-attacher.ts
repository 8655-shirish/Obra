import { createMiddleware } from "@tanstack/react-start";

import { supabaseBrowser } from "@/lib/supabase-browser";

export const attachSupabaseAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const { data } = await supabaseBrowser.auth.getSession();
    const token = data.session?.access_token;
    return next({
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  },
);