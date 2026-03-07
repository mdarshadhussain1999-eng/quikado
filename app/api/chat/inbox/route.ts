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

export async function GET() {
  try {
    const authed = await supabaseAuthed();
    const admin = supabaseAdmin();

    const { data: userData } = await authed.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }
    const proId = userData.user.id;

    const { data: threads, error: thErr } = await admin
      .from("chat_threads")
      .select(
        "id, seeker_id, pro_id, request_id, pro_service_id, seeker_unlocked, pro_unlocked, seeker_msgs_sent, pro_msgs_sent, whatsapp_accepted, is_closed, closed_at, created_at"
      )
      .eq("pro_id", proId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (thErr) return NextResponse.json({ ok: false, error: thErr.message }, { status: 500 });

    const list = threads ?? [];
    const requestIds = Array.from(new Set(list.map((t: any) => t.request_id).filter(Boolean)));
    const proServiceIds = Array.from(new Set(list.map((t: any) => t.pro_service_id).filter(Boolean)));
    const seekerIds = Array.from(new Set(list.map((t: any) => t.seeker_id).filter(Boolean)));

    const reqMap = new Map<string, string>();
    if (requestIds.length) {
      const { data: reqs } = await admin.from("seeker_requests").select("id, raw_text").in("id", requestIds);
      (reqs ?? []).forEach((r: any) => reqMap.set(r.id, r.raw_text));
    }

    const svcMap = new Map<string, string>();
    if (proServiceIds.length) {
      const { data: svcs } = await admin.from("pro_services").select("id, raw_text").in("id", proServiceIds);
      (svcs ?? []).forEach((s: any) => svcMap.set(s.id, s.raw_text));
    }

    const seekerNameMap = new Map<string, string>();
    if (seekerIds.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("id, display_name, email")
        .in("id", seekerIds);

      (profs ?? []).forEach((p: any) => {
        const fallback = (p.email ?? "").split("@")[0];
        seekerNameMap.set(p.id, p.display_name ?? fallback ?? "Seeker");
      });
    }

    const open: any[] = [];
    const closed: any[] = [];

    for (const t of list) {
      const item = {
        threadId: t.id,
        seekerId: t.seeker_id,
        seekerName: seekerNameMap.get(t.seeker_id) ?? "Seeker",
        requestId: t.request_id,
        requestText: reqMap.get(t.request_id) ?? "",
        proServiceId: t.pro_service_id,
        serviceText: svcMap.get(t.pro_service_id) ?? "",
        seekerUnlocked: !!t.seeker_unlocked,
        proUnlocked: !!t.pro_unlocked,
        seekerMsgsSent: t.seeker_msgs_sent ?? 0,
        proMsgsSent: t.pro_msgs_sent ?? 0,
        whatsappAccepted: !!t.whatsapp_accepted,
        createdAt: t.created_at,
        isClosed: !!t.is_closed,
        closedAt: t.closed_at ?? null,
      };

      if (item.isClosed) closed.push(item);
      else open.push(item);
    }

    return NextResponse.json({ ok: true, open, closed });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}