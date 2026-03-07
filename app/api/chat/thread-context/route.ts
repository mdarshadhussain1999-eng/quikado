export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

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

  if (role !== "service_role") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not service_role");
  }

  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

export async function GET(req: Request) {
  try {
    const authed = await supabaseAuthed();
    const admin = supabaseAdmin();

    const { data: userData } = await authed.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }

    const url = new URL(req.url);
    const threadId = url.searchParams.get("threadId");

    if (!threadId) {
      return NextResponse.json({ ok: false, error: "threadId is required" }, { status: 400 });
    }

    const { data: thread, error: threadErr } = await admin
      .from("chat_threads")
      .select(
        "id, seeker_id, pro_id, seeker_name, pro_name, request_id, pro_service_id, is_closed"
      )
      .eq("id", threadId)
      .single();

    if (threadErr || !thread) {
      return NextResponse.json({ ok: false, error: "Thread not found" }, { status: 404 });
    }

    const userId = userData.user.id;
    const isSeeker = userId === thread.seeker_id;
    const isProvider = userId === thread.pro_id;

    if (!isSeeker && !isProvider) {
      return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
    }

    let requestText: string | null = null;
    let serviceText: string | null = null;

    if (thread.request_id) {
      const { data: reqRow } = await admin
        .from("seeker_requests")
        .select("raw_text")
        .eq("id", thread.request_id)
        .maybeSingle();

      requestText = reqRow?.raw_text ?? null;
    }

    if (thread.pro_service_id) {
      const { data: svcRow } = await admin
        .from("pro_services")
        .select("raw_text")
        .eq("id", thread.pro_service_id)
        .maybeSingle();

      serviceText = svcRow?.raw_text ?? null;
    }

    return NextResponse.json({
      ok: true,
      context: {
        threadId: thread.id,
        role: isSeeker ? "seeker" : "provider",
        isClosed: !!thread.is_closed,
        seekerName: thread.seeker_name ?? null,
        providerName: thread.pro_name ?? null,
        requestText,
        serviceText,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Failed to load thread context." },
      { status: 500 }
    );
  }
}