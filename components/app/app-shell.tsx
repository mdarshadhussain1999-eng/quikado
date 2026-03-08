"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { fetchMyProfile, updateMyProfile, type Profile } from "@/lib/profile";
import { PostHogIdentify } from "@/components/analytics/posthog-identify";
import { EVENTS } from "@/lib/analytics/events";
import { resetAnalytics, track } from "@/lib/analytics/client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/app/sidebar";
import { AudioRecorder } from "@/components/app/audio-recorder";

import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Inbox,
  Star,
  CreditCard,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

declare global {
  interface Window {
    Razorpay: any;
  }
}

type MatchCard = {
  rank: number;
  score: number;
  pro_service_id: string;
  pro_user_id?: string;
  service_text: string;
  reasons?: string[];
};

type ChatMessage = {
  id: string;
  sender_id: string;
  text: string;
  created_at: string;
};

type InboxItem = {
  threadId: string;
  seekerId: string;
  seekerName: string;
  requestId: string;
  requestText: string;
  proServiceId: string;
  serviceText: string;
  seekerUnlocked: boolean;
  proUnlocked: boolean;
  seekerMsgsSent: number;
  proMsgsSent: number;
  whatsappAccepted: boolean;
  createdAt: string;
  isClosed: boolean;
  closedAt: string | null;
};

type ReviewItem = {
  id: string;
  content_type: string;
  content_text: string;
  category: string | null;
  score: number;
  created_at: string;
  expires_at?: string | null;
  status: string;
  resolved_at?: string | null;
  resolution_note?: string | null;
};

type SearchQuota = {
  usageDate: string;
  freeUsed: number;
  paidUsed: number;
  freeLeft: number;
  nextSearchCost: number;
};

type StructuredFilters = {
  category: string;
  location: string;
  budget: string;
  timing: string;
  language: string;
};

type ThreadContext = {
  threadId: string;
  role: "seeker" | "provider";
  isClosed: boolean;
  seekerName: string | null;
  providerName: string | null;
  requestText: string | null;
  serviceText: string | null;
};

const EMPTY_FILTERS: StructuredFilters = {
  category: "",
  location: "",
  budget: "",
  timing: "",
  language: "",
};

function parseWhatsApp(text: string) {
  if (!text?.startsWith("WHATSAPP|")) return null;
  const parts = text.split("|");
  if (parts.length < 2) return null;
  const phone = parts[1] || "";
  const msg = parts.slice(2).join("|") || "";
  return { phone, msg };
}

function parseEmail(text: string) {
  if (!text?.startsWith("EMAIL|")) return null;
  const parts = text.split("|");
  if (parts.length < 2) return null;
  const email = parts[1] || "";
  const msg = parts.slice(2).join("|") || "";
  return { email, msg };
}

function waLink(phone: string, msg: string) {
  const encoded = encodeURIComponent(msg || "");
  return `https://wa.me/${phone}?text=${encoded}`;
}

