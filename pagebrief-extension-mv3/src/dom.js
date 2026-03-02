export const dom = {
  menuToggle: document.getElementById("menuToggle"),
  closeDrawerBtn: document.getElementById("closeDrawerBtn"),
  menuDrawer: document.getElementById("menuDrawer"),
  navItems: Array.from(document.querySelectorAll("[data-view-target]")),
  accordionTriggers: Array.from(document.querySelectorAll("[data-accordion-target]")),

  docTitle: document.getElementById("docTitle"),
  sourceBadge: document.getElementById("sourceBadge"),
  readingTime: document.getElementById("readingTime"),
  confidencePill: document.getElementById("confidencePill"),
  statusBar: document.getElementById("statusBar"),
  statusProgressWrap: document.getElementById("statusProgressWrap"),
  statusProgressFill: document.getElementById("statusProgressFill"),

  views: {
    render: document.getElementById("renderView"),
    analyze: document.getElementById("analyzeView"),
    history: document.getElementById("historyView"),
    settings: document.getElementById("settingsView"),
  },

  render: {
    formatBadge: document.getElementById("formatBadge"),
    panelTitle: document.getElementById("panelTitle"),
    analysisBasis: document.getElementById("analysisBasis"),
    sourceNote: document.getElementById("sourceNote"),
    introLabel: document.getElementById("introLabel"),
    pointsLabel: document.getElementById("pointsLabel"),
    conclusionLabel: document.getElementById("conclusionLabel"),
    annexLabel: document.getElementById("annexLabel"),
    intro: document.getElementById("intro"),
    keyPoints: document.getElementById("keyPoints"),
    conclusion: document.getElementById("conclusion"),
    annexBlocks: document.getElementById("annexBlocks"),
    copyBtn: document.getElementById("copyBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
  },

  analyze: {
    formatTabs: Array.from(document.querySelectorAll("[data-format]")),
    scopeSelect: document.getElementById("scopeSelect"),
    inspectBtn: document.getElementById("inspectBtn"),
    pickBtn: document.getElementById("pickBtn"),
    analyzeSelectionBtn: document.getElementById("analyzeSelectionBtn"),
    selectionStateTitle: document.getElementById("selectionStateTitle"),
    selectionStateText: document.getElementById("selectionStateText"),
    currentTargetTitle: document.getElementById("currentTargetTitle"),
    currentTargetMeta: document.getElementById("currentTargetMeta"),
    formatGuideTitle: document.getElementById("formatGuideTitle"),
    formatGuideSummary: document.getElementById("formatGuideSummary"),
    formatGuideBestFor: document.getElementById("formatGuideBestFor"),
  },

  history: {
    historyMeta: document.getElementById("historyMeta"),
    historyCountBadge: document.getElementById("historyCountBadge"),
    historySearch: document.getElementById("historySearch"),
    historyList: document.getElementById("historyList"),
    clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  },

  settings: {
    backendUrl: document.getElementById("backendUrl"),
    saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  },
};
