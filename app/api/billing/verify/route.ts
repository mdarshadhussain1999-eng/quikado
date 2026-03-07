export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({
  razorpay_order_id: z.string().min(5),
  razorpay_payment_id: z.string().min(5),
  razorpay_signature: z.string().min(5),
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

async function supabaseAuthed() {
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
  if (role !== "service_role") throw new Error("SUPABASE_SERVICE_ROLE_KEY not service_role");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const authed = await supabaseAuthed();
    const admin = supabaseAdmin();

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

    const { data: userData } = await authed.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }
    const userId = userData.user.id;

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return NextResponse.json({ ok: false, error: "Missing Razorpay secret" }, { status: 500 });
    }

    // Verify signature using HMAC SHA256: order_id + "|" + payment_id :contentReference[oaicite:2]{index=2}
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return NextResponse.json({ ok: false, error: "Signature verification failed" }, { status: 400 });
    }

    // Find purchase row
    const { data: purchase, error: pErr } = await admin
      .from("credit_purchases")
      .select("id, user_id, credits, status")
      .eq("razorpay_order_id", razorpay_order_id)
      .single();

    if (pErr || !purchase) {
      return NextResponse.json({ ok: false, error: "Order not found in DB" }, { status: 404 });
    }
    if (purchase.user_id !== userId) {
      return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
    }

    // Idempotent: already paid → just return current credits
    if (purchase.status === "paid") {
      const { data: prof } = await admin.from("profiles").select("credits").eq("id", userId).single();
      return NextResponse.json({ ok: true, credits: prof?.credits ?? 0, alreadyProcessed: true });
    }

    // Mark paid
    await admin
      .from("credit_purchases")
      .update({
        status: "paid",
        razorpay_payment_id,
        razorpay_signature,
        paid_at: new Date().toISOString(),
      })
      .eq("razorpay_order_id", razorpay_order_id);

    // Add credits
    const { data: prof, error: profErr } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (profErr) {
      return NextResponse.json({ ok: false, error: "Profile not found" }, { status: 500 });
    }

    const newCredits = (prof?.credits ?? 0) + (purchase.credits ?? 0);

    await admin.from("profiles").update({ credits: newCredits }).eq("id", userId);

    await admin.from("credit_ledger").insert({
      user_id: userId,
      event_type: "credit_purchase",
      credits_change: purchase.credits,
      notes: `Razorpay order ${razorpay_order_id}`,
    });

    return NextResponse.json({ ok: true, credits: newCredits });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}