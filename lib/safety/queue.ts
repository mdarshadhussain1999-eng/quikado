export function getReviewExpiryDate(hours = 24) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

export async function expirePendingModerationItems(admin: any) {
  const nowIso = new Date().toISOString();

  const { error } = await admin
    .from("moderation_queue")
    .update({
      status: "rejected",
      resolved_at: nowIso,
      resolution_note: "Auto-expired after review window",
    })
    .eq("status", "pending")
    .lt("expires_at", nowIso);

  if (error) {
    throw new Error(error.message);
  }
}