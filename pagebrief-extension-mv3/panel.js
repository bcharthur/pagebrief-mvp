import { SETTINGS_KEYS, MAX_HISTORY_ITEMS, VIEW_IDS } from "./src/constants.js";
import { state } from "./src/state.js";
import { dom } from "./src/dom.js";
import { readHistory, writeHistory } from "./src/storage.js";
import { getActiveTab, getTabState, patchTabState } from "./src/tabState.js";
import { sendToBackend, extractCurrentTab } from "./src/api.js";
import { capitalize, buildHistoryExplanation, buildHistoryKey } from "./src/helpers.js";
import { applyEmptyRender, renderResult, buildPlainText } from "./src/views/renderView.js";
import { setActiveFormat, setLoading, renderSelectionState, renderActiveTarget } from "./src/views/analyzeView.js";
import { renderHistory } from "./src/views/historyView.js";
import { renderSettings } from "./src/views/settingsView.js";

init().catch((error) => {
  console.error("[PageBrief panel] init error", error);
  setStatus(error?.message || "Erreur d'initialisation.", "error");
});

async function init() {
  const stored = await chrome.storage.local.get(SETTINGS_KEYS);

  dom.settings.backendUrl.value = stored.pagebrief_backend_url || "http://localhost:8000";
  state.currentFormat = stored.pagebrief_view_format || "express";
  dom.analyze.scopeSelect.value = stored.pagebrief_scope || "document";
  state.activeView = VIEW_IDS.includes(stored.pagebrief_active_view) ? stored.pagebrief_active_view : "render";

  setActiveFormat(dom, state.currentFormat);
  setActiveView(state.activeView, false);
  wireEvents();

  applyEmptyRender(dom, state.currentFormat);
  updateSummaryMeta();
  await refreshHistoryPanel();
  await syncForActiveTab();
  renderSettings(dom, dom.settings.backendUrl.value);
}

function wireEvents() {
  dom.menuToggle.addEventListener("click", () => toggleDrawer(true));
  dom.closeDrawerBtn.addEventListener("click", () => toggleDrawer(false));
  dom.menuDrawer.addEventListener("click", (event) => {
    if (event.target === dom.menuDrawer) toggleDrawer(false);
  });

  dom.navItems.forEach((button) => {
    button.addEventListener("click", async () => {
      setActiveView(button.dataset.viewTarget || "render", true);
      toggleDrawer(false);
      await persistSettings();
    });
  });

  dom.accordionTriggers.forEach((button) => {
    button.addEventListener("click", () => toggleAccordion(button));
  });

  dom.analyze.formatTabs.forEach((button) => {
    button.addEventListener("click", async () => {
      state.currentFormat = button.dataset.format || "express";
      setActiveFormat(dom, state.currentFormat);
      if (!state.currentResult) {
        applyEmptyRender(dom, state.currentFormat);
      }
      await persistSettings();
    });
  });

  dom.analyze.scopeSelect.addEventListener("change", persistSettings);
  dom.analyze.inspectBtn.addEventListener("click", handleInspectClick);
  dom.analyze.pickBtn.addEventListener("click", handlePickClick);
  dom.analyze.analyzeSelectionBtn.addEventListener("click", handleAnalyzeSelectionClick);

  dom.render.copyBtn.addEventListener("click", handleCopyClick);
  dom.render.refreshBtn.addEventListener("click", handleRefreshClick);

  dom.settings.saveSettingsBtn.addEventListener("click", async () => {
    await persistSettings();
    setStatus("Paramètres enregistrés.", "ok");
  });
  dom.settings.backendUrl.addEventListener("change", persistSettings);

  dom.history.clearHistoryBtn.addEventListener("click", handleClearHistoryClick);
  dom.history.historySearch.addEventListener("input", () => {
    renderHistory(dom, state.historyItems, historyHandlers(), dom.history.historySearch.value);
  });

  chrome.tabs.onActivated.addListener(() => {
    syncForActiveTab().catch(console.warn);
  });

  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (tabId !== state.activeTabId && info.status !== "complete") return;
    if (info.status === "complete") {
      await syncForActiveTab();
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "pagebrief_tab_state_updated" && typeof message.tabId === "number" && message.tabId === state.activeTabId) {
      syncForActiveTab().catch(console.warn);
    }
  });
}

