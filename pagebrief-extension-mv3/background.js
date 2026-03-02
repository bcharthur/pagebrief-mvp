const DEFAULTS = {
  pagebrief_backend_url: "http://localhost:8000",
  pagebrief_view_format: "express",
  pagebrief_scope: "document",
  pagebrief_active_view: "render",
};

const TAB_STATE_KEY = "pagebrief_tab_state";

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const existing = await chrome.storage.local.get(Object.keys(DEFAULTS));
    const missing = {};
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (typeof existing[key] === "undefined") missing[key] = value;
    }
    if (Object.keys(missing).length) {
      await chrome.storage.local.set(missing);
    }
  } catch (error) {
    console.warn("[PageBrief bg] impossible d'initialiser le stockage", error);
  }

  if (chrome.sidePanel?.setPanelBehavior) {
    try {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    } catch (error) {
      console.warn("[PageBrief bg] setPanelBehavior a échoué", error);
    }
  }
});

async function enableSidePanel(tabId) {
  if (!chrome.sidePanel?.setOptions || typeof tabId !== "number") return;
  try {
    await chrome.sidePanel.setOptions({ tabId, path: "panel.html", enabled: true });
  } catch (error) {
    console.warn("[PageBrief bg] setOptions a échoué", error);
  }
}

async function readTabStateMap() {
  const stored = await chrome.storage.local.get([TAB_STATE_KEY]);
  return stored[TAB_STATE_KEY] || {};
}

async function writeTabStateMap(map) {
  await chrome.storage.local.set({ [TAB_STATE_KEY]: map });
}

async function patchTabState(tabId, patch) {
  const map = await readTabStateMap();
  const key = String(tabId);
  const previous = map[key] || {};
  const next = { ...previous, ...patch, tabId, updatedAt: Date.now() };

  if (!next.pendingSelection) {
    delete next.pendingSelection;
  }

  map[key] = next;
  await writeTabStateMap(map);
  await broadcastTabStateUpdated(tabId);
}

async function clearTabSelection(tabId) {
  const map = await readTabStateMap();
  const key = String(tabId);
  if (!map[key]) return;
  delete map[key].pendingSelection;
  map[key].updatedAt = Date.now();
  await writeTabStateMap(map);
  await broadcastTabStateUpdated(tabId);
}

async function cleanupTabState(tabId) {
  const map = await readTabStateMap();
  const key = String(tabId);
  if (!(key in map)) return;
  delete map[key];
  await writeTabStateMap(map);
}

async function broadcastTabStateUpdated(tabId) {
  try {
    await chrome.runtime.sendMessage({ type: "pagebrief_tab_state_updated", tabId });
  } catch (_error) {
    // Aucun listener actif.
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await enableSidePanel(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status === "complete") {
    await enableSidePanel(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await cleanupTabState(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "pagebrief_store_selection") {
    const tabId = sender?.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "Aucun onglet source détecté." });
      return false;
    }

    patchTabState(tabId, {
      url: sender?.tab?.url || message.payload?.url || "",
      title: sender?.tab?.title || message.payload?.title || "",
      sourceKind: message.payload?.sourceKind || "html",
      pendingSelection: message.payload,
    })
      .then(() => sendResponse({ ok: true, tabId }))
      .catch((error) => {
        console.warn("[PageBrief bg] impossible de stocker la sélection", error);
        sendResponse({ ok: false, error: String(error?.message || error) });
      });

    return true;
  }

  if (message?.type === "pagebrief_clear_selection") {
    const tabId = typeof message.tabId === "number" ? message.tabId : sender?.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "Aucun onglet cible détecté." });
      return false;
    }

    clearTabSelection(tabId)
      .then(() => sendResponse({ ok: true, tabId }))
      .catch((error) => {
        console.warn("[PageBrief bg] impossible de vider la sélection", error);
        sendResponse({ ok: false, error: String(error?.message || error) });
      });

    return true;
  }

  return false;
});
