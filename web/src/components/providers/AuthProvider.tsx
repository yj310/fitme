"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMe } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import type { User } from "@/lib/types";

interface AuthState {
  /** "loading" until the first session check finishes. */
  status: "loading" | "signed_out" | "signed_in";
  session: Session | null;
  me: User | null;
  meError: string | null;
  configError: string | null;
  refreshMe: () => Promise<User | null>;
  setMe: (u: User) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthState["status"]>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      const u = await getMe();
      setMe(u);
      setMeError(null);
      return u;
    } catch (e) {
      setMeError(e instanceof Error ? e.message : "프로필을 불러오지 못했어요.");
      return null;
    }
  }, []);

  useEffect(() => {
    let supabase;
    try {
      supabase = getSupabase();
    } catch (e) {
      // Missing env: render signed-out with a visible configuration message.
      queueMicrotask(() => {
        setConfigError((e as Error).message);
        setStatus("signed_out");
      });
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setStatus(data.session ? "signed_in" : "signed_out");
      if (data.session) void refreshMe();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!alive) return;
      setSession(s);
      setStatus(s ? "signed_in" : "signed_out");
      if (event === "SIGNED_IN") void refreshMe();
      if (event === "SIGNED_OUT") setMe(null);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshMe]);

  const signOut = useCallback(async () => {
    try {
      await getSupabase().auth.signOut();
    } finally {
      setMe(null);
      setSession(null);
      setStatus("signed_out");
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ status, session, me, meError, configError, refreshMe, setMe, signOut }),
    [status, session, me, meError, configError, refreshMe, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function onboardingDone(me: User | null): boolean {
  return Boolean(me?.onboarding_state?.completed_at);
}
