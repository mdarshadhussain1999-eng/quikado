"use client";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft,
  ChevronRight,
  Inbox,
  Star,
  Sun,
  Moon,
  CreditCard,
  LogOut,
} from "lucide-react";

type Props = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;

  theme: "dark" | "light";
  onToggleTheme: (next: "dark" | "light") => void;

  credits: number;
  onOpenCredits: () => void;

  onSignOut: () => void;

  onOpenInbox: () => void;
  onOpenSaved: () => void;

  inboxHasNew?: boolean;
};

export function Sidebar({
  sidebarOpen,
  onToggleSidebar,
  theme,
  onToggleTheme,
  credits,
  onOpenCredits,
  onSignOut,
  onOpenInbox,
  onOpenSaved,
  inboxHasNew = false,
}: Props) {
  const isDark = theme === "dark";

  const navBtnClass = sidebarOpen
    ? "w-full justify-start gap-2 rounded-xl h-10 px-3"
    : "w-full justify-center rounded-xl h-10 px-0";

  return (
    <aside
      className={[
        "h-screen border-r bg-background",
        sidebarOpen ? "w-[280px]" : "w-[76px]",
        "transition-all duration-200",
        "flex flex-col",
      ].join(" ")}
    >
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl border flex items-center justify-center font-semibold">
            Q
          </div>
          {sidebarOpen && <div className="font-semibold">Quikado</div>}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="mt-2 flex-1 overflow-auto px-3">
        {sidebarOpen && (
          <div className="px-1 pb-2 text-xs text-muted-foreground">
            Chats / Requests
          </div>
        )}

        <div className="space-y-1">
          <Button variant="ghost" className={navBtnClass} onClick={onOpenInbox}>
            <div className="relative">
              <Inbox className="h-4 w-4" />
              {inboxHasNew && (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
              )}
            </div>
            {sidebarOpen ? "Inbox" : null}
          </Button>

          <Button variant="ghost" className={navBtnClass} onClick={onOpenSaved}>
            <Star className="h-4 w-4" />
            {sidebarOpen ? "Saved" : null}
          </Button>
        </div>
      </div>

      <div className="border-t p-3 space-y-2">
        <Button variant="secondary" className={navBtnClass} onClick={onOpenCredits}>
          <CreditCard className="h-4 w-4" />
          {sidebarOpen ? `Credits: ${credits}` : null}
        </Button>

        <Button variant="ghost" className={navBtnClass} onClick={onSignOut}>
          <LogOut className="h-4 w-4" />
          {sidebarOpen ? "Sign out" : null}
        </Button>

        {sidebarOpen ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <Sun className="h-4 w-4" />
              <span>Light</span>
            </div>

            <Switch
              checked={isDark}
              onCheckedChange={(checked) =>
                onToggleTheme(checked ? "dark" : "light")
              }
              className="border border-muted-foreground/30 data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted"
              aria-label="Toggle theme"
            />

            <div className="flex items-center gap-2 text-sm">
              <Moon className="h-4 w-4" />
              <span>Dark</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center pt-1">
            <Button
              variant="secondary"
              size="icon"
              className="rounded-xl"
              onClick={() => onToggleTheme(isDark ? "light" : "dark")}
              aria-label="Toggle theme"
            >
              {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}