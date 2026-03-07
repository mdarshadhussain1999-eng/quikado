"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LoginDialog } from "@/components/auth/login-dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function Landing() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [loginOpen, setLoginOpen] = useState(false);

  // Landing can have its own mode toggle (before login)
  const [mode, setMode] = useState<"find" | "offer">("find");

  // Theme toggle (pre-login)
  const [isDark, setIsDark] = useState(true);
  const applyTheme = (dark: boolean) => {
    setIsDark(dark);
    document.documentElement.classList.toggle("dark", dark);
  };

  const openLogin = () => setLoginOpen(true);

  const suggestionChips =
    mode === "find"
      ? ["Electrician near me", "Cook for lunch", "Tailor (Zari work)", "AC repair today"]
      : ["I do AC repair", "I provide home tuition", "I do tailoring", "I do catering"];

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Top bar: Brand left + Toggle center */}
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl border flex items-center justify-center font-semibold">
            Q
          </div>
          <div className="font-semibold">Quikado</div>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "find" | "offer")}>
          <TabsList className="rounded-full">
            <TabsTrigger value="find" className="rounded-full">
              Find
            </TabsTrigger>
            <TabsTrigger value="offer" className="rounded-full">
              Offer
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="w-[120px]" />
      </div>

      {/* Center Gemini-like block */}
      <div className="mx-auto flex min-h-[calc(100vh-64px)] max-w-5xl flex-col items-center justify-center px-6">
        <div className="w-full max-w-[760px]">
          <div className="mb-4 text-left">
            <div className="text-sm text-muted-foreground">Hi 👋</div>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Where should we start?
            </h1>
          </div>

          {/* Disabled prompt card that opens login */}
          <Card className="rounded-2xl p-4 cursor-pointer" onClick={openLogin}>
            <div className="flex items-center gap-3">
              <div className="min-h-[56px] w-full text-muted-foreground flex items-center">
                {mode === "find"
                  ? "Describe what you need… (login to continue)"
                  : "Describe what service you offer… (login to continue)"}
              </div>
              <Button className="rounded-xl" onClick={openLogin}>
                Continue
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
              {suggestionChips.map((t) => (
                <span key={t} className="rounded-full border px-3 py-1">
                  {t}
                </span>
              ))}
            </div>
          </Card>

          {/* Center-aligned legal line under the card */}
          <div className="mt-2 text-center text-xs text-muted-foreground">
            Legal services only. Unsafe or illegal requests are blocked.
          </div>
        </div>
      </div>

      {/* Bottom-right links */}
      <div className="fixed bottom-4 right-6 text-xs text-muted-foreground">
        <div className="flex justify-end gap-4">
          <a className="hover:underline" href="/privacy">Privacy</a>
          <a className="hover:underline" href="/terms">Terms</a>
          <a className="hover:underline" href="/help">Help</a>
        </div>
      </div>

      {/* Bottom-left theme toggle */}
      <div className="fixed bottom-4 left-6 flex items-center gap-2 text-xs text-muted-foreground">
        <span>Light</span>
        <Switch checked={isDark} onCheckedChange={(checked) => applyTheme(checked)} />
        <span>Dark</span>
      </div>

      {/* Login modal */}
      <LoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onGoogle={() => {
          // Save chosen mode for after login
          localStorage.setItem("quikado_mode", mode);

          const redirectTo = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
          supabase.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo },
          });
        }}
      />
    </main>
  );
}