function mailtoLink(email: string, msg: string) {
  const subject = encodeURIComponent("Quikado — continuing our conversation");
  const body = encodeURIComponent(msg || "Hi, I found you on Quikado. Let’s continue here.");
  return `mailto:${email}?subject=${subject}&body=${body}`;
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function getWhyMatched(searchText: string, serviceText: string) {
  const stopwords = new Set([
    "need",
    "want",
    "for",
    "the",
    "and",
    "with",
    "from",
    "this",
    "that",
    "you",
    "your",
    "have",
    "has",
    "are",
    "was",
    "will",
    "can",
    "near",
    "today",
    "help",
    "service",
    "services",
    "looking",
    "needful",
    "please",
    "work",
  ]);

  const promptTokens = tokenize(searchText).filter(
    (t) => t.length >= 3 && !stopwords.has(t)
  );
  const serviceTokens = new Set(tokenize(serviceText));

  const overlap: string[] = [];
  for (const t of promptTokens) {
    if (serviceTokens.has(t) && !overlap.includes(t)) {
      overlap.push(t);
    }
  }

  const reasons: string[] = [];

  if (overlap.length > 0) {
    reasons.push(...overlap.slice(0, 5).map((t) => `Matches "${t}"`));
  }

  const lowerPrompt = searchText.toLowerCase();
  const lowerService = serviceText.toLowerCase();

  if (
    (lowerPrompt.includes("html") && lowerService.includes("html")) ||
    (lowerPrompt.includes("css") && lowerService.includes("css")) ||
    (lowerPrompt.includes("js") && lowerService.includes("js")) ||
    (lowerPrompt.includes("javascript") && lowerService.includes("javascript"))
  ) {
    reasons.push("Same technical keyword overlap");
  }

  if (
    lowerPrompt.includes("today") ||
    lowerPrompt.includes("urgent") ||
    lowerPrompt.includes("asap")
  ) {
    reasons.push("Your request looks urgent");
  }

  if (reasons.length === 0) {
    reasons.push("Basic keyword similarity");
  }

  return reasons.slice(0, 6);
}

function getConfidenceLabel(score: number) {
  if (score >= 10) return "High";
  if (score >= 5) return "Medium";
  return "Basic";
}

function hasAnyFilters(filters: StructuredFilters) {
  return Object.values(filters).some((v) => v.trim().length > 0);
}

function chipLabel(label: string, value: string) {
  return value.trim() ? `${label}: ${value.trim()}` : label;
}

export function AppShell() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [displayName, setDisplayName] = useState<string>("User");

  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [filters, setFilters] = useState<StructuredFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [searchQuota, setSearchQuota] = useState<SearchQuota | null>(null);
  const [searchChargeOpen, setSearchChargeOpen] = useState(false);

  const [matches, setMatches] = useState<MatchCard[]>([]);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const [lastSearchText, setLastSearchText] = useState("");

  const carouselRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const [chatOpen, setChatOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStatus, setChatStatus] = useState<string | null>(null);
  const [sendingMsg, setSendingMsg] = useState(false);
  const [chatLocked, setChatLocked] = useState(false);

  const [threadMeta, setThreadMeta] = useState<{
    seeker_id: string;
    pro_id: string;
    seeker_name: string | null;
    pro_name: string | null;
  } | null>(null);

  const [threadContext, setThreadContext] = useState<ThreadContext | null>(null);

  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffKind, setHandoffKind] = useState<"whatsapp" | "email">("whatsapp");
  const [handoffValue, setHandoffValue] = useState("");
  const [handoffMsg, setHandoffMsg] = useState("");

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const [inboxOpen, setInboxOpen] = useState(false);
  const [inboxTab, setInboxTab] = useState<"open" | "closed">("open");
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxOpenItems, setInboxOpenItems] = useState<InboxItem[]>([]);
  const [inboxClosedItems, setInboxClosedItems] = useState<InboxItem[]>([]);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [inboxHasNew, setInboxHasNew] = useState(false);

  const [creditsOpen, setCreditsOpen] = useState(false);
  const [billingStatus, setBillingStatus] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  const [matchDetailOpen, setMatchDetailOpen] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState<MatchCard | null>(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [pendingReviews, setPendingReviews] = useState<ReviewItem[]>([]);
  const [recentReviews, setRecentReviews] = useState<ReviewItem[]>([]);

  const loadMyReviewQueue = async () => {
    const res = await fetch("/api/moderation/my-queue");
    const json = await res.json().catch(() => null);
    if (!res.ok) return;

    setPendingReviews((json?.pending ?? []) as ReviewItem[]);
    setRecentReviews((json?.recent ?? []) as ReviewItem[]);
  };

  const loadSearchQuota = async () => {
    const res = await fetch("/api/search/quota");
    const json = await res.json().catch(() => null);
    if (!res.ok) return null;

    setSearchQuota(json?.quota ?? null);
    return (json?.quota ?? null) as SearchQuota | null;
  };

  useEffect(() => {
    (async () => {
      try {
        const p = await fetchMyProfile(supabase);
        setProfile(p);
        setLoading(false);

        document.documentElement.classList.toggle("dark", p.theme === "dark");
        setDisplayName(p.display_name ?? (p.email ?? "User").split("@")[0]);

        await loadMyReviewQueue();
        await loadSearchQuota();
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    })();
  }, [supabase]);

  const setTheme = async (nextTheme: "dark" | "light") => {
    setProfile((prev) => (prev ? { ...prev, theme: nextTheme } : prev));
    document.documentElement.classList.toggle("dark", nextTheme === "dark");

    try {
      await updateMyProfile(supabase, { theme: nextTheme });
    } catch (e) {
      console.error(e);
    }
  };

  const setMode = async (nextMode: "find" | "offer") => {
    if (!profile) return;

    setProfile({ ...profile, mode_default: nextMode });
    await updateMyProfile(supabase, { mode_default: nextMode });

    track(EVENTS.MODE_CHANGED, {
      mode: nextMode,
      source: "topbar-toggle",
    });

    setStatus(null);
    setMatches([]);
    setLastRequestId(null);
    setLastSearchText("");

    setChatOpen(false);
    setActiveThreadId(null);
    setChatMessages([]);
    setChatInput("");
    setChatStatus(null);
    setChatLocked(false);
    setThreadMeta(null);
    setThreadContext(null);

    setInboxOpen(false);
    setMatchDetailOpen(false);
    setSelectedMatch(null);

    await loadSearchQuota();
  };

  const signOut = async () => {
    resetAnalytics();
    await supabase.auth.signOut();
    window.location.reload();
  };

  const updateCarouselArrows = () => {
    const el = carouselRef.current;
    if (!el) return;
    const left = el.scrollLeft;
    const maxLeft = el.scrollWidth - el.clientWidth;
    setCanLeft(left > 2);
    setCanRight(left < maxLeft - 2);
  };

  useEffect(() => {
    updateCarouselArrows();
  }, [matches]);

  const scrollCarousel = (dir: "left" | "right") => {
    const el = carouselRef.current;
    if (!el) return;
    const delta = Math.round(el.clientWidth * 0.7) * (dir === "left" ? -1 : 1);
    el.scrollBy({ left: delta, behavior: "smooth" });
    setTimeout(updateCarouselArrows, 250);
  };

  const runSubmit = async (skipPaidSearchPrompt = false) => {
    if (!profile) return;

    setStatus(null);
    setMatches([]);
    setLastRequestId(null);

    const text = prompt.trim();
    if (text.length < 3) {
      setStatus("Please type a bit more.");
      return;
    }

    if (profile.mode_default === "find" && !skipPaidSearchPrompt) {
      const quota = await loadSearchQuota();
      if (quota && quota.nextSearchCost > 0) {
        setSearchChargeOpen(true);
        return;
      }
    }

    try {
      setSubmitting(true);

      const payload = {
        mode: profile.mode_default,
        text,
        structured: hasAnyFilters(filters) ? filters : null,
      };

      if (profile.mode_default === "find") {
        track(EVENTS.MATCH_REQUESTED, {
          mode: "find",
          category: filters.category || null,
          city: filters.location || null,
          language: filters.language || null,
          budget: filters.budget || null,
          timing: filters.timing || null,
        });
      }

      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 202 && json?.review) {
        await loadMyReviewQueue();
        setStatus(json?.error ?? "This submission is under review.");
        setPrompt("");
        return;
      }

      if (res.status === 402 && json?.needsCredits) {
        if (json?.quota) setSearchQuota(json.quota);
        setStatus(json?.error ?? "This search needs 5 credits.");
        setCreditsOpen(true);
        return;
      }

      if (!res.ok) {
        setStatus(json?.error ?? "Something went wrong.");
        return;
      }

      setPrompt("");

      if (profile.mode_default === "offer") {
        track(EVENTS.OFFER_SUBMITTED, {
          mode: "offer",
          category: filters.category || null,
          city: filters.location || null,
          language: filters.language || null,
          budget: filters.budget || null,
          timing: filters.timing || null,
        });

        setStatus("Service saved ✅ (matching happens when seekers search)");
        return;
      }

      setLastSearchText(text);

      if (json?.billing?.quota) {
        setSearchQuota(json.billing.quota);
      } else {
        await loadSearchQuota();
      }

      if (typeof json?.billing?.credits === "number") {
        setProfile((prev) =>
          prev ? { ...prev, credits: json.billing.credits } : prev
        );
      }

      const requestId = json?.data?.id as string | undefined;
      if (!requestId) {
        setStatus("Request saved ✅ (but requestId missing).");
        return;
      }

      setLastRequestId(requestId);

      track(EVENTS.FIND_SUBMITTED, {
        mode: "find",
        request_id: requestId,
        category: filters.category || null,
        city: filters.location || null,
        language: filters.language || null,
        budget: filters.budget || null,
        timing: filters.timing || null,
      });

      const chargedCredits = json?.billing?.chargedCredits ?? 0;

      if (chargedCredits > 0) {
        track(EVENTS.SEARCH_CHARGED, {
          charge_type: "search",
          credits_spent: chargedCredits,
          free_quota_exhausted: true,
        });
      }

      setStatus(
        chargedCredits > 0
          ? `Search submitted. 5 credits used. Finding matches…`
          : "Finding matches…"
      );

      const mRes = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId }),
      });

      const mJson = await mRes.json().catch(() => null);
      if (!mRes.ok) {
        setStatus(mJson?.error ?? "Matching failed.");
        return;
      }

      const apiMatches = (mJson?.matches ?? []) as any[];
      if (apiMatches.length === 0) {
        setStatus("No matches found yet. Try a different request.");
        return;
      }

      const cards: MatchCard[] = apiMatches.map((m) => ({
        rank: m.rank,
        score: Number(m.score ?? 0),
        pro_service_id: m.pro_service_id,
        pro_user_id: m.pro_user_id,
        service_text: m.service_text ?? "Service details not available",
        reasons: m.reasons ?? [],
      }));

      setMatches(cards);

      track(EVENTS.MATCH_RESULTS_VIEWED, {
        mode: "find",
        request_id: requestId,
        match_count: cards.length,
      });

      setStatus(`Top ${cards.length} matches found ✅`);

      setTimeout(() => {
        if (carouselRef.current) {
          carouselRef.current.scrollTo({ left: 0, behavior: "smooth" });
        }
        updateCarouselArrows();
      }, 50);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async () => {
    await runSubmit(false);
  };

  const loadThreadMeta = async (threadId: string) => {
    const { data, error } = await supabase
      .from("chat_threads")
      .select("seeker_id, pro_id, seeker_name, pro_name")
      .eq("id", threadId)
      .single();

    if (!error && data) {
      setThreadMeta(data as any);
    }
  };

  const loadThreadContext = async (threadId: string) => {
    const res = await fetch(`/api/chat/thread-context?threadId=${threadId}`);
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      setThreadContext(null);
      return;
    }

    setThreadContext((json?.context ?? null) as ThreadContext | null);
  };

  const loadMessages = async (threadId: string) => {
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, text, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (error) {
      setChatStatus("Could not load messages.");
      return;
    }
    setChatMessages((data ?? []) as any);
  };

  useEffect(() => {
    if (!activeThreadId || !chatOpen) return;

    const channel = supabase
      .channel(`thread-${activeThreadId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `thread_id=eq.${activeThreadId}`,
        },
        (payload) => {
          const m = payload.new as any;
          setChatMessages((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev;
            return [...prev, m];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeThreadId, chatOpen, supabase]);

  const openChatAsSeeker = async (m: MatchCard) => {
    if (!profile || !lastRequestId) return;

    setChatStatus(null);
    setChatLocked(false);

    track(EVENTS.CHAT_UNLOCK_STARTED, {
      unlock_side: "seeker",
      request_id: lastRequestId,
      pro_service_id: m.pro_service_id,
      pro_user_id: m.pro_user_id ?? null,
    });

    const res = await fetch("/api/chat/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: lastRequestId, proServiceId: m.pro_service_id }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setChatStatus(json?.error ?? "Could not open chat.");
      return;
    }

    if (typeof json?.credits === "number") {
      setProfile((p) => (p ? { ...p, credits: json.credits } : p));
    }

    const threadId = json?.threadId as string | undefined;
    if (!threadId) return;

    track(EVENTS.CHAT_UNLOCK_SUCCEEDED, {
      unlock_side: "seeker",
      thread_id: threadId,
      request_id: lastRequestId,
      pro_service_id: m.pro_service_id,
      pro_user_id: m.pro_user_id ?? null,
    });

    setActiveThreadId(threadId);
    setChatOpen(true);
    setMatchDetailOpen(false);

    await loadThreadMeta(threadId);
    await loadThreadContext(threadId);
    await loadMessages(threadId);
  };

  const openChatAsProvider = async (threadId: string) => {
    if (!profile) return;

    setChatStatus(null);
    setChatLocked(false);

    track(EVENTS.CHAT_UNLOCK_STARTED, {
      unlock_side: "provider",
      thread_id: threadId,
    });

    const res = await fetch("/api/chat/open-provider", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setChatStatus(json?.error ?? "Could not open provider chat.");
      return;
    }

    if (typeof json?.credits === "number") {
      setProfile((p) => (p ? { ...p, credits: json.credits } : p));
    }

    track(EVENTS.CHAT_UNLOCK_SUCCEEDED, {
      unlock_side: "provider",
      thread_id: threadId,
    });

    setActiveThreadId(threadId);
    setChatOpen(true);

    await loadThreadMeta(threadId);
    await loadThreadContext(threadId);
    await loadMessages(threadId);
  };

  const sendChatMessage = async () => {
    if (!activeThreadId) return;
    const t = chatInput.trim();
    if (!t) return;

    setChatStatus(null);
    setSendingMsg(true);

    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: activeThreadId, text: t }),
      });

      const json = await res.json().catch(() => null);

      if (res.status === 202 && json?.review) {
        await loadMyReviewQueue();
        setChatStatus(json?.error ?? "This message is under review.");
        setChatInput("");
        return;
      }

      if (!res.ok) {
        setChatStatus(json?.error ?? "Message failed.");
        if (res.status === 429) {
          setChatLocked(true);
          setHandoffOpen(true);
        }
        return;
      }

      track(EVENTS.MESSAGE_SENT, {
        thread_id: activeThreadId,
        message_length: t.length,
        is_limited_chat: true,
      });

      setChatInput("");

      if (json?.limitReached) {
        setChatLocked(true);
        setChatStatus("Message limit reached. Continue via WhatsApp or Email.");
        setHandoffOpen(true);
      }
    } finally {
      setSendingMsg(false);
    }
  };

  const submitHandoff = async () => {
    if (!activeThreadId) return;

    const value = handoffValue.trim();
    if (!value) {
      setChatStatus("Please enter WhatsApp number or Email.");
      return;
    }

    const res = await fetch("/api/chat/share-contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: activeThreadId,
        kind: handoffKind,
        value,
        message: handoffMsg.trim(),
      }),
    });

    const json = await res.json().catch(() => null);

    if (res.status === 202 && json?.review) {
      await loadMyReviewQueue();
      setHandoffOpen(false);
      setChatStatus(json?.error ?? "This contact message is under review.");
      return;
    }

    if (!res.ok) {
      setChatStatus(json?.error ?? "Could not share contact.");
      return;
    }

    setHandoffOpen(false);
    setChatStatus("Contact shared ✅ Continue there.");
  };

  const fetchInbox = async (tab: "open" | "closed") => {
    setInboxLoading(true);
    setInboxError(null);

    const res = await fetch("/api/chat/inbox");
    const json = await res.json().catch(() => null);

    setInboxLoading(false);

    if (!res.ok) {
      setInboxError(json?.error ?? "Failed to load inbox.");
      return;
    }

    setInboxOpenItems((json?.open ?? []) as InboxItem[]);
    setInboxClosedItems((json?.closed ?? []) as InboxItem[]);
    setInboxTab(tab);
  };

  const openInbox = async () => {
    track(EVENTS.PROVIDER_INBOX_VIEWED, {
      tab: "open",
      source: "app-shell",
    });

    setInboxHasNew(false);
    setInboxOpen(true);
    setMobileNavOpen(false);
    await fetchInbox("open");
  };

  const openSaved = async () => {
    setInboxHasNew(false);
    setInboxOpen(true);
    setMobileNavOpen(false);
    await fetchInbox("closed");
  };

  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel(`inbox-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_threads",
          filter: `pro_id=eq.${profile.id}`,
        },
        async () => {
          if (inboxOpen) await fetchInbox(inboxTab);
          else setInboxHasNew(true);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_threads",
          filter: `pro_id=eq.${profile.id}`,
        },
        async () => {
          if (inboxOpen) await fetchInbox(inboxTab);
          else setInboxHasNew(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, inboxOpen, inboxTab, supabase]);

  const closeAndDeleteChat = async () => {
    if (!activeThreadId) return;

    const res = await fetch("/api/chat/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: activeThreadId }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setChatStatus(json?.error ?? "Could not close chat.");
      return;
    }

    setChatOpen(false);
    setActiveThreadId(null);
    setChatMessages([]);
    setChatInput("");
    setChatLocked(false);
    setThreadMeta(null);
    setThreadContext(null);

    if (inboxOpen) await fetchInbox(inboxTab);
  };

  const loadRazorpayScript = () =>
    new Promise<boolean>((resolve) => {
      if (typeof window === "undefined") return resolve(false);
      if (window.Razorpay) return resolve(true);

      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.body.appendChild(s);
    });

  const startPurchase = async (packId: "PACK_50" | "PACK_100") => {
    setBillingStatus(null);
    setBillingLoading(true);

    const packMeta =
      packId === "PACK_50"
        ? { credits_to_add: 50, amount: 59 }
        : { credits_to_add: 100, amount: 119 };

    track(EVENTS.PAYMENT_CHECKOUT_STARTED, {
      pack_id: packId,
      credits_to_add: packMeta.credits_to_add,
      amount: packMeta.amount,
    });

    const ok = await loadRazorpayScript();
    if (!ok) {
      setBillingLoading(false);
      setBillingStatus("Razorpay script failed to load.");
      return;
    }

    const res = await fetch("/api/billing/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setBillingLoading(false);
      setBillingStatus(json?.error ?? "Order creation failed.");
      return;
    }

    const { order, razorpayKeyId, pack } = json;

    const options = {
      key: razorpayKeyId,
      amount: order.amount,
      currency: order.currency,
      name: "Quikado",
      description: pack.label,
      order_id: order.id,
      handler: async (response: any) => {
        const vRes = await fetch("/api/billing/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });

        const vJson = await vRes.json().catch(() => null);
        if (!vRes.ok) {
          setBillingStatus(vJson?.error ?? "Payment verification failed.");
          return;
        }

        setProfile((p) => (p ? { ...p, credits: vJson.credits } : p));
        setBillingStatus("Credits added ✅");
        setCreditsOpen(false);
      },
      modal: {
        ondismiss: () => {
          setBillingLoading(false);
        },
      },
      theme: { color: "#3a29a6" },
    };

    setBillingLoading(false);
    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  const myName = displayName || "You";
  const otherName =
    threadMeta &&
    (profile?.id === threadMeta.seeker_id
      ? threadMeta.pro_name || "Professional"
      : threadMeta.seeker_name || "Seeker");

  if (loading) return <div className="p-6">Loading…</div>;
  if (!profile) return <div className="p-6">No profile found.</div>;

  return (
    <>
      <PostHogIdentify
        isLoaded={!loading}
        userId={profile.id}
        email={profile.email ?? null}
        fullName={profile.display_name ?? null}
        mode={profile.mode_default}
        credits={profile.credits}
      />

      <div className="flex min-h-screen bg-background text-foreground md:h-screen">
        <div className="hidden md:block">
          <Sidebar
            sidebarOpen={sidebarOpen}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            theme={profile.theme}
            onToggleTheme={setTheme}
            credits={profile.credits}
            onOpenCredits={() => {
              setBillingStatus(null);
              setCreditsOpen(true);
            }}
            onSignOut={signOut}
            onOpenInbox={openInbox}
            onOpenSaved={openSaved}
            inboxHasNew={inboxHasNew}
          />
        </div>

        <div className="relative flex min-h-screen flex-1 flex-col md:h-screen">
          <div className="flex h-14 items-center justify-between border-b px-3 sm:px-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl md:hidden"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>

              <div className="hidden text-sm text-muted-foreground md:block">
                {profile.mode_default === "find" ? "Find services" : "Offer services"}
              </div>
            </div>

            <Tabs value={profile.mode_default} onValueChange={(v) => setMode(v as any)}>
              <TabsList className="rounded-full">
                <TabsTrigger value="find" className="rounded-full px-3 sm:px-4">
                  Find
                </TabsTrigger>
                <TabsTrigger value="offer" className="rounded-full px-3 sm:px-4">
                  Offer
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="w-[40px] md:w-[180px]" />
          </div>

          <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 md:py-0">
            <div className="w-full max-w-[760px] pb-24 sm:pb-20">
              <div className="mb-4 text-left">
                <div className="text-sm text-muted-foreground">Hi, {displayName} 👋</div>
                <h2 className="mt-1 text-2xl font-semibold sm:text-3xl">
                  Where should we start?
                </h2>
              </div>

              <Card className="rounded-2xl p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    className="min-h-[64px] w-full resize-none bg-transparent text-sm outline-none sm:text-base"
                    placeholder={
                      profile.mode_default === "find"
                        ? "Describe what you need…"
                        : "Describe what service you offer…"
                    }
                  />

                  <div className="flex items-center justify-end gap-2">
                    <AudioRecorder
                      onTranscript={(text) => {
                        setPrompt((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
                      }}
                      onStatus={(msg) => setStatus(msg)}
                    />

                    <Button className="rounded-xl" onClick={handleSend} disabled={submitting}>
                      {submitting ? "Sending…" : "Send"}
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => setFiltersOpen(true)}
                  >
                    {chipLabel("Category", filters.category)}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => setFiltersOpen(true)}
                  >
                    {chipLabel("Location", filters.location)}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => setFiltersOpen(true)}
                  >
                    {chipLabel("Budget", filters.budget)}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => setFiltersOpen(true)}
                  >
                    {chipLabel("Time", filters.timing)}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="rounded-full"
                    onClick={() => setFiltersOpen(true)}
                  >
                    {chipLabel("Language", filters.language)}
                  </Button>

                  {hasAnyFilters(filters) && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => setFilters(EMPTY_FILTERS)}
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </Card>

              <div className="mt-2 text-center text-xs text-muted-foreground">
                Legal services only. Unsafe or illegal requests are blocked.
              </div>

              {profile.mode_default === "find" && searchQuota && (
                <div className="mt-2 text-center text-xs text-muted-foreground">
                  3 free searches/day · Free left today: {searchQuota.freeLeft} · Then 5
                  credits/search
                </div>
              )}

              {status && (
                <div className="mt-2 text-center text-xs text-muted-foreground">
                  {status}
                </div>
              )}

              {pendingReviews.length > 0 && (
                <div className="mt-3 rounded-2xl border p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium">Under review</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {pendingReviews.length} item(s) are waiting for moderation review.
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      className="rounded-xl"
                      onClick={() => {
                        track(EVENTS.MODERATION_UNDER_REVIEW_VIEWED, {
                          source: "pending-review-card",
                        });
                        setReviewOpen(true);
                      }}
                    >
                      View status
                    </Button>
                  </div>
                </div>
              )}

              {matches.length > 0 && (
                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-medium">Top {matches.length} matches</div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="icon"
                        className="rounded-xl"
                        onClick={() => scrollCarousel("left")}
                        disabled={!canLeft}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="rounded-xl"
                        onClick={() => scrollCarousel("right")}
                        disabled={!canRight}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div
                    ref={carouselRef}
                    onScroll={updateCarouselArrows}
                    className="flex gap-3 overflow-x-auto pb-2"
                    style={{ scrollbarWidth: "thin" }}
                  >
                    {matches.map((m) => {
                      const reasons =
                        m.reasons && m.reasons.length > 0
                          ? m.reasons
                          : getWhyMatched(lastSearchText, m.service_text);
                      const confidence = getConfidenceLabel(m.score);

                      return (
                        <div
                          key={m.pro_service_id}
                          className="w-[280px] shrink-0 rounded-2xl border p-4 sm:w-[320px] md:w-[340px]"
                        >
                          <div className="text-sm font-semibold">
                            Match #{m.rank}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {confidence} fit · score {m.score}
                            </span>
                          </div>

                          <div className="mt-2 text-sm text-muted-foreground line-clamp-3">
                            {m.service_text}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            {reasons.slice(0, 3).map((r) => (
                              <span
                                key={r}
                                className="rounded-full border px-2 py-1 text-[11px] text-muted-foreground"
                              >
                                {r}
                              </span>
                            ))}
                          </div>

                          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <Button
                              variant="secondary"
                              className="rounded-xl"
                              onClick={() => {
                                track(EVENTS.MATCH_DETAIL_OPENED, {
                                  pro_service_id: m.pro_service_id,
                                  pro_user_id: m.pro_user_id ?? null,
                                  rank: m.rank,
                                  score: m.score,
                                });

                                setSelectedMatch(m);
                                setMatchDetailOpen(true);
                              }}
                            >
                              Tap to open
                            </Button>

                            <Button className="rounded-xl" onClick={() => openChatAsSeeker(m)}>
                              Quick unlock
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-2 text-center text-xs text-muted-foreground">
                    Tap a match to see why it matched and unlock from there.
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="absolute bottom-4 left-0 right-0 px-4 text-center text-xs text-muted-foreground sm:left-auto sm:right-6 sm:px-0 sm:text-right">
            <div className="flex items-center justify-center gap-4 sm:justify-end">
              <a className="hover:underline" href="/privacy">
                Privacy
              </a>
              <a className="hover:underline" href="/terms">
                Terms
              </a>
              <a className="hover:underline" href="/help">
                Help
              </a>
            </div>
          </div>

          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent side="left" className="w-[88vw] max-w-[320px]">
              <SheetHeader>
                <SheetTitle>Quikado</SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-3">
                <Button
                  variant="ghost"
                  className="w-full justify-start rounded-xl"
                  onClick={openInbox}
                >
                  <div className="relative mr-2">
                    <Inbox className="h-4 w-4" />
                    {inboxHasNew && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                  Inbox
                </Button>

                <Button
                  variant="ghost"
                  className="w-full justify-start rounded-xl"
                  onClick={openSaved}
                >
                  <Star className="mr-2 h-4 w-4" />
                  Saved
                </Button>

                <Button
                  variant="secondary"
                  className="w-full justify-start rounded-xl"
                  onClick={() => {
                    setBillingStatus(null);
                    setCreditsOpen(true);
                    setMobileNavOpen(false);
                  }}
                >
                  <CreditCard className="mr-2 h-4 w-4" />
                  Credits: {profile.credits}
                </Button>

                {profile.mode_default === "find" && searchQuota ? (
                  <div className="rounded-2xl border p-3 text-xs text-muted-foreground">
                    Free left today: {searchQuota.freeLeft}
                    <div className="mt-1">Then 5 credits/search</div>
                  </div>
                ) : null}

                {pendingReviews.length > 0 && (
                  <Button
                    variant="secondary"
                    className="w-full justify-start rounded-xl"
                    onClick={() => {
                      track(EVENTS.MODERATION_UNDER_REVIEW_VIEWED, {
                        source: "mobile-nav",
                      });
                      setReviewOpen(true);
                      setMobileNavOpen(false);
                    }}
                  >
                    Under review ({pendingReviews.length})
                  </Button>
                )}

                <div className="rounded-2xl border p-3">
                  <div className="mb-3 text-sm font-medium">Theme</div>
                  <div className="flex gap-2">
                    <Button
                      variant={profile.theme === "light" ? "default" : "secondary"}
                      className="flex-1 rounded-xl"
                      onClick={() => setTheme("light")}
                    >
                      <Sun className="mr-2 h-4 w-4" />
                      Light
                    </Button>
                    <Button
                      variant={profile.theme === "dark" ? "default" : "secondary"}
                      className="flex-1 rounded-xl"
                      onClick={() => setTheme("dark")}
                    >
                      <Moon className="mr-2 h-4 w-4" />
                      Dark
                    </Button>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  className="w-full justify-start rounded-xl"
                  onClick={signOut}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Search / service filters</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Category</div>
                  <Input
                    value={filters.category}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, category: e.target.value }))
                    }
                    placeholder="e.g. Web design, Plumbing, Tutor"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Location</div>
                  <Input
                    value={filters.location}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, location: e.target.value }))
                    }
                    placeholder="e.g. Kolkata, Remote, Chennai"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Budget</div>
                  <Input
                    value={filters.budget}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, budget: e.target.value }))
                    }
                    placeholder="e.g. ₹500-₹2000, Flexible"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Time</div>
                  <Input
                    value={filters.timing}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, timing: e.target.value }))
                    }
                    placeholder="e.g. Today, Tomorrow, Flexible"
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs text-muted-foreground">Language</div>
                  <Input
                    value={filters.language}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, language: e.target.value }))
                    }
                    placeholder="e.g. Hindi, English, Bengali"
                  />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="secondary"
                    className="rounded-xl"
                    onClick={() => setFilters(EMPTY_FILTERS)}
                  >
                    Clear all
                  </Button>
                  <Button className="rounded-xl" onClick={() => setFiltersOpen(false)}>
                    Save filters
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={searchChargeOpen} onOpenChange={setSearchChargeOpen}>
            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>This search will use 5 credits</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  You have used your 3 free searches for today.
                </div>

                <div className="rounded-xl border p-3 text-xs text-muted-foreground">
                  We charge credits to keep Quikado live, moderated, and secure. This paid
                  search will use 5 credits.
                </div>

                <div className="text-sm text-muted-foreground">
                  Current credits:{" "}
                  <span className="font-medium text-foreground">{profile.credits}</span>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="secondary"
                    className="rounded-xl"
                    onClick={() => setSearchChargeOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="rounded-xl"
                    onClick={async () => {
                      setSearchChargeOpen(false);
                      await runSubmit(true);
                    }}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-[640px]">
              <DialogHeader>
                <DialogTitle>Moderation status</DialogTitle>
              </DialogHeader>

              <div className="space-y-6">
                <div>
                  <div className="mb-3 text-sm font-medium">Pending</div>
                  {pendingReviews.length === 0 ? (
                    <div className="rounded-xl border p-3 text-sm text-muted-foreground">
                      No pending review items.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pendingReviews.map((item) => (
                        <div key={item.id} className="rounded-xl border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border px-2 py-1 text-xs">
                              {item.content_type}
                            </span>
                            {item.category ? (
                              <span className="rounded-full border px-2 py-1 text-xs">
                                {item.category}
                              </span>
                            ) : null}
                            <span className="rounded-full border px-2 py-1 text-xs">
                              score {item.score}
                            </span>
                          </div>

                          <div className="mt-3 whitespace-pre-wrap text-sm">
                            {item.content_text}
                          </div>

                          <div className="mt-3 text-xs text-muted-foreground">
                            Expires:{" "}
                            {item.expires_at
                              ? new Date(item.expires_at).toLocaleString()
                              : "-"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-3 text-sm font-medium">Recent results</div>
                  {recentReviews.length === 0 ? (
                    <div className="rounded-xl border p-3 text-sm text-muted-foreground">
                      No recent moderation results.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recentReviews.slice(0, 10).map((item) => (
                        <div key={item.id} className="rounded-xl border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full border px-2 py-1 text-xs">
                              {item.content_type}
                            </span>
                            <span className="rounded-full border px-2 py-1 text-xs">
                              {item.status}
                            </span>
                          </div>

                          <div className="mt-3 whitespace-pre-wrap text-sm">
                            {item.content_text}
                          </div>

                          {item.resolution_note ? (
                            <div className="mt-3 text-xs text-muted-foreground">
                              Note: {item.resolution_note}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={matchDetailOpen} onOpenChange={setMatchDetailOpen}>
            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>Match details</DialogTitle>
              </DialogHeader>

              {selectedMatch && (
                <div className="space-y-4">
                  <div className="rounded-2xl border p-4">
                    <div className="text-sm font-semibold">
                      Match #{selectedMatch.rank}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {getConfidenceLabel(selectedMatch.score)} fit · score{" "}
                        {selectedMatch.score}
                      </span>
                    </div>

                    <div className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
                      {selectedMatch.service_text}
                    </div>
                  </div>

                  <div className="rounded-2xl border p-4">
                    <div className="text-sm font-medium">Why this matched</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(selectedMatch.reasons && selectedMatch.reasons.length > 0
                        ? selectedMatch.reasons
                        : getWhyMatched(lastSearchText, selectedMatch.service_text)
                      ).map((reason) => (
                        <span
                          key={reason}
                          className="rounded-full border px-3 py-1 text-xs text-muted-foreground"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 text-xs text-muted-foreground">
                      This is the current explanation based on keyword overlap,
                      structured filters, location/language hints, and request intent.
                    </div>
                  </div>

                  <div className="rounded-2xl border p-4">
                    <div className="text-sm font-medium">Unlock</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Opening this chat costs 10 credits. The provider will also need to
                      unlock on their side.
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <Button
                        variant="secondary"
                        className="rounded-xl"
                        onClick={() => setMatchDetailOpen(false)}
                      >
                        Close
                      </Button>
                      <Button
                        className="rounded-xl"
                        onClick={() => openChatAsSeeker(selectedMatch)}
                      >
                        Unlock & Open Chat
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Sheet open={inboxOpen} onOpenChange={setInboxOpen}>
            <SheetContent side="right" className="w-[100vw] sm:max-w-[520px]">
              <SheetHeader>
                <SheetTitle>Provider Inbox</SheetTitle>
              </SheetHeader>

              <div className="mt-3 flex gap-2">
                <Button
                  variant={inboxTab === "open" ? "default" : "secondary"}
                  className="rounded-xl"
                  onClick={() => fetchInbox("open")}
                >
                  Open
                </Button>
                <Button
                  variant={inboxTab === "closed" ? "default" : "secondary"}
                  className="rounded-xl"
                  onClick={() => fetchInbox("closed")}
                >
                  Closed
                </Button>

                <div className="flex-1" />
                <Button
                  variant="ghost"
                  className="rounded-xl"
                  onClick={() => fetchInbox(inboxTab)}
                >
                  Refresh
                </Button>
              </div>

              {inboxLoading && (
                <div className="mt-4 text-sm text-muted-foreground">Loading…</div>
              )}
              {inboxError && (
                <div className="mt-4 text-sm text-muted-foreground">{inboxError}</div>
              )}

              {!inboxLoading && !inboxError && (
                <div className="mt-4 space-y-3">
                  {(inboxTab === "open" ? inboxOpenItems : inboxClosedItems).length ===
                  0 ? (
                    <div className="text-sm text-muted-foreground">
                      {inboxTab === "open"
                        ? "No open chats yet."
                        : "No closed chats yet."}
                    </div>
                  ) : (
                    (inboxTab === "open" ? inboxOpenItems : inboxClosedItems).map((t) => (
                      <div key={t.threadId} className="rounded-2xl border p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border px-2 py-1 text-xs">
                            You are the provider
                          </span>
                          <span className="rounded-full border px-2 py-1 text-xs">
                            {t.isClosed ? "Closed thread" : "Active thread"}
                          </span>
                        </div>

                        <div className="mt-3 rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">
                            About the seeker request
                          </div>
                          <div className="mt-1 text-sm font-medium">
                            Request from {t.seekerName}
                          </div>
                          <div className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                            {t.requestText || "(request details unavailable)"}
                          </div>
                        </div>

                        <div className="mt-3 rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">
                            Matched with your offered service
                          </div>
                          <div className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                            {t.serviceText || "(service details unavailable)"}
                          </div>
                        </div>

                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="text-xs text-muted-foreground">
                            {t.isClosed ? "Closed" : t.proUnlocked ? "Unlocked" : "Locked"}{" "}
                            · Contact: {t.whatsappAccepted ? "shared" : "not shared"}
                          </div>

                          {!t.isClosed ? (
                            <Button
                              className="rounded-xl"
                              variant={t.proUnlocked ? "default" : "secondary"}
                              onClick={async () => {
                                setInboxOpen(false);
                                await openChatAsProvider(t.threadId);
                              }}
                            >
                              {t.proUnlocked
                                ? "Open provider chat"
                                : "Unlock provider chat (10)"}
                            </Button>
                          ) : (
                            <Button className="rounded-xl" variant="secondary" disabled>
                              Closed
                            </Button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </SheetContent>
          </Sheet>

          <Sheet open={chatOpen} onOpenChange={setChatOpen}>
            <SheetContent side="right" className="w-[100vw] sm:max-w-[460px]">
              <SheetHeader>
                <SheetTitle>Chat</SheetTitle>
              </SheetHeader>

              {threadContext && (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border px-2 py-1 text-xs">
                      {threadContext.role === "seeker"
                        ? "You are the seeker"
                        : "You are the provider"}
                    </span>
                    <span className="rounded-full border px-2 py-1 text-xs">
                      {threadContext.isClosed ? "Closed thread" : "Active thread"}
                    </span>
                  </div>

                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-muted-foreground">
                      {threadContext.role === "seeker"
                        ? "About your request"
                        : "About the seeker request"}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                      {threadContext.requestText || "(request details unavailable)"}
                    </div>
                  </div>

                  <div className="rounded-xl border p-3">
                    <div className="text-xs text-muted-foreground">
                      {threadContext.role === "provider"
                        ? "About your offered service"
                        : "About the matched service"}
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                      {threadContext.serviceText || "(service details unavailable)"}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 flex justify-end">
                <Button
                  variant="secondary"
                  className="rounded-xl"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  Work done & delete
                </Button>
              </div>

              <div className="mt-4 h-[50vh] overflow-auto rounded-xl border p-3 space-y-3">
                {chatMessages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No messages yet.</div>
                ) : (
                  chatMessages.map((m) => {
                    const wa = parseWhatsApp(m.text);
                    if (wa) {
                      return (
                        <div key={m.id} className="rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">
                            WhatsApp shared
                          </div>
                          <div className="mt-1 text-sm font-medium">+{wa.phone}</div>
                          {wa.msg ? (
                            <div className="mt-1 text-sm text-muted-foreground">
                              {wa.msg}
                            </div>
                          ) : null}
                          <div className="mt-3">
                            <a
                              className="inline-flex rounded-xl bg-primary px-4 py-2 text-primary-foreground"
                              href={waLink(wa.phone, wa.msg)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() =>
                                track(EVENTS.CONTACT_WHATSAPP_CLICKED, {
                                  thread_id: activeThreadId,
                                  source: "chat-message",
                                })
                              }
                            >
                              Open WhatsApp
                            </a>
                          </div>
                        </div>
                      );
                    }

                    const em = parseEmail(m.text);
                    if (em) {
                      return (
                        <div key={m.id} className="rounded-xl border p-3">
                          <div className="text-xs text-muted-foreground">Email shared</div>
                          <div className="mt-1 text-sm font-medium">{em.email}</div>
                          {em.msg ? (
                            <div className="mt-1 text-sm text-muted-foreground">
                              {em.msg}
                            </div>
                          ) : null}
                          <div className="mt-3">
                            <a
                              className="inline-flex rounded-xl bg-primary px-4 py-2 text-primary-foreground"
                              href={mailtoLink(em.email, em.msg)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() =>
                                track(EVENTS.CONTACT_EMAIL_CLICKED, {
                                  thread_id: activeThreadId,
                                  source: "chat-message",
                                })
                              }
                            >
                              Open Email
                            </a>
                          </div>
                        </div>
                      );
                    }

                    const senderLabel = m.sender_id === profile.id ? myName : otherName ?? "Other";
                    return (
                      <div key={m.id} className="text-sm">
                        <div className="text-xs text-muted-foreground">{senderLabel}</div>
                        <div className="mt-1 whitespace-pre-wrap">{m.text}</div>
                      </div>
                    );
                  })
                )}
              </div>

              {chatStatus && (
                <div className="mt-3 text-xs text-muted-foreground">{chatStatus}</div>
              )}

              {chatLocked && (
                <div className="mt-3 rounded-xl border p-3 text-sm">
                  <div className="font-medium">Continue outside Quikado</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    We limit in-app chats to reduce misuse and keep the platform safe.
                    Share WhatsApp or Email only if you’re comfortable.
                  </div>
                  <div className="mt-3">
                    <Button className="rounded-xl" onClick={() => setHandoffOpen(true)}>
                      Share WhatsApp / Email
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="min-h-[44px] resize-none rounded-xl"
                  placeholder={
                    chatLocked
                      ? "Chat locked. Use WhatsApp or Email."
                      : "Type message… (2 messages max)"
                  }
                  disabled={sendingMsg || chatLocked}
                />
                <Button
                  className="rounded-xl"
                  onClick={sendChatMessage}
                  disabled={sendingMsg || chatLocked}
                >
                  {sendingMsg ? "…" : "Send"}
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          <Dialog open={handoffOpen} onOpenChange={setHandoffOpen}>
            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Share contact to continue</DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="text-xs text-muted-foreground">
                  Why this exists: Quikado limits in-app messages to reduce illegal/abusive
                  use. You can continue on WhatsApp or Email if you choose.
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={handoffKind === "whatsapp" ? "default" : "secondary"}
                    className="rounded-xl"
                    onClick={() => setHandoffKind("whatsapp")}
                  >
                    WhatsApp
                  </Button>
                  <Button
                    variant={handoffKind === "email" ? "default" : "secondary"}
                    className="rounded-xl"
                    onClick={() => setHandoffKind("email")}
                  >
                    Email
                  </Button>
                </div>

                <div>
                  <div className="mb-1 text-xs text-muted-foreground">
                    {handoffKind === "whatsapp" ? "WhatsApp number" : "Email address"}
                  </div>
                  <Input
                    value={handoffValue}
                    onChange={(e) => setHandoffValue(e.target.value)}
                    placeholder={
                      handoffKind === "whatsapp"
                        ? "10-digit (India) or country code"
                        : "name@example.com"
                    }
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs text-muted-foreground">
                    Message (optional)
                  </div>
                  <Textarea
                    value={handoffMsg}
                    onChange={(e) => setHandoffMsg(e.target.value)}
                    placeholder="Hi, I found you on Quikado. Let’s continue here."
                  />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="secondary"
                    className="rounded-xl"
                    onClick={() => setHandoffOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button className="rounded-xl" onClick={submitHandoff}>
                    Share
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground">
                  You can delete this chat anytime using “Work done & delete”.
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Delete this chat?</DialogTitle>
              </DialogHeader>

              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  This will close the chat and permanently delete messages (including
                  contact info shared).
                </p>

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="secondary"
                    className="rounded-xl"
                    onClick={() => setConfirmDeleteOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="rounded-xl"
                    onClick={async () => {
                      setConfirmDeleteOpen(false);
                      await closeAndDeleteChat();
                    }}
                  >
                    Confirm delete
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={creditsOpen} onOpenChange={setCreditsOpen}>
            <DialogContent className="max-w-[calc(100vw-2rem)] rounded-2xl sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Buy Credits</DialogTitle>
              </DialogHeader>

              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Current credits:{" "}
                  <span className="font-medium text-foreground">{profile.credits}</span>
                </div>

                <div className="rounded-xl border p-3 text-xs text-muted-foreground">
                  We charge credits to keep Quikado running (servers, moderation,
                  support). Payments are for operations only.
                </div>

                <div className="grid gap-2">
                  <Button
                    className="rounded-xl"
                    disabled={billingLoading}
                    onClick={() => startPurchase("PACK_50")}
                  >
                    Buy 50 credits — ₹59 (+GST as applicable)
                  </Button>
                  <Button
                    className="rounded-xl"
                    disabled={billingLoading}
                    onClick={() => startPurchase("PACK_100")}
                  >
                    Buy 100 credits — ₹119 (+GST as applicable)
                  </Button>
                </div>

                {billingStatus && (
                  <div className="text-xs text-muted-foreground">{billingStatus}</div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </>
  );
}