export function normalizeUrl(value) {
  return String(value || "").replace(/#.*$/, "");
}

export function capitalize(value) {
  const text = String(value || "");
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : "";
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

export function buildHistoryExplanation(result) {
  const primary = result?.conclusion || result?.tldr || "";
  if (String(primary).trim()) return safeTrim(primary, 240);
  const fallback = [
    ...(Array.isArray(result?.intro_lines) ? result.intro_lines : []),
    ...(Array.isArray(result?.key_points) ? result.key_points.slice(0, 2) : []),
  ].join(" ");
  return safeTrim(fallback, 240) || "Aucune explication synthétique disponible.";
}

export function buildHistoryKey(url, scope = "document", focusHint = "") {
  const normalized = normalizeUrl(url) || "page-sans-url";
  if (scope !== "selection") return `${normalized}::${scope}`;
  return `${normalized}::selection::${safeTrim(focusHint || "selection", 80)}`;
}

export function isTabStateStaleForUrl(tabState, currentUrl) {
  const savedUrl = normalizeUrl(tabState?.url);
  const liveUrl = normalizeUrl(currentUrl);
  return Boolean(savedUrl && liveUrl && savedUrl !== liveUrl);
}
