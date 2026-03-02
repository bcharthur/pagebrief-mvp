import { capitalize, formatTimestamp, safeTrim } from "../helpers.js";

function buildEntry(entry, handlers) {
  const article = document.createElement("article");
  article.className = "history-entry";

  const head = document.createElement("div");
  head.className = "history-head";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "history-title";
  title.textContent = safeTrim(entry.title || entry.result?.panel_title || entry.url || "Document analysé", 90);
  left.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "history-meta";
  const formatChip = document.createElement("span");
  formatChip.className = "history-chip";
  formatChip.textContent = entry.formatLabel || capitalize(entry.result?.format_label || entry.format || "express");
  const sourceChip = document.createElement("span");
  sourceChip.className = "history-chip";
  sourceChip.textContent = String(entry.sourceKind || entry.result?.source_kind || "page").toUpperCase();
  meta.appendChild(formatChip);
  meta.appendChild(sourceChip);
  left.appendChild(meta);
  head.appendChild(left);

  const time = document.createElement("div");
  time.className = "history-time";
  time.textContent = formatTimestamp(entry.savedAt);
  head.appendChild(time);
  article.appendChild(head);

  const body = document.createElement("p");
  body.className = "history-body";
  body.textContent = entry.explanation || "Aucune explication disponible.";
  article.appendChild(body);

  const link = document.createElement("a");
  link.className = "history-url";
  link.href = entry.url || "#";
  link.textContent = entry.url || "Aucune URL";
  link.title = entry.url || "Aucune URL";
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    await handlers.onOpen(entry.url, true);
  });
  article.appendChild(link);

  const actions = document.createElement("div");
  actions.className = "history-actions";

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.textContent = "Charger";
  previewBtn.addEventListener("click", () => handlers.onPreview(entry));

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.textContent = "Ouvrir";
  openBtn.disabled = !entry.url;
  openBtn.addEventListener("click", () => handlers.onOpen(entry.url, false));

  actions.appendChild(previewBtn);
  actions.appendChild(openBtn);
  article.appendChild(actions);

  return article;
}

export function renderHistory(dom, entries, handlers, search = "") {
  const term = String(search || "").toLowerCase().trim();
  const filtered = !term
    ? entries
    : entries.filter((entry) => {
      const hay = [entry.title, entry.url, entry.explanation, entry.formatLabel].join(" ").toLowerCase();
      return hay.includes(term);
    });

  dom.history.historyCountBadge.textContent = String(entries.length);
  dom.history.historyMeta.textContent = `Historique de session : ${entries.length} document${entries.length > 1 ? "s" : ""}.`;
  dom.history.historyList.innerHTML = "";

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "item-card empty";
    empty.textContent = term
      ? "Aucun élément ne correspond à cette recherche."
      : "Aucun document enregistré dans cette session pour l'instant.";
    dom.history.historyList.appendChild(empty);
    return;
  }

  for (const entry of filtered) {
    dom.history.historyList.appendChild(buildEntry(entry, handlers));
  }
}
