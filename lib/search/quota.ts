export type SearchQuotaState = {
  usageDate: string;
  freeUsed: number;
  paidUsed: number;
  freeLeft: number;
  nextSearchCost: number;
};

export type ConsumeSearchQuotaResult =
  | {
      ok: true;
      chargedCredits: number;
      credits?: number;
      quota: SearchQuotaState;
    }
  | {
      ok: false;
      error: string;
      quota: SearchQuotaState;
    };

function getKolkataDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function getSearchQuotaState(admin: any, userId: string): Promise<SearchQuotaState> {
  const usageDate = getKolkataDateString();

  const { data, error } = await admin
    .from("search_usage_daily")
    .select("free_used, paid_used")
    .eq("user_id", userId)
    .eq("usage_date", usageDate)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const freeUsed = data?.free_used ?? 0;
  const paidUsed = data?.paid_used ?? 0;
  const freeLeft = Math.max(0, 3 - freeUsed);
  const nextSearchCost = freeLeft > 0 ? 0 : 5;

  return {
    usageDate,
    freeUsed,
    paidUsed,
    freeLeft,
    nextSearchCost,
  };
}

export async function consumeSearchQuota(
  admin: any,
  userId: string
): Promise<ConsumeSearchQuotaResult> {
  const current = await getSearchQuotaState(admin, userId);

  if (current.freeLeft > 0) {
    const { error } = await admin.from("search_usage_daily").upsert({
      user_id: userId,
      usage_date: current.usageDate,
      free_used: current.freeUsed + 1,
      paid_used: current.paidUsed,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(error.message);
    }

    const next = await getSearchQuotaState(admin, userId);
    return {
      ok: true,
      chargedCredits: 0,
      quota: next,
    };
  }

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();

  if (profileErr) {
    throw new Error(profileErr.message);
  }

  const currentCredits = profile?.credits ?? 0;
  if (currentCredits < 5) {
    return {
      ok: false,
      error:
        "You have used your 3 free searches today. This search now needs 5 credits.",
      quota: current,
    };
  }

  const newCredits = currentCredits - 5;

  const { error: creditErr } = await admin
    .from("profiles")
    .update({ credits: newCredits })
    .eq("id", userId);

  if (creditErr) {
    throw new Error(creditErr.message);
  }

  const { error: ledgerErr } = await admin.from("credit_ledger").insert({
    user_id: userId,
    event_type: "search_charge",
    credits_change: -5,
    notes: "Paid search after daily free quota exhausted",
  });

  if (ledgerErr) {
    throw new Error(ledgerErr.message);
  }

  const { error: usageErr } = await admin.from("search_usage_daily").upsert({
    user_id: userId,
    usage_date: current.usageDate,
    free_used: current.freeUsed,
    paid_used: current.paidUsed + 1,
    updated_at: new Date().toISOString(),
  });

  if (usageErr) {
    throw new Error(usageErr.message);
  }

  const next = await getSearchQuotaState(admin, userId);

  return {
    ok: true,
    chargedCredits: 5,
    credits: newCredits,
    quota: next,
  };
}