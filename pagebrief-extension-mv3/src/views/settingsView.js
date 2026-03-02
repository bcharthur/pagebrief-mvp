export function renderSettings(dom, backendUrl) {
  dom.settings.backendUrl.value = backendUrl || "http://localhost:8000";
}
