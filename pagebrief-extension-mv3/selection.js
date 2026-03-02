(() => {
  const existing = window.__pagebriefSelectionMode;
  if (existing?.cleanup) {
    existing.cleanup();
    return;
  }

  const state = {
    hovered: null,
    styleEl: null,
    badgeEl: null,
  };

  const SELECTORS = ["p", "li", "blockquote", "pre", "code", "h1", "h2", "h3", "article", "section", "div", "td"];

  const clean = (value) => String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+/g, " ")
    .trim();

  const getText = (element) => {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, svg, canvas, button, input, textarea, select").forEach((node) => node.remove());
    return clean(clone.innerText || clone.textContent || "");
  };

  const labelFor = (element) => {
    if (!element) return "Passage ciblé";
    const tag = element.tagName?.toLowerCase() || "bloc";
    const classes = Array.from(element.classList || []).slice(0, 2).join(".");
    return classes ? `${tag}.${classes}` : tag;
  };

  const resolveCandidate = (target) => {
    const selectedText = clean(window.getSelection ? window.getSelection().toString() : "");
    if (selectedText.length >= 30) {
      return { type: "selection", text: selectedText, label: "Texte surligné" };
    }

    let element = target instanceof Element ? target : target?.parentElement;
    let best = null;

    while (element && element !== document.body) {
      const tag = element.tagName?.toLowerCase();
      if (SELECTORS.includes(tag)) {
        const text = getText(element);
        if (text.length >= 40 && text.length <= 900) {
          return { type: "element", element, text, label: labelFor(element) };
        }
        if (!best && text.length >= 40 && text.length <= 1400) {
          best = { type: "element", element, text, label: labelFor(element) };
        }
      }
      element = element.parentElement;
    }

    return best;
  };

  const clearHover = () => {
    if (state.hovered) state.hovered.classList.remove("pagebrief-hover");
    state.hovered = null;
  };

  const highlight = (candidate) => {
    const element = candidate?.type === "element" ? candidate.element : null;
    if (state.hovered === element) return;
    clearHover();
    state.hovered = element;
    if (state.hovered) state.hovered.classList.add("pagebrief-hover");
  };

  const onMove = (event) => {
    const candidate = resolveCandidate(event.target);
    highlight(candidate);
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") cleanup();
  };

  const onClick = (event) => {
    const candidate = resolveCandidate(event.target);
    if (!candidate?.text) return;
    event.preventDefault();
    event.stopPropagation();

    const payload = {
      text: candidate.text.slice(0, 12000),
      url: window.location.href,
      title: document.title || "",
      sourceKind: "html",
      label: candidate.label || "Passage ciblé",
      charCount: candidate.text.length,
      capturedAt: Date.now(),
    };

    chrome.runtime.sendMessage({ type: "pagebrief_store_selection", payload }, (response) => {
      const ok = Boolean(response?.ok);
      showBadge(ok
        ? "Passage capturé pour cet onglet. Le panneau peut l'analyser."
        : "Capture impossible. Réessaie sur un autre bloc de texte.");
      setTimeout(() => cleanup(), ok ? 900 : 1300);
    });
  };

  const showBadge = (message) => {
    if (!state.badgeEl) return;
    state.badgeEl.textContent = message;
  };

  const cleanup = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    clearHover();
    state.styleEl?.remove();
    state.badgeEl?.remove();
    delete window.__pagebriefSelectionMode;
  };

  state.styleEl = document.createElement("style");
  state.styleEl.textContent = `
    .pagebrief-hover {
      outline: 2px solid rgba(125, 211, 252, 0.95) !important;
      outline-offset: 4px !important;
      background: rgba(96, 165, 250, 0.08) !important;
      cursor: crosshair !important;
    }
    .pagebrief-badge {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      padding: 10px 12px;
      border-radius: 14px;
      background: rgba(11, 16, 32, 0.94);
      color: #eef2ff;
      border: 1px solid rgba(125, 211, 252, 0.35);
      font: 12px/1.4 Inter, system-ui, sans-serif;
      box-shadow: 0 12px 30px rgba(0,0,0,0.32);
      max-width: min(420px, calc(100vw - 36px));
    }
  `;
  document.documentElement.appendChild(state.styleEl);

  state.badgeEl = document.createElement("div");
  state.badgeEl.className = "pagebrief-badge";
  state.badgeEl.textContent = "PageBrief : clique sur un passage ou surligne du texte, puis clique dans la page. Échap pour annuler.";
  document.documentElement.appendChild(state.badgeEl);

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);

  window.__pagebriefSelectionMode = { cleanup };
})();
