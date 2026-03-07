"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const WORDS = [
  "Jaldi",
  "Fatafat",
  "Turant",
  "Tara-tari",
  "Lavkar",
  "Seekkiram",
  "Tondaraga",
  "Bega",
  "Vegam",
  "Chheti",
];

export function Splash({ onSkip }: { onSkip: () => void }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setI((x) => (x + 1) % WORDS.length);
    }, 1100);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      {/* subtle brand glow */}
      <div className="pointer-events-none fixed inset-0 opacity-30">
        <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
             style={{ background: "radial-gradient(circle, rgba(58,41,166,0.35) 0%, rgba(0,0,0,0) 70%)" }} />
      </div>

      <div className="relative w-full max-w-2xl text-center">
        {/* Brand mini mark */}
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border">
          <span className="text-lg font-semibold">Q</span>
        </div>

        {/* Big headline */}
        <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">
          <span className="text-muted-foreground">{WORDS[i]}</span>{" "}
          <span>means</span>{" "}
          <span className="text-primary">Quikado</span>.
        </h1>

        <p className="mt-4 text-sm sm:text-base text-muted-foreground">
          Hyperlocal matching, in your language.
        </p>

        {/* tiny accent (sparingly using #ff2f00) */}
        <div className="mx-auto mt-6 h-[3px] w-16 rounded-full"
             style={{ backgroundColor: "#ff2f00" }} />

        <div className="mt-10 flex justify-center">
          <Button variant="ghost" onClick={onSkip} className="rounded-xl">
            Skip
          </Button>
        </div>
      </div>
    </main>
  );
}