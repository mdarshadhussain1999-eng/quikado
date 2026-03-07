"use client";

import { useEffect, useState } from "react";

type QueueItem = {
  id: string;
  user_id: string | null;
  content_type: "request" | "service" | "message" | "contact_message";
  content_text: string;
  category: string | null;
  score: number;
  reasons: string[];
  meta: any;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  published_source_table: string | null;
  published_source_id: string | null;
};

export default function ModerationAdminPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<QueueItem[]>([]);
  const [recent, setRecent] = useState<QueueItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);

    const res = await fetch("/api/admin/moderation");
    const json = await res.json().catch(() => null);

    setLoading(false);

    if (!res.ok) {
      setError(json?.error ?? "Failed to load moderation queue.");
      return;
    }

    setPending(json?.pending ?? []);
    setRecent(json?.recent ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const resolveItem = async (queueId: string, action: "approve" | "reject") => {
    setBusyId(queueId);

    const res = await fetch("/api/admin/moderation/resolve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ queueId, action }),
    });

    const json = await res.json().catch(() => null);
    setBusyId(null);

    if (!res.ok) {
      alert(json?.error ?? "Could not resolve item.");
      return;
    }

    await load();
  };

  return (
    <main className="min-h-screen bg-background text-foreground px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Moderation Admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Only ambiguous items come here. Clear-safe stays automatic. Clear-bad stays blocked.
          </p>
        </div>

        <div className="mb-4">
          <button
            onClick={load}
            className="rounded-xl border px-4 py-2 text-sm"
          >
            Refresh
          </button>
        </div>

        {loading ? <div>Loading…</div> : null}
        {error ? <div className="text-sm text-red-500">{error}</div> : null}

        {!loading && !error ? (
          <div className="grid gap-10">
            <section>
              <h2 className="mb-4 text-xl font-medium">Pending Review</h2>

              {pending.length === 0 ? (
                <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
                  No pending items.
                </div>
              ) : (
                <div className="space-y-4">
                  {pending.map((item) => (
                    <div key={item.id} className="rounded-2xl border p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border px-2 py-1 text-xs">
                          {item.content_type}
                        </span>
                        {item.category ? (
                          <span className="rounded-full border px-2 py-1 text-xs">
                            {item.category}
                          </span>
                        ) : null}
                        <span className="rounded-full border px-2 py-1 text-xs">
                          score {item.score}
                        </span>
                      </div>

                      <div className="mt-4 whitespace-pre-wrap text-sm">
                        {item.content_text}
                      </div>

                      {Array.isArray(item.reasons) && item.reasons.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {item.reasons.map((r, idx) => (
                            <span
                              key={`${item.id}-${idx}`}
                              className="rounded-full border px-2 py-1 text-xs text-muted-foreground"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div className="mt-4 text-xs text-muted-foreground">
                        Created: {new Date(item.created_at).toLocaleString()}
                      </div>

                      <div className="mt-4 flex gap-2">
                        <button
                          disabled={busyId === item.id}
                          onClick={() => resolveItem(item.id, "approve")}
                          className="rounded-xl bg-primary px-4 py-2 text-sm text-primary-foreground"
                        >
                          {busyId === item.id ? "Working…" : "Approve"}
                        </button>

                        <button
                          disabled={busyId === item.id}
                          onClick={() => resolveItem(item.id, "reject")}
                          className="rounded-xl border px-4 py-2 text-sm"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-4 text-xl font-medium">Recently Resolved</h2>

              {recent.length === 0 ? (
                <div className="rounded-2xl border p-4 text-sm text-muted-foreground">
                  No resolved items yet.
                </div>
              ) : (
                <div className="space-y-4">
                  {recent.map((item) => (
                    <div key={item.id} className="rounded-2xl border p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border px-2 py-1 text-xs">
                          {item.content_type}
                        </span>
                        <span className="rounded-full border px-2 py-1 text-xs">
                          {item.status}
                        </span>
                        {item.category ? (
                          <span className="rounded-full border px-2 py-1 text-xs">
                            {item.category}
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-4 whitespace-pre-wrap text-sm">
                        {item.content_text}
                      </div>

                      <div className="mt-4 text-xs text-muted-foreground">
                        Resolved:{" "}
                        {item.resolved_at ? new Date(item.resolved_at).toLocaleString() : "-"}
                      </div>

                      {item.published_source_table ? (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Published to: {item.published_source_table}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}