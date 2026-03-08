const FORMAT_LABELS = {
  express: "Express",
  analytique: "Analytique",
  decision: "Décision",
  etude: "Étude",
};

const CONFIDENCE_LABELS = {
  faible: "Faible",
  moyenne: "Moyenne",
  elevee: "Élevée",
  élevée: "Élevée",
  high: "Élevée",
  medium: "Moyenne",
  low: "Faible",
};

export function normalizeUrl(value) {
  return String(value || "").replace(/#.*$/, "");
}

export function capitalize(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
}

export function formatFormatLabel(value) {
  const key = String(value || "").toLowerCase();
  return FORMAT_LABELS[key] || capitalize(key);
}

export function formatConfidence(value) {
  const key = String(value || "").toLowerCase();
  return CONFIDENCE_LABELS[key] || (key ? capitalize(key) : "-");
}

export function formatPlan(value) {
  const key = String(value || "").toLowerCase();
  if (key === "premium") return "Premium";
  if (key === "free") return "Gratuit";
  return key ? capitalize(key) : "-";
}

export function safeTrim(value, maxLength = 280) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export function formatTimestamp(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_error) {
    return "";
  }
}

export function isTabStateStaleForUrl(tabState, currentUrl) {
  const savedUrl = normalizeUrl(tabState?.url);
  const liveUrl = normalizeUrl(currentUrl);
  return Boolean(savedUrl && liveUrl && savedUrl !== liveUrl);
}
