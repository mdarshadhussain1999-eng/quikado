import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const BodySchema = z.object({
  requestId: z.string().uuid(),
  proServiceId: z.string().uuid(),
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
  if (role !== "service_role") {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY is not service_role (role=${role ?? "unknown"}).`
    );
  }

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

    const { requestId, proServiceId } = parsed.data;

    // Must be logged in
    const { data: userData } = await authed.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }
    const seekerId = userData.user.id;

    // Request must belong to seeker
    const { data: reqRow, error: reqErr } = await authed
      .from("seeker_requests")
      .select("id, user_id")
      .eq("id", requestId)
      .single();

    if (reqErr || !reqRow) {
      return NextResponse.json({ ok: false, error: "Request not found" }, { status: 404 });
    }
    if (reqRow.user_id !== seekerId) {
      return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
    }

    // Pro service must exist + active (admin bypass RLS)
    const { data: proService, error: psErr } = await admin
      .from("pro_services")
      .select("id, user_id, is_active")
      .eq("id", proServiceId)
      .single();

    if (psErr || !proService) {
      return NextResponse.json({ ok: false, error: "Service not found" }, { status: 404 });
    }
    if (!proService.is_active) {
      return NextResponse.json({ ok: false, error: "Service is not active" }, { status: 400 });
    }

    const proId = proService.user_id as string;

    // Find or create thread (admin)
    const { data: existingThread, error: thSelErr } = await admin
      .from("chat_threads")
      .select(
        "id, seeker_unlocked, pro_unlocked, seeker_msgs_sent, pro_msgs_sent, whatsapp_requested_by_seeker, whatsapp_requested_by_pro, whatsapp_accepted"
      )
      .eq("seeker_id", seekerId)
      .eq("pro_id", proId)
      .eq("request_id", requestId)
      .eq("pro_service_id", proServiceId)
      .maybeSingle();

    if (thSelErr) {
      return NextResponse.json({ ok: false, error: thSelErr.message }, { status: 500 });
    }

    let thread = existingThread;

    if (!thread) {
      const { data: created, error: thInsErr } = await admin
        .from("chat_threads")
        .insert({
          seeker_id: seekerId,
          pro_id: proId,
          request_id: requestId,
          pro_service_id: proServiceId,
          seeker_unlocked: false,
          pro_unlocked: false,
        })
        .select(
          "id, seeker_unlocked, pro_unlocked, seeker_msgs_sent, pro_msgs_sent, whatsapp_requested_by_seeker, whatsapp_requested_by_pro, whatsapp_accepted"
        )
        .single();

      if (thInsErr) {
        return NextResponse.json({ ok: false, error: thInsErr.message }, { status: 500 });
      }

      thread = created;
    }

    // If seeker not unlocked, charge 10 credits
    if (!thread!.seeker_unlocked) {
      const { data: prof, error: profErr } = await admin
        .from("profiles")
        .select("id, credits")
        .eq("id", seekerId)
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

      // Deduct credits (admin)
      const { data: updated, error: updErr } = await admin
        .from("profiles")
        .update({ credits: (prof.credits as number) - 10 })
        .eq("id", seekerId)
        .select("credits")
        .single();

      if (updErr) {
        return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
      }

      // Mark unlocked
      const { error: thUpdErr } = await admin
        .from("chat_threads")
        .update({ seeker_unlocked: true })
        .eq("id", thread!.id);

      if (thUpdErr) {
        return NextResponse.json({ ok: false, error: thUpdErr.message }, { status: 500 });
      }

      // Credit ledger entry (admin)
      await admin.from("credit_ledger").insert({
        user_id: seekerId,
        event_type: "unlock_chat_seeker",
        credits_change: -10,
        notes: `Unlock chat thread ${thread!.id}`,
      });

      // Return updated state
      return NextResponse.json({
        ok: true,
        threadId: thread!.id,
        credits: updated.credits,
        thread: { ...thread, seeker_unlocked: true },
      });
    }

    // Already unlocked, just return
    const { data: prof2 } = await admin
      .from("profiles")
      .select("credits")
      .eq("id", seekerId)
      .single();

    return NextResponse.json({
      ok: true,
      threadId: thread!.id,
      credits: prof2?.credits ?? null,
      thread,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}