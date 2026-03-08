import { SETTINGS_KEYS } from "./src/constants.js";
import { state } from "./src/state.js";
import { dom } from "./src/dom.js";
import { getActiveTab, getTabState, patchTabState } from "./src/tabState.js";
import {
  ApiError,
  createAnalysisJob,
  extractCurrentTab,
  fetchHistory,
  fetchMe,
  getAnalysisJob,
  login,
  register,
  uploadPdfFile,
} from "./src/api.js";
import { formatConfidence, formatFormatLabel, formatPlan } from "./src/helpers.js";
import { applyEmptyRender, renderResult, buildPlainText } from "./src/views/renderView.js";
import { setActiveFormat, setLoading, renderSelectionState, renderActiveTarget } from "./src/views/analyzeView.js";
import { renderHistory } from "./src/views/historyView.js";
import { renderSettings } from "./src/views/settingsView.js";

const PROGRESS_TIMEOUT_MS = 300000;
const PROGRESS_TICK_MS = 90;

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

  wireEvents();
  applyEmptyRender(dom, state.currentFormat);
  setActiveFormat(dom, state.currentFormat);
  updateSummaryMeta({});
  renderSettingsPanel();
  renderHistoryPanel(false);
  updateSessionPill();

  await syncAuthSession();
  await syncForActiveTab();
}

function wireEvents() {
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

  dom.openHistoryBtn.addEventListener("click", handleOpenHistoryClick);
  dom.openAccountBtn.addEventListener("click", () => openModal("account"));

  dom.modals.closeHistoryBtn.addEventListener("click", closeModal);
  dom.modals.closeAccountBtn.addEventListener("click", closeModal);
  dom.modals.overlay.addEventListener("click", (event) => {
    if (event.target === dom.modals.overlay) closeModal();
  });

  dom.settings.saveSettingsBtn.addEventListener("click", async () => {
    await persistSettings();
    setStatus("Paramètres enregistrés.", "ok");
  });
  dom.settings.loginBtn.addEventListener("click", () => handleLoginClick(false));
  dom.settings.registerBtn.addEventListener("click", () => handleLoginClick(true));
  dom.settings.logoutBtn.addEventListener("click", handleLogoutClick);
  dom.settings.backendUrl.addEventListener("change", persistSettings);
  dom.settings.authEmail.addEventListener("change", persistSettings);
  dom.settings.authPassword.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleLoginClick(false).catch(console.warn);
    }
  });

  dom.history.clearHistoryBtn.addEventListener("click", () => refreshHistoryPanel(true));
  dom.history.historySearch.addEventListener("input", () => renderHistoryPanel(Boolean(state.authToken && state.currentUser)));

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
    if (
      message?.type === "pagebrief_tab_state_updated" &&
      typeof message.tabId === "number" &&
      message.tabId === state.activeTabId
    ) {
      syncForActiveTab().catch(console.warn);
    }
  });
}

async function persistSettings() {
  await chrome.storage.local.set({
    pagebrief_backend_url: dom.settings.backendUrl.value.trim(),
    pagebrief_view_format: state.currentFormat,
    pagebrief_scope: dom.analyze.scopeSelect.value,
    pagebrief_auth_email: dom.settings.authEmail.value.trim(),
    pagebrief_auth_token: state.authToken || "",
  });
}

function toggleAccordion(button) {
  const targetId = button.dataset.accordionTarget;
  const panel = targetId ? document.getElementById(targetId) : null;
  if (!panel) return;
  const open = !panel.classList.contains("open");
  panel.classList.toggle("open", open);
  button.setAttribute("aria-expanded", open ? "true" : "false");
}

function openModal(name) {
  const valid = name === "history" || name === "account";
  if (!valid) return;

  state.activeModal = name;
  dom.modals.overlay.classList.remove("hidden");
  dom.modals.overlay.setAttribute("aria-hidden", "false");

  Object.entries({ history: dom.modals.history, account: dom.modals.account }).forEach(([key, element]) => {
    const open = key === name;
    element.classList.toggle("hidden", !open);
    element.setAttribute("aria-hidden", open ? "false" : "true");
  });
}

function closeModal() {
  state.activeModal = "";
  dom.modals.overlay.classList.add("hidden");
  dom.modals.overlay.setAttribute("aria-hidden", "true");
  dom.modals.history.classList.add("hidden");
  dom.modals.account.classList.add("hidden");
  dom.modals.history.setAttribute("aria-hidden", "true");
  dom.modals.account.setAttribute("aria-hidden", "true");
}

