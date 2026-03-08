import { formatPlan } from "../helpers.js";

export function renderSettings(dom, model) {
  dom.settings.backendUrl.value = model?.backendUrl || "http://localhost";
  dom.settings.authEmail.value = model?.email || "";

  if (model?.connected && model?.user) {
    dom.settings.authStateTitle.textContent = "Session active";
    dom.settings.authStateText.textContent = `${model.user.email} · Plan ${formatPlan(model.user.plan)}`;
    dom.settings.logoutBtn.disabled = false;
    return;
  }

  dom.settings.authStateTitle.textContent = "Session";
  dom.settings.authStateText.textContent = "Aucune session active. Connecte-toi pour lancer des analyses et charger l'historique serveur.";
  dom.settings.logoutBtn.disabled = true;
}