function toggleDrawer(open) {
  dom.menuDrawer.classList.toggle("hidden", !open);
  dom.menuDrawer.setAttribute("aria-hidden", open ? "false" : "true");
}

function setActiveView(viewName, focusRenderTop = false) {
  state.activeView = VIEW_IDS.includes(viewName) ? viewName : "render";

  for (const [name, element] of Object.entries(dom.views)) {
    element.classList.toggle("hidden", name !== state.activeView);
  }

  dom.navItems.forEach((button) => {
    button.classList.toggle("active", button.dataset.viewTarget === state.activeView);
  });

  if (focusRenderTop) {
    document.querySelector(".view-stage")?.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function toggleAccordion(button) {
  const targetId = button.dataset.accordionTarget;
  const panel = targetId ? document.getElementById(targetId) : null;
  if (!panel) return;
  const open = !panel.classList.contains("open");
  panel.classList.toggle("open", open);
  button.setAttribute("aria-expanded", open ? "true" : "false");
}

async function persistSettings() {
  await chrome.storage.local.set({
    pagebrief_backend_url: dom.settings.backendUrl.value.trim(),
    pagebrief_view_format: state.currentFormat,
    pagebrief_scope: dom.analyze.scopeSelect.value,
    pagebrief_active_view: state.activeView,
  });
}

function setStatus(message, type = "") {
  dom.statusBar.textContent = message;
  dom.statusBar.className = `status-bar ${type}`.trim();
}

function startProgress(label) {
  stopProgress();
  state.progressStartedAt = Date.now();
  dom.statusProgressWrap.classList.remove("hidden");
  dom.statusProgressWrap.setAttribute("aria-hidden", "false");
  const tick = () => {
    const elapsed = Math.max(0, Date.now() - state.progressStartedAt);
    const seconds = Math.max(1, Math.floor(elapsed / 1000));
    const pct = Math.min(94, Math.round(8 + (1 - Math.exp(-elapsed / 20000)) * 86));
    dom.statusProgressFill.style.width = `${pct}%`;
    setStatus(`${label} • ${seconds}s • ${pct}%`, "warn");
  };
  tick();
  state.progressTimer = window.setInterval(tick, 350);
}

function stopProgress(finalMessage = "", type = "") {
  if (state.progressTimer) {
    window.clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
  state.progressStartedAt = 0;
  dom.statusProgressFill.style.width = "100%";
  if (finalMessage) {
    setStatus(finalMessage, type);
  }
  window.setTimeout(() => {
    if (!state.progressTimer) {
      dom.statusProgressWrap.classList.add("hidden");
      dom.statusProgressWrap.setAttribute("aria-hidden", "true");
      dom.statusProgressFill.style.width = "0%";
    }
  }, finalMessage ? 450 : 0);
}

function computeConfidence(result) {
  if (result?.confidence_label) return result.confidence_label;
  if (result?.engine === "llm") return "Élevée";
  if (result?.engine === "heuristic") return "Moyenne";
  return "-";
}

function updateSummaryMeta(meta = {}) {
  if (meta.sourceKind) dom.sourceBadge.textContent = String(meta.sourceKind).toUpperCase();
  if (typeof meta.readingTime !== "undefined") dom.readingTime.textContent = meta.readingTime ? `${meta.readingTime} min` : "-";
  if (typeof meta.confidence !== "undefined") dom.confidencePill.textContent = meta.confidence || "-";
}

function applyResultToUi(result) {
  state.currentResult = result;
  state.currentFormat = result.view_format || state.currentFormat;
  setActiveFormat(dom, state.currentFormat);
  renderResult(dom, result);
  updateSummaryMeta({
    sourceKind: result.source_kind,
    readingTime: result.reading_time_min,
    confidence: computeConfidence(result),
  });
}

function applyEmptyState(message) {
  state.currentResult = null;
  applyEmptyRender(dom, state.currentFormat);
  if (state.activeTabTitle) {
    dom.docTitle.textContent = state.activeTabTitle;
  }
  updateSummaryMeta({
    sourceKind: /\.pdf($|\?)/i.test(state.activeTabUrl) ? "pdf" : "html",
    readingTime: null,
    confidence: "-",
  });
  setStatus(message, "warn");
}

async function syncForActiveTab() {
  const tab = await getActiveTab();
  if (!tab) {
    state.activeTabId = null;
    state.activeTabUrl = "";
    state.activeTabTitle = "";
    renderActiveTarget(dom, "Aucun onglet actif", "");
    if (!state.currentResult) applyEmptyState("Aucun onglet actif détecté.");
    renderSelectionState(dom, null);
    return;
  }

  state.activeTabId = tab.id;
  state.activeTabUrl = tab.url || "";
  state.activeTabTitle = tab.title || "Onglet actif";
  renderActiveTarget(dom, state.activeTabTitle, state.activeTabUrl);

  if (!state.currentResult) {
    dom.docTitle.textContent = state.activeTabTitle;
    updateSummaryMeta({ sourceKind: /\.pdf($|\?)/i.test(state.activeTabUrl) ? "pdf" : "html" });
  }

  const selectionState = await getTabState(state.activeTabId);
  state.lastKnownSelection = selectionState?.pendingSelection || null;
  await refreshSelectionState(state.lastKnownSelection);
}

async function refreshSelectionState(cached = null) {
  let selection = cached;
  if (!selection && typeof state.activeTabId === "number") {
    const selectionState = await getTabState(state.activeTabId);
    selection = selectionState?.pendingSelection || null;
  }

  state.lastKnownSelection = selection || null;
  renderSelectionState(dom, state.lastKnownSelection);

  if (selection?.text && dom.analyze.scopeSelect.value !== "selection") {
    dom.analyze.scopeSelect.value = "selection";
    await persistSettings();
  }
}

async function handlePickClick() {
  setStatus("Mode ciblage activé : clique sur un bloc de texte dans cette page.", "warn");

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("Aucun onglet actif détecté.");

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["selection.js"],
    });
  } catch (error) {
    setStatus(error?.message || "Impossible d'activer le ciblage.", "error");
  }
}

