import { HISTORY_KEY, MAX_HISTORY_ITEMS } from "./constants.js";

export function getSessionArea() {
  return chrome.storage.session || chrome.storage.local;
}

export async function readHistory() {
  const stored = await getSessionArea().get([HISTORY_KEY]);
  return Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
}

export async function writeHistory(entries) {
  await getSessionArea().set({ [HISTORY_KEY]: entries.slice(0, MAX_HISTORY_ITEMS) });
}
