import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import {
  cleanStructuredInput,
  compareStructuredInputs,
  type StructuredSearchInput,
} from "@/lib/search/structured";

const BodySchema = z.object({
  requestId: z.string().uuid(),
});

function normalizeText(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s₹-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string) {
  const stopwords = new Set([
    "i",
    "me",
    "my",
    "we",
    "our",
    "you",
    "your",
    "he",
    "she",
    "they",
    "them",
    "need",
    "want",
    "looking",
    "for",
    "with",
    "from",
    "the",
    "and",
    "or",
    "to",
    "of",
    "in",
    "on",
    "a",
    "an",
    "is",
    "are",
    "be",
    "it",
    "this",
    "that",
    "please",
    "help",
    "service",
    "services",
    "work",
    "someone",
    "person",
    "near",
    "nearby",
  ]);

  return normalizeText(text)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !stopwords.has(t));
}

function unique<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function extractLocationHints(text: string) {
  const normalized = normalizeText(text);

  const knownLocations = [
    "kolkata",
    "delhi",
    "mumbai",
    "bangalore",
    "bengaluru",
    "hyderabad",
    "chennai",
    "pune",
    "ahmedabad",
    "jaipur",
    "lucknow",
    "patna",
    "indore",
    "surat",
    "bhopal",
    "noida",
    "gurgaon",
    "guwahati",
    "kashmir",
    "srinagar",
    "tamil nadu",
    "kerala",
    "west bengal",
    "bihar",
    "jharkhand",
    "odisha",
    "remote",
    "online",
  ];

  return knownLocations.filter((loc) => normalized.includes(loc));
}

function extractLanguageHints(text: string) {
  const normalized = normalizeText(text);

  const langs = [
    "english",
    "hindi",
    "bengali",
    "bangla",
    "tamil",
    "telugu",
    "malayalam",
    "kannada",
    "marathi",
    "gujarati",
    "punjabi",
    "urdu",
    "odia",
    "assamese",
  ];

  return langs.filter((lang) => normalized.includes(lang));
}

function extractUrgencyHints(text: string) {
  const normalized = normalizeText(text);
  const hints: string[] = [];

  if (/\burgent\b/.test(normalized)) hints.push("urgent");
  if (/\btoday\b/.test(normalized)) hints.push("today");
  if (/\basap\b/.test(normalized)) hints.push("asap");
  if (/\bnow\b/.test(normalized)) hints.push("now");
  if (/\bimmediate\b/.test(normalized)) hints.push("immediate");

  return hints;
}

function extractBudgetHints(text: string) {
  const normalized = normalizeText(text);
  const hints: string[] = [];

  if (/₹\s?\d+/.test(normalized)) hints.push("rupee_budget");
  if (/\b\d+\s?(rs|inr)\b/.test(normalized)) hints.push("rupee_budget");
  if (/\bbudget\b/.test(normalized)) hints.push("budget");

  return unique(hints);
}

