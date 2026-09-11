import "server-only";
import { getSupabase } from "./supabase";

/**
 * Verify a Supabase access token from the Authorization header and return
 * the authenticated user, or null. Used to gate state-changing endpoints
 * (saved signals, saved backtests) without a server session.
 */
export async function getAuthUser(
  req: Request
): Promise<{ id: string; email?: string } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}
