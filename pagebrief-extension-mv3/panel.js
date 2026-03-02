import { SETTINGS_KEYS, MAX_HISTORY_ITEMS, VIEW_IDS } from "./src/constants.js";
import { state } from "./src/state.js";
import { dom } from "./src/dom.js";
import { readHistory, writeHistory } from "./src/storage.js";
import { getActiveTab, getTabState, patchTabState } from "./src/tabState.js";
import { sendToBackend, extractCurrentTab } from "./src/api.js";
import { normalizeUrl, capitalize, buildHistoryExplanation, buildHistoryKey, isTabStateStaleForUrl } from "./src/helpers.js";
import { applyEmptyRender, renderResult, buildPlainText } from "./src/views/renderView.js";
import { setActiveFormat, setLoading, renderSelectionState } from "./src/views/analyzeView.js";
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
      if (!hasCurrentResult()) {
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

function updateSummaryMeta(meta = {}) {
  if (meta.sourceKind) dom.sourceBadge.textContent = String(meta.sourceKind).toUpperCase();
  if (typeof meta.readingTime !== "undefined") dom.readingTime.textContent = meta.readingTime ? `${meta.readingTime} min` : "-";
  if (typeof meta.engine !== "undefined") dom.enginePill.textContent = meta.engine || "-";
  if (typeof meta.confidence !== "undefined") dom.confidencePill.textContent = meta.confidence || "-";
  if (typeof meta.scope !== "undefined") dom.scopeBadge.textContent = meta.scope || "document";
}

function hasCurrentResult() {
  return Boolean(dom.render.analysisBasis.dataset.hasResult === "1");
}

function markRenderHasResult(value) {
  dom.render.analysisBasis.dataset.hasResult = value ? "1" : "0";
}

function applyResultToUi(result) {
  renderResult(dom, result);
  markRenderHasResult(true);
  updateSummaryMeta({
    sourceKind: result.source_kind,
    readingTime: result.reading_time_min,
    engine: result.engine,
    confidence: result.confidence_label,
    scope: result.scope,
  });
}

function applyEmptyStateForCurrentTab(message) {
  const previousTitle = dom.docTitle.textContent;
  applyEmptyRender(dom, state.currentFormat);
  if (state.activeTabUrl && previousTitle && previousTitle !== "Aucun document analysé") {
    dom.docTitle.textContent = previousTitle;
  }
  markRenderHasResult(false);
  updateSummaryMeta({
    sourceKind: /\.pdf($|\?)/i.test(state.activeTabUrl) ? "pdf" : "html",
    readingTime: null,
    engine: "-",
    confidence: "-",
    scope: dom.analyze.scopeSelect.value,
  });
  setStatus(message, "warn");
}

async function syncForActiveTab() {
  const tab = await getActiveTab();
  if (!tab) {
    state.activeTabId = null;
    state.activeTabUrl = "";
    applyEmptyStateForCurrentTab("Aucun onglet actif détecté.");
    renderSelectionState(dom, null);
    return;
  }

  state.activeTabId = tab.id;
  state.activeTabUrl = tab.url || "";
  dom.docTitle.textContent = tab.title || "Onglet actif";
  updateSummaryMeta({ sourceKind: /\.pdf($|\?)/i.test(state.activeTabUrl) ? "pdf" : "html" });

  let tabState = await getTabState(state.activeTabId);
  const isPdf = /\.pdf($|\?)/i.test(state.activeTabUrl);

  if (isTabStateStaleForUrl(tabState, state.activeTabUrl)) {
    await patchTabState(state.activeTabId, {
      url: state.activeTabUrl,
      title: tab.title || "",
      sourceKind: isPdf ? "pdf" : "html",
      status: "",
      result: null,
      pendingSelection: null,
    });
    tabState = await getTabState(state.activeTabId);
  }

  state.lastKnownSelection = tabState?.pendingSelection || null;

  if (tabState?.result) {
    applyResultToUi(tabState.result);
    setStatus(tabState.status || "Dernière analyse restaurée pour cet onglet.", "ok");
  } else {
    applyEmptyStateForCurrentTab(tabState?.updatedAt
      ? "Cet onglet a changé de page : relance l'analyse."
      : "Aucune analyse enregistrée pour cet onglet.");
  }

  await refreshSelectionState(state.lastKnownSelection);
}

async function refreshSelectionState(cached = null) {
  let selection = cached;
  if (!selection && typeof state.activeTabId === "number") {
    const tabState = await getTabState(state.activeTabId);
    selection = tabState?.pendingSelection || null;
  }

  state.lastKnownSelection = selection || null;
  renderSelectionState(dom, state.lastKnownSelection);

  if (selection?.text && dom.analyze.scopeSelect.value !== "selection") {
    dom.analyze.scopeSelect.value = "selection";
    await persistSettings();
  }
}

async function handlePickClick() {
  setStatus("Mode ciblage activé : clique sur un bloc de texte dans cette page.");

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
  setStatus("Extraction du contenu de l'onglet…");

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("Aucun onglet actif détecté.");

    state.activeTabId = tab.id;
    state.activeTabUrl = tab.url || "";

    const preferSelection = dom.analyze.scopeSelect.value === "selection";
    const tabState = await getTabState(state.activeTabId);
    const pendingSelection = tabState?.pendingSelection;
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
        ? "PDF public : extraction via URL si nécessaire."
        : requestPayload.scope === "selection"
          ? "Passage sélectionné dans la page HTML."
          : "Page HTML analysée depuis l'onglet courant.";
      updateSummaryMeta({ sourceKind: extraction.sourceKind });
    }

    const result = await sendToBackend(dom.settings.backendUrl.value, requestPayload);
    const statusMessage = `Vue ${result.format_label || state.currentFormat} prête (${result.engine || "unknown"}). ${sourceHint}`;
    setStatus(statusMessage, "ok");
    applyResultToUi(result);
    await patchTabState(state.activeTabId, {
      url: requestPayload.url,
      title: requestPayload.title,
      sourceKind: result.source_kind || "page",
      status: statusMessage,
      result,
      lastAnalyzedAt: Date.now(),
      pendingSelection: shouldClearSelection ? null : pendingSelection,
    });
    await upsertHistoryEntry(requestPayload, result);

    if (shouldClearSelection) {
      state.lastKnownSelection = null;
    }

    setActiveView("render", true);
    await persistSettings();
  } catch (error) {
    setStatus(error?.message || "Erreur pendant l'analyse.", "error");
  } finally {
    await refreshSelectionState();
    setLoading(dom, false);
  }
}

