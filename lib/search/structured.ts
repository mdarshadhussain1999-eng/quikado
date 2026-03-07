export type StructuredSearchInput = {
  category?: string | null;
  location?: string | null;
  budget?: string | null;
  timing?: string | null;
  language?: string | null;
};

function cleanValue(value?: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function cleanStructuredInput(input?: unknown): StructuredSearchInput | null {
  if (!input || typeof input !== "object") return null;

  const raw = input as Record<string, unknown>;

  const cleaned: StructuredSearchInput = {
    category: cleanValue(raw.category),
    location: cleanValue(raw.location),
    budget: cleanValue(raw.budget),
    timing: cleanValue(raw.timing),
    language: cleanValue(raw.language),
  };

  const hasAny =
    !!cleaned.category ||
    !!cleaned.location ||
    !!cleaned.budget ||
    !!cleaned.timing ||
    !!cleaned.language;

  return hasAny ? cleaned : null;
}

export function structuredToModerationText(input?: StructuredSearchInput | null) {
  if (!input) return "";

  return [
    input.category ? `category ${input.category}` : "",
    input.location ? `location ${input.location}` : "",
    input.budget ? `budget ${input.budget}` : "",
    input.timing ? `timing ${input.timing}` : "",
    input.language ? `language ${input.language}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

function normalizeLoose(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s₹-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLoose(value?: string | null) {
  return normalizeLoose(value)
    .split(/[,\s/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function compareStructuredInputs(
  request: StructuredSearchInput | null,
  service: StructuredSearchInput | null
) {
  let score = 0;
  const reasons: string[] = [];

  if (!request || !service) {
    return { score, reasons };
  }

  const reqCategory = normalizeLoose(request.category);
  const proCategory = normalizeLoose(service.category);

  if (reqCategory && proCategory) {
    if (reqCategory === proCategory) {
      score += 12;
      reasons.push(`Category fit: ${request.category}`);
    } else if (reqCategory.includes(proCategory) || proCategory.includes(reqCategory)) {
      score += 8;
      reasons.push(`Category overlap`);
    }
  }

  const reqLocation = normalizeLoose(request.location);
  const proLocation = normalizeLoose(service.location);

  if (reqLocation && proLocation) {
    if (reqLocation === proLocation) {
      score += 10;
      reasons.push(`Location fit: ${request.location}`);
    } else if (reqLocation.includes(proLocation) || proLocation.includes(reqLocation)) {
      score += 6;
      reasons.push(`Location overlap`);
    }
  }

  const reqLang = splitLoose(request.language);
  const proLang = splitLoose(service.language);
  const langOverlap = reqLang.filter((x) => proLang.includes(x));

  if (langOverlap.length > 0) {
    score += 6;
    reasons.push(`Language fit: ${langOverlap[0]}`);
  }

  const reqTiming = normalizeLoose(request.timing);
  const proTiming = normalizeLoose(service.timing);
  if (reqTiming && proTiming) {
    if (reqTiming === proTiming) {
      score += 4;
      reasons.push(`Time fit: ${request.timing}`);
    } else if (reqTiming.includes(proTiming) || proTiming.includes(reqTiming)) {
      score += 3;
      reasons.push(`Time overlap`);
    }
  }

  const reqBudget = normalizeLoose(request.budget);
  const proBudget = normalizeLoose(service.budget);
  if (reqBudget && proBudget) {
    score += 2;
    reasons.push(`Budget provided on both sides`);
  }

  return {
    score,
    reasons,
  };
}