import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({
  threadId: z.string().uuid(),
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

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const role = getJwtRole(serviceKey);
  if (role !== "service_role") throw new Error("SUPABASE_SERVICE_ROLE_KEY is not service_role");

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  try {
    const authed = await supabaseAuthed();
    const admin = supabaseAdmin();

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const { threadId } = parsed.data;

    const { data: userData } = await authed.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }
    const proId = userData.user.id;

    // Thread must exist + pro must be participant
    const { data: thread, error: thErr } = await admin
      .from("chat_threads")
      .select("id, pro_id, pro_unlocked, is_closed")
      .eq("id", threadId)
      .single();

    if (thErr || !thread) {
      return NextResponse.json({ ok: false, error: "Thread not found" }, { status: 404 });
    }
    if (thread.pro_id !== proId) {
      return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
    }
    if (thread.is_closed) {
      return NextResponse.json({ ok: false, error: "Chat is closed." }, { status: 400 });
    }

    // If already unlocked, return credits
    if (thread.pro_unlocked) {
      const { data: p } = await admin.from("profiles").select("credits").eq("id", proId).single();
      return NextResponse.json({ ok: true, credits: p?.credits ?? null });
    }

    // Charge 10 credits
    const { data: prof, error: profErr } = await admin
      .from("profiles")
      .select("id, credits")
      .eq("id", proId)
      .single();

    if (profErr || !prof) {
      return NextResponse.json({ ok: false, error: "Profile not found" }, { status: 500 });
    }

    if ((prof.credits ?? 0) < 10) {
      return NextResponse.json(
        { ok: false, error: "Not enough credits (need 10)." },
        { status: 402 }
      );
    }

    // Deduct credits + unlock
    const { data: updated, error: updErr } = await admin
      .from("profiles")
      .update({ credits: (prof.credits as number) - 10 })
      .eq("id", proId)
      .select("credits")
      .single();

    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    const { error: thUpdErr } = await admin
      .from("chat_threads")
      .update({ pro_unlocked: true })
      .eq("id", threadId);

    if (thUpdErr) {
      return NextResponse.json({ ok: false, error: thUpdErr.message }, { status: 500 });
    }

    await admin.from("credit_ledger").insert({
      user_id: proId,
      event_type: "unlock_chat_provider",
      credits_change: -10,
      notes: `Provider unlock thread ${threadId}`,
    });

    return NextResponse.json({ ok: true, credits: updated.credits });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}