async function handleInspectClick() {
  setLoading(dom, true, "inspect");
  startProgress("Analyse du document en cours");

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("Aucun onglet actif détecté.");

    state.activeTabId = tab.id;
    state.activeTabUrl = tab.url || "";
    state.activeTabTitle = tab.title || "Onglet actif";

    const preferSelection = dom.analyze.scopeSelect.value === "selection";
    const selectionState = await getTabState(state.activeTabId);
    const pendingSelection = selectionState?.pendingSelection;
    let requestPayload;
    let sourceHint;
    let shouldClearSelection = false;

    if (preferSelection && pendingSelection?.text) {
      shouldClearSelection = true;
      requestPayload = {
        url: pendingSelection.url,
        title: pendingSelection.title,
        page_text: pendingSelection.text,
        format: state.currentFormat,
        scope: "selection",
        focus_hint: pendingSelection.label || "Passage ciblé",
      };
      sourceHint = "Passage ciblé analysé.";
      updateSummaryMeta({ sourceKind: pendingSelection.sourceKind || "html" });
    } else {
      const extraction = await extractCurrentTab(tab.id, preferSelection);
      requestPayload = {
        url: extraction.url,
        title: extraction.title,
        page_text: extraction.pageText,
        format: state.currentFormat,
        scope: extraction.scope || (preferSelection ? "selection" : "document"),
        focus_hint: extraction.selectionLabel || "",
      };
      sourceHint = extraction.sourceKind === "pdf"
        ? "PDF analysé depuis son URL ou son aperçu." 
        : requestPayload.scope === "selection"
          ? "Passage sélectionné dans la page HTML."
          : "Page HTML analysée depuis l'onglet courant.";
      updateSummaryMeta({ sourceKind: extraction.sourceKind });
    }

    state.lastRequestPayload = requestPayload;
    const result = await sendToBackend(dom.settings.backendUrl.value, requestPayload);
    const statusMessage = `Vue ${result.format_label || capitalize(state.currentFormat)} prête. ${sourceHint}`;
    stopProgress(statusMessage, "ok");
    applyResultToUi(result);
    await upsertHistoryEntry(requestPayload, result);

    if (shouldClearSelection && typeof state.activeTabId === "number") {
      await patchTabState(state.activeTabId, { pendingSelection: null });
      state.lastKnownSelection = null;
    }

    setActiveView("render", true);
    await persistSettings();
  } catch (error) {
    stopProgress(error?.message || "Erreur pendant l'analyse.", "error");
  } finally {
    await refreshSelectionState();
    setLoading(dom, false);
  }
}