async function handleAnalyzeSelectionClick() {
  setLoading(dom, true, "selection");
  setStatus("Envoi du passage ciblé au backend…");

  try {
    const tab = await getActiveTab();
    if (!tab?.id) throw new Error("Aucun onglet actif détecté.");

    state.activeTabId = tab.id;
    const tabState = await getTabState(state.activeTabId);
    const selection = tabState?.pendingSelection;

    if (!selection?.text) {
      throw new Error("Aucune sélection enregistrée pour cet onglet. Utilise d'abord “Cibler un passage”.");
    }

    const requestPayload = {
      url: selection.url,
      title: selection.title,
      page_text: selection.text,
      format: state.currentFormat,
      scope: "selection",
      focus_hint: selection.label || "Passage ciblé",
    };

    const result = await sendToBackend(dom.settings.backendUrl.value, requestPayload);
    const statusMessage = `Vue ${result.format_label || state.currentFormat} prête (${result.engine || "unknown"}). Passage ciblé analysé.`;

    setStatus(statusMessage, "ok");
    applyResultToUi(result);
    await patchTabState(state.activeTabId, {
      url: selection.url,
      title: selection.title,
      sourceKind: selection.sourceKind || "html",
      status: statusMessage,
      result,
      lastAnalyzedAt: Date.now(),
      pendingSelection: null,
    });
    await upsertHistoryEntry(requestPayload, result);
    state.lastKnownSelection = null;

    setActiveView("render", true);
    await persistSettings();
  } catch (error) {
    setStatus(error?.message || "Erreur pendant l'analyse ciblée.", "error");
  } finally {
    await refreshSelectionState();
    setLoading(dom, false);
  }
}

async function handleCopyClick() {
  if (typeof state.activeTabId !== "number") {
    setStatus("Aucun onglet actif détecté.", "warn");
    return;
  }

  const tabState = await getTabState(state.activeTabId);
  const result = tabState?.result;
  if (!result) {
    setStatus("Aucun rendu disponible pour cet onglet.", "warn");
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
  setStatus("Aperçu chargé depuis l'historique de session.", "ok");
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
