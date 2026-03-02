import { capitalize } from "../helpers.js";

function createItemCard(text, empty = false) {
  const div = document.createElement("div");
  div.className = `item-card${empty ? " empty" : ""}`;
  div.textContent = text;
  return div;
}

function renderList(target, items, emptyMessage) {
  target.innerHTML = "";
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) {
    target.appendChild(createItemCard(emptyMessage, true));
    return;
  }

  for (const value of values) {
    target.appendChild(createItemCard(value));
  }
}

function renderAnnexBlocks(target, blocks) {
  target.innerHTML = "";
  const values = Array.isArray(blocks) ? blocks.filter(Boolean) : [];

  if (!values.length) {
    const empty = document.createElement("div");
    empty.className = "item-card annex-empty";
    empty.textContent = "Aucun bloc complémentaire.";
    target.appendChild(empty);
    return;
  }

  for (const block of values) {
    const wrapper = document.createElement("div");
    wrapper.className = "annex-card";

    const title = document.createElement("h3");
    title.className = "annex-title";
    title.textContent = String(block.title || "Bloc utile").trim() || "Bloc utile";
    wrapper.appendChild(title);

    const chips = document.createElement("div");
    chips.className = "chips";
    const items = Array.isArray(block.items) ? block.items.filter(Boolean) : [];

    if (!items.length) {
      const chip = document.createElement("span");
      chip.className = "pill";
      chip.textContent = "Aucun repère.";
      chips.appendChild(chip);
    } else {
      for (const item of items) {
        const chip = document.createElement("span");
        chip.className = "pill";
        chip.textContent = item;
        chips.appendChild(chip);
      }
    }

    wrapper.appendChild(chips);
    target.appendChild(wrapper);
  }
}

export function applyEmptyRender(dom, format = "express") {
  dom.docTitle.textContent = "Aucun document analysé";
  dom.render.panelTitle.textContent = `Vue ${capitalize(format)}`;
  dom.render.formatBadge.textContent = capitalize(format);
  dom.render.introLabel.textContent = "Introduction";
  dom.render.pointsLabel.textContent = "Points clés";
  dom.render.conclusionLabel.textContent = "Conclusion";
  dom.render.annexLabel.textContent = "Blocs utiles";
  dom.render.analysisBasis.textContent = "Aucune analyse pour cet onglet.";
  dom.render.sourceNote.textContent = "Lance une analyse depuis la vue “Analyser”.";
  renderList(dom.render.intro, [], "Aucune analyse pour cet onglet.");
  renderList(dom.render.keyPoints, [], "Aucun point clé disponible.");
  renderAnnexBlocks(dom.render.annexBlocks, []);
  dom.render.conclusion.textContent = "En attente d'une première analyse.";
}

export function renderResult(dom, result) {
  const sectionLabels = result.section_labels || {};
  dom.docTitle.textContent = result.document_title || result.title || result.panel_title || "Document analysé";
  dom.render.panelTitle.textContent = result.panel_title || `Vue ${capitalize(result.format_label || result.view_format || "express")}`;
  dom.render.formatBadge.textContent = capitalize(result.format_label || result.view_format || "express");
  dom.render.introLabel.textContent = sectionLabels.intro || "Introduction";
  dom.render.pointsLabel.textContent = sectionLabels.points || "Points clés";
  dom.render.conclusionLabel.textContent = sectionLabels.conclusion || "Conclusion";
  dom.render.annexLabel.textContent = sectionLabels.annex || "Blocs utiles";
  dom.render.analysisBasis.textContent = result.analysis_basis || "Analyse complète par défaut.";
  dom.render.sourceNote.textContent = result.source_note || "";

  renderList(dom.render.intro, result.intro_lines, "Aucune introduction fournie.");
  renderList(dom.render.keyPoints, result.key_points, "Aucun point clé fourni.");
  renderAnnexBlocks(dom.render.annexBlocks, result.annex_blocks);
  dom.render.conclusion.textContent = result.conclusion || result.tldr || "En attente…";
}

export function buildPlainText(result) {
  const lines = [];
  lines.push(result.panel_title || "PageBrief");
  lines.push("");
  for (const intro of result.intro_lines || []) lines.push(`- ${intro}`);
  lines.push("");
  for (const point of result.key_points || []) lines.push(`• ${point}`);
  lines.push("");
  lines.push(result.conclusion || result.tldr || "");
  lines.push("");
  for (const block of result.annex_blocks || []) {
    lines.push(`${block.title}:`);
    for (const item of block.items || []) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}
