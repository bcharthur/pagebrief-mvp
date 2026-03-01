const backendUrlInput = document.getElementById("backendUrl");
const modeSelect = document.getElementById("mode");
const inspectBtn = document.getElementById("inspectBtn");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const actionsEl = document.getElementById("actionsList");
const risksEl = document.getElementById("risksList");
const tldrEl = document.getElementById("tldr");
const readingTimeEl = document.getElementById("readingTime");
const engineEl = document.getElementById("engine");
const pageKindEl = document.getElementById("pageKind");

init();

async function init() {
  const stored = await chrome.storage.local.get(["pagebrief_backend_url", "pagebrief_mode"]);
  if (stored.pagebrief_backend_url) backendUrlInput.value = stored.pagebrief_backend_url;
  if (stored.pagebrief_mode) modeSelect.value = stored.pagebrief_mode;

  backendUrlInput.addEventListener("change", persistSettings);
  modeSelect.addEventListener("change", persistSettings);
  inspectBtn.addEventListener("click", handleInspectClick);
}

async function persistSettings() {
  await chrome.storage.local.set({
    pagebrief_backend_url: backendUrlInput.value.trim(),
    pagebrief_mode: modeSelect.value
  });
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function setLoading(isLoading) {
  inspectBtn.disabled = isLoading;
  inspectBtn.textContent = isLoading ? "Analyse en cours…" : "Analyser l'onglet actif";
}

function renderList(target, items, emptyMessage) {
  target.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = emptyMessage;
    target.appendChild(div);
    return;
  }

  for (const value of values) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = value;
    target.appendChild(div);
  }
}

async function handleInspectClick() {
  setLoading(true);
  setStatus("Extraction du contenu de l'onglet…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("Aucun onglet actif détecté.");
    }

    const extraction = await extractCurrentTab(tab.id);
    pageKindEl.textContent = extraction.sourceKind.toUpperCase();

    setStatus("Envoi au backend pour résumé…");

    const backendUrl = backendUrlInput.value.trim().replace(/\/$/, "");
    const response = await fetch(`${backendUrl}/v1/pagebrief/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: extraction.url,
        title: extraction.title,
        page_text: extraction.pageText,
        mode: modeSelect.value
      })
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Le backend a refusé l'analyse.");
    }

    renderList(summaryEl, data.summary_points, "Aucun résumé disponible.");
    renderList(actionsEl, data.actions, "Aucune action détectée.");
    renderList(risksEl, data.risks, "Aucun risque détecté.");
    tldrEl.textContent = data.tldr || "Aucun TL;DR.";
    readingTimeEl.textContent = `${data.reading_time_min || "-"} min`;
    engineEl.textContent = data.engine || "-";

    const sourceHint = extraction.sourceKind === "pdf"
      ? "PDF public : extraction via URL si nécessaire."
      : "Page HTML analysée depuis l'onglet courant.";

    setStatus(`Résumé prêt. ${sourceHint}`, "ok");
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Erreur pendant l'analyse.", "error");
  } finally {
    setLoading(false);
  }
}

async function extractCurrentTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (value) => String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const selected = clean(window.getSelection ? window.getSelection().toString() : "");
      const url = window.location.href;
      const title = document.title || "";
      const isPdf = document.contentType === "application/pdf" || /\.pdf($|\?)/i.test(url);

      let pageText = "";
      if (!isPdf) {
        const preferred = document.querySelector("main, article") || document.body;
        const clone = preferred.cloneNode(true);
        clone.querySelectorAll("script, style, noscript, svg, canvas").forEach((node) => node.remove());
        const raw = clean(clone.innerText || clone.textContent || "");
        pageText = selected && selected.length >= 180 ? selected : raw;
      }

      return {
        title: clean(title),
        url,
        pageText: pageText.slice(0, 18000),
        sourceKind: isPdf ? "pdf" : "html"
      };
    }
  });

  return result;
}
