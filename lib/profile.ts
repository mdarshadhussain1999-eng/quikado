import type { SupabaseClient } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  credits: number;
  mode_default: "find" | "offer";
  theme: "dark" | "light";
  whatsapp_number: string | null;
  whatsapp_share_allowed: boolean;
};

function bestNameFromUser(user: any) {
  const meta = user?.user_metadata ?? {};
  const fromMeta = meta.full_name || meta.name;
  const fromEmail = (user?.email ?? "").split("@")[0];
  return (fromMeta || fromEmail || "User").toString();
}

export async function fetchMyProfile(supabase: SupabaseClient) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr) throw new Error(userErr.message);
  if (!user) throw new Error("No user session");

  const desiredName = bestNameFromUser(user);

  // Fetch profile safely
  const { data: existing, error: selErr } = await supabase
    .from("profiles")
    .select(
      "id, email, display_name, credits, mode_default, theme, whatsapp_number, whatsapp_share_allowed"
    )
    .eq("id", user.id)
    .maybeSingle();

  if (selErr) throw new Error(selErr.message);

  // If missing, create (30 credits)
  if (!existing) {
    const { error: upErr } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email ?? null,
          display_name: desiredName,
          credits: 30,
          mode_default: "find",
          theme: "dark",
          whatsapp_number: null,
          whatsapp_share_allowed: false,
        },
        { onConflict: "id" }
      );

    if (upErr) throw new Error(upErr.message);

    const { data: created, error: sel2Err } = await supabase
      .from("profiles")
      .select(
        "id, email, display_name, credits, mode_default, theme, whatsapp_number, whatsapp_share_allowed"
      )
      .eq("id", user.id)
      .single();

    if (sel2Err) throw new Error(sel2Err.message);
    return created as Profile;
  }

  // If exists but display_name missing, update once
  if (!existing.display_name || existing.display_name.trim().length === 0) {
    await supabase.from("profiles").update({ display_name: desiredName }).eq("id", user.id);
    return { ...(existing as any), display_name: desiredName } as Profile;
  }

  return existing as Profile;
}

export async function updateMyProfile(
  supabase: SupabaseClient,
  updates: Partial<
    Pick<
      Profile,
      "mode_default" | "theme" | "whatsapp_number" | "whatsapp_share_allowed" | "display_name"
    >
  >
) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr) throw new Error(userErr.message);
  if (!user) throw new Error("No user session");

  const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
  if (error) throw new Error(error.message);
}