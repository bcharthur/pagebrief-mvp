import { SETTINGS_KEYS, VIEW_IDS } from "./src/constants.js";
import { state } from "./src/state.js";
import { dom } from "./src/dom.js";
import { getActiveTab, getTabState, patchTabState } from "./src/tabState.js";
import { ApiError, createAnalysisJob, extractCurrentTab, fetchHistory, fetchMe, getAnalysisJob, login, register } from "./src/api.js";
import { formatConfidence, formatFormatLabel, formatPlan } from "./src/helpers.js";
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

  dom.settings.backendUrl.value = stored.pagebrief_backend_url || "http://localhost";
  dom.settings.authEmail.value = stored.pagebrief_auth_email || "";
  state.authToken = stored.pagebrief_auth_token || "";
  state.currentFormat = stored.pagebrief_view_format || "express";
  dom.analyze.scopeSelect.value = stored.pagebrief_scope || "document";
  state.activeView = VIEW_IDS.includes(stored.pagebrief_active_view) ? stored.pagebrief_active_view : "render";

  setActiveFormat(dom, state.currentFormat);
  setActiveView(state.activeView, false);
  wireEvents();

  applyEmptyRender(dom, state.currentFormat);
  updateSummaryMeta();
  renderSettingsPanel();
  renderHistoryPanel(false);

  await syncAuthSession();
  await syncForActiveTab();
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
      if ((button.dataset.viewTarget || "") === "history") {
        await refreshHistoryPanel(false);
      }
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
  dom.settings.loginBtn.addEventListener("click", () => handleLoginClick(false));
  dom.settings.registerBtn.addEventListener("click", () => handleLoginClick(true));
  dom.settings.logoutBtn.addEventListener("click", handleLogoutClick);
  dom.settings.backendUrl.addEventListener("change", persistSettings);
  dom.settings.authEmail.addEventListener("change", persistSettings);

  dom.history.clearHistoryBtn.addEventListener("click", () => refreshHistoryPanel(true));
  dom.history.historySearch.addEventListener("input", () => {
    renderHistoryPanel(false);
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
    pagebrief_auth_email: dom.settings.authEmail.value.trim(),
    pagebrief_auth_token: state.authToken || "",
  });
}

