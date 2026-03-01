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
  console.log("[PageBrief popup] init");
  const stored = await chrome.storage.local.get([
    "pagebrief_backend_url",
    "pagebrief_mode",
    "pagebrief_last_result",
    "pagebrief_last_status"
  ]);

  if (stored.pagebrief_backend_url) backendUrlInput.value = stored.pagebrief_backend_url;
  if (stored.pagebrief_mode) modeSelect.value = stored.pagebrief_mode;

  if (stored.pagebrief_last_result) {
    console.log("[PageBrief popup] restauration du dernier résultat", stored.pagebrief_last_result);
    renderResult(stored.pagebrief_last_result);
    const lastStatus = stored.pagebrief_last_status || "Dernière analyse restaurée.";
    setStatus(lastStatus, "ok");
  }

  backendUrlInput.addEventListener("change", persistSettings);
  modeSelect.addEventListener("change", persistSettings);
  inspectBtn.addEventListener("click", handleInspectClick);
}

async function persistSettings() {
  const payload = {
    pagebrief_backend_url: backendUrlInput.value.trim(),
    pagebrief_mode: modeSelect.value
  };
  console.log("[PageBrief popup] sauvegarde settings", payload);
  await chrome.storage.local.set(payload);
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

function resetOutput() {
  summaryEl.innerHTML = "";
  actionsEl.innerHTML = "";
  risksEl.innerHTML = "";
  tldrEl.textContent = "En attente…";
  readingTimeEl.textContent = "-";
  engineEl.textContent = "-";
}

function renderResult(data) {
  renderList(summaryEl, data.summary_points, "Aucun résumé disponible.");
  renderList(actionsEl, data.actions, "Aucune action détectée.");
  renderList(risksEl, data.risks, "Aucun risque détecté.");
  tldrEl.textContent = data.tldr || "Aucun TL;DR.";
  readingTimeEl.textContent = `${data.reading_time_min || "-"} min`;
  engineEl.textContent = data.engine || "-";
  if (data.source_kind) {
    pageKindEl.textContent = String(data.source_kind).toUpperCase();
  }
}

async function persistLastResult(data, statusMessage) {
  await chrome.storage.local.set({
    pagebrief_last_result: data,
    pagebrief_last_status: statusMessage
  });
}

async function clearLastResult() {
  await chrome.storage.local.remove(["pagebrief_last_result", "pagebrief_last_status"]);
}

async function handleInspectClick() {
  setLoading(true);
  setStatus("Extraction du contenu de l'onglet…");
  resetOutput();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log("[PageBrief popup] onglet actif", tab);
    if (!tab?.id) {
      throw new Error("Aucun onglet actif détecté.");
    }

    const extraction = await extractCurrentTab(tab.id);
    console.log("[PageBrief popup] extraction", {
      ...extraction,
      pageText: extraction.pageText ? `${extraction.pageText.slice(0, 200)}…` : ""
    });
    pageKindEl.textContent = extraction.sourceKind.toUpperCase();

    setStatus("Envoi au backend pour résumé…");

    const backendUrl = backendUrlInput.value.trim().replace(/\/$/, "");
    if (!backendUrl) {
      throw new Error("Renseigne une URL de backend.");
    }

    const requestBody = {
      url: extraction.url,
      title: extraction.title,
      page_text: extraction.pageText,
      mode: modeSelect.value
    };
    console.log("[PageBrief popup] POST", `${backendUrl}/v1/pagebrief/summarize`, requestBody);

    const response = await fetch(`${backendUrl}/v1/pagebrief/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });

    const raw = await response.text();
    console.log("[PageBrief popup] réponse brute", raw);
    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch (parseError) {
      console.error("[PageBrief popup] JSON invalide", parseError, raw);
      throw new Error(`Réponse backend illisible (HTTP ${response.status}).`);
    }

    console.log("[PageBrief popup] réponse JSON", data, "x-request-id=", response.headers.get("x-request-id"));

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `Le backend a refusé l'analyse (HTTP ${response.status}).`);
    }

    renderResult(data);

    const sourceHint = extraction.sourceKind === "pdf"
      ? "PDF public : extraction via URL si nécessaire."
      : "Page HTML analysée depuis l'onglet courant.";

    const statusMessage = `Résumé prêt (${data.engine || "unknown"}). ${sourceHint}`;
    setStatus(statusMessage, "ok");
    await persistLastResult(data, statusMessage);
  } catch (error) {
    console.error("[PageBrief popup] erreur", error);
    await clearLastResult();
    setStatus(error?.message || "Erreur pendant l'analyse.", "error");
  } finally {
    setLoading(false);
  }
}

async function extractCurrentTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const clean = (value) => String(value || "")
        .replace(/ /g, " ")
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
