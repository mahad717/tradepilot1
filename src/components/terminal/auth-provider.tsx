"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** null when Supabase env vars are missing (auth unavailable) */
  client: SupabaseClient | null;
  signOut: () => Promise<void>;
  /** Access token for Authorization headers, or null. */
  accessToken: () => string | null;
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  loading: true,
  client: null,
  signOut: async () => {},
  accessToken: () => null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const client = useMemo(() => getSupabaseBrowser(), []);
  // When no client is configured there is nothing to wait for.
  const loading = client ? sessionLoading : false;

  useEffect(() => {
    if (!client) return;

    let mounted = true;

    client.auth
      .getSession()
      .then(({ data }) => {
        if (mounted) setSession(data.session ?? null);
      })
      .finally(() => {
        if (mounted) setSessionLoading(false);
      });

    const { data: sub } = client.auth.onAuthStateChange((_event, newSession) => {
      if (mounted) setSession(newSession);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [client]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      client,
      signOut: async () => {
        if (client) await client.auth.signOut();
        setSession(null);
      },
      accessToken: () => session?.access_token ?? null,
    }),
    [session, loading, client]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
