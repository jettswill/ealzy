import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./config.js";

function restAwareFetch(input: RequestInfo | URL, init?: RequestInit) {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const url = new URL(raw);
  if (url.pathname.startsWith("/rest/v1/")) {
    url.pathname = url.pathname.slice("/rest/v1".length) || "/";
  } else if (url.pathname === "/rest/v1") {
    url.pathname = "/";
  }
  return fetch(url, init);
}

export function createDatabase(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">,
): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: restAwareFetch,
    },
  });
}
