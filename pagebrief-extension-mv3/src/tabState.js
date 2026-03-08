import { TAB_STATE_KEY } from "./constants.js";

export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

export async function readTabStateMap() {
  const stored = await chrome.storage.local.get([TAB_STATE_KEY]);
  return stored[TAB_STATE_KEY] || {};
}

export async function getTabState(tabId) {
  if (typeof tabId !== "number") return null;
  const map = await readTabStateMap();
  return map[String(tabId)] || null;
}

export async function patchTabState(tabId, patch) {
  if (typeof tabId !== "number") return;
  const map = await readTabStateMap();
  const key = String(tabId);
  const previous = map[key] || {};
  const next = { ...previous, ...patch, tabId, updatedAt: Date.now() };

  if (!next.pendingSelection) {
    delete next.pendingSelection;
  }

  map[key] = next;
  await chrome.storage.local.set({ [TAB_STATE_KEY]: map });
}
