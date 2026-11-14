"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/** Supabase is used for login only. All data goes through the FITME API. */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!env.supabaseUrl || !env.supabaseAnonKey) {
    throw new Error("Supabase 설정이 없어요. web/.env.local 을 확인해 주세요.");
  }
  client = createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
  return client;
}

export async function getAccessToken(): Promise<string | null> {
  try {
    const { data } = await getSupabase().auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}
