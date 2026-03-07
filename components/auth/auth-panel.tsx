"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthPanel() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // ✅ Create profile once per user (30 free credits)
  const ensureProfile = async (email?: string | null) => {
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr) {
      console.error("getUser error:", userErr.message);
      return;
    }
    if (!user) return;

    // Check if profile exists
    const { data: existing, error: selErr } = await supabase
      .from("profiles")
      .select("id, credits")
      .eq("id", user.id)
      .maybeSingle();

    if (selErr) {
      console.error("Profile select error:", selErr.message);
      return;
    }

    if (existing) return; // already exists

    // Create profile
    const { error: insErr } = await supabase.from("profiles").upsert(
  {
    id: user.id,
    email: email ?? user.email ?? null,
    credits: 30,
    mode_default: "find",
    theme: "dark",
    whatsapp_share_allowed: false,
  },
  { onConflict: "id" }
);

    if (insErr) {
      console.error("Profile insert error:", insErr.message);
    }
  };

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) console.error("getSession error:", error.message);
      if (!mounted) return;

      setSession(data.session ?? null);
      setLoading(false);

      if (data.session?.user) {
        await ensureProfile(data.session.user.email);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession ?? null);
      setLoading(false);

      if (newSession?.user) {
        await ensureProfile(newSession.user.email);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  const signInWithGoogle = async () => {
    const redirectTo =
      process.env.NEXT_PUBLIC_APP_URL || window.location.origin;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) alert(`Google login error: ${error.message}`);
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) alert(`Sign out error: ${error.message}`);
  };

  if (loading) {
    return (
      <Card className="w-full max-w-md rounded-2xl">
        <CardContent className="p-6">Loading auth status...</CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md rounded-2xl">
      <CardHeader>
        <CardTitle>Quikado Auth Test</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {session ? (
          <>
            <div className="text-sm">
              Signed in as:
              <div className="mt-1 font-medium">{session.user.email}</div>
            </div>

            <Button onClick={signOut} className="w-full">
              Sign out
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Test Google login before building the full Quikado UI.
            </p>

            <Button onClick={signInWithGoogle} className="w-full">
              Continue with Google
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}