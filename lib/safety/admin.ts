export function getAdminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string | null) {
  if (!email) return false;
  return getAdminEmails().includes(email.toLowerCase());
}