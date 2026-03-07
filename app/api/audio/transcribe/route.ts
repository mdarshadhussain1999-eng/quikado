export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { moderateText, moderationMessage } from "@/lib/safety/moderation";

async function supabaseAuthed() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("Missing Supabase URL/Anon key");
  }

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

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json(
        { ok: false, error: "Not logged in" },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "Audio file is required." },
        { status: 400 }
      );
    }

    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: "Audio file is too large. Keep it under 25 MB." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });

    const transcript = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
    });

    const text = transcript.text?.trim() ?? "";

    if (!text) {
      return NextResponse.json(
        { ok: false, error: "No speech detected. Please try again." },
        { status: 400 }
      );
    }

    const moderation = moderateText(text, "voice_transcript");

    if (moderation.verdict === "block") {
      await supabase.from("moderation_logs").insert({
        user_id: userData.user.id,
        content_type: "voice_transcript",
        content_text: text,
        result: "block",
        flags: JSON.stringify({
          category: moderation.category,
          score: moderation.score,
          reasons: moderation.reasons,
        }),
      });

      return NextResponse.json(
        {
          ok: false,
          blocked: true,
          transcript: text,
          error: moderationMessage(moderation),
        },
        { status: 400 }
      );
    }

    if (moderation.verdict === "review") {
      await supabase.from("moderation_logs").insert({
        user_id: userData.user.id,
        content_type: "voice_transcript",
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
          transcript: text,
          error:
            "This audio transcript looks ambiguous or potentially unsafe. Please say it again more clearly.",
        },
        { status: 202 }
      );
    }

    return NextResponse.json({
      ok: true,
      transcript: text,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Transcription failed." },
      { status: 500 }
    );
  }
}