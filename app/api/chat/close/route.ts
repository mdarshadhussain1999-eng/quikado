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
  if (role !== "service_role") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not service_role.");
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

    const { threadId } = parsed.data;

    const { data: userData } = await authed.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }
    const userId = userData.user.id;

    // Verify participant using authed client (RLS allows select)
    const { data: thread, error: thErr } = await authed
      .from("chat_threads")
      .select("id, seeker_id, pro_id")
      .eq("id", threadId)
      .single();

    if (thErr || !thread) {
      return NextResponse.json({ ok: false, error: "Thread not found" }, { status: 404 });
    }

    const isSeeker = userId === thread.seeker_id;
    const isPro = userId === thread.pro_id;
    if (!isSeeker && !isPro) {
      return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
    }

    // Admin delete all messages for this thread (bypass delete RLS)
    await admin.from("messages").delete().eq("thread_id", threadId);

    // Mark thread closed (keep minimal metadata)
    const { error: updErr } = await admin
      .from("chat_threads")
      .update({ is_closed: true, closed_at: new Date().toISOString() })
      .eq("id", threadId);

    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}