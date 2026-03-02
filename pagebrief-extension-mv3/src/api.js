export async function sendToBackend(backendUrl, requestBody) {
  const root = String(backendUrl || "").trim().replace(/\/$/, "");
  if (!root) throw new Error("Renseigne une URL de backend.");

  const response = await fetch(`${root}/v1/pagebrief/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  const raw = await response.text();

  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch (_parseError) {
    throw new Error(`Réponse backend illisible (HTTP ${response.status}).`);
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || `Le backend a refusé l'analyse (HTTP ${response.status}).`);
  }

  return data;
}

export async function extractCurrentTab(tabId, preferSelection = false) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (preferSelectionInPage) => {
      const clean = (value) => String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const selected = clean(window.getSelection ? window.getSelection().toString() : "");
      const url = window.location.href;
      const title = document.title || "";
      const isPdf = document.contentType === "application/pdf" || /\.pdf($|\?)/i.test(url);

      let pageText = "";
      let scope = "document";
      let selectionLabel = "";

      if (!isPdf) {
        const preferred = document.querySelector("main, article") || document.body;
        const clone = preferred.cloneNode(true);
        clone.querySelectorAll("script, style, noscript, svg, canvas").forEach((node) => node.remove());
        const raw = clean(clone.innerText || clone.textContent || "");

        if (preferSelectionInPage && selected && selected.length >= 40) {
          pageText = selected;
          scope = "selection";
          selectionLabel = "Texte surligné";
        } else {
          pageText = raw;
        }
      }

      return {
        title: clean(title),
        url,
        pageText: pageText.slice(0, 24000),
        sourceKind: isPdf ? "pdf" : "html",
        scope,
        selectionLabel,
      };
    },
    args: [preferSelection],
  });

  return result;
}
