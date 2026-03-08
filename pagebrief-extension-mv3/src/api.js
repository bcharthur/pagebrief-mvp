class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function buildRoot(backendUrl) {
  return String(backendUrl || "").trim().replace(/\/$/, "");
}

async function apiRequest(backendUrl, path, options = {}) {
  const root = buildRoot(backendUrl);
  if (!root) throw new ApiError("Renseigne une URL de backend.");

  const headers = new Headers(options.headers || {});
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(`${root}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });

  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch (_error) {
      data = raw;
    }
  }

  if (!response.ok) {
    const detail =
      data?.detail ||
      data?.message ||
      (typeof data === "string" ? data : "Requête refusée.");
    throw new ApiError(detail || `Erreur HTTP ${response.status}.`, response.status, data);
  }

  return data;
}

export async function login(backendUrl, email, password) {
  return apiRequest(backendUrl, "/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function register(backendUrl, email, password) {
  return apiRequest(backendUrl, "/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function fetchMe(backendUrl, token) {
  return apiRequest(backendUrl, "/v1/me", { token });
}

export async function createAnalysisJob(backendUrl, token, payload) {
  return apiRequest(backendUrl, "/v1/jobs", {
    method: "POST",
    token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getAnalysisJob(backendUrl, token, jobId) {
  return apiRequest(backendUrl, `/v1/jobs/${encodeURIComponent(jobId)}`, { token });
}

export async function fetchHistory(backendUrl, token) {
  return apiRequest(backendUrl, "/v1/history", { token });
}

export async function uploadPdfFile(backendUrl, token, filename, bytes) {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    filename || "document.pdf"
  );

  return apiRequest(backendUrl, "/v1/uploads", {
    method: "POST",
    token,
    body: formData,
  });
}

export async function extractCurrentTab(tabId, preferSelection = false) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (preferSelectionInPage) => {
      const clean = (value) =>
        String(value || "")
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

      const selected = clean(window.getSelection ? window.getSelection().toString() : "");
      const url = window.location.href;
      const title = document.title || "";
      const isPdf =
        document.contentType === "application/pdf" || /\.pdf($|\?)/i.test(url);

      let pageText = "";
      let scope = "document";
      let selectionLabel = "";

      if (!isPdf) {
        const preferred = document.querySelector("main, article") || document.body;
        const clone = preferred.cloneNode(true);
        clone
          .querySelectorAll("script, style, noscript, svg, canvas")
          .forEach((node) => node.remove());

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

export { ApiError };