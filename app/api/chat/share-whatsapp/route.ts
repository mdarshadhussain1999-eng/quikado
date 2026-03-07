import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

const BodySchema = z.object({
  threadId: z.string().uuid(),
  phone: z.string().min(8).max(20),
  message: z.string().max(600).optional().default(""),
});

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

function normalizePhone(input: string) {
  // Keep digits only
  const digits = input.replace(/\D/g, "");

  // If user enters 10-digit Indian number, prefix 91
  if (digits.length === 10) return "91" + digits;

  // If already with country code (like 91xxxxxxxxxx), keep
  if (digits.length >= 11 && digits.length <= 15) return digits;

  // fallback
  return digits;
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseAuthed();

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const { threadId, phone, message } = parsed.data;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }
    const userId = userData.user.id;

    // Verify thread access (RLS allows participants select)
    const { data: thread, error: thErr } = await supabase
      .from("chat_threads")
      .select("id, seeker_id, pro_id, is_closed")
      .eq("id", threadId)
      .single();

    if (thErr || !thread) {
      return NextResponse.json({ ok: false, error: "Thread not found" }, { status: 404 });
    }

    if (thread.is_closed) {
      return NextResponse.json({ ok: false, error: "Chat is closed." }, { status: 400 });
    }

    const isSeeker = userId === thread.seeker_id;
    const isPro = userId === thread.pro_id;
    if (!isSeeker && !isPro) {
      return NextResponse.json({ ok: false, error: "Not allowed" }, { status: 403 });
    }

    const norm = normalizePhone(phone);
    if (norm.length < 10) {
      return NextResponse.json({ ok: false, error: "Invalid phone number." }, { status: 400 });
    }

    // Store WhatsApp share as a special message string.
    // This is temporary and can be deleted when chat is marked done.
    const payload = `WHATSAPP|${norm}|${(message ?? "").trim()}`;

    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .insert({
        thread_id: threadId,
        sender_id: userId,
        text: payload,
        is_blocked: false,
      })
      .select("id, thread_id, sender_id, text, created_at")
      .single();

    if (msgErr) {
      return NextResponse.json({ ok: false, error: msgErr.message }, { status: 500 });
    }

    // Mark WhatsApp handoff as accepted (simple version)
    const updates = isSeeker
      ? { whatsapp_requested_by_seeker: true, whatsapp_accepted: true }
      : { whatsapp_requested_by_pro: true, whatsapp_accepted: true };

    await supabase.from("chat_threads").update(updates).eq("id", threadId);

    return NextResponse.json({ ok: true, message: msg });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}