function setStatus(message, type = "") {
  dom.statusBar.textContent = message;
  dom.statusBar.className = `status-bar ${type}`.trim();
}

function stopProgressAnimation() {
  if (state.progressTimer) {
    window.clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

function renderProgress() {
  const safe = Math.max(0, Math.min(100, Math.round(state.progressVisual || 0)));
  dom.statusProgressFill.style.width = `${safe}%`;
  dom.statusPercent.textContent = `${safe}%`;
}

function startProgressAnimation() {
  if (state.progressTimer) return;

  state.progressTimer = window.setInterval(() => {
    const delta = state.progressTarget - state.progressVisual;
    if (Math.abs(delta) < 0.35) {
      state.progressVisual = state.progressTarget;
      renderProgress();
      if (state.progressVisual >= 100 || state.progressVisual === state.progressTarget) {
        if (state.progressVisual >= 100) stopProgressAnimation();
      }
      return;
    }

    const step = Math.max(0.6, Math.abs(delta) * 0.18);
    state.progressVisual += delta > 0 ? step : -step;
    renderProgress();
  }, PROGRESS_TICK_MS);
}

function computeVisualTarget(progress) {
  const real = Math.max(0, Math.min(100, Number(progress) || 0));
  const elapsed = state.progressStartedAt ? Date.now() - state.progressStartedAt : 0;
  let target = real;

  if (real >= 20 && real < 45) {
    target = Math.min(43, Math.max(real, real + Math.floor(elapsed / 5000)));
  } else if (real >= 45 && real < 90) {
    target = Math.min(88, Math.max(real, real + Math.floor(elapsed / 4500)));
  } else if (real >= 90 && real < 100) {
    target = Math.min(97, Math.max(real, real + Math.floor(elapsed / 6000)));
  }

  return Math.max(state.progressVisual || 0, target);
}

function showProgress(progress = 0, label = "Analyse en cours") {
  if (!state.progressStartedAt) {
    state.progressStartedAt = Date.now();
    state.progressVisual = 0;
    state.progressReal = 0;
    state.progressTarget = 0;
  }

  state.progressReal = Math.max(0, Math.min(100, Number(progress) || 0));
  state.progressTarget = computeVisualTarget(state.progressReal);

  const seconds = Math.max(1, Math.floor((Date.now() - state.progressStartedAt) / 1000));
  dom.statusProgressWrap.classList.remove("hidden");
  dom.statusProgressWrap.setAttribute("aria-hidden", "false");
  setStatus(`${label} • ${seconds}s`, "warn");
  startProgressAnimation();
  renderProgress();
}

function hideProgress(finalMessage = "", type = "") {
  if (!state.progressStartedAt) {
    stopProgressAnimation();
    dom.statusProgressWrap.classList.add("hidden");
    dom.statusProgressWrap.setAttribute("aria-hidden", "true");
    dom.statusProgressFill.style.width = "0%";
    dom.statusPercent.textContent = "0%";
    if (finalMessage) setStatus(finalMessage, type);
    return;
  }

  state.progressTarget = 100;
  startProgressAnimation();

  window.setTimeout(() => {
    state.progressVisual = 100;
    renderProgress();
    stopProgressAnimation();
    state.progressStartedAt = 0;
    state.progressReal = 0;
    state.progressTarget = 0;

    if (finalMessage) {
      setStatus(finalMessage, type);
    }

    window.setTimeout(() => {
      dom.statusProgressWrap.classList.add("hidden");
      dom.statusProgressWrap.setAttribute("aria-hidden", "true");
      dom.statusProgressFill.style.width = "0%";
      dom.statusPercent.textContent = "0%";
      state.progressVisual = 0;
    }, finalMessage ? 450 : 0);
  }, 220);
}

function updateSummaryMeta(meta = {}) {
  if (typeof meta.sourceKind !== "undefined") {
    const source = String(meta.sourceKind || "page").toUpperCase();
    dom.sourceBadge.textContent = source === "HTML" ? "PAGE" : source;
  }
  if (typeof meta.readingTime !== "undefined") {
    dom.readingTime.textContent = meta.readingTime ? `${meta.readingTime} min` : "-";
  }
  if (typeof meta.confidence !== "undefined") {
    dom.confidencePill.textContent = meta.confidence || "-";
  }
}

function updateSessionPill() {
  const connected = Boolean(state.authToken && state.currentUser);
  dom.sessionPill.classList.remove("connected", "warning");

  if (connected) {
    dom.sessionPill.textContent = formatPlan(state.currentUser?.plan || "free");
    dom.sessionPill.classList.add("connected");
    return;
  }

  dom.sessionPill.textContent = "Connexion requise";
  dom.sessionPill.classList.add("warning");
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
  updateSessionPill();
}

function renderSettingsPanel() {
  renderSettings(dom, {
    backendUrl: dom.settings.backendUrl.value.trim(),
    email: dom.settings.authEmail.value.trim(),
    connected: Boolean(state.authToken && state.currentUser),
    user: state.currentUser,
  });
  updateSessionPill();
}

function renderHistoryPanel(authenticated) {
  renderHistory(dom, state.historyItems, historyHandlers(), dom.history.historySearch.value, {
    authenticated,
  });
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
      setStatus("Session expirée. Reconnecte-toi pour analyser.", "warn");
      return;
    }
    throw error;
  }
}

