import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { moderateText, moderationMessage } from "@/lib/safety/moderation";
import { getReviewExpiryDate } from "@/lib/safety/queue";

const BodySchema = z.object({
  threadId: z.string().uuid(),
  text: z.string().min(1).max(2000),
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

    const { threadId, text } = parsed.data;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ ok: false, error: "Not logged in" }, { status: 401 });
    }
    const userId = userData.user.id;

    const { data: thread, error: thErr } = await supabase
      .from("chat_threads")
      .select(
        "id, seeker_id, pro_id, seeker_unlocked, pro_unlocked, seeker_msgs_sent, pro_msgs_sent, whatsapp_accepted"
      )
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

    if (isSeeker && !thread.seeker_unlocked) {
      return NextResponse.json({ ok: false, error: "Seeker not unlocked" }, { status: 403 });
    }
    if (isPro && !thread.pro_unlocked) {
      return NextResponse.json({ ok: false, error: "Provider not unlocked" }, { status: 403 });
    }

    if (isSeeker && (thread.seeker_msgs_sent ?? 0) >= 2) {
      return NextResponse.json(
        { ok: false, error: "Message limit reached. Continue on WhatsApp or Email." },
        { status: 429 }
      );
    }
    if (isPro && (thread.pro_msgs_sent ?? 0) >= 2) {
      return NextResponse.json(
        { ok: false, error: "Message limit reached. Continue on WhatsApp or Email." },
        { status: 429 }
      );
    }

    const moderation = moderateText(text, "message");

    if (moderation.verdict === "block") {
      await supabase.from("moderation_logs").insert({
        user_id: userId,
        content_type: "message",
        content_text: text,
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
          content_type: "message",
          content_text: text,
          category: moderation.category,
          score: moderation.score,
          reasons: moderation.reasons,
          meta: { threadId },
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
        content_type: "message",
        content_text: text,
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
            "This message is under review before delivery. Please rewrite it clearly if needed.",
        },
        { status: 202 }
      );
    }

    const { data: msg, error: msgErr } = await supabase
      .from("messages")
      .insert({
        thread_id: threadId,
        sender_id: userId,
        text,
        is_blocked: false,
      })
      .select("id, thread_id, sender_id, text, created_at")
      .single();

    if (msgErr) {
      return NextResponse.json({ ok: false, error: msgErr.message }, { status: 500 });
    }

    const updates = isSeeker
      ? { seeker_msgs_sent: (thread.seeker_msgs_sent ?? 0) + 1 }
      : { pro_msgs_sent: (thread.pro_msgs_sent ?? 0) + 1 };

    const { data: updatedThread, error: updErr } = await supabase
      .from("chat_threads")
      .update(updates)
      .eq("id", threadId)
      .select("seeker_msgs_sent, pro_msgs_sent")
      .single();

    if (updErr) {
      return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    }

    const limitReached = isSeeker
      ? (updatedThread.seeker_msgs_sent ?? 0) >= 2
      : (updatedThread.pro_msgs_sent ?? 0) >= 2;

    return NextResponse.json({
      ok: true,
      message: msg,
      counts: updatedThread,
      limitReached,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}