function setStatus(message, type = "") {
  dom.statusBar.textContent = message;
  dom.statusBar.className = `status-bar ${type}`.trim();
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function getSoftProgressTarget(realProgress) {
  const p = clampPercent(realProgress);

  if (p >= 100) return 100;
  if (p >= 90) return 97;
  if (p >= 60) return 92;
  if (p >= 45) return 82;
  if (p >= 20) return 38;
  if (p >= 5) return 14;
  return 8;
}

function stopProgressLoop() {
  if (state.progressTimer) {
    window.clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

function paintProgress(labelOverride = "") {
  const label = labelOverride || state.progressLabel || "Analyse en cours";
  const elapsed = Math.max(0, Date.now() - (state.progressStartedAt || Date.now()));
  const seconds = Math.max(1, Math.floor(elapsed / 1000));

  const visible = clampPercent(
    Math.max(
      state.progressReal || 0,
      state.progressVisual || 0
    )
  );

  dom.statusProgressWrap.classList.remove("hidden");
  dom.statusProgressWrap.setAttribute("aria-hidden", "false");
  dom.statusProgressFill.style.width = `${visible}%`;

  setStatus(`${label} • ${seconds}s • ${visible}%`, "warn");
}

function ensureProgressLoop() {
  if (state.progressTimer) return;

  state.progressTimer = window.setInterval(() => {
    const visual = clampPercent(state.progressVisual || 0);
    const target = clampPercent(state.progressTarget || 0);

    if (visual < target) {
      const gap = target - visual;
      const step = gap >= 20 ? 2 : 1;
      state.progressVisual = Math.min(target, visual + step);
      paintProgress();
    }
  }, 180);
}

function showProgress(progress = 0, label = "Analyse en cours") {
  const real = clampPercent(progress);

  if (!state.progressStartedAt) {
    state.progressStartedAt = Date.now();
    state.progressVisual = 0;
    state.progressTarget = 0;
    state.progressReal = 0;
  }

  state.progressLabel = label;
  state.progressReal = Math.max(clampPercent(state.progressReal || 0), real);

  // Cible visuelle "douce" pour éviter une barre figée pendant Ollama
  const softTarget = getSoftProgressTarget(real);
  state.progressTarget = Math.max(
    clampPercent(state.progressTarget || 0),
    softTarget
  );

  // Ne jamais afficher moins que le vrai progrès backend
  state.progressVisual = Math.max(
    clampPercent(state.progressVisual || 0),
    state.progressReal
  );

  ensureProgressLoop();
  paintProgress(label);
}

function hideProgress(finalMessage = "", type = "") {
  stopProgressLoop();

  state.progressReal = 100;
  state.progressTarget = 100;
  state.progressVisual = 100;

  dom.statusProgressWrap.classList.remove("hidden");
  dom.statusProgressWrap.setAttribute("aria-hidden", "false");
  dom.statusProgressFill.style.width = "100%";

  if (finalMessage) {
    setStatus(finalMessage, type);
  }

  window.setTimeout(() => {
    dom.statusProgressWrap.classList.add("hidden");
    dom.statusProgressWrap.setAttribute("aria-hidden", "true");
    dom.statusProgressFill.style.width = "0%";

    state.progressStartedAt = 0;
    state.progressReal = 0;
    state.progressTarget = 0;
    state.progressVisual = 0;
    state.progressLabel = "";
  }, finalMessage ? 500 : 0);
}

function updateSummaryMeta(meta = {}) {
  if (typeof meta.sourceKind !== "undefined") {
    const source = String(meta.sourceKind || "page").toUpperCase();
    dom.sourceBadge.textContent = source === "HTML" ? "PAGE" : source;
  }
  if (typeof meta.readingTime !== "undefined") dom.readingTime.textContent = meta.readingTime ? `${meta.readingTime} min` : "-";
  if (typeof meta.confidence !== "undefined") dom.confidencePill.textContent = meta.confidence || "-";
}

function normalizeResultFromJob(job, sourceHint = "") {
  const payload = job?.result || {};
  const format = job?.format || state.currentFormat || "express";
  return {
    ...payload,
    title: payload.title || job?.title || state.activeTabTitle || "Document analysé",
    document_title: payload.document_title || job?.title || state.activeTabTitle || "Document analysé",
    panel_title: payload.panel_title || `Vue ${formatFormatLabel(format)}`,
    format_label: payload.format_label || formatFormatLabel(format),
    view_format: format,
    source_kind: job?.source_type || payload.source_kind || "html",
    reading_time_min: job?.reading_time_min || payload.reading_time_min || null,
    confidence_label: formatConfidence(job?.confidence || payload.confidence || ""),
    analysis_basis: payload.analysis_basis || "Analyse complète",
    source_note: payload.source_note || sourceHint || "Analyse terminée.",
    intro_lines: Array.isArray(payload.intro_lines) ? payload.intro_lines : [],
    key_points: Array.isArray(payload.key_points) ? payload.key_points : [],
    annex_blocks: Array.isArray(payload.annex_blocks) ? payload.annex_blocks : [],
    conclusion: payload.conclusion || payload.tldr || "",
  };
}

function applyResultToUi(result) {
  state.currentResult = result;
  state.currentFormat = result.view_format || state.currentFormat;
  setActiveFormat(dom, state.currentFormat);
  renderResult(dom, result);
  updateSummaryMeta({
    sourceKind: result.source_kind,
    readingTime: result.reading_time_min,
    confidence: result.confidence_label || "-",
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

function clearSession(keepEmail = true) {
  state.authToken = "";
  state.currentUser = null;
  state.historyItems = [];
  if (!keepEmail) {
    dom.settings.authEmail.value = "";
  }
}

function renderSettingsPanel() {
  renderSettings(dom, {
    backendUrl: dom.settings.backendUrl.value.trim(),
    email: dom.settings.authEmail.value.trim(),
    connected: Boolean(state.authToken && state.currentUser),
    user: state.currentUser,
  });
}

function renderHistoryPanel(authenticated) {
  renderHistory(dom, state.historyItems, historyHandlers(), dom.history.historySearch.value, { authenticated });
}

async function syncAuthSession() {
  renderSettingsPanel();

  if (!state.authToken) {
    renderHistoryPanel(false);
    return;
  }

  try {
    state.currentUser = await fetchMe(dom.settings.backendUrl.value, state.authToken);
    renderSettingsPanel();
    await refreshHistoryPanel(false);
    setStatus(`Connecté · ${state.currentUser.email} · ${formatPlan(state.currentUser.plan)}`, "ok");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(true);
      await persistSettings();
      renderSettingsPanel();
      renderHistoryPanel(false);
      setStatus("Session expirée. Reconnecte-toi dans Réglages.", "warn");
      return;
    }
    throw error;
  }
}

async function ensureAuthenticated() {
  if (state.authToken && state.currentUser) return;
  throw new Error("Connecte-toi d'abord dans Réglages pour utiliser le backend pro.");
}

async function refreshHistoryPanel(showMessage = false) {
  if (!state.authToken || !state.currentUser) {
    state.historyItems = [];
    renderHistoryPanel(false);
    if (showMessage) setStatus("Aucune session active. Connecte-toi pour charger l'historique.", "warn");
    return;
  }

  try {
    state.historyItems = await fetchHistory(dom.settings.backendUrl.value, state.authToken);
    renderHistoryPanel(true);
    if (showMessage) setStatus("Historique serveur actualisé.", "ok");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(true);
      await persistSettings();
      renderSettingsPanel();
      renderHistoryPanel(false);
      setStatus("Session expirée. Reconnecte-toi pour voir l'historique.", "warn");
      return;
    }
    setStatus(error?.message || "Impossible de charger l'historique.", "error");
  }
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

async function buildAnalysisPayload({ preferStoredSelection = false, forceStoredSelection = false } = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("Aucun onglet actif détecté.");

  state.activeTabId = tab.id;
  state.activeTabUrl = tab.url || "";
  state.activeTabTitle = tab.title || "Onglet actif";

  const selectionState = await getTabState(state.activeTabId);
  const pendingSelection = selectionState?.pendingSelection;

  if ((forceStoredSelection || preferStoredSelection) && pendingSelection?.text) {
    return {
      payload: {
        format: state.currentFormat,
        scope: "selection",
        title: pendingSelection.title || state.activeTabTitle,
        source_url: pendingSelection.url || state.activeTabUrl,
        source_type: pendingSelection.sourceKind || "html",
        text_content: pendingSelection.text,
      },
      sourceHint: "Passage ciblé analysé.",
      shouldClearSelection: true,
      sourceKind: pendingSelection.sourceKind || "html",
    };
  }

  if (forceStoredSelection) {
    throw new Error("Aucune sélection enregistrée. Utilise d'abord “Cibler un passage”.");
  }

  const preferSelection = dom.analyze.scopeSelect.value === "selection";
  const likelyPdfUrl = /\.pdf($|\?)/i.test(state.activeTabUrl || "");

  if (likelyPdfUrl) {
    return {
      payload: {
        format: state.currentFormat,
        scope: "document",
        title: state.activeTabTitle,
        source_url: state.activeTabUrl,
        source_type: "pdf",
        text_content: "",
      },
      sourceHint: state.activeTabUrl.startsWith("file:")
        ? "PDF local analysé depuis son chemin de fichier."
        : "PDF analysé depuis son URL.",
      shouldClearSelection: false,
      sourceKind: "pdf",
    };
  }

  const extraction = await extractCurrentTab(tab.id, preferSelection);
  const sourceType = extraction.sourceKind === "pdf" ? "pdf" : "html";
  const scope = sourceType === "pdf" ? "document" : (extraction.scope || (preferSelection ? "selection" : "document"));

  const payload = {
    format: state.currentFormat,
    scope,
    title: extraction.title || state.activeTabTitle,
    source_url: extraction.url || state.activeTabUrl,
    source_type: sourceType,
    text_content: sourceType === "html" ? (extraction.pageText || "") : "",
  };

  let sourceHint = "Page HTML analysée depuis l'onglet courant.";
  if (sourceType === "pdf") {
    sourceHint = extraction.url?.startsWith("file:")
      ? "PDF local analysé depuis son chemin de fichier."
      : "PDF analysé depuis son URL.";
  } else if (scope === "selection") {
    sourceHint = "Passage sélectionné dans la page HTML.";
  }

  return {
    payload,
    sourceHint,
    shouldClearSelection: false,
    sourceKind: sourceType,
  };
}

async function pollJobUntilDone(jobId) {
  const startedAt = Date.now();
  let snapshot = null;

  while (Date.now() - startedAt < 300000) {
    snapshot = await getAnalysisJob(dom.settings.backendUrl.value, state.authToken, jobId);
    showProgress(snapshot.progress, snapshot.progress_label || "Analyse en cours");

    if (snapshot.status === "done" || snapshot.status === "failed") {
      return snapshot;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }

  throw new Error("Analyse trop longue : le job n'a pas terminé à temps.");
}

async function runAnalysis(built) {
  await ensureAuthenticated();
  updateSummaryMeta({ sourceKind: built.sourceKind });

  state.lastRequestPayload = built.payload;
  showProgress(0, "Création du job");

  const created = await createAnalysisJob(dom.settings.backendUrl.value, state.authToken, built.payload);
  const finalJob = await pollJobUntilDone(created.job_id);

  if (finalJob.status === "failed") {
    throw new Error(finalJob.error_message || "Le backend a signalé une erreur d'analyse.");
  }

  const normalized = normalizeResultFromJob(finalJob, built.sourceHint);
  const finalMessage = `${normalized.panel_title} prête. ${built.sourceHint}`;

  hideProgress(finalMessage, "ok");
  applyResultToUi(normalized);

  if (built.shouldClearSelection && typeof state.activeTabId === "number") {
    await patchTabState(state.activeTabId, { pendingSelection: null });
    state.lastKnownSelection = null;
  }

  await refreshHistoryPanel(false);
  setActiveView("render", true);
  await persistSettings();
}

async function handleInspectClick() {
  setLoading(dom, true, "inspect");

  try {
    const built = await buildAnalysisPayload({ preferStoredSelection: dom.analyze.scopeSelect.value === "selection" });
    await runAnalysis(built);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(true);
      await persistSettings();
      renderSettingsPanel();
      renderHistoryPanel(false);
      hideProgress("Session expirée. Reconnecte-toi dans Réglages.", "warn");
    } else {
      hideProgress(error?.message || "Erreur pendant l'analyse.", "error");
    }
  } finally {
    await refreshSelectionState();
    setLoading(dom, false);
  }
}

async function handleAnalyzeSelectionClick() {
  setLoading(dom, true, "selection");

  try {
    const built = await buildAnalysisPayload({ forceStoredSelection: true });
    await runAnalysis(built);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(true);
      await persistSettings();
      renderSettingsPanel();
      renderHistoryPanel(false);
      hideProgress("Session expirée. Reconnecte-toi dans Réglages.", "warn");
    } else {
      hideProgress(error?.message || "Erreur pendant l'analyse ciblée.", "error");
    }
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

async function handleLoginClick(shouldRegister) {
  const email = dom.settings.authEmail.value.trim();
  const password = dom.settings.authPassword.value;

  if (!email || !password) {
    setStatus("Renseigne un email et un mot de passe.", "warn");
    setActiveView("settings", true);
    return;
  }

  try {
    if (shouldRegister) {
      await register(dom.settings.backendUrl.value, email, password);
    }

    const tokenResponse = await login(dom.settings.backendUrl.value, email, password);
    state.authToken = tokenResponse.access_token || "";
    state.currentUser = await fetchMe(dom.settings.backendUrl.value, state.authToken);
    dom.settings.authPassword.value = "";

    await persistSettings();
    renderSettingsPanel();
    await refreshHistoryPanel(false);
    setStatus(`Connecté · ${state.currentUser.email} · ${formatPlan(state.currentUser.plan)}`, "ok");
  } catch (error) {
    if (error instanceof ApiError) {
      setStatus(error.message || "Connexion impossible.", "error");
    } else {
      setStatus(error?.message || "Connexion impossible.", "error");
    }
  }
}

async function handleLogoutClick() {
  clearSession(true);
  await persistSettings();
  renderSettingsPanel();
  renderHistoryPanel(false);
  setStatus("Session fermée.", "ok");
}

function historyHandlers() {
  return {
    onPreview: previewHistoryEntry,
    onOpen: openHistoryUrl,
  };
}

async function previewHistoryEntry(entry) {
  if (!entry?.job_id) {
    setStatus("Aucun job complet disponible pour cet élément.", "warn");
    return;
  }

  if (!state.authToken) {
    setStatus("Reconnecte-toi pour charger cet élément serveur.", "warn");
    return;
  }

  try {
    showProgress(15, "Chargement du rendu");
    const job = await getAnalysisJob(dom.settings.backendUrl.value, state.authToken, entry.job_id);
    if (job.status !== "done") {
      throw new Error("Ce job n'est pas encore terminé.");
    }
    const normalized = normalizeResultFromJob(job, "Rendu rechargé depuis l'historique serveur.");
    hideProgress("Rendu chargé depuis l'historique serveur.", "ok");
    applyResultToUi(normalized);
    setActiveView("render", true);
    await persistSettings();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(true);
      await persistSettings();
      renderSettingsPanel();
      renderHistoryPanel(false);
      hideProgress("Session expirée. Reconnecte-toi pour recharger l'historique.", "warn");
      return;
    }
    hideProgress(error?.message || "Impossible de charger ce rendu.", "error");
  }
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