async function ensureAuthenticated(options = {}) {
  if (state.authToken && state.currentUser) return;

  if (options.interactive !== false) {
    openModal("account");
    setStatus("Connecte-toi d'abord pour lancer une analyse.", "warn");
  }

  throw new Error("Connecte-toi d'abord pour utiliser le backend pro.");
}

async function refreshHistoryPanel(showMessage = false) {
  if (!state.authToken || !state.currentUser) {
    state.historyItems = [];
    renderHistoryPanel(false);
    if (showMessage) {
      setStatus("Aucune session active. Connecte-toi pour voir l'historique.", "warn");
    }
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
    updateSummaryMeta({
      sourceKind: /\.pdf($|\?)/i.test(state.activeTabUrl) ? "pdf" : "html",
      readingTime: null,
      confidence: "-",
    });
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
  setStatus("Mode ciblage activé : clique sur un bloc de texte dans la page.", "warn");

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

async function uploadLocalPdfFromFileUrl(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith("file:")) {
    throw new Error("Aucun PDF local à envoyer.");
  }

  setStatus("PDF local détecté : envoi vers le backend…", "warn");

  let response;
  try {
    response = await fetch(fileUrl);
  } catch (_error) {
    throw new Error(
      "Impossible de lire ce PDF local. Vérifie que l'extension a bien “Autoriser l’accès aux URL de fichiers”."
    );
  }

  if (!response.ok) {
    throw new Error(
      "Lecture du PDF local refusée. Active “Autoriser l’accès aux URL de fichiers” dans chrome://extensions."
    );
  }

  const bytes = await response.arrayBuffer();
  const rawName = decodeURIComponent(fileUrl.split("/").pop() || "document.pdf");

  let uploaded;
  try {
    uploaded = await uploadPdfFile(dom.settings.backendUrl.value, state.authToken, rawName, bytes);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new Error("Le backend ne propose pas encore /v1/uploads. Il faut ajouter la route d’upload PDF côté API.");
    }
    throw error;
  }

  if (!uploaded?.file_token) {
    throw new Error("Le backend n'a pas retourné de file_token.");
  }

  return { fileToken: uploaded.file_token, filename: rawName };
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
    throw new Error("Aucune sélection enregistrée. Clique d'abord sur “Cibler un passage”.");
  }

  const preferSelection = dom.analyze.scopeSelect.value === "selection";
  const likelyPdfUrl = /\.pdf($|\?)/i.test(state.activeTabUrl || "");

  if (likelyPdfUrl) {
    const isLocalPdf = state.activeTabUrl.startsWith("file:");

    if (isLocalPdf) {
      const uploaded = await uploadLocalPdfFromFileUrl(state.activeTabUrl);
      return {
        payload: {
          format: state.currentFormat,
          scope: "document",
          title: state.activeTabTitle || uploaded.filename,
          source_url: state.activeTabUrl,
          source_type: "pdf",
          text_content: "",
          file_token: uploaded.fileToken,
        },
        sourceHint: "PDF local transféré puis analysé.",
        shouldClearSelection: false,
        sourceKind: "pdf",
      };
    }

    return {
      payload: {
        format: state.currentFormat,
        scope: "document",
        title: state.activeTabTitle,
        source_url: state.activeTabUrl,
        source_type: "pdf",
        text_content: "",
      },
      sourceHint: "PDF analysé depuis son URL.",
      shouldClearSelection: false,
      sourceKind: "pdf",
    };
  }

  const extraction = await extractCurrentTab(tab.id, preferSelection);
  const sourceType = extraction.sourceKind === "pdf" ? "pdf" : "html";
  const scope = sourceType === "pdf"
    ? "document"
    : extraction.scope || (preferSelection ? "selection" : "document");

  const payload = {
    format: state.currentFormat,
    scope,
    title: extraction.title || state.activeTabTitle,
    source_url: extraction.url || state.activeTabUrl,
    source_type: sourceType,
    text_content: sourceType === "html" ? extraction.pageText || "" : "",
  };

  let sourceHint = "Page HTML analysée depuis l'onglet courant.";
  if (sourceType === "pdf") {
    sourceHint = extraction.url?.startsWith("file:")
      ? "PDF local analysé depuis ton poste."
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

  while (Date.now() - startedAt < PROGRESS_TIMEOUT_MS) {
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
  await ensureAuthenticated({ interactive: false });
  updateSummaryMeta({ sourceKind: built.sourceKind });

  state.lastRequestPayload = built.payload;
  showProgress(0, "Création du job");

  const created = await createAnalysisJob(dom.settings.backendUrl.value, state.authToken, built.payload);
  const finalJob = await pollJobUntilDone(created.job_id);

  if (finalJob.status === "failed") {
    throw new Error(finalJob.error_message || "Le backend a signalé une erreur d'analyse.");
  }

  const normalized = normalizeResultFromJob(finalJob, built.sourceHint);
  hideProgress(`${normalized.panel_title} prête. ${built.sourceHint}`, "ok");
  applyResultToUi(normalized);

  if (built.shouldClearSelection && typeof state.activeTabId === "number") {
    await patchTabState(state.activeTabId, { pendingSelection: null });
    state.lastKnownSelection = null;
  }

  await refreshHistoryPanel(false);
  await persistSettings();
}

async function withAnalysisFlow(runner, loadingLabel = "inspect") {
  setLoading(dom, true, loadingLabel);

  try {
    await ensureAuthenticated({ interactive: true });
    const built = await runner();
    await runAnalysis(built);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(true);
      await persistSettings();
      renderSettingsPanel();
      renderHistoryPanel(false);
      openModal("account");
      hideProgress("Session expirée. Reconnecte-toi pour continuer.", "warn");
    } else if (String(error?.message || "").includes("Connecte-toi d'abord")) {
      hideProgress(error.message, "warn");
    } else {
      hideProgress(error?.message || "Erreur pendant l'analyse.", "error");
    }
  } finally {
    await refreshSelectionState();
    setLoading(dom, false);
  }
}

async function handleInspectClick() {
  await withAnalysisFlow(() => buildAnalysisPayload({
    preferStoredSelection: dom.analyze.scopeSelect.value === "selection",
  }), "inspect");
}

async function handleAnalyzeSelectionClick() {
  await withAnalysisFlow(() => buildAnalysisPayload({ forceStoredSelection: true }), "selection");
}

async function handleCopyClick() {
  const result = state.currentResult;
  if (!result) {
    setStatus("Aucun rendu chargé.", "warn");
    return;
  }

  await navigator.clipboard.writeText(buildPlainText(result));
  setStatus("Résumé copié dans le presse-papiers.", "ok");
}

async function handleRefreshClick() {
  await handleInspectClick();
}

async function handleLoginClick(shouldRegister) {
  const email = dom.settings.authEmail.value.trim();
  const password = dom.settings.authPassword.value;

  if (!email || !password) {
    openModal("account");
    setStatus("Renseigne un email et un mot de passe.", "warn");
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
    closeModal();
    setStatus(`Connecté · ${state.currentUser.email} · ${formatPlan(state.currentUser.plan)}`, "ok");
  } catch (error) {
    setStatus(error?.message || "Connexion impossible.", "error");
    openModal("account");
  }
}

async function handleLogoutClick() {
  clearSession(true);
  await persistSettings();
  renderSettingsPanel();
  renderHistoryPanel(false);
  setStatus("Session fermée.", "ok");
}

async function handleOpenHistoryClick() {
  if (!state.authToken || !state.currentUser) {
    openModal("account");
    setStatus("Connecte-toi pour consulter l'historique.", "warn");
    return;
  }

  await refreshHistoryPanel(false);
  openModal("history");
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
    openModal("account");
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
    closeModal();
    await persistSettings();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearSession(true);
      await persistSettings();
      renderSettingsPanel();
      renderHistoryPanel(false);
      openModal("account");
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
