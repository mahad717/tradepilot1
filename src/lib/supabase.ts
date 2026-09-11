import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase factory (used by the authenticated app).
 * Public SEO pages never touch the database — they render from the
 * file-based content system, keeping them static and fast.
 *
 * Configure via env:
 *   NEXT_PUBLIC_SUPABASE_URL=https://cofqyzlhquevcefdxxke.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=<from Supabase dashboard>
 */
let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false },
    });
  }
  return cached;
}
