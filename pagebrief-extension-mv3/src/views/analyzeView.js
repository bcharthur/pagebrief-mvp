export function setActiveFormat(dom, value) {
  dom.analyze.formatTabs.forEach((button) => {
    button.classList.toggle("active", button.dataset.format === value);
  });
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
    dom.analyze.selectionStateText.textContent = `${size} caractères prêts pour analyse sur cet onglet.`;
    return;
  }

  dom.analyze.selectionStateTitle.textContent = "Sélection";
  dom.analyze.selectionStateText.textContent = "Aucun passage capturé pour cet onglet.";
}
