import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { moderateText, moderationMessage } from "@/lib/safety/moderation";
import { getReviewExpiryDate } from "@/lib/safety/queue";
import { consumeSearchQuota } from "@/lib/search/quota";
import {
  cleanStructuredInput,
  structuredToModerationText,
} from "@/lib/search/structured";

const StructuredSchema = z.object({
  category: z.string().max(80).optional().nullable(),
  location: z.string().max(80).optional().nullable(),
  budget: z.string().max(80).optional().nullable(),
  timing: z.string().max(80).optional().nullable(),
  language: z.string().max(80).optional().nullable(),
});

const BodySchema = z.object({
  mode: z.enum(["find", "offer"]),
  text: z.string().min(3, "Please write a bit more."),
  structured: StructuredSchema.optional().nullable(),
});

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

async function supabaseServer() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const role = getJwtRole(serviceKey);

  if (role !== "service_role") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not service_role");
  }

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const admin = supabaseAdmin();

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const { mode, text, structured } = parsed.data;
  const structuredInput = cleanStructuredInput(structured);

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
  }

  const userId = userData.user.id;
  const contentType = mode === "find" ? "request" : "service";

  const moderationText = [text, structuredToModerationText(structuredInput)]
    .filter(Boolean)
    .join(" | ");

  const moderation = moderateText(
    moderationText,
    mode === "find" ? "request" : "service"
  );

  if (moderation.verdict === "block") {
    await supabase.from("moderation_logs").insert({
      user_id: userId,
      content_type: contentType,
      content_text: moderationText,
      result: "block",
      flags: JSON.stringify({
        category: moderation.category,
        score: moderation.score,
        reasons: moderation.reasons,
      }),
    });

    return NextResponse.json(
      { ok: false, error: moderationMessage(moderation) },
      { status: 400 }
    );
  }

  if (moderation.verdict === "review") {
    const expiresAt = getReviewExpiryDate(24);

    const { data: queued, error: qErr } = await supabase
      .from("moderation_queue")
      .insert({
        user_id: userId,
        content_type: contentType,
        content_text: moderationText,
        category: moderation.category,
        score: moderation.score,
        reasons: moderation.reasons,
        meta: { mode, structured: structuredInput, rawText: text },
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();

    if (qErr) {
      return NextResponse.json({ ok: false, error: qErr.message }, { status: 500 });
    }

    await supabase.from("moderation_logs").insert({
      user_id: userId,
      content_type: contentType,
      content_text: moderationText,
      result: "review",
      flags: JSON.stringify({
        category: moderation.category,
        score: moderation.score,
        reasons: moderation.reasons,
      }),
    });

    return NextResponse.json(
      {
        ok: false,
        review: true,
        queueId: queued.id,
        expiresAt: queued.expires_at,
        error:
          "This submission is under review before it can go live. Please rewrite it clearly if you want faster approval.",
      },
      { status: 202 }
    );
  }

  if (mode === "offer") {
    const { data, error } = await supabase
      .from("pro_services")
      .insert({
        user_id: userId,
        raw_text: text,
        structured_json: structuredInput,
        is_active: true,
      })
      .select("id, created_at")
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, type: "service", data });
  }

  const { data, error } = await supabase
    .from("seeker_requests")
    .insert({
      user_id: userId,
      raw_text: text,
      structured_json: structuredInput,
      status: "open",
    })
    .select("id, created_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const quotaResult = await consumeSearchQuota(admin, userId);

  if (!quotaResult.ok) {
    await supabase.from("seeker_requests").delete().eq("id", data.id);

    return NextResponse.json(
      {
        ok: false,
        needsCredits: true,
        quota: quotaResult.quota,
        error: quotaResult.error,
      },
      { status: 402 }
    );
  }

  return NextResponse.json({
    ok: true,
    type: "request",
    data,
    billing: {
      chargedCredits: quotaResult.chargedCredits,
      credits: quotaResult.credits,
      quota: quotaResult.quota,
    },
  });
}