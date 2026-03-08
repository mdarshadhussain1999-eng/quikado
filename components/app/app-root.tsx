"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/app-shell";
import { Splash } from "@/components/marketing/splash";
import { Landing } from "@/components/marketing/landing";
import { EVENTS } from "@/lib/analytics/events";
import { track } from "@/lib/analytics/client";

type Screen = "splash" | "landing" | "app";

export function AppRoot() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [screen, setScreen] = useState<Screen>("splash");

  const MIN_SPLASH_MS = 2500;

  const startRef = useRef<number>(Date.now());
  const queuedRef = useRef<Screen | null>(null);
  const splashDoneRef = useRef<boolean>(false);
  const landingTrackedRef = useRef<boolean>(false);

  useEffect(() => {
    let alive = true;
    startRef.current = Date.now();

    const decideAfterSplash = async () => {
      const { data } = await supabase.auth.getSession();
      const next: Screen = data.session ? "app" : "landing";

      const elapsed = Date.now() - startRef.current;
      const wait = Math.max(0, MIN_SPLASH_MS - elapsed);

      setTimeout(() => {
        if (!alive) return;

        const final = queuedRef.current ?? next;
        splashDoneRef.current = true;
        setScreen(final);
      }, wait);
    };

    decideAfterSplash();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const next: Screen = session ? "app" : "landing";

      if (!splashDoneRef.current) {
        queuedRef.current = next;
        return;
      }

      setScreen(next);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (screen === "landing" && !landingTrackedRef.current) {
      track(EVENTS.LANDING_VIEWED, {
        source: "app-root",
      });
      landingTrackedRef.current = true;
    }

    if (screen !== "landing") {
      landingTrackedRef.current = false;
    }
  }, [screen]);

  const skipSplash = async () => {
    const { data } = await supabase.auth.getSession();
    splashDoneRef.current = true;
    setScreen(data.session ? "app" : "landing");
  };

  if (screen === "splash") return <Splash onSkip={skipSplash} />;
  if (screen === "landing") return <Landing />;
  return <AppShell />;
}