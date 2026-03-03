export const SETTINGS_KEYS = [
  "pagebrief_backend_url",
  "pagebrief_view_format",
  "pagebrief_scope",
  "pagebrief_active_view",
  "pagebrief_auth_email",
  "pagebrief_auth_token",
];

export const TAB_STATE_KEY = "pagebrief_tab_state";
export const HISTORY_KEY = "pagebrief_session_history";
export const MAX_HISTORY_ITEMS = 20;

export const VIEW_IDS = ["render", "analyze", "history", "settings"];

export const FORMAT_CONFIG = {
  express: {
    label: "Express",
    tagline: "Gratuit",
    plan: "free",
    iconInfo: "Vue la plus rapide : idéale pour repérer le sujet d'un article, d'un PDF ou d'une page web en quelques secondes.",
    summary: "Intro courte, points clés, conclusion. Parfait pour un scan rapide.",
    bestFor: "Articles, pages produit, PDF longs à situer rapidement.",
  },
  analytique: {
    label: "Analytique",
    tagline: "Premium",
    plan: "premium",
    iconInfo: "À privilégier quand tu veux comprendre la structure et les idées fortes sans lire tout le document.",
    summary: "Vue enrichie : structure, éléments marquants et repères utiles.",
    bestFor: "Documentation, chapitres techniques, cours, contenus longs.",
  },
  decision: {
    label: "Décision",
    tagline: "Premium",
    plan: "premium",
    iconInfo: "Pensé pour transformer un contenu en aide à la décision : actions, risques et zones floues.",
    summary: "Contexte, actions, risques, flous et recommandation rapide.",
    bestFor: "CGU, propositions commerciales, documents internes, achats.",
  },
  etude: {
    label: "Étude",
    tagline: "Premium",
    plan: "premium",
    iconInfo: "Le meilleur mode pour apprendre : il remonte définitions, notions et repères pédagogiques.",
    summary: "Définitions, notions, repères et questions à retenir.",
    bestFor: "Cours, livres, PDF académiques, supports de formation.",
  },
};