function scoreMatch(
  reqText: string,
  proText: string,
  reqStructured: StructuredSearchInput | null,
  proStructured: StructuredSearchInput | null
) {
  const reqNorm = normalizeText(reqText);
  const proNorm = normalizeText(proText);

  const reqTokens = unique(tokenize(reqText));
  const proTokens = new Set(unique(tokenize(proText)));

  let score = 0;
  const reasons: string[] = [];

  const overlap = reqTokens.filter((t) => proTokens.has(t));

  for (const token of overlap) {
    if (token.length >= 5) score += 4;
    else if (token.length >= 3) score += 2;
  }

  if (overlap.length > 0) {
    reasons.push(...overlap.slice(0, 6).map((t) => `Matches "${t}"`));
  }

  const strongPairs = [
    "html",
    "css",
    "javascript",
    "react",
    "node",
    "tailwind",
    "bubble",
    "seo",
    "logo",
    "design",
    "plumber",
    "electrician",
    "tutor",
    "photographer",
    "video editor",
    "wedding",
    "cleaning",
    "repair",
    "delivery",
    "makeup",
    "mehendi",
  ];

  for (const phrase of strongPairs) {
    if (reqNorm.includes(phrase) && proNorm.includes(phrase)) {
      score += 6;
      reasons.push(`Both mention ${phrase}`);
    }
  }

  const reqLoc = extractLocationHints(reqText);
  const proLoc = extractLocationHints(proText);
  const locOverlap = reqLoc.filter((x) => proLoc.includes(x));
  if (locOverlap.length > 0) {
    score += 8;
    reasons.push(`Location fit: ${locOverlap[0]}`);
  }

  if (
    (reqNorm.includes("remote") || reqNorm.includes("online")) &&
    (proNorm.includes("remote") || proNorm.includes("online"))
  ) {
    score += 6;
    reasons.push("Remote/online compatible");
  }

  const reqLang = extractLanguageHints(reqText);
  const proLang = extractLanguageHints(proText);
  const langOverlap = reqLang.filter((x) => proLang.includes(x));
  if (langOverlap.length > 0) {
    score += 5;
    reasons.push(`Language fit: ${langOverlap[0]}`);
  }

  const reqUrgency = extractUrgencyHints(reqText);
  if (reqUrgency.length > 0) {
    score += 2;
    reasons.push("Urgent request");
  }

  const reqBudget = extractBudgetHints(reqText);
  const proBudget = extractBudgetHints(proText);
  if (reqBudget.length > 0 && proBudget.length > 0) {
    score += 2;
    reasons.push("Budget mentioned");
  }

  const structuredCompare = compareStructuredInputs(reqStructured, proStructured);
  score += structuredCompare.score;
  reasons.push(...structuredCompare.reasons);

  if (overlap.length === 0 && score < 6) {
    score -= 4;
  }

  return {
    score,
    reasons: unique(reasons).slice(0, 8),
    overlap,
  };
}

async function supabaseAuthed() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Missing Supabase URL/Anon key");

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {}
        });
      },
    },
  });
}

function base64UrlToJson(b64url: string) {
  try {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const json = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getJwtRole(jwt: string) {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  const payload = base64UrlToJson(parts[1]);
  return payload?.role ?? null;
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const role = getJwtRole(serviceKey);
  if (role !== "service_role") throw new Error("SUPABASE_SERVICE_ROLE_KEY is not service_role");

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  const authed = await supabaseAuthed();
  const admin = supabaseAdmin();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { requestId } = parsed.data;

  const { data: userData } = await authed.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }
  const userId = userData.user.id;

  const { data: reqRow, error: reqErr } = await authed
    .from("seeker_requests")
    .select("id, user_id, raw_text, structured_json")
    .eq("id", requestId)
    .single();

  if (reqErr || !reqRow) {
    return NextResponse.json({ ok: false, error: "Request not found" }, { status: 404 });
  }

  if (reqRow.user_id !== userId) {
    return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
  }

  const { data: pros, error: prosErr } = await admin
    .from("pro_services")
    .select("id, user_id, raw_text, structured_json")
    .eq("is_active", true)
    .limit(500);

  if (prosErr) {
    return NextResponse.json({ ok: false, error: prosErr.message }, { status: 500 });
  }

  const reqStructured = cleanStructuredInput(reqRow.structured_json);

  const scored = (pros ?? []).map((p) => {
    const proStructured = cleanStructuredInput(p.structured_json);
    const result = scoreMatch(
      reqRow.raw_text,
      p.raw_text,
      reqStructured,
      proStructured
    );

    return {
      pro_service_id: p.id,
      pro_user_id: p.user_id,
      service_text: p.raw_text,
      score: result.score,
      reasons: result.reasons,
      overlap: result.overlap,
    };
  });

  const filtered = scored.filter((x) => x.score > 0);

  if (filtered.length === 0) {
    await admin.from("match_results").delete().eq("request_id", requestId);
    return NextResponse.json({ ok: true, matches: [] });
  }

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.overlap.length - a.overlap.length;
  });

  const top10 = filtered.slice(0, 10);

  const top10Store = top10.map((x, idx) => ({
    request_id: requestId,
    pro_service_id: x.pro_service_id,
    score: x.score,
    rank: idx + 1,
  }));

  await admin.from("match_results").delete().eq("request_id", requestId);

  const { error: insErr } = await admin.from("match_results").insert(top10Store);
  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
  }

  const matches = top10.map((x, idx) => ({
    rank: idx + 1,
    score: x.score,
    pro_service_id: x.pro_service_id,
    pro_user_id: x.pro_user_id,
    service_text: x.service_text,
    reasons: x.reasons,
  }));

  return NextResponse.json({ ok: true, matches });
}