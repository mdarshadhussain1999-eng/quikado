export type ModerationContext =
  | "request"
  | "service"
  | "message"
  | "voice_transcript"
  | "contact_message";

export type ModerationVerdict = "allow" | "review" | "block";

export type ModerationResult = {
  verdict: ModerationVerdict;
  category: string | null;
  score: number;
  normalizedText: string;
  reasons: string[];
};

function normalizeText(input: string) {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[@]/g, "a")
    .replace(/[0]/g, "o")
    .replace(/[3]/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5]/g, "s")
    .replace(/[7]/g, "t")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
}

type Rule = {
  category: string;
  weight: number;
  patterns: RegExp[];
};

const HARD_BLOCK_RULES: Rule[] = [
  {
    category: "sexual_services",
    weight: 100,
    patterns: [
      /escort/i,
      /prostitut/i,
      /call girl/i,
      /sex work/i,
      /paid sex/i,
      /hookup service/i,
    ],
  },
  {
    category: "drugs",
    weight: 100,
    patterns: [
      /\bcocaine\b/i,
      /\bheroin\b/i,
      /\bmdma\b/i,
      /\blsd\b/i,
      /\bganja\b/i,
      /\bmarijuana\b/i,
      /\bweed\b/i,
      /\bhash\b/i,
      /\bcharas\b/i,
      /\bdrugs?\b/i,
      /\bnarcotics?\b/i,
    ],
  },
  {
    category: "weapons",
    weight: 100,
    patterns: [
      /\bglock\b/i,
      /\bpistol\b/i,
      /\brevolver\b/i,
      /\brifle\b/i,
      /\bak\s?47\b/i,
      /\bgun\b/i,
      /\bammunition\b/i,
      /\bbullet\b/i,
    ],
  },
  {
    category: "explosives_terror",
    weight: 100,
    patterns: [
      /\bbomb\b/i,
      /\bexplosive\b/i,
      /\bdetonator\b/i,
      /\bterror\b/i,
      /\bterrorist\b/i,
      /\bisis\b/i,
      /\bal qaeda\b/i,
    ],
  },
  {
    category: "human_trafficking",
    weight: 100,
    patterns: [
      /\btraffic(king)?\b/i,
      /\bsell girls?\b/i,
      /\bbuy girls?\b/i,
      /\bminor girl\b/i,
      /\bunderage\b/i,
    ],
  },
];

const REVIEW_RULES: Rule[] = [
  {
    category: "suspicious_illicit_trade",
    weight: 20,
    patterns: [
      /special stuff/i,
      /party stuff/i,
      /green stuff/i,
      /powder/i,
      /white stuff/i,
      /maal/i,
      /discreet/i,
      /secret delivery/i,
      /no questions asked/i,
    ],
  },
  {
    category: "suspicious_adult_or_offplatform",
    weight: 20,
    patterns: [
      /private massage/i,
      /full night/i,
      /room service girl/i,
      /after party/i,
      /dm only/i,
      /cash only/i,
      /telegram only/i,
      /signal only/i,
    ],
  },
  {
    category: "violent_or_criminal_intent",
    weight: 25,
    patterns: [
      /\bkill\b/i,
      /\bshoot\b/i,
      /\battack\b/i,
      /\bblast\b/i,
      /\bhitman\b/i,
      /\bfake id\b/i,
      /\bforged documents?\b/i,
      /\bscam\b/i,
      /\bfraud\b/i,
    ],
  },
];

export function moderateText(
  rawText: string,
  _context: ModerationContext
): ModerationResult {
  const normalizedText = normalizeText(rawText);

  let score = 0;
  let category: string | null = null;
  const reasons: string[] = [];

  for (const rule of HARD_BLOCK_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalizedText)) {
        score += rule.weight;
        category = category ?? rule.category;
        reasons.push(`Matched hard-block rule: ${rule.category}`);
      }
    }
  }

  if (score >= 100) {
    return {
      verdict: "block",
      category,
      score,
      normalizedText,
      reasons: Array.from(new Set(reasons)),
    };
  }

  for (const rule of REVIEW_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalizedText)) {
        score += rule.weight;
        category = category ?? rule.category;
        reasons.push(`Matched review rule: ${rule.category}`);
      }
    }
  }

  // Combo logic: urgency + secrecy + item words = review
  const comboFlags = [
    /\burgent\b/i.test(normalizedText) || /\btoday\b/i.test(normalizedText),
    /\bsecret\b/i.test(normalizedText) || /\bdiscreet\b/i.test(normalizedText),
    /\bstuff\b/i.test(normalizedText) || /\bmaterial\b/i.test(normalizedText),
  ].filter(Boolean).length;

  if (comboFlags >= 2) {
    score += 20;
    category = category ?? "ambiguous_high_risk";
    reasons.push("Matched risky intent combination");
  }

  if (score >= 30) {
    return {
      verdict: "review",
      category,
      score,
      normalizedText,
      reasons: Array.from(new Set(reasons)),
    };
  }

  return {
    verdict: "allow",
    category: null,
    score,
    normalizedText,
    reasons: [],
  };
}

export function moderationMessage(result: ModerationResult) {
  if (result.verdict === "block") {
    return "Illegal or unsafe requests/services/messages are not allowed on Quikado.";
  }

  if (result.verdict === "review") {
    return "This looks ambiguous or potentially unsafe. Please rewrite it clearly as a legal service request.";
  }

  return null;
}