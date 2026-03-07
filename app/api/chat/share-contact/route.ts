import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { moderateText, moderationMessage } from "@/lib/safety/moderation";
import { getReviewExpiryDate } from "@/lib/safety/queue";

const BodySchema = z.object({
  threadId: z.string().uuid(),
  kind: z.enum(["whatsapp", "email"]),
  value: z.string().min(3).max(80),
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
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  return digits;
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

    const { threadId, kind, value, message } = parsed.data;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }
    const userId = userData.user.id;

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

    const safeMessage = (message ?? "").trim();

    if (safeMessage.length > 0) {
      const moderation = moderateText(safeMessage, "contact_message");

      if (moderation.verdict === "block") {
        await supabase.from("moderation_logs").insert({
          user_id: userId,
          content_type: "contact_message",
          content_text: safeMessage,
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
            content_type: "contact_message",
            content_text: safeMessage,
            category: moderation.category,
            score: moderation.score,
            reasons: moderation.reasons,
            meta: { threadId, kind, value },
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
          content_type: "contact_message",
          content_text: safeMessage,
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
              "This contact message is under review before sharing. Please rewrite it clearly if needed.",
          },
          { status: 202 }
        );
      }
    }

    let payload = "";
    if (kind === "whatsapp") {
      const norm = normalizePhone(value);
      if (norm.length < 10) {
        return NextResponse.json({ ok: false, error: "Invalid WhatsApp number." }, { status: 400 });
      }
      payload = `WHATSAPP|${norm}|${safeMessage}`;
    } else {
      const email = value.trim().toLowerCase();
      if (!isValidEmail(email)) {
        return NextResponse.json({ ok: false, error: "Invalid email address." }, { status: 400 });
      }
      payload = `EMAIL|${email}|${safeMessage}`;
    }

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