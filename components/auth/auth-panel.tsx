"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EVENTS } from "@/lib/analytics/events";
import { resetAnalytics, track } from "@/lib/analytics/client";

export function AuthPanel() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lastTrackedUserIdRef = useRef<string | null>(null);

  const ensureProfile = async (user: User) => {
    const { data: existing, error: selErr } = await supabase
      .from("profiles")
      .select("id, credits")
      .eq("id", user.id)
      .maybeSingle();

    if (selErr) {
      console.error("Profile select error:", selErr.message);
      return false;
    }

    if (existing) return false;

    const { error: insErr } = await supabase.from("profiles").upsert(
      {
        id: user.id,
        email: user.email ?? null,
        credits: 30,
        mode_default: "find",
        theme: "dark",
        whatsapp_share_allowed: false,
      },
      { onConflict: "id" }
    );

    if (insErr) {
      console.error("Profile insert error:", insErr.message);
      return false;
    }

    return true;
  };

  useEffect(() => {
    let mounted = true;

    const syncSignedInUser = async (user: User) => {
      const createdProfile = await ensureProfile(user);

      if (lastTrackedUserIdRef.current !== user.id) {
        track(EVENTS.AUTH_SUCCEEDED, {
          provider: "google",
          user_id: user.id,
        });

        if (createdProfile) {
          track(EVENTS.PROFILE_CREATED, {
            provider: "google",
            user_id: user.id,
            starting_credits: 30,
          });
        }

        lastTrackedUserIdRef.current = user.id;
      }
    };

    supabase.auth.getSession().then(async ({ data, error }) => {
      if (error) console.error("getSession error:", error.message);
      if (!mounted) return;

      setSession(data.session ?? null);
      setLoading(false);

      if (data.session?.user) {
        await syncSignedInUser(data.session.user);
      } else {
        lastTrackedUserIdRef.current = null;
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      setSession(newSession ?? null);
      setLoading(false);

      if (event === "SIGNED_OUT" || !newSession?.user) {
        lastTrackedUserIdRef.current = null;
        return;
      }

      await syncSignedInUser(newSession.user);
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
    resetAnalytics();
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