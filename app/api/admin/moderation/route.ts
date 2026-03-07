import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/safety/admin";
import { expirePendingModerationItems } from "@/lib/safety/queue";

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

export async function GET() {
  try {
    const authed = await supabaseAuthed();
    const admin = supabaseAdmin();

    await expirePendingModerationItems(admin);

    const { data: userData } = await authed.auth.getUser();
    const email = userData.user?.email ?? null;

    if (!userData.user || !isAdminEmail(email)) {
      return NextResponse.json(
        { ok: false, error: "Not authorized" },
        { status: 403 }
      );
    }

    const { data: pending, error: pErr } = await admin
      .from("moderation_queue")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100);

    if (pErr) {
      return NextResponse.json(
        { ok: false, error: pErr.message },
        { status: 500 }
      );
    }

    const { data: recent, error: rErr } = await admin
      .from("moderation_queue")
      .select("*")
      .neq("status", "pending")
      .order("resolved_at", { ascending: false })
      .limit(100);

    if (rErr) {
      return NextResponse.json(
        { ok: false, error: rErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      pending: pending ?? [],
      recent: recent ?? [],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}