async function handleAnalyzeSelectionClick() {
  setLoading(dom, true, "selection");
  startProgress("Analyse du passage en cours");

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("Aucun onglet actif détecté.");

    state.activeTabId = tab.id;
    const selectionState = await getTabState(state.activeTabId);
    const selection = selectionState?.pendingSelection;

    if (!selection?.text) {
      throw new Error("Aucune sélection enregistrée. Utilise d'abord “Cibler un passage”.");
    }

    const requestPayload = {
      url: selection.url,
      title: selection.title,
      page_text: selection.text,
      format: state.currentFormat,
      scope: "selection",
      focus_hint: selection.label || "Passage ciblé",
    };

    state.lastRequestPayload = requestPayload;
    const result = await sendToBackend(dom.settings.backendUrl.value, requestPayload);
    const statusMessage = `Vue ${result.format_label || capitalize(state.currentFormat)} prête. Passage ciblé analysé.`;

    stopProgress(statusMessage, "ok");
    applyResultToUi(result);
    await patchTabState(state.activeTabId, { pendingSelection: null });
    await upsertHistoryEntry(requestPayload, result);
    state.lastKnownSelection = null;

    setActiveView("render", true);
    await persistSettings();
  } catch (error) {
    stopProgress(error?.message || "Erreur pendant l'analyse ciblée.", "error");
  } finally {
    await refreshSelectionState();
    setLoading(dom, false);
  }
}

async function handleCopyClick() {
  const result = state.currentResult;
  if (!result) {
    setStatus("Aucun rendu chargé.", "warn");
    return;
  }

  const text = buildPlainText(result);
  await navigator.clipboard.writeText(text);
  setStatus("Rendu copié dans le presse-papiers.", "ok");
}

async function handleRefreshClick() {
  await handleInspectClick();
}

function historyHandlers() {
  return {
    onPreview: previewHistoryEntry,
    onOpen: openHistoryUrl,
  };
}

async function refreshHistoryPanel() {
  state.historyItems = await readHistory();
  renderHistory(dom, state.historyItems, historyHandlers(), dom.history.historySearch.value);
}

async function upsertHistoryEntry(requestPayload, result) {
  if (!result) return;
  const current = await readHistory();
  const scope = result.scope || requestPayload.scope || "document";
  const historyKey = buildHistoryKey(requestPayload.url, scope, requestPayload.focus_hint || "");

  const entry = {
    key: historyKey,
    url: requestPayload.url || "",
    title: requestPayload.title || result.panel_title || "Document analysé",
    sourceKind: result.source_kind || "page",
    format: result.view_format || state.currentFormat,
    formatLabel: result.format_label || capitalize(result.view_format || state.currentFormat),
    scope,
    savedAt: Date.now(),
    explanation: buildHistoryExplanation(result),
    result,
  };

  const next = [entry, ...current.filter((item) => item.key !== historyKey)].slice(0, MAX_HISTORY_ITEMS);
  await writeHistory(next);
  state.historyItems = next;
  renderHistory(dom, state.historyItems, historyHandlers(), dom.history.historySearch.value);
}

function previewHistoryEntry(entry) {
  if (!entry?.result) {
    setStatus("Cet élément d'historique n'a pas de rendu complet.", "warn");
    return;
  }
  if (entry.result.view_format) {
    state.currentFormat = entry.result.view_format;
    setActiveFormat(dom, state.currentFormat);
  }
  applyResultToUi(entry.result);
  setStatus("Rendu chargé depuis l'historique de session.", "ok");
  setActiveView("render", true);
  persistSettings().catch(console.warn);
}

async function openHistoryUrl(url, newTab) {
  if (!url) {
    setStatus("Aucune URL disponible pour cet élément d'historique.", "warn");
    return;
  }

  if (newTab) {
    await chrome.tabs.create({ url });
    return;
  }

  const tab = await getActiveTab();
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { url });
    return;
  }

  await chrome.tabs.create({ url });
}

async function handleClearHistoryClick() {
  await writeHistory([]);
  state.historyItems = [];
  renderHistory(dom, state.historyItems, historyHandlers(), dom.history.historySearch.value);
  setStatus("Historique de session vidé.", "ok");
}
