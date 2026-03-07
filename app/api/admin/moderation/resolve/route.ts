import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { isAdminEmail } from "@/lib/safety/admin";

const BodySchema = z.object({
  queueId: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  resolutionNote: z.string().max(500).optional().default(""),
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
  if (role !== "service_role") throw new Error("SUPABASE_SERVICE_ROLE_KEY is not service_role");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  return digits;
}

export async function POST(req: Request) {
  try {
    const authed = await supabaseAuthed();
    const admin = supabaseAdmin();

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const { queueId, action, resolutionNote } = parsed.data;

    const { data: userData } = await authed.auth.getUser();
    const adminUser = userData.user;
    const adminEmail = adminUser?.email ?? null;

    if (!adminUser || !isAdminEmail(adminEmail)) {
      return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
    }

    const { data: item, error: qErr } = await admin
      .from("moderation_queue")
      .select("*")
      .eq("id", queueId)
      .single();

    if (qErr || !item) {
      return NextResponse.json({ ok: false, error: "Queue item not found" }, { status: 404 });
    }

    if (item.status !== "pending") {
      return NextResponse.json({ ok: false, error: "Item already resolved" }, { status: 400 });
    }

    let publishedSourceTable: string | null = null;
    let publishedSourceId: string | null = null;

    if (action === "approve") {
      if (item.content_type === "request") {
        const { data: created, error } = await admin
          .from("seeker_requests")
          .insert({
            user_id: item.user_id,
            raw_text: item.content_text,
            structured_json: null,
            status: "open",
          })
          .select("id")
          .single();

        if (error) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        publishedSourceTable = "seeker_requests";
        publishedSourceId = created.id;
      }

      if (item.content_type === "service") {
        const { data: created, error } = await admin
          .from("pro_services")
          .insert({
            user_id: item.user_id,
            raw_text: item.content_text,
            structured_json: null,
            is_active: true,
          })
          .select("id")
          .single();

        if (error) {
          return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        }

        publishedSourceTable = "pro_services";
        publishedSourceId = created.id;
      }

      if (item.content_type === "message") {
        const threadId = item.meta?.threadId;
        if (threadId) {
          const { data: created, error } = await admin
            .from("messages")
            .insert({
              thread_id: threadId,
              sender_id: item.user_id,
              text: item.content_text,
              is_blocked: false,
            })
            .select("id")
            .single();

          if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
          }

          publishedSourceTable = "messages";
          publishedSourceId = created.id;
        }
      }

      if (item.content_type === "contact_message") {
        const threadId = item.meta?.threadId;
        const kind = item.meta?.kind;
        const value = item.meta?.value;

        if (threadId && kind && value) {
          let payload = "";
          if (kind === "whatsapp") {
            payload = `WHATSAPP|${normalizePhone(String(value))}|${item.content_text}`;
          } else {
            payload = `EMAIL|${String(value).toLowerCase()}|${item.content_text}`;
          }

          const { data: created, error } = await admin
            .from("messages")
            .insert({
              thread_id: threadId,
              sender_id: item.user_id,
              text: payload,
              is_blocked: false,
            })
            .select("id")
            .single();

          if (error) {
            return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
          }

          publishedSourceTable = "messages";
          publishedSourceId = created.id;
        }
      }
    }

    const { error: updErr } = await admin
      .from("moderation_queue")
      .update({
        status: action === "approve" ? "approved" : "rejected",
        resolved_at: new Date().toISOString(),
        resolved_by: adminUser.id,
        resolution_note: resolutionNote || null,
        published_source_table: publishedSourceTable,
        published_source_id: publishedSourceId,
      })
      .eq("id", queueId);

    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}