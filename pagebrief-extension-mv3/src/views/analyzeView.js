import { FORMAT_CONFIG } from "../constants.js";

export function setActiveFormat(dom, value) {
  dom.analyze.formatTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.format === value);
  });
  renderFormatGuide(dom, value);
}

export function renderFormatGuide(dom, value) {
  const cfg = FORMAT_CONFIG[value] || FORMAT_CONFIG.express;
  dom.analyze.formatGuideTitle.textContent = `${cfg.label} · ${cfg.tagline}`;
  dom.analyze.formatGuideSummary.textContent = cfg.summary;
  dom.analyze.formatGuideBestFor.textContent = `Idéal pour : ${cfg.bestFor}`;
}

export function setLoading(dom, isLoading, label = "inspect") {
  dom.analyze.inspectBtn.disabled = isLoading;
  dom.analyze.pickBtn.disabled = isLoading;
  dom.analyze.analyzeSelectionBtn.disabled = isLoading || dom.analyze.analyzeSelectionBtn.dataset.hasSelection !== "1";
  dom.analyze.inspectBtn.textContent = isLoading && label === "inspect" ? "Analyse en cours…" : "Analyser l'onglet actif";
  dom.analyze.analyzeSelectionBtn.textContent = isLoading && label === "selection" ? "Analyse ciblée…" : "Analyser la sélection";
}

export function renderSelectionState(dom, selection) {
  const hasSelection = Boolean(selection?.text);
  dom.analyze.analyzeSelectionBtn.disabled = !hasSelection;
  dom.analyze.analyzeSelectionBtn.dataset.hasSelection = hasSelection ? "1" : "0";

  if (hasSelection) {
    const size = selection.charCount || selection.text.length;
    dom.analyze.selectionStateTitle.textContent = selection.label || "Passage ciblé";
    dom.analyze.selectionStateText.textContent = `${size} caractères prêts pour analyse.`;
    return;
  }

  dom.analyze.selectionStateTitle.textContent = "Sélection";
  dom.analyze.selectionStateText.textContent = "Aucun passage capturé pour le moment.";
}

export function renderActiveTarget(dom, title, url) {
  const safeTitle = String(title || "Onglet actif").trim() || "Onglet actif";
  const safeUrl = String(url || "").trim();
  dom.analyze.currentTargetTitle.textContent = safeTitle;
  dom.analyze.currentTargetMeta.textContent = safeUrl || "Aucune URL détectée.";
}
