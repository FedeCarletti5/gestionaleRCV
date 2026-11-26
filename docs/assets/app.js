import {
  SYMPTOM_TYPES,
  inferAnatomicalRegionAndSide,
  renderBodySvgMarkup,
  clientEventToNormalizedSvgCoords
} from "./body_map.js?v=20";
import {
  PCS_ITEMS,
  TSK13_ITEMS,
  computeScaleBreakdown,
  buildClinicalNoteFromBreakdown,
  parseTallyScalesCsv
} from "./scales.js?v=20";
import { renderAnamnesisTab } from "./anamnesis.js?v=20";
import { renderAgendaView, showAppleCalendarConfigModal } from "./agenda.js?v=20";

const SUPABASE_EDGE_API_BASE = "https://exqltoapupbmgxxwqtal.supabase.co/functions/v1/gestionale-api";
const USE_LOCAL_SERVER =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("local") === "1";

const state = {
  authenticated: false,
  envMode: "prod",
  apiBaseUrl: USE_LOCAL_SERVER ? "" : SUPABASE_EDGE_API_BASE,
  sessionToken: (typeof localStorage !== "undefined" && localStorage.getItem("gestionale_cloud_token")) || "",
  user: null,
  csrfToken: "",
  currentNav: "people",
  privacyMode: false,
  selectedPersonId: null,
  selectedPersonTab: "profilo",
  profileEditMode: false,
  selectedEpisodeId: null,
  selectedEvalId: null,
  peopleAreaFilter: "tutti",
  peopleStatusFilter: "attivo",
  peopleLocalQuery: "",
  peopleCache: [],
  peopleCacheKey: "",
  allPeopleSearchCache: null,
  dossierCache: new Map(),
  packagesCache: null,
  packagesCategoryFilter: "tutti",
  packagesStatusFilter: "tutti",
  agendaView: "day",
  agendaDate: "",
  agendaDoneUids: new Set(),
  bodyMapDraft: {
    viewSide: "anterior",
    markerKind: "point",
    radiusNorm: 24,
    symptomType: "Dolore acuto",
    intensity: 5,
    zoom: { scale: 1, focus: "full" },
    markers: []
  }
};

// ============================================================================
// ICONE SVG MONOCROMATICHE
// ============================================================================

const ICONS = {
  plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
  minus: `<line x1="5" y1="12" x2="19" y2="12"/>`,
  back: `<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>`,
  edit: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  trash: `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
  download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  printer: `<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>`,
  chevronRight: `<polyline points="9 18 15 12 9 6"/>`,
  chevronDown: `<polyline points="6 9 12 15 18 9"/>`,
  x: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  rotateCcw: `<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>`
};

function ico(name, sizeClass = "ico-sm") {
  const path = ICONS[name] || "";
  return `<svg class="${sizeClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// ============================================================================
// UTILITÀ DI FORMATTAZIONE E STATO SALVATAGGIO
// ============================================================================

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateIt(isoDate) {
  if (!isoDate) return "—";
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(isoDate);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function calcAge(birthDate) {
  if (!birthDate) return "";
  const m = String(birthDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const today = new Date();
  let age = today.getFullYear() - Number(m[1]);
  const mo = today.getMonth() + 1 - Number(m[2]);
  if (mo < 0 || (mo === 0 && today.getDate() < Number(m[3]))) age--;
  return age >= 0 && age < 130 ? `${age} anni` : "";
}

function formatRomeDateTime(isoStr) {
  if (!isoStr) return "—";
  try {
    const d = new Date(isoStr);
    return d.toLocaleString("it-IT", {
      timeZone: "Europe/Rome",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return String(isoStr).replace("T", " ").slice(0, 16);
  }
}

function todayRomeStr() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
}

function setSaveStatus(mode, text) {
  const el = document.getElementById("saveStatusIndicator");
  if (!el) return;
  el.className = `save-status ${mode}`;
  const label = el.querySelector(".status-text");
  if (!label) return;
  if (mode === "saving") label.textContent = text || "Salvataggio...";
  else if (mode === "saved") label.textContent = text || "Salvato";
  else if (mode === "error") label.textContent = text || "Errore";
}

// ============================================================================
// CLIENT API
// ============================================================================

function buildAuthUrl(path) {
  const base = state.apiBaseUrl ? `${state.apiBaseUrl}${path}` : path;
  if (!state.sessionToken) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(state.sessionToken)}`;
}

function invalidateDataCaches() {
  state.peopleCacheKey = "";
  state.allPeopleSearchCache = null;
  state.dossierCache.clear();
  state.packagesCache = null;
}

async function apiFetch(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (state.sessionToken) {
    headers["Authorization"] = `Bearer ${state.sessionToken}`;
    headers["X-Session-Token"] = state.sessionToken;
  }
  if (method !== "GET" && state.csrfToken) {
    headers["X-CSRF-Token"] = state.csrfToken;
  }
  let body = options.body;
  if (body && typeof body === "object" && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  if (method !== "GET" && !options.silentStatus) {
    setSaveStatus("saving", "Salvataggio...");
  }

  const targetUrl = state.apiBaseUrl ? `${state.apiBaseUrl}${path}` : path;

  let resp;
  try {
    resp = await fetch(targetUrl, {
      method,
      headers,
      body,
      credentials: state.apiBaseUrl ? "omit" : "same-origin"
    });
  } catch {
    setSaveStatus("error", "Offline");
    throw new Error("Impossibile contattare il server. Controlla la connessione.");
  }

  let data = null;
  const ctype = resp.headers.get("Content-Type") || "";
  if (ctype.includes("application/json")) {
    data = await resp.json();
  }

  if (resp.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/status") {
    setSaveStatus("error", "Sessione scaduta");
    showLoginScreen("Sessione scaduta. Effettua nuovamente l'accesso.");
    throw new Error("Non autenticato");
  }

  if (resp.status === 409 && data && data.code === "CONFLICT") {
    setSaveStatus("error", "Conflitto versione");
    showConflictResolutionModal(data.error, data.server_record);
    const err = new Error(data.error || "Conflitto di versione");
    err.isConflict = true;
    throw err;
  }

  if (!resp.ok) {
    if (method !== "GET" && !options.silentStatus) {
      setSaveStatus("error", "Errore");
    }
    const err = new Error((data && data.error) || `Errore HTTP ${resp.status}`);
    err.details = (data && data.details) || {};
    err.data = data;
    throw err;
  }

  if (method !== "GET") {
    invalidateDataCaches();
    if (!options.silentStatus) {
      setSaveStatus("saved", "Salvato");
    }
  }
  return data;
}

function showConflictResolutionModal(message, serverRecord) {
  openModal(`
    <h2 class="modal-title">Modifica da un altro dispositivo</h2>
    <p style="color:var(--text-secondary); margin-top:0;">${esc(message)}</p>
    <p style="font-size:13px; color:var(--text-muted);">
      Versione sul server: <strong>v${esc(serverRecord?.version)}</strong> (${esc(formatRomeDateTime(serverRecord?.updated_at))}).
    </p>
    <div class="modal-footer">
      <button class="btn btn-primary" id="conflictReloadBtn">Ricarica dati aggiornati</button>
    </div>
  `);
  document.getElementById("conflictReloadBtn")?.addEventListener("click", async () => {
    closeModal();
    await refreshCurrentView();
  });
}

// ============================================================================
// MODALI E NAVIGAZIONE
// ============================================================================

function openModal(htmlContent, { wide = false } = {}) {
  const backdrop = document.getElementById("modalContainer");
  const content = document.getElementById("modalContent");
  content.className = wide ? "modal-panel modal-wide" : "modal-panel";
  content.innerHTML = htmlContent;
  backdrop.style.display = "flex";
}

function closeModal() {
  const backdrop = document.getElementById("modalContainer");
  const content = document.getElementById("modalContent");
  backdrop.style.display = "none";
  content.innerHTML = "";
}

document.getElementById("modalContainer")?.addEventListener("click", (e) => {
  if (e.target.id === "modalContainer") closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const backdrop = document.getElementById("modalContainer");
    if (backdrop && backdrop.style.display !== "none") closeModal();
  }
});

function showLoginScreen(errMsg = "") {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("appShell").style.display = "none";
  const errEl = document.getElementById("loginError");
  if (errMsg) {
    errEl.textContent = errMsg;
    errEl.style.display = "block";
  } else {
    errEl.style.display = "none";
  }
}

function normalizePersonTab(tab) {
  if (tab === "riepilogo" || tab === "anagrafica" || tab === "fitness") return "profilo";
  if (tab === "appuntamenti") return "pacchetti";
  if (tab === "cronologia") return "documenti";
  return tab || "profilo";
}

function getAgendaContext() {
  return {
    state,
    apiFetch,
    openModal,
    closeModal,
    refreshCurrentView,
    bindCommonActionButtons,
    showRenewPackageModal,
    helpers: {
      todayRomeStr,
      getSessionCounterTone,
      inferPackageCategory,
      shortPackageTitle,
      isOpenSinglePackage,
      sortPackagesActiveFirst
    }
  };
}

async function navigateTo(navKey, options = {}) {
  state.currentNav = ["people", "agenda", "packages", "security"].includes(navKey) ? navKey : "people";
  if (options.personId !== undefined) {
    if (options.personId !== state.selectedPersonId) {
      state.profileEditMode = false;
      state.selectedEpisodeId = null;
      state.selectedEvalId = null;
    }
    state.selectedPersonId = options.personId;
  }
  if (options.personTab) {
    state.selectedPersonTab = normalizePersonTab(options.personTab);
    state.profileEditMode = false;
  }
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-nav") === state.currentNav);
  });
  await refreshCurrentView();
}

async function refreshCurrentView() {
  const container = document.getElementById("mainViewContainer");
  if (!container) return;
  if (state.currentNav === "people") {
    if (state.selectedPersonId) {
      await renderPersonDossierView(container, state.selectedPersonId);
    } else {
      await renderPeopleListView(container);
    }
  } else if (state.currentNav === "agenda") {
    await renderAgendaView(container, getAgendaContext());
  } else if (state.currentNav === "packages") {
    await renderPackagesView(container);
  } else if (state.currentNav === "security") {
    await renderSecurityView(container);
  }
}

// ============================================================================
// 1. LISTA PERSONE
// ============================================================================

async function renderPeopleListView(container) {
  const cacheKey = `${state.peopleAreaFilter}|${state.peopleStatusFilter}`;
  if (state.peopleCacheKey !== cacheKey) {
    const data = await apiFetch(
      `/api/people?area=${encodeURIComponent(state.peopleAreaFilter)}&status=${encodeURIComponent(state.peopleStatusFilter)}`
    );
    state.peopleCache = data.people || [];
    state.peopleCacheKey = cacheKey;
    if (state.peopleAreaFilter === "tutti" && state.peopleStatusFilter === "attivo") {
      state.allPeopleSearchCache = state.peopleCache;
    }
  }

  const areaButtons = [
    { id: "tutti", label: "Tutti" },
    { id: "con_fisio", label: "Fisio" },
    { id: "con_fitness", label: "PT" },
    { id: "entrambi", label: "Entrambi" }
  ];

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">
        Persone
        <span class="count-pill num" id="peopleCountPill">${state.peopleCache.length}</span>
      </h1>
      <button class="btn btn-primary" id="newPersonTopBtn">${ico("plus")} <span>Nuova persona</span></button>
    </div>

    <div class="card card-flush">
      <div class="toolbar">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; flex:1;">
          <div class="segmented" role="group" aria-label="Filtro percorso">
            ${areaButtons
              .map(
                (b) =>
                  `<button class="seg-btn ${state.peopleAreaFilter === b.id ? "active" : ""}" data-area-filter="${b.id}">${b.label}</button>`
              )
              .join("")}
          </div>
          <input
            type="search"
            id="peopleInlineFilter"
            class="form-control form-control-sm"
            placeholder="Filtra per nome, problematica, sport..."
            value="${esc(state.peopleLocalQuery)}"
            style="max-width:280px;"
          />
        </div>
        <select class="form-control form-control-sm" id="peopleStatusSelect" style="width:auto;">
          <option value="attivo" ${state.peopleStatusFilter === "attivo" ? "selected" : ""}>Attivi</option>
          <option value="archiviato" ${state.peopleStatusFilter === "archiviato" ? "selected" : ""}>Archiviati</option>
          <option value="tutti" ${state.peopleStatusFilter === "tutti" ? "selected" : ""}>Tutti</option>
        </select>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Percorso</th>
              <th>Problematiche / Obiettivo</th>
              <th style="width:110px;">Sedute rim.</th>
              <th style="width:36px;"></th>
            </tr>
          </thead>
          <tbody id="peopleTableBody"></tbody>
        </table>
      </div>
    </div>
  `;

  const paintRows = () => {
    const q = (state.peopleLocalQuery || "").trim().toLowerCase();
    const list = q
      ? state.peopleCache.filter((p) => {
          const hay = `${p.first_name} ${p.last_name} ${p.current_pain_notes || ""} ${p.medical_history || ""} ${p.sport_activity || ""} ${p.goals || ""} ${p.phone || ""}`.toLowerCase();
          return hay.includes(q);
        })
      : state.peopleCache;

    const pill = document.getElementById("peopleCountPill");
    if (pill) pill.textContent = String(list.length);

    const tbody = document.getElementById("peopleTableBody");
    if (!tbody) return;
    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Nessuna persona trovata.</td></tr>`;
      return;
    }

    tbody.innerHTML = list
      .map((p) => {
        const age = calcAge(p.birth_date);
        const tags = [];
        if (p.physio_active) tags.push(`<span class="tag tag-accent">Fisio</span>`);
        if (p.fitness_active) tags.push(`<span class="tag">PT</span>`);
        if (!tags.length) tags.push(`<span class="tag">—</span>`);
        if (p.status === "archiviato") tags.push(`<span class="tag tag-warning">Archiviato</span>`);

        const summaryText = p.current_pain_notes || p.goals || p.sport_activity || "—";
        const rem = Number(p.remaining_sessions || 0);
        const remTone = getSessionCounterTone(rem);
        const remBadge =
          rem > 0
            ? `<span class="tag num" style="color:${remTone.text}; background:${remTone.bg}; border:1px solid ${remTone.border};"><strong>${rem}</strong> rim.</span>`
            : `<span style="color:var(--text-muted);">—</span>`;

        return `
          <tr class="clickable-row" data-open-person="${p.id}">
            <td>
              <div style="font-weight:600; color:var(--text);" class="sensitive-data">${esc(p.last_name)} ${esc(p.first_name)}</div>
              ${age ? `<div style="font-size:12px; color:var(--text-muted);" class="sensitive-data">${esc(age)}</div>` : ""}
            </td>
            <td><div style="display:flex; gap:4px; flex-wrap:wrap;">${tags.join("")}</div></td>
            <td style="max-width:360px;">
              <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary);" class="sensitive-data" title="${esc(summaryText)}">
                ${esc(summaryText)}
              </div>
            </td>
            <td>${remBadge}</td>
            <td style="color:var(--text-muted); text-align:right;">${ico("chevronRight")}</td>
          </tr>
        `;
      })
      .join("");

    tbody.querySelectorAll("[data-open-person]").forEach((row) => {
      row.addEventListener("click", async () => {
        const pid = Number(row.getAttribute("data-open-person"));
        await navigateTo("people", { personId: pid, personTab: "profilo" });
      });
    });
  };

  paintRows();

  document.getElementById("peopleInlineFilter")?.addEventListener("input", (e) => {
    state.peopleLocalQuery = e.target.value;
    paintRows();
  });

  container.querySelectorAll("[data-area-filter]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.peopleAreaFilter = btn.getAttribute("data-area-filter");
      await renderPeopleListView(container);
    });
  });

  document.getElementById("peopleStatusSelect")?.addEventListener("change", async (e) => {
    state.peopleStatusFilter = e.target.value;
    await renderPeopleListView(container);
  });

  document.getElementById("newPersonTopBtn")?.addEventListener("click", () => showNewPersonModal());
}

// ============================================================================
// 2. SCHEDA PERSONA (4 TAB ESSENZIALI: PROFILO, CLINICA & SCALE, PACCHETTI, DOCUMENTI)
// ============================================================================

async function renderPersonDossierView(container, personId) {
  let dossier = state.dossierCache.get(personId);
  if (!dossier) {
    dossier = await apiFetch(`/api/people/${personId}`);
    state.dossierCache.set(personId, dossier);
  }
  const p = dossier.person;
  const activePackages = (dossier.packages || []).filter((k) => k.status === "attivo");
  const activeFixedPackages = activePackages.filter((k) => !isOpenSinglePackage(k));
  const activeOpenSingles = activePackages.filter((k) => isOpenSinglePackage(k));
  const totalRemSessions = activeFixedPackages.reduce((acc, k) => acc + Number(k.remaining_sessions || 0), 0);
  const totalActiveSessions = activeFixedPackages.reduce((acc, k) => acc + Number(k.total_sessions || 0), 0);
  const openSinglesDone = activeOpenSingles.reduce((acc, k) => acc + Number(k.consumed_sessions || 0), 0);
  const headerRemTone = getSessionCounterTone(totalRemSessions, totalActiveSessions || null);

  state.selectedPersonTab = normalizePersonTab(state.selectedPersonTab);

  const totalScalesCount = (dossier.physio.episodes || []).reduce(
    (acc, ep) => acc + (ep.outcome_measures ? ep.outcome_measures.length : 0),
    0
  );

  const pkgTabCount =
    totalRemSessions > 0
      ? `${totalRemSessions} rim.`
      : activeOpenSingles.length
        ? `${openSinglesDone} sing.`
        : dossier.packages.length || null;

  const tabs = [
    { id: "profilo", label: "Profilo", count: null },
    { id: "anamnesi", label: "Anamnesi", count: null },
    { id: "fisio", label: "Scale & Note", count: totalScalesCount || null },
    {
      id: "pacchetti",
      label: "Pacchetti",
      count: pkgTabCount,
      countStyle:
        totalRemSessions > 0
          ? `color:${headerRemTone.text}; background:${headerRemTone.bg}; border:1px solid ${headerRemTone.border};`
          : ""
    },
    { id: "documenti", label: "Documenti", count: dossier.attachments.length + dossier.consents.length || null }
  ];

  const age = calcAge(p.birth_date);
  const lifetime = computePersonLifetimeSessions(dossier);
  const metaParts = [];
  if (p.birth_date) metaParts.push(`${formatDateIt(p.birth_date)}${age ? ` (${age})` : ""}`);
  if (p.gender) metaParts.push(p.gender);
  if (p.height_cm) metaParts.push(`${p.height_cm} cm`);
  if (p.weight_kg !== null && p.weight_kg !== undefined && p.weight_kg !== "") metaParts.push(`${p.weight_kg} kg`);
  if (p.phone) metaParts.push(p.phone);
  if (lifetime.total > 0) {
    metaParts.push(`${lifetime.total} ${lifetime.total === 1 ? "seduta svolta in totale" : "sedute svolte in totale"}`);
  }

  container.innerHTML = `
    <div class="dossier-top">
      <button class="btn btn-sm btn-ghost" id="backToPeopleListBtn">${ico("back")} <span>Persone</span></button>
      <div style="display:flex; gap:4px; flex-wrap:wrap;">
        <a class="btn btn-sm btn-ghost" href="${esc(buildAuthUrl(`/api/people/${p.id}/export-pdf`))}" target="_blank">${ico("printer")} <span>PDF</span></a>
        <a class="btn btn-sm btn-ghost" href="${esc(buildAuthUrl(`/api/people/${p.id}/export.json`))}" target="_blank">${ico("download")} <span>JSON</span></a>
        <button class="btn btn-sm btn-danger-ghost" id="deletePersonBtn">${ico("trash")} <span>Elimina</span></button>
      </div>
    </div>

    <div class="dossier-header">
      <div>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <h1 class="dossier-name sensitive-data">${esc(p.first_name)} ${esc(p.last_name)}</h1>
          ${p.physio_active ? `<span class="tag tag-accent">Fisio</span>` : ""}
          ${p.fitness_active ? `<span class="tag">PT</span>` : ""}
          ${p.status === "archiviato" ? `<span class="tag tag-warning">Archiviato</span>` : ""}
        </div>
        ${metaParts.length ? `<div class="dossier-meta sensitive-data">${esc(metaParts.join(" · "))}</div>` : ""}
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        ${
          totalRemSessions > 0
            ? `<button class="btn btn-sm btn-secondary" id="headerGoPackagesBtn" style="color:${headerRemTone.text}; background:${headerRemTone.bg}; border-color:${headerRemTone.border};">
                <strong class="num">${totalRemSessions}</strong> ${totalRemSessions === 1 ? "seduta rimanente" : "sedute rimanenti"}
               </button>`
            : activeOpenSingles.length > 0
              ? `<button class="btn btn-sm btn-secondary" id="headerGoPackagesBtn">
                  <strong class="num">${openSinglesDone}</strong> ${openSinglesDone === 1 ? "seduta singola" : "sedute singole"}
                 </button>`
              : ""
        }
      </div>
    </div>

    <div class="tabs-bar" role="tablist">
      ${tabs
        .map(
          (t) => `
          <button class="tab-btn ${state.selectedPersonTab === t.id ? "active" : ""}" data-person-subtab="${t.id}">
            <span>${t.label}</span>
            ${t.count ? `<span class="tab-count num" ${t.countStyle ? `style="${t.countStyle}"` : ""}>${esc(t.count)}</span>` : ""}
          </button>
        `
        )
        .join("")}
    </div>

    <div id="personSubtabViewport"></div>
  `;

  document.getElementById("backToPeopleListBtn")?.addEventListener("click", async () => {
    state.selectedPersonId = null;
    state.profileEditMode = false;
    await renderPeopleListView(container);
  });

  document.getElementById("headerGoPackagesBtn")?.addEventListener("click", async () => {
    state.selectedPersonTab = "pacchetti";
    await renderPersonDossierView(container, p.id);
  });

  document.getElementById("deletePersonBtn")?.addEventListener("click", async () => {
    const fullName = `${p.first_name || ""} ${p.last_name || ""}`.trim();
    if (!window.confirm(`Eliminare definitivamente l'anagrafica di ${fullName} e tutti i dati collegati?`)) return;
    await apiFetch(`/api/people/${p.id}`, { method: "DELETE" });
    state.selectedPersonId = null;
    await renderPeopleListView(container);
  });

  container.querySelectorAll("[data-person-subtab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.selectedPersonTab = btn.getAttribute("data-person-subtab");
      state.profileEditMode = false;
      await renderPersonDossierView(container, p.id);
    });
  });

  const subViewport = document.getElementById("personSubtabViewport");
  if (state.selectedPersonTab === "profilo") {
    renderPersonTabProfilo(subViewport, dossier);
  } else if (state.selectedPersonTab === "anamnesi") {
    renderAnamnesisTab(subViewport, dossier, {
      selectedEpisodeId: state.selectedEpisodeId,
      onSelectEpisode: async (epId) => {
        state.selectedEpisodeId = epId;
        await renderPersonDossierView(container, p.id);
      },
      onNewEpisode: () => showNewPhysioEpisodeModal(p.id),
      onSave: async (payload) => {
        const res = await apiFetch(`/api/people/${p.id}/anamnesis`, {
          method: "PUT",
          body: payload
        });
        if (res?.episode_id) state.selectedEpisodeId = res.episode_id;
        await renderPersonDossierView(container, p.id);
      }
    });
  } else if (state.selectedPersonTab === "fisio") {
    renderPersonTabFisio(subViewport, dossier);
  } else if (state.selectedPersonTab === "pacchetti") {
    renderPersonTabPacchetti(subViewport, dossier);
  } else if (state.selectedPersonTab === "documenti") {
    renderPersonTabDocumenti(subViewport, dossier);
  }
}

// ============================================================================
// TAB 1: PROFILO (SOLA LETTURA DI DEFAULT + MODIFICA SU RICHIESTA)
// ============================================================================

function renderPersonTabProfilo(viewport, dossier) {
  const p = dossier.person;
  const lims = (dossier.shared_limitations || []).filter((l) => l.is_active);

  const limsStrip = lims.length
    ? `
      <div class="notice-strip">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:6px;">
          <strong style="font-size:13px; color:var(--warning);">Attenzioni / limitazioni (${lims.length})</strong>
          <button class="btn btn-xs btn-secondary" id="addSharedLimBtn">${ico("plus")} Aggiungi</button>
        </div>
        ${lims
          .map(
            (l) => `
            <div style="font-size:13px; margin-top:4px;" class="sensitive-data">
              <strong>${esc(l.title)}</strong>${l.body_region ? ` (${esc(l.body_region)} ${esc(l.laterality || "")})` : ""} — ${esc(l.description)}
            </div>`
          )
          .join("")}
      </div>
    `
    : "";

  if (!state.profileEditMode) {
    const val = (v) =>
      v !== null && v !== undefined && String(v).trim() !== "" ? esc(v) : `<span style="color:var(--text-muted);">—</span>`;
    const weightStr =
      p.weight_kg !== null && p.weight_kg !== undefined && p.weight_kg !== ""
        ? `${p.weight_kg} kg${p.weight_updated_at ? ` (${formatDateIt(p.weight_updated_at)})` : ""}`
        : "";

    viewport.innerHTML = `
      ${limsStrip}

      <div style="display:flex; justify-content:flex-end; gap:8px; margin-bottom:12px;">
        ${!lims.length ? `<button class="btn btn-sm btn-secondary" id="addSharedLimBtn">${ico("plus")} Limitazione</button>` : ""}
        <button class="btn btn-sm btn-secondary" id="enterProfileEditBtn">${ico("edit")} Modifica profilo</button>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header"><h3 class="card-title">Problematiche e anamnesi</h3></div>
          <div class="info-block">
            <div class="info-item-label">Dolori e problematiche attuali</div>
            <div class="info-item-val sensitive-data">${val(p.current_pain_notes)}</div>
          </div>
          <div class="info-block">
            <div class="info-item-label">Storia clinica, infortuni, interventi</div>
            <div class="info-item-val sensitive-data">${val(p.medical_history)}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Sport, obiettivi e note</h3></div>
          <div class="info-block">
            <div class="info-item-label">Obiettivi</div>
            <div class="info-item-val sensitive-data">${val(p.goals)}</div>
          </div>
          <div class="info-block">
            <div class="info-item-label">Attività / Sport</div>
            <div class="info-item-val sensitive-data">${val(p.sport_activity)}</div>
          </div>
          <div class="grid-2" style="gap:12px;">
            <div>
              <div class="info-item-label">Frequenza</div>
              <div class="info-item-val">${val(p.training_frequency)}</div>
            </div>
            <div>
              <div class="info-item-label">Luogo</div>
              <div class="info-item-val">${val(p.training_location)}</div>
            </div>
          </div>
          ${
            p.general_notes
              ? `<div class="info-block" style="margin-top:12px;">
                  <div class="info-item-label">Note generali</div>
                  <div class="info-item-val sensitive-data">${esc(p.general_notes)}</div>
                </div>`
              : ""
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="card-title">Dati personali e misure</h3></div>
        <div class="info-grid sensitive-data">
          <div><div class="info-item-label">Data di nascita</div><div class="info-item-val num">${p.birth_date ? formatDateIt(p.birth_date) : "—"}</div></div>
          <div><div class="info-item-label">Sesso</div><div class="info-item-val">${val(p.gender)}</div></div>
          <div><div class="info-item-label">Altezza</div><div class="info-item-val num">${p.height_cm ? `${p.height_cm} cm` : "—"}</div></div>
          <div><div class="info-item-label">Peso</div><div class="info-item-val num">${weightStr ? esc(weightStr) : "—"}</div></div>
          <div><div class="info-item-label">Professione</div><div class="info-item-val">${val(p.profession)}</div></div>
          <div><div class="info-item-label">Telefono</div><div class="info-item-val num">${val(p.phone)}</div></div>
          <div><div class="info-item-label">Email</div><div class="info-item-val">${val(p.email)}</div></div>
          <div><div class="info-item-label">CF / Indirizzo</div><div class="info-item-val">${val([p.tax_code, p.address].filter(Boolean).join(" · "))}</div></div>
          ${(() => {
            const lt = computePersonLifetimeSessions(dossier);
            const sub = lt.prior > 0 ? ` (${lt.prior} pregresse + ${lt.tracked})` : "";
            return `<div><div class="info-item-label">Sedute totali svolte</div><div class="info-item-val num"><strong>${lt.total}</strong>${sub}</div></div>`;
          })()}
        </div>
      </div>
    `;

    document.getElementById("enterProfileEditBtn")?.addEventListener("click", () => {
      state.profileEditMode = true;
      renderPersonTabProfilo(viewport, dossier);
    });
    document.getElementById("addSharedLimBtn")?.addEventListener("click", () => {
      showAddSharedLimitationModal(p.id, dossier.physio.episodes || [], null);
    });
    return;
  }

  // Modalità Modifica
  viewport.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Modifica profilo</h3>
        <button class="btn btn-sm btn-ghost" id="cancelProfileEditBtn">Annulla</button>
      </div>
      <form id="editPersonForm">
        <input type="hidden" name="expected_version" value="${p.version}" />

        <div class="form-section-title">Anagrafica e misure</div>
        <div class="grid-3">
          <div class="form-group"><label class="form-label">Nome *</label><input class="form-control" name="first_name" value="${esc(p.first_name)}" required /></div>
          <div class="form-group"><label class="form-label">Cognome *</label><input class="form-control" name="last_name" value="${esc(p.last_name)}" required /></div>
          <div class="form-group"><label class="form-label">Data di nascita</label><input class="form-control" type="date" name="birth_date" value="${esc(p.birth_date || "")}" /></div>
        </div>
        <div class="grid-4">
          <div class="form-group">
            <label class="form-label">Sesso</label>
            <select class="form-control" name="gender">
              <option value="" ${!p.gender ? "selected" : ""}>—</option>
              <option value="Uomo" ${p.gender === "Uomo" ? "selected" : ""}>Uomo</option>
              <option value="Donna" ${p.gender === "Donna" ? "selected" : ""}>Donna</option>
              <option value="Altro" ${p.gender === "Altro" ? "selected" : ""}>Altro</option>
            </select>
          </div>
          <div class="form-group"><label class="form-label">Altezza (cm)</label><input class="form-control" type="number" min="80" max="240" name="height_cm" value="${p.height_cm ?? ""}" /></div>
          <div class="form-group"><label class="form-label">Peso (kg)</label><input class="form-control" type="number" min="20" max="250" step="0.1" name="weight_kg" value="${p.weight_kg ?? ""}" /></div>
          <div class="form-group"><label class="form-label">Data peso</label><input class="form-control" type="date" name="weight_updated_at" value="${esc(p.weight_updated_at || "")}" /></div>
        </div>
        <div class="grid-3">
          <div class="form-group"><label class="form-label">Telefono</label><input class="form-control" name="phone" value="${esc(p.phone || "")}" /></div>
          <div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" name="email" value="${esc(p.email || "")}" /></div>
          <div class="form-group"><label class="form-label">Professione</label><input class="form-control" name="profession" value="${esc(p.profession || "")}" /></div>
        </div>
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">Percorsi</label>
            <div style="display:flex; gap:16px; padding-top:6px;">
              <label style="display:flex; align-items:center; gap:6px; font-size:13.5px; cursor:pointer;"><input type="checkbox" name="physio_active" ${p.physio_active ? "checked" : ""} /> Fisio</label>
              <label style="display:flex; align-items:center; gap:6px; font-size:13.5px; cursor:pointer;"><input type="checkbox" name="fitness_active" ${p.fitness_active ? "checked" : ""} /> PT</label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Stato</label>
            <select class="form-control" name="status">
              <option value="attivo" ${p.status === "attivo" ? "selected" : ""}>Attivo</option>
              <option value="archiviato" ${p.status === "archiviato" ? "selected" : ""}>Archiviato</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">CF / Indirizzo</label>
            <div style="display:flex; gap:6px;">
              <input class="form-control" name="tax_code" value="${esc(p.tax_code || "")}" placeholder="CF" />
              <input class="form-control" name="address" value="${esc(p.address || "")}" placeholder="Indirizzo" />
            </div>
          </div>
        </div>

        <div class="form-section-title">Problematiche e anamnesi</div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Dolori e problematiche attuali</label><textarea class="form-control" rows="3" name="current_pain_notes">${esc(p.current_pain_notes || "")}</textarea></div>
          <div class="form-group"><label class="form-label">Storia clinica, infortuni, interventi</label><textarea class="form-control" rows="3" name="medical_history">${esc(p.medical_history || "")}</textarea></div>
        </div>

        <div class="form-section-title">Sport e obiettivi</div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Obiettivi</label><textarea class="form-control" rows="2" name="goals">${esc(p.goals || "")}</textarea></div>
          <div class="form-group"><label class="form-label">Sport / Attività</label><textarea class="form-control" rows="2" name="sport_activity">${esc(p.sport_activity || "")}</textarea></div>
        </div>
        <div class="grid-3">
          <div class="form-group"><label class="form-label">Frequenza settimanale</label><input class="form-control" name="training_frequency" value="${esc(p.training_frequency || "")}" /></div>
          <div class="form-group"><label class="form-label">Dove si allena</label><input class="form-control" name="training_location" value="${esc(p.training_location || "")}" /></div>
          <div class="form-group"><label class="form-label">Sedute pregresse (prima del gestionale)</label><input class="form-control" type="number" min="0" step="1" name="prior_sessions_count" value="${Number(p.prior_sessions_count || 0)}" /></div>
        </div>
        <div class="form-group"><label class="form-label">Note generali</label><textarea class="form-control" rows="2" name="general_notes">${esc(p.general_notes || "")}</textarea></div>

        <div class="modal-footer" style="margin-top:16px;">
          <button type="button" class="btn btn-secondary" id="cancelProfileEditBtn2">Annulla</button>
          <button type="submit" class="btn btn-primary">Salva modifiche</button>
        </div>
      </form>
    </div>
  `;

  const cancelEdit = () => {
    state.profileEditMode = false;
    renderPersonTabProfilo(viewport, dossier);
  };
  document.getElementById("cancelProfileEditBtn")?.addEventListener("click", cancelEdit);
  document.getElementById("cancelProfileEditBtn2")?.addEventListener("click", cancelEdit);

  document.getElementById("editPersonForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch(`/api/people/${p.id}`, {
      method: "PUT",
      body: {
        expected_version: Number(fd.get("expected_version")),
        first_name: fd.get("first_name"),
        last_name: fd.get("last_name"),
        birth_date: fd.get("birth_date"),
        gender: fd.get("gender"),
        height_cm: fd.get("height_cm"),
        weight_kg: fd.get("weight_kg"),
        weight_updated_at: fd.get("weight_updated_at"),
        phone: fd.get("phone"),
        email: fd.get("email"),
        tax_code: fd.get("tax_code"),
        address: fd.get("address"),
        profession: fd.get("profession"),
        sport_activity: fd.get("sport_activity"),
        medical_history: fd.get("medical_history"),
        current_pain_notes: fd.get("current_pain_notes"),
        goals: fd.get("goals"),
        training_frequency: fd.get("training_frequency"),
        training_location: fd.get("training_location"),
        prior_sessions_count: Math.max(0, Number(fd.get("prior_sessions_count") || 0)),
        physio_active: fd.get("physio_active") === "on",
        fitness_active: fd.get("fitness_active") === "on",
        status: fd.get("status"),
        general_notes: fd.get("general_notes")
      }
    });
    state.profileEditMode = false;
    await refreshCurrentView();
  });
}

// ============================================================================
// TAB 2: CLINICA & SCALE
// ============================================================================

async function ensureActiveEpisode(person, episodes) {
  if (episodes && episodes.length > 0) {
    return episodes.find((e) => e.id === state.selectedEpisodeId) || episodes[0];
  }
  const ep = await apiFetch("/api/physio/episodes", {
    method: "POST",
    body: {
      person_id: person.id,
      title: "Valutazione clinica",
      chief_complaint: person.current_pain_notes || "Valutazione e monitoraggio",
      body_region: "",
      laterality: "DX",
      start_date: todayRomeStr(),
      init_default_flags: true
    }
  });
  state.selectedEpisodeId = ep.id;
  return ep;
}

function renderPersonTabFisio(viewport, dossier) {
  const p = dossier.person;
  const episodes = dossier.physio.episodes || [];
  if (!state.selectedEpisodeId || !episodes.some((e) => e.id === state.selectedEpisodeId)) {
    state.selectedEpisodeId = episodes.length ? episodes[0].id : null;
  }
  const activeEp = episodes.find((e) => e.id === state.selectedEpisodeId) || null;

  if (!activeEp) {
    viewport.innerHTML = `
      <div class="card">
        <div class="empty-state">
          <div style="font-weight:600; color:var(--text); margin-bottom:6px;">Nessun episodio clinico presente</div>
          <div style="margin-bottom:16px;">Crea una problematica / episodio oppure importa subito le scale da CSV Tally.</div>
          <div style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-primary" id="createFirstEpisodeBtn">${ico("plus")} Nuovo episodio</button>
            <button class="btn btn-secondary" id="quickImportTallyBtn">${ico("upload")} Importa CSV Tally</button>
            <button class="btn btn-secondary" id="quickRecordScaleBtn">${ico("plus")} Registra scala</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById("createFirstEpisodeBtn")?.addEventListener("click", () => showNewPhysioEpisodeModal(p.id));
    document.getElementById("quickImportTallyBtn")?.addEventListener("click", async () => {
      const ep = await ensureActiveEpisode(p, episodes);
      showImportTallyCsvModal(ep.id);
    });
    document.getElementById("quickRecordScaleBtn")?.addEventListener("click", async () => {
      const ep = await ensureActiveEpisode(p, episodes);
      showRecordOutcomeModal(ep.id, null);
    });
    return;
  }

  const evals = activeEp.evaluations || [];
  if (!state.selectedEvalId || !evals.some((ev) => ev.id === state.selectedEvalId)) {
    state.selectedEvalId = evals.length ? evals[evals.length - 1].id : null;
  }
  const currentEval = evals.find((ev) => ev.id === state.selectedEvalId) || null;
  const previousEval = evals.length > 1 ? evals.find((ev) => ev.id !== (currentEval && currentEval.id)) : null;

  const fSum = activeEp.flag_summary || { red_present: 0, red_unassessed: 0, yellow_present: 0, yellow_unassessed: 0 };
  const totalPresent = (fSum.red_present || 0) + (fSum.yellow_present || 0);
  const totalUnassessed = (fSum.red_unassessed || 0) + (fSum.yellow_unassessed || 0);

  viewport.innerHTML = `
    <!-- Selettore Episodio -->
    <div class="card" style="padding:14px 18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:240px;">
          <select class="form-control form-control-sm" id="physioEpisodeSelect" style="max-width:360px; font-weight:600;">
            ${episodes
              .map(
                (e) =>
                  `<option value="${e.id}" ${e.id === state.selectedEpisodeId ? "selected" : ""}>${esc(e.title)} (${formatDateIt(e.start_date)} · ${esc(e.status)})</option>`
              )
              .join("")}
          </select>
          <button class="btn btn-sm btn-ghost" id="newPhysioEpisodeBtn">${ico("plus")} Episodio</button>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-ghost" id="shareLimFromPhysioBtn">+ Limitazione</button>
          <button class="btn btn-sm btn-ghost" id="closeEpisodeModalBtn">Stato</button>
        </div>
      </div>
      <div style="margin-top:8px; font-size:13px; color:var(--text-secondary);" class="sensitive-data">
        ${activeEp.body_region ? `<span class="tag" style="margin-right:6px;">${esc(activeEp.body_region)}${activeEp.laterality ? ` ${esc(activeEp.laterality)}` : ""}</span>` : ""}
        <span>${esc(activeEp.chief_complaint || "")}</span>
        ${activeEp.reassessment_due_date ? `<span style="color:var(--text-muted);"> · Rivalutazione: ${formatDateIt(activeEp.reassessment_due_date)}</span>` : ""}
        ${activeEp.closure_summary ? `<div style="margin-top:4px; color:var(--text-muted);">Chiusura: ${esc(activeEp.closure_outcome)} — ${esc(activeEp.closure_summary)}</div>` : ""}
      </div>
    </div>

    <!-- 1. SCALE E QUESTIONARI -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Scale e questionari</h3>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-secondary" id="importTallyCsvBtn">${ico("upload")} Importa CSV Tally</button>
          <button class="btn btn-sm btn-primary" id="recordOutcomeMeasureBtn">${ico("plus")} Registra scala</button>
        </div>
      </div>
      ${renderOutcomeMeasuresSection(activeEp.outcome_comparisons)}
    </div>

    <!-- 2. NOTE DI SEDUTA -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Note di seduta</h3>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${activeEp.notes.length ? `<button class="btn btn-sm btn-ghost" id="copyPrevNoteAsDraftBtn">Richiama ultima</button>` : ""}
          <button class="btn btn-sm btn-secondary" id="newSoapNoteBtn">${ico("plus")} Nuova nota</button>
        </div>
      </div>
      ${renderClinicalNotesList(activeEp.notes)}
    </div>

    ${
      evals.length
        ? `<details class="clean-details">
            <summary>
              <div style="display:flex; align-items:center; gap:8px;">
                <span>Esami obiettivi / Valutazioni (${evals.length})</span>
              </div>
              ${ico("chevronDown")}
            </summary>
            <div class="details-body">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
                <select class="form-control form-control-sm" id="evalHistorySelect" style="width:auto;">
                  ${evals
                    .map(
                      (ev) =>
                        `<option value="${ev.id}" ${ev.id === (currentEval && currentEval.id) ? "selected" : ""}>
                          ${ev.eval_type === "prima_valutazione" ? "1ª valutazione" : "Rivalutazione"} · ${formatDateIt(ev.eval_date)} (${esc(ev.status)})
                        </option>`
                    )
                    .join("")}
                </select>
                <div style="display:flex; gap:6px;">
                  ${currentEval && currentEval.status === "bozza" ? `<button class="btn btn-sm btn-secondary" id="editCurrentEvalBtn">${ico("edit")} Modifica</button>` : ""}
                  ${currentEval && currentEval.status === "finalizzata" ? `<button class="btn btn-sm btn-ghost" id="addEvalAddendumBtn">+ Integrazione</button>` : ""}
                  <button class="btn btn-sm btn-secondary" id="newEvalModalBtn">${ico("plus")} Rivalutazione</button>
                </div>
              </div>
              ${currentEval ? renderEvaluationSection(currentEval, previousEval) : ""}
            </div>
          </details>`
        : ""
    }
  `;

  document.getElementById("physioEpisodeSelect")?.addEventListener("change", async (e) => {
    state.selectedEpisodeId = Number(e.target.value);
    state.selectedEvalId = null;
    await refreshCurrentView();
  });
  document.getElementById("evalHistorySelect")?.addEventListener("change", async (e) => {
    state.selectedEvalId = Number(e.target.value);
    await refreshCurrentView();
  });
  document.getElementById("newPhysioEpisodeBtn")?.addEventListener("click", () => showNewPhysioEpisodeModal(p.id));
  document.getElementById("shareLimFromPhysioBtn")?.addEventListener("click", () =>
    showAddSharedLimitationModal(p.id, episodes, activeEp.id)
  );
  document.getElementById("closeEpisodeModalBtn")?.addEventListener("click", () => showCloseEpisodeModal(activeEp));
  document.getElementById("importTallyCsvBtn")?.addEventListener("click", () => showImportTallyCsvModal(activeEp.id));
  document.getElementById("recordOutcomeMeasureBtn")?.addEventListener("click", () =>
    showRecordOutcomeModal(activeEp.id, currentEval ? currentEval.id : null)
  );
  document.getElementById("newSoapNoteBtn")?.addEventListener("click", () => showSoapNoteModal(activeEp, null));
  document.getElementById("copyPrevNoteAsDraftBtn")?.addEventListener("click", () =>
    showSoapNoteModal(activeEp, null, activeEp.notes[0])
  );
  document.getElementById("newEvalModalBtn")?.addEventListener("click", () =>
    showEvaluationModal(activeEp, null, evals.length ? "rivalutazione" : "prima_valutazione")
  );
  document.getElementById("editCurrentEvalBtn")?.addEventListener("click", () =>
    showEvaluationModal(activeEp, currentEval, currentEval.eval_type)
  );
  document.getElementById("addEvalAddendumBtn")?.addEventListener("click", () =>
    showAddendumModal({ evaluation_id: currentEval.id, title: `Valutazione del ${formatDateIt(currentEval.eval_date)}` })
  );

  viewport.querySelectorAll("[data-quick-flag-status]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const fl = activeEp.flags.find((x) => x.id === Number(sel.getAttribute("data-quick-flag-status")));
      if (!fl) return;
      await apiFetch("/api/physio/flags", {
        method: "PUT",
        body: { id: fl.id, status: sel.value, source_info: fl.source_info || "Valutazione clinica", notes: fl.notes || "", action_taken: fl.action_taken || "" }
      });
      await refreshCurrentView();
    });
  });

  viewport.querySelectorAll("[data-edit-flag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fl = activeEp.flags.find((x) => x.id === Number(btn.getAttribute("data-edit-flag")));
      if (fl) showEditFlagModal(fl);
    });
  });

  viewport.querySelectorAll("[data-del-outcome]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Eliminare questa rilevazione?")) return;
      await apiFetch(`/api/physio/outcome-measures/${Number(btn.getAttribute("data-del-outcome"))}`, { method: "DELETE" });
      await refreshCurrentView();
    });
  });

  viewport.querySelectorAll("[data-edit-soap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = activeEp.notes.find((x) => x.id === Number(btn.getAttribute("data-edit-soap")));
      if (note) showSoapNoteModal(activeEp, note);
    });
  });
  viewport.querySelectorAll("[data-addendum-soap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = activeEp.notes.find((x) => x.id === Number(btn.getAttribute("data-addendum-soap")));
      if (note) showAddendumModal({ note_id: note.id, title: `Nota del ${formatDateIt(note.note_date)}` });
    });
  });
}

function renderOutcomeMeasuresSection(comparisons) {
  if (!comparisons || !comparisons.length) {
    return `<div style="color:var(--text-muted); font-size:13px;">Nessuna scala registrata. Usa "Importa CSV Tally" o "Registra scala".</div>`;
  }

  return comparisons
    .map((c) => {
      const seriesDesc = [...(c.series || [])].reverse();
      const latest = seriesDesc[0];
      const deltaBadge =
        c.numeric_delta !== null
          ? `<span class="tag ${c.numeric_delta < 0 ? "tag-success" : c.numeric_delta > 0 ? "tag-warning" : ""} num">${c.numeric_delta > 0 ? "+" : ""}${c.numeric_delta}${esc(c.score_unit)}</span>`
          : "";

      const entriesHtml = seriesDesc
        .map((s) => {
          const bd = computeScaleBreakdown(s.scale_code, s.responses, s.score_value);
          const responses = Array.isArray(s.responses) ? s.responses : [];
          const hasNamedItems = responses.length > 0 && responses[0] && (responses[0].text || responses[0].activity);

          const subscalesHtml = bd.chips.length
            ? `<div class="subscale-row">
                ${bd.chips.map((ch) => `<span class="subscale-chip">${esc(ch.label)}: <strong>${esc(ch.value)}</strong></span>`).join("")}
               </div>`
            : "";

          const psfsInline =
            s.scale_code === "PSFS" && responses.length
              ? `<div class="subscale-row">
                  ${responses
                    .map((r) => `<span class="subscale-chip">${esc(r.activity)}: <strong>${r.score !== null ? `${r.score}/10` : "—"}</strong></span>`)
                    .join("")}
                 </div>`
              : "";

          const itemsDetailHtml =
            hasNamedItems && s.scale_code !== "PSFS"
              ? `
                <details class="inline-details">
                  <summary>Dettaglio risposte (${responses.length} item)</summary>
                  <div class="table-wrap" style="margin-top:8px;">
                    <table class="data-table data-table-compact">
                      <thead><tr><th style="width:36px;">#</th><th>Domanda</th><th>Sottoscala</th><th style="text-align:right;">Punti</th></tr></thead>
                      <tbody>
                        ${responses
                          .map(
                            (it, idx) => `
                            <tr>
                              <td class="num" style="color:var(--text-muted);">${esc(it.item ?? idx + 1)}</td>
                              <td>${esc(it.text || it.activity || "—")}</td>
                              <td style="color:var(--text-muted);">${esc(it.subscale || "—")}</td>
                              <td class="num" style="text-align:right; font-weight:${Number(it.score) >= 3 ? "700" : "500"};">${it.score !== null && it.score !== undefined ? esc(it.score) : "—"}</td>
                            </tr>`
                          )
                          .join("")}
                      </tbody>
                    </table>
                  </div>
                </details>
              `
              : "";

          return `
            <div class="scale-entry">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:13px;">
                  <strong class="num">${formatDateIt(s.recorded_date)}</strong>
                  <span class="tag num"><strong>${esc(s.score_value)}${esc(s.score_unit)}</strong></span>
                  ${bd.badge ? `<span class="tag ${bd.badge.cls}">${esc(bd.badge.text)}</span>` : ""}
                  ${s.context_label ? `<span style="color:var(--text-muted);">${esc(s.context_label)}</span>` : ""}
                </div>
                <button class="btn btn-xs btn-danger-ghost" data-del-outcome="${s.id}" title="Elimina rilevazione">${ico("trash")}</button>
              </div>
              ${subscalesHtml}
              ${psfsInline}
              ${s.clinical_note ? `<div style="font-size:12.5px; color:var(--text-secondary); margin-top:6px;" class="sensitive-data">${esc(s.clinical_note)}</div>` : ""}
              ${itemsDetailHtml}
            </div>
          `;
        })
        .join("");

      return `
        <div class="scale-card">
          <div class="scale-header">
            <div>
              <div style="font-weight:600; font-size:14.5px; color:var(--text);">${esc(c.scale_name)}</div>
              <div style="font-size:12px; color:var(--text-muted);">${esc(c.scale_version)}</div>
            </div>
            <div style="display:flex; align-items:baseline; gap:8px;">
              ${deltaBadge}
              <div class="scale-score-big">${esc(latest?.score_value)}<span class="scale-score-unit">${esc(c.score_unit)}</span></div>
            </div>
          </div>
          ${entriesHtml}
        </div>
      `;
    })
    .join("");
}

function renderClinicalNotesList(notes) {
  if (!notes || !notes.length) {
    return `<div style="color:var(--text-muted); font-size:13px;">Nessuna nota di seduta registrata.</div>`;
  }
  return notes
    .map((n) => {
      const rows = [
        ["S", n.subjective_response],
        ["O", n.objective_findings],
        ["A", [n.interventions_performed, n.exercises_performed].filter(Boolean).join(" · ")],
        ["P", n.plan_next_steps]
      ].filter(([, v]) => v && String(v).trim() !== "");

      const addenda = (n.addenda || [])
        .map(
          (a) => `
          <div style="background:var(--warning-soft); border-left:2px solid var(--warning); padding:6px 10px; margin-top:8px; font-size:12.5px; border-radius:4px;">
            <strong>Integrazione (${formatRomeDateTime(a.created_at)}):</strong> ${esc(a.addendum_text)}
          </div>`
        )
        .join("");

      return `
        <div style="border:1px solid var(--border); border-radius:var(--radius-md); padding:12px 14px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <strong class="num">${formatDateIt(n.note_date)}</strong>
              <span class="tag ${n.status === "finalizzata" ? "tag-success" : "tag-warning"}">${n.status === "finalizzata" ? "Finalizzata" : "Bozza"}</span>
              ${
                n.pain_pre !== null || n.pain_post !== null
                  ? `<span class="tag num">Dolore ${n.pain_pre ?? "—"} → ${n.pain_post ?? "—"}/10</span>`
                  : ""
              }
            </div>
            <div>
              ${
                n.status === "bozza"
                  ? `<button class="btn btn-xs btn-secondary" data-edit-soap="${n.id}">${ico("edit")} Modifica</button>`
                  : `<button class="btn btn-xs btn-ghost" data-addendum-soap="${n.id}">+ Integrazione</button>`
              }
            </div>
          </div>
          <div class="sensitive-data" style="font-size:13px; display:grid; gap:4px;">
            ${
              rows.length
                ? rows
                    .map(([k, v]) => `<div><strong style="color:var(--text-muted); margin-right:6px;">${k}</strong> ${esc(v)}</div>`)
                    .join("")
                : `<span style="color:var(--text-muted);">Nessun contenuto compilato.</span>`
            }
          </div>
          ${addenda}
        </div>
      `;
    })
    .join("");
}

function renderEvaluationSection(ev, prevEval) {
  const fields = [
    ["Motivo", ev.consult_reason],
    ["Obiettivi", ev.patient_goals],
    ["Esordio", ev.symptom_onset],
    ["Aggravanti", ev.aggravating_factors],
    ["Allevianti", ev.easing_factors],
    ["Storia clinica", ev.medical_history],
    ["Carico / Sonno", ev.work_sport_load],
    ["Test speciali", ev.special_tests],
    ["Ragionamento clinico", ev.clinical_reasoning],
    ["Indicazioni domiciliari", ev.home_advice]
  ].filter(([, v]) => v && String(v).trim() !== "");

  const markers = ev.body_map_markers || [];
  const prevMarkers = prevEval ? prevEval.body_map_markers || [] : [];

  const addendaHtml = (ev.addenda || [])
    .map(
      (a) => `
      <div style="background:var(--warning-soft); border-left:2px solid var(--warning); padding:6px 10px; margin-top:8px; font-size:12.5px; border-radius:4px;">
        <strong>Integrazione (${formatRomeDateTime(a.created_at)}):</strong> ${esc(a.addendum_text)}
      </div>`
    )
    .join("");

  return `
    <div style="display:flex; align-items:center; gap:6px; margin-bottom:12px;">
      <span class="tag tag-accent">${ev.eval_type === "prima_valutazione" ? "1ª valutazione" : "Rivalutazione"}</span>
      <span class="tag ${ev.status === "finalizzata" ? "tag-success" : "tag-warning"}">${ev.status === "finalizzata" ? "Finalizzata" : "Bozza"}</span>
      <span class="num" style="font-size:12.5px; color:var(--text-muted);">${formatDateIt(ev.eval_date)}</span>
    </div>

    ${
      fields.length
        ? `<div class="grid-2 sensitive-data" style="gap:10px 18px; margin-bottom:12px;">
            ${fields
              .map(
                ([k, v]) => `
                <div>
                  <div class="info-item-label">${k}</div>
                  <div class="info-item-val">${esc(v)}</div>
                </div>`
              )
              .join("")}
          </div>`
        : ""
    }

    ${addendaHtml}

    ${
      markers.length > 0
        ? `
          <details class="inline-details" open>
            <summary>Mappa corporea (${markers.length} punti)</summary>
            <div class="grid-2" style="margin-top:10px;">
              <div class="body-map-stage">${renderBodySvgMarkup("anterior", markers, prevMarkers)}</div>
              <div class="body-map-stage">${renderBodySvgMarkup("posterior", markers, prevMarkers)}</div>
            </div>
            <div class="table-wrap" style="margin-top:10px;">
              <table class="data-table data-table-compact">
                <thead><tr><th>Vista</th><th>Regione</th><th>Lato</th><th>Sintomo</th><th>Intensità</th><th>Note</th></tr></thead>
                <tbody>
                  ${markers
                    .map(
                      (m) => `
                      <tr>
                        <td>${m.view_side === "anterior" ? "Ant" : "Post"}</td>
                        <td><strong>${esc(m.anatomical_region)}</strong></td>
                        <td>${esc(m.laterality)}</td>
                        <td>${esc(m.symptom_type)}</td>
                        <td class="num"><strong>${m.intensity}/10</strong></td>
                        <td class="sensitive-data">${esc(m.notes || "—")}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </details>
        `
        : ""
    }
  `;
}

function renderClinicalFlagsTable(flags) {
  if (!flags || !flags.length) {
    return `<div style="color:var(--text-muted); font-size:13px;">Nessuna flag registrata.</div>`;
  }
  return `
    <div class="table-wrap">
      <table class="data-table data-table-compact">
        <thead>
          <tr><th>Tipo</th><th>Criterio</th><th style="width:150px;">Stato</th><th style="width:70px;"></th></tr>
        </thead>
        <tbody>
          ${flags
            .map(
              (f) => `
              <tr>
                <td><span class="tag ${f.flag_type === "red" ? "tag-danger" : "tag-warning"}">${f.flag_type === "red" ? "Red" : "Yellow"}</span></td>
                <td>
                  <div style="font-weight:500; color:var(--text);">${esc(f.item_label)}</div>
                  ${f.notes || f.action_taken ? `<div style="font-size:12px; color:var(--text-muted);" class="sensitive-data">${esc([f.notes, f.action_taken].filter(Boolean).join(" · "))}</div>` : ""}
                </td>
                <td>
                  <select class="form-control form-control-sm" data-quick-flag-status="${f.id}">
                    <option value="non_valutato" ${f.status === "non_valutato" ? "selected" : ""}>Non valutato</option>
                    <option value="assente" ${f.status === "assente" ? "selected" : ""}>Assente</option>
                    <option value="presente" ${f.status === "presente" ? "selected" : ""}>Presente</option>
                  </select>
                </td>
                <td style="text-align:right;">
                  <button class="btn btn-xs btn-ghost" data-edit-flag="${f.id}">Note</button>
                </td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// TAB 3: PACCHETTI DELLA PERSONA (SOLO CONTEGGIO SEDUTE — ZERO SOLDI)
// ============================================================================

/**
 * Scala cromatica fluida (verde smeraldo -> lime -> ambra -> arancio -> rosso)
 * calibrata sul numero di sedute rimanenti rispetto al totale del pacchetto (5, 10, 11 o singola).
 */
function getSessionCounterTone(remaining, total = null) {
  const rem = Math.max(0, Number(remaining || 0));
  if (rem === 0) {
    return {
      text: "#6b7280",
      barStart: "#cbd5e1",
      barEnd: "#94a3b8",
      bg: "#f3f4f6",
      border: "#e5e7eb",
      isEmpty: true
    };
  }

  const tot = total !== null && total !== undefined && Number(total) > 0 ? Number(total) : null;
  let t;
  if (tot === 1) {
    // Seduta singola non ancora svolta (1/1): verde pieno
    t = 1;
  } else if (tot !== null && tot >= 2) {
    // 1 rimasta -> rosso (0.0); pieno (rem == tot) -> verde smeraldo (1.0)
    t = Math.max(0, Math.min(1, (rem - 1) / (tot - 1)));
  } else {
    // Fallback quando conosciamo solo il totale residuo (es. lista Persone)
    t = Math.max(0, Math.min(1, (rem - 1) / 4));
  }

  const stops = [
    { at: 0.0, text: [220, 38, 38], bar1: [239, 68, 68], bar2: [220, 38, 38], bg: [254, 242, 242], border: [254, 202, 202] },
    { at: 0.25, text: [234, 88, 12], bar1: [249, 115, 22], bar2: [234, 88, 12], bg: [255, 247, 237], border: [254, 215, 170] },
    { at: 0.5, text: [180, 120, 4], bar1: [234, 179, 8], bar2: [202, 138, 4], bg: [254, 252, 232], border: [253, 230, 138] },
    { at: 0.75, text: [63, 145, 24], bar1: [101, 185, 38], bar2: [63, 145, 24], bg: [247, 254, 231], border: [217, 249, 157] },
    { at: 1.0, text: [21, 128, 61], bar1: [34, 197, 94], bar2: [22, 163, 74], bg: [240, 253, 244], border: [187, 247, 208] }
  ];

  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].at && t <= stops[i + 1].at) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }
  const f = hi.at === lo.at ? 0 : (t - lo.at) / (hi.at - lo.at);
  const lerp = (a, b) =>
    `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)}, ${Math.round(a[1] + (b[1] - a[1]) * f)}, ${Math.round(a[2] + (b[2] - a[2]) * f)})`;

  return {
    text: lerp(lo.text, hi.text),
    barStart: lerp(lo.bar1, hi.bar1),
    barEnd: lerp(lo.bar2, hi.bar2),
    bg: lerp(lo.bg, hi.bg),
    border: lerp(lo.border, hi.border),
    isEmpty: false
  };
}

function computePersonLifetimeSessions(dossier) {
  const prior = Math.max(0, Number(dossier?.person?.prior_sessions_count || 0));
  const tracked = (dossier?.packages || []).reduce((acc, k) => acc + Math.max(0, Number(k.consumed_sessions || 0)), 0);
  return { prior, tracked, total: prior + tracked };
}

function isOpenSinglePackage(pkg) {
  return Boolean(pkg?.is_open_single) || Number(pkg?.total_sessions) === 0;
}

function isPackageLow(pkg) {
  if (isOpenSinglePackage(pkg)) return false;
  const total = Number(pkg?.total_sessions || 0);
  const rem = Number(pkg?.remaining_sessions || 0);
  return total >= 2 && rem > 0 && rem <= 2;
}

function renderPackageProgressBar(pkg) {
  const total = Math.max(1, Number(pkg.total_sessions || 1));
  const rem = Math.max(0, Number(pkg.remaining_sessions || 0));
  const pct = Math.min(100, Math.round((rem / total) * 100));
  const tone = getSessionCounterTone(rem, total);
  const fillBg = rem === 0 ? "transparent" : `linear-gradient(90deg, ${tone.barStart}, ${tone.barEnd})`;
  return `<div class="progress-bar"><div class="progress-fill" style="width:${pct}%; background:${fillBg};"></div></div>`;
}

function areaLabel(code) {
  if (code === "fisio") return "Fisio";
  if (code === "fitness") return "PT";
  return "Misto";
}

// ============================================================================
// CATALOGO PACCHETTI & SEDUTE (FISIO, PT NORMALE, PT SC, PT DUETTO, BlVck)
// ============================================================================

const PACKAGE_CATALOG = [
  {
    key: "fisio",
    label: "Fisioterapia",
    description: "Fisioterapia · pacchetto da 5 sedute oppure contatore aperto per sedute singole",
    serviceArea: "fisio",
    badgeClass: "pkg-tag-fisio",
    notePlaceholder: "Es. percorso riabilitativo, distretto o note...",
    presets: [
      { id: "fisio_5", label: "Pacchetto 5 sedute", sub: "5 sedute", sessions: 5, name: "Fisioterapia · Pacchetto 5 sedute" },
      { id: "fisio_single", label: "Sedute singole", sub: "Contatore aperto (+1)", sessions: 0, openSingle: true, name: "Fisioterapia · Sedute singole" }
    ]
  },
  {
    key: "pt_normale",
    label: "PT Normale",
    description: "Personal Training · pacchetto 10 + 1 (11 sedute totali) oppure sedute singole aperte",
    serviceArea: "fitness",
    badgeClass: "pkg-tag-pt",
    notePlaceholder: "Es. frequenza settimanale, obiettivi...",
    presets: [
      { id: "pt_10_1", label: "Pacchetto 10 + 1", sub: "11 sedute totali", sessions: 11, name: "PT Normale · 10+1 (11 sedute)" },
      { id: "pt_single", label: "Sedute singole", sub: "Contatore aperto (+1)", sessions: 0, openSingle: true, name: "PT Normale · Sedute singole" }
    ]
  },
  {
    key: "pt_sc",
    label: "PT SC",
    description: "Sport Conditioning · pacchetto da 10 sedute oppure sedute singole aperte",
    serviceArea: "fitness",
    badgeClass: "pkg-tag-sc",
    notePlaceholder: "Es. sport praticato, fase stagione / return to play...",
    presets: [
      { id: "pt_sc_10", label: "Pacchetto 10 sedute", sub: "10 sedute", sessions: 10, name: "PT SC (Sport Conditioning) · 10 sedute" },
      { id: "pt_sc_single", label: "Sedute singole", sub: "Contatore aperto (+1)", sessions: 0, openSingle: true, name: "PT SC (Sport Conditioning) · Sedute singole" }
    ]
  },
  {
    key: "pt_duetto",
    label: "PT Duetto",
    description: "Allenamento in coppia · pacchetto 10 + 1 (11 sedute totali) oppure sedute singole aperte",
    serviceArea: "fitness",
    badgeClass: "pkg-tag-duetto",
    notePlaceholder: "Es. in coppia con (nome compagno/a)...",
    presets: [
      { id: "pt_duetto_10_1", label: "Pacchetto 10 + 1", sub: "11 sedute totali", sessions: 11, name: "PT Duetto · 10+1 (11 sedute)" },
      { id: "pt_duetto_single", label: "Sedute singole", sub: "Contatore aperto (+1)", sessions: 0, openSingle: true, name: "PT Duetto · Sedute singole" }
    ]
  },
  {
    key: "blvck",
    label: "BlVck",
    description: "Gestione personalizzata · pacchetti da 10, 5, sedute singole aperte o formula dedicata (listino BlVck)",
    serviceArea: "fitness",
    badgeClass: "pkg-tag-blvck",
    notePlaceholder: "Es. gestione personalizzata / condizioni dedicate BlVck...",
    presets: [
      { id: "blvck_10", label: "Pacchetto 10 sedute", sub: "10 sedute", sessions: 10, name: "BlVck · 10 sedute" },
      { id: "blvck_5", label: "Pacchetto 5 sedute", sub: "5 sedute", sessions: 5, name: "BlVck · 5 sedute" },
      { id: "blvck_single", label: "Sedute singole", sub: "Contatore aperto (+1)", sessions: 0, openSingle: true, name: "BlVck · Sedute singole" },
      { id: "blvck_custom", label: "Personalizzato", sub: "Sedute libere", sessions: null, name: "BlVck · Personalizzato", custom: true }
    ]
  }
];

function inferPackageCategory(pkg) {
  const name = String(pkg?.name || "").toLowerCase();
  if (name.includes("blvck")) return PACKAGE_CATALOG[4];
  if (name.includes("duetto")) return PACKAGE_CATALOG[3];
  if (name.includes("pt sc") || name.includes("sport conditioning")) return PACKAGE_CATALOG[2];
  if (name.includes("pt normale") || name.includes("personal training") || /^pt\b/.test(name)) return PACKAGE_CATALOG[1];
  if (pkg?.service_area === "fisio" || name.includes("fisio")) return PACKAGE_CATALOG[0];
  return PACKAGE_CATALOG[1];
}

function shortPackageTitle(pkg) {
  const raw = String(pkg?.name || "").trim();
  const stripped = raw.replace(
    /^(?:Fisioterapia|PT\s+Normale|PT\s+SC\s*(?:\(Sport\s+Conditioning\))?|PT\s+Duetto|BlVck)\s*·\s*/i,
    ""
  );
  return stripped || raw;
}

function sortPackagesActiveFirst(list) {
  const rank = (st) => (st === "attivo" ? 0 : st === "sospeso" ? 1 : 2);
  return [...(list || [])].sort((a, b) => {
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    const da = String(a.purchased_date || "");
    const db = String(b.purchased_date || "");
    if (da !== db) return db.localeCompare(da);
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function renderPersonTabPacchetti(viewport, dossier) {
  const p = dossier.person;
  const packages = sortPackagesActiveFirst(dossier.packages || []).map((k) => ({
    ...k,
    first_name: p.first_name,
    last_name: p.last_name
  }));

  const pkgCards = packages.length
    ? packages
        .map((pkg) => {
          const cat = inferPackageCategory(pkg);
          const isOpen = isOpenSinglePackage(pkg);
          const shortTitle = shortPackageTitle(pkg);
          const movRows = (pkg.movements || [])
            .map(
              (m) => `
              <tr>
                <td class="num">${formatRomeDateTime(m.created_at)}</td>
                <td><span class="tag ${m.movement_type === "CONSUME" ? "" : "tag-warning"}">${
                  isOpen
                    ? m.movement_type === "CONSUME"
                      ? "Seduta singola (+1)"
                      : "Rimozione (−1)"
                    : m.movement_type === "CONSUME"
                      ? "Seduta svolta (−1)"
                      : "Ripristino (+1)"
                }</span></td>
                <td style="color:var(--text-secondary);">${esc(m.reason)}</td>
              </tr>`
            )
            .join("");

          if (isOpen) {
            return `
              <div class="card">
                <div class="card-header" style="margin-bottom:12px;">
                  <div>
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                      <span class="tag ${cat.badgeClass}">${esc(cat.label)}</span>
                      <h4 class="card-title">${esc(shortTitle)}</h4>
                      <span class="tag ${pkg.status === "sospeso" ? "tag-warning" : ""}">${pkg.status === "sospeso" ? "sospeso" : "contatore aperto"}</span>
                    </div>
                    <div class="card-subtitle num">Inizio ${formatDateIt(pkg.purchased_date)}${pkg.notes ? ` · ${esc(pkg.notes)}` : ""}</div>
                  </div>
                  <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                    <button class="btn btn-sm btn-primary" data-pkg-consume="${pkg.id}" ${pkg.status === "sospeso" ? "disabled" : ""}>
                      ${ico("plus")} <span>1 seduta svolta</span>
                    </button>
                    <button class="btn btn-sm btn-secondary" data-pkg-undo="${pkg.id}" title="Rimuovi 1 seduta" ${pkg.consumed_sessions <= 0 ? "disabled" : ""}>
                      ${ico("rotateCcw")} <span>−1</span>
                    </button>
                    <button class="btn btn-sm btn-secondary" data-pkg-convert="${pkg.id}">
                      <span>Converti in pacchetto</span>
                    </button>
                    <button class="btn btn-sm btn-ghost" data-pkg-suspend="${pkg.id}" data-pkg-status="${pkg.status}">
                      ${pkg.status === "sospeso" ? "Riattiva" : "Sospendi"}
                    </button>
                    <button class="btn btn-sm btn-danger-ghost" data-pkg-delete="${pkg.id}" title="Elimina contatore">${ico("trash")}</button>
                  </div>
                </div>

                <div class="grid-2" style="margin-bottom:4px;">
                  <div class="stat-card">
                    <div class="stat-label">Modalità</div>
                    <div class="stat-value" style="font-size:17px;">Sedute singole</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Convertibile in pacchetto conservando le sedute svolte</div>
                  </div>
                  <div class="stat-card" style="background:var(--accent-soft); border-color:#d4e3f3;">
                    <div class="stat-label" style="color:var(--accent);">Sedute svolte</div>
                    <div class="stat-value" style="color:var(--accent);">${pkg.consumed_sessions}</div>
                  </div>
                </div>

                ${
                  pkg.movements?.length
                    ? `<details class="inline-details">
                        <summary>Storico sedute (${pkg.movements.length})</summary>
                        <div class="table-wrap" style="margin-top:8px;">
                          <table class="data-table data-table-compact">
                            <thead><tr><th>Data</th><th>Movimento</th><th>Note</th></tr></thead>
                            <tbody>${movRows}</tbody>
                          </table>
                        </div>
                      </details>`
                    : ""
                }
              </div>
            `;
          }

          const remTone = getSessionCounterTone(pkg.remaining_sessions, pkg.total_sessions);
          const isExhausted = pkg.remaining_sessions <= 0;
          const remCardStyle =
            pkg.remaining_sessions > 0
              ? `background:${remTone.bg}; border-color:${remTone.border};`
              : "";

          return `
            <div class="card">
              <div class="card-header" style="margin-bottom:12px;">
                <div>
                  <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <span class="tag ${cat.badgeClass}">${esc(cat.label)}</span>
                    <h4 class="card-title">${esc(shortTitle)}</h4>
                    <span class="tag ${pkg.status === "attivo" ? "tag-accent" : pkg.status === "esaurito" ? "" : "tag-warning"}">${esc(pkg.status)}</span>
                  </div>
                  <div class="card-subtitle num">Inizio ${formatDateIt(pkg.purchased_date)}${pkg.valid_until ? ` · Scadenza ${formatDateIt(pkg.valid_until)}` : ""}${pkg.notes ? ` · ${esc(pkg.notes)}` : ""}</div>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                  <button class="btn btn-sm ${isExhausted ? "btn-secondary" : "btn-primary"}" data-pkg-consume="${pkg.id}" ${isExhausted || pkg.status === "sospeso" ? "disabled" : ""}>
                    ${ico("minus")} <span>Seduta svolta</span>
                  </button>
                  <button class="btn btn-sm btn-secondary" data-pkg-undo="${pkg.id}" title="Ripristina 1 seduta" ${pkg.consumed_sessions <= 0 ? "disabled" : ""}>
                    ${ico("rotateCcw")} <span>+1</span>
                  </button>
                  <button class="btn btn-sm ${isExhausted ? "btn-primary" : "btn-secondary"}" data-pkg-renew="${pkg.id}" title="Fai ripartire un nuovo pacchetto identico">
                    <span>Rinnova uguale</span>
                  </button>
                  <button class="btn btn-sm btn-ghost" data-pkg-suspend="${pkg.id}" data-pkg-status="${pkg.status}">
                    ${pkg.status === "sospeso" ? "Riattiva" : "Sospendi"}
                  </button>
                  <button class="btn btn-sm btn-danger-ghost" data-pkg-delete="${pkg.id}" title="Elimina pacchetto">${ico("trash")}</button>
                </div>
              </div>

              <div class="grid-3" style="margin-bottom:12px;">
                <div class="stat-card"><div class="stat-label">Totali</div><div class="stat-value">${pkg.total_sessions}</div></div>
                <div class="stat-card"><div class="stat-label">Svolte</div><div class="stat-value">${pkg.consumed_sessions}</div></div>
                <div class="stat-card" style="${remCardStyle}">
                  <div class="stat-label" style="${pkg.remaining_sessions > 0 ? `color:${remTone.text};` : ""}">Rimanenti</div>
                  <div class="stat-value" style="color:${remTone.text};">${pkg.remaining_sessions}</div>
                </div>
              </div>

              ${renderPackageProgressBar(pkg)}

              ${
                pkg.movements?.length
                  ? `<details class="inline-details">
                      <summary>Storico sedute (${pkg.movements.length})</summary>
                      <div class="table-wrap" style="margin-top:8px;">
                        <table class="data-table data-table-compact">
                          <thead><tr><th>Data</th><th>Movimento</th><th>Note</th></tr></thead>
                          <tbody>${movRows}</tbody>
                        </table>
                      </div>
                    </details>`
                  : ""
              }
            </div>
          `;
        })
        .join("")
    : `<div class="card"><div class="empty-state">Nessun pacchetto o seduta registrata per questa persona.</div></div>`;

  const lifetime = computePersonLifetimeSessions(dossier);
  const lifetimeSub =
    lifetime.prior > 0
      ? `${lifetime.prior} pregresse (prima del gestionale) + ${lifetime.tracked} registrate qui`
      : `${lifetime.tracked} registrate sul gestionale · aggiungi le pregresse se già seguito in passato`;

  viewport.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3 class="card-title">Pacchetti e sedute</h3>
      <button class="btn btn-sm btn-primary" id="personNewPkgBtn">${ico("plus")} Nuovo pacchetto / sedute singole</button>
    </div>

    <div class="card" style="padding:14px 18px; display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap;">
      <div>
        <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted);">Storico totale lezioni / sedute svolte</div>
        <div style="font-size:12.5px; color:var(--text-secondary); margin-top:2px;" class="num">${esc(lifetimeSub)}</div>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <div class="num" style="font-size:28px; font-weight:700; color:var(--text); line-height:1;">${lifetime.total}</div>
        <button type="button" class="btn btn-sm btn-secondary" id="editPriorSessionsBtn">
          ${lifetime.prior > 0 ? "Modifica pregresse" : "+ Aggiungi pregresse"}
        </button>
      </div>
    </div>

    ${pkgCards}
  `;

  document.getElementById("personNewPkgBtn")?.addEventListener("click", () => showNewPackageModal(p.id));
  document.getElementById("editPriorSessionsBtn")?.addEventListener("click", () => showEditPriorSessionsModal(dossier));
  bindPackageActions(viewport, packages);
}

function bindPackageActions(root, packagesList = []) {
  root.querySelectorAll("[data-pkg-consume]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const pkgId = Number(btn.getAttribute("data-pkg-consume"));
      try {
        await apiFetch(`/api/packages/${pkgId}/movements`, {
          method: "POST",
          body: { action: "consume", reason: "Seduta svolta" }
        });
        await refreshCurrentView();
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    });
  });

  root.querySelectorAll("[data-pkg-undo]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const pkgId = Number(btn.getAttribute("data-pkg-undo"));
      try {
        await apiFetch(`/api/packages/${pkgId}/movements`, {
          method: "POST",
          body: { action: "undo", reason: "Ripristino seduta" }
        });
        await refreshCurrentView();
      } catch (err) {
        btn.disabled = false;
        alert(err.message);
      }
    });
  });

  root.querySelectorAll("[data-pkg-convert]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pkgId = Number(btn.getAttribute("data-pkg-convert"));
      const pkg = (packagesList || []).find((k) => k.id === pkgId);
      if (pkg) showConvertPackageModal(pkg);
    });
  });

  root.querySelectorAll("[data-pkg-renew]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pkgId = Number(btn.getAttribute("data-pkg-renew"));
      const pkg = (packagesList || []).find((k) => k.id === pkgId);
      if (pkg) showRenewPackageModal(pkg);
    });
  });

  root.querySelectorAll("[data-pkg-suspend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pkgId = Number(btn.getAttribute("data-pkg-suspend"));
      const nextSt = btn.getAttribute("data-pkg-status") === "sospeso" ? "attivo" : "sospeso";
      await apiFetch(`/api/packages/${pkgId}/status`, { method: "POST", body: { status: nextSt, reason: "Modifica stato" } });
      await refreshCurrentView();
    });
  });

  root.querySelectorAll("[data-pkg-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Eliminare questo pacchetto e il relativo storico sedute?")) return;
      const pkgId = Number(btn.getAttribute("data-pkg-delete"));
      await apiFetch(`/api/packages/${pkgId}`, { method: "DELETE" });
      await refreshCurrentView();
    });
  });
}

// ============================================================================
// TAB 4: DOCUMENTI, CONSENSI E CRONOLOGIA
// ============================================================================

function renderPersonTabDocumenti(viewport, dossier) {
  const p = dossier.person;
  const consents = dossier.consents || [];
  const attachments = dossier.attachments || [];
  const audits = dossier.audit_history || [];

  viewport.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Allegati</h3>
        <button class="btn btn-sm btn-primary" id="uploadAttachmentBtn">${ico("upload")} Carica file</button>
      </div>
      <div class="table-wrap">
        <table class="data-table data-table-compact">
          <thead><tr><th>File</th><th>Categoria</th><th>Descrizione</th><th>Data</th><th style="text-align:right;"></th></tr></thead>
          <tbody>
            ${
              attachments.length
                ? attachments
                    .map(
                      (a) => `
                      <tr>
                        <td><strong>${esc(a.original_filename)}</strong> <span style="color:var(--text-muted); font-size:11.5px;">(${(a.size_bytes / 1024).toFixed(0)} KB)</span></td>
                        <td><span class="tag">${esc(a.category)}</span></td>
                        <td class="sensitive-data">${esc(a.description || "—")}</td>
                        <td class="num">${formatDateIt(a.uploaded_at)}</td>
                        <td style="text-align:right;"><a class="btn btn-xs btn-secondary" href="${esc(buildAuthUrl(`/attachments/${a.id}`))}" target="_blank">Apri</a></td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="5" style="color:var(--text-muted);">Nessun allegato caricato.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Consensi e informative</h3>
        <button class="btn btn-sm btn-secondary" id="addConsentBtn">${ico("plus")} Registra consenso</button>
      </div>
      <div class="table-wrap">
        <table class="data-table data-table-compact">
          <thead><tr><th>Documento</th><th>Versione</th><th>Stato</th><th>Data</th><th>Modalità</th></tr></thead>
          <tbody>
            ${
              consents.length
                ? consents
                    .map(
                      (c) => `
                      <tr>
                        <td><strong>${esc(c.doc_type.replace(/_/g, " "))}</strong></td>
                        <td>${esc(c.doc_version)}</td>
                        <td><span class="tag ${c.status === "acquisito" ? "tag-success" : "tag-danger"}">${esc(c.status)}</span></td>
                        <td class="num">${formatDateIt(c.signed_date)}</td>
                        <td style="color:var(--text-muted);">${esc(c.acquisition_method)}</td>
                      </tr>`
                    )
                    .join("")
                : `<tr><td colspan="5" style="color:var(--text-muted);">Nessun consenso registrato.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>

    <details class="clean-details">
      <summary>
        <span>Cronologia operazioni (${audits.length})</span>
        ${ico("chevronDown")}
      </summary>
      <div class="details-body">
        <div class="table-wrap">
          <table class="data-table data-table-compact">
            <thead><tr><th>Data</th><th>Azione</th><th>Dettaglio</th></tr></thead>
            <tbody>
              ${
                audits.length
                  ? audits
                      .map(
                        (a) =>
                          `<tr><td class="num">${formatRomeDateTime(a.timestamp)}</td><td><span class="tag">${esc(a.action)}</span></td><td class="sensitive-data">${esc(a.summary)}</td></tr>`
                      )
                      .join("")
                  : `<tr><td colspan="3" style="color:var(--text-muted);">Nessuna operazione.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </details>
  `;

  document.getElementById("addConsentBtn")?.addEventListener("click", () => showAddConsentModal(p.id));
  document.getElementById("uploadAttachmentBtn")?.addEventListener("click", () => showUploadAttachmentModal(p.id));
}

// ============================================================================
// 3. VISTA GLOBALE PACCHETTI (SOLO SEDUTE — 1 CLIC PER SCALARE)
// ============================================================================

async function renderPackagesView(container) {
  let packages = state.packagesCache;
  if (!packages) {
    const data = await apiFetch("/api/packages");
    packages = data.packages || [];
    state.packagesCache = packages;
  }

  const enriched = sortPackagesActiveFirst(packages).map((pkg) => ({ ...pkg, _cat: inferPackageCategory(pkg) }));
  const activePkgs = enriched.filter((k) => k.status === "attivo");
  const activeFixedPkgs = activePkgs.filter((k) => !isOpenSinglePackage(k));
  const remainingTotal = activeFixedPkgs.reduce((a, k) => a + Number(k.remaining_sessions || 0), 0);
  const totalActiveCapacity = activeFixedPkgs.reduce((a, k) => a + Number(k.total_sessions || 0), 0);
  const lowPkgs = activeFixedPkgs.filter((k) => isPackageLow(k));
  const lowCount = lowPkgs.length;
  const hasCriticalLow = lowPkgs.some((k) => Number(k.remaining_sessions || 0) <= 1);
  const remSummaryTone = getSessionCounterTone(remainingTotal, totalActiveCapacity || null);
  const lowTone = lowCount > 0 ? getSessionCounterTone(hasCriticalLow ? 1 : 2, 5) : null;

  const filtered = enriched.filter((k) => {
    if (state.packagesCategoryFilter !== "tutti" && k._cat.key !== state.packagesCategoryFilter) return false;
    if (state.packagesStatusFilter !== "tutti" && k.status !== state.packagesStatusFilter) return false;
    return true;
  });

  const catCounts = {};
  for (const c of PACKAGE_CATALOG) {
    catCounts[c.key] = enriched.filter((k) => k._cat.key === c.key).length;
  }

  const rows = filtered
    .map((pkg) => {
      const isOpen = isOpenSinglePackage(pkg);
      const isExhausted = !isOpen && pkg.remaining_sessions <= 0;
      const shortTitle = shortPackageTitle(pkg);
      const tone = getSessionCounterTone(pkg.remaining_sessions, pkg.total_sessions);
      return `
      <tr>
        <td>
          <a href="#" data-open-person="${pkg.person_id}" data-person-tab="pacchetti" style="font-weight:600; color:var(--text); text-decoration:none;" class="sensitive-data">
            ${esc(pkg.last_name)} ${esc(pkg.first_name)}
          </a>
        </td>
        <td>
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="tag ${pkg._cat.badgeClass}">${esc(pkg._cat.label)}</span>
            <span style="font-weight:500;">${esc(shortTitle)}</span>
            ${isOpen ? `<span class="tag">aperto</span>` : ""}
            ${pkg.status !== "attivo" ? `<span class="tag">${esc(pkg.status)}</span>` : ""}
          </div>
          ${pkg.notes ? `<div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${esc(pkg.notes)}</div>` : ""}
        </td>
        <td style="min-width:140px;">
          ${
            isOpen
              ? `<div style="font-size:12.5px; color:var(--text-secondary);">Contatore sedute singole</div>`
              : `<div class="num" style="font-size:12.5px; color:var(--text-secondary); margin-bottom:4px;">${pkg.consumed_sessions} / ${pkg.total_sessions} svolte</div>${renderPackageProgressBar(pkg)}`
          }
        </td>
        <td>
          ${
            isOpen
              ? `<span class="tag tag-accent pkg-rem-pill num"><strong>${pkg.consumed_sessions}</strong> svolte</span>`
              : `<span class="tag pkg-rem-pill num" style="color:${tone.text}; background:${tone.bg}; border:1px solid ${tone.border};"><strong>${pkg.remaining_sessions}</strong> rim.</span>`
          }
        </td>
        <td style="text-align:right; white-space:nowrap;">
          <div class="pkg-actions-grid">
            ${
              isOpen
                ? `<button class="btn btn-xs btn-primary" data-pkg-consume="${pkg.id}" ${pkg.status === "sospeso" ? "disabled" : ""}>+1 seduta</button>
                   <button class="btn btn-xs btn-secondary" data-pkg-undo="${pkg.id}" title="Rimuovi 1 seduta" ${pkg.consumed_sessions <= 0 ? "disabled" : ""}>−1</button>
                   <button class="btn btn-xs btn-secondary" data-pkg-convert="${pkg.id}">Converti</button>`
                : `<button class="btn btn-xs ${isExhausted ? "btn-secondary" : "btn-primary"}" data-pkg-consume="${pkg.id}" ${isExhausted || pkg.status === "sospeso" ? "disabled" : ""}>−1 seduta</button>
                   <button class="btn btn-xs btn-secondary" data-pkg-undo="${pkg.id}" title="Ripristina +1" ${pkg.consumed_sessions <= 0 ? "disabled" : ""}>+1</button>
                   <button class="btn btn-xs ${isExhausted ? "btn-primary" : "btn-secondary"}" data-pkg-renew="${pkg.id}" title="Fai ripartire un nuovo pacchetto identico">Rinnova</button>`
            }
            <button class="btn btn-xs btn-ghost" data-open-person="${pkg.person_id}" data-person-tab="pacchetti">Scheda</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Pacchetti <span class="count-pill num">${filtered.length}</span></h1>
      <button class="btn btn-primary" id="globalNewPkgBtn">${ico("plus")} <span>Nuovo pacchetto / seduta</span></button>
    </div>

    <div class="grid-3" style="margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Pacchetti attivi</div><div class="stat-value">${activePkgs.length}</div></div>
      <div class="stat-card" style="${remainingTotal > 0 ? `background:${remSummaryTone.bg}; border-color:${remSummaryTone.border};` : ""}">
        <div class="stat-label" style="${remainingTotal > 0 ? `color:${remSummaryTone.text};` : ""}">Sedute rimanenti</div>
        <div class="stat-value" style="color:${remainingTotal > 0 ? remSummaryTone.text : "var(--text-muted)"};">${remainingTotal}</div>
      </div>
      <div class="stat-card" style="${lowTone ? `background:${lowTone.bg}; border-color:${lowTone.border};` : ""}">
        <div class="stat-label" style="${lowTone ? `color:${lowTone.text};` : ""}">In esaurimento (≤ 2)</div>
        <div class="stat-value" style="color:${lowTone ? lowTone.text : "var(--text)"};">${lowCount}</div>
      </div>
    </div>

    <div class="card card-flush">
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Filtro tipologia pacchetto" style="flex-wrap:wrap;">
          <button type="button" class="seg-btn ${state.packagesCategoryFilter === "tutti" ? "active" : ""}" data-pkg-cat-filter="tutti">Tutti (${enriched.length})</button>
          ${PACKAGE_CATALOG.map(
            (c) =>
              `<button type="button" class="seg-btn ${state.packagesCategoryFilter === c.key ? "active" : ""}" data-pkg-cat-filter="${c.key}">${esc(c.label)}${catCounts[c.key] ? ` (${catCounts[c.key]})` : ""}</button>`
          ).join("")}
        </div>
        <select class="form-control form-control-sm" id="pkgStatusFilterSelect" style="width:auto; min-width:130px;">
          <option value="tutti" ${state.packagesStatusFilter === "tutti" ? "selected" : ""}>Tutti gli stati</option>
          <option value="attivo" ${state.packagesStatusFilter === "attivo" ? "selected" : ""}>Solo attivi</option>
          <option value="esaurito" ${state.packagesStatusFilter === "esaurito" ? "selected" : ""}>Esauriti</option>
          <option value="sospeso" ${state.packagesStatusFilter === "sospeso" ? "selected" : ""}>Sospesi</option>
        </select>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Tipologia e pacchetto</th>
              <th>Progresso</th>
              <th>Rimanenti</th>
              <th style="text-align:right;"></th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="5" class="empty-state">Nessun pacchetto trovato con i filtri selezionati.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("globalNewPkgBtn")?.addEventListener("click", () => showNewPackageModal());
  container.querySelectorAll("[data-pkg-cat-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.packagesCategoryFilter = btn.getAttribute("data-pkg-cat-filter") || "tutti";
      renderPackagesView(container);
    });
  });
  document.getElementById("pkgStatusFilterSelect")?.addEventListener("change", (e) => {
    state.packagesStatusFilter = e.target.value;
    renderPackagesView(container);
  });
  bindPackageActions(container, enriched);
  bindCommonActionButtons(container);
}

// ============================================================================
// 4. IMPOSTAZIONI (ACCOUNT, 2FA, BACKUP)
// ============================================================================

async function renderSecurityView(container) {
  const [sec, calCfg] = await Promise.all([
    apiFetch("/api/security/overview"),
    apiFetch("/api/calendar/config").catch(() => ({ configured: false }))
  ]);
  const bkpRows = (sec.backups || [])
    .map(
      (b) => `
      <tr>
        <td><strong>${esc(b.backup_id)}</strong></td>
        <td class="num">${formatRomeDateTime(b.created_at)}</td>
        <td class="num">${(b.size_bytes / 1024).toFixed(0)} KB</td>
        <td style="text-align:right;"><button class="btn btn-xs btn-secondary" data-verify-backup="${esc(b.encrypted_filename)}">Verifica</button></td>
      </tr>`
    )
    .join("");

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Impostazioni</h1>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Apple Calendar (Agenda in sola lettura)</h3>
          <div class="card-subtitle">Specchio live privato del tuo calendario Apple tramite CalDAV cifrato — nessun evento salvato nel database.</div>
        </div>
        <span class="tag ${calCfg?.configured ? "tag-success" : ""}">${calCfg?.configured ? "Collegato" : "Non collegato"}</span>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="font-size:13px; color:var(--text-secondary);">
          ${
            calCfg?.configured
              ? `<span style="display:inline-flex; align-items:center; gap:6px;">
                   <span class="cal-dot" style="background:${esc(calCfg.calendar_color || "#1e4976")};"></span>
                   <strong>${esc(calCfg.calendar_name || "Lavoro")}</strong> · ${esc(calCfg.apple_id || "")}
                 </span>`
              : "Nessun calendario Apple collegato. Configuralo per visualizzare la tua giornata nella sezione Agenda."
          }
        </div>
        <div style="display:flex; gap:8px;">
          ${calCfg?.configured ? `<button type="button" class="btn btn-sm btn-secondary" id="openAgendaFromSettingsBtn">Apri Agenda</button>` : ""}
          <button type="button" class="btn btn-sm btn-primary" id="configAppleCalFromSettingsBtn">
            ${calCfg?.configured ? "Modifica / Scollega" : "Collega Apple Calendar"}
          </button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Credenziali account</h3>
        <span class="tag">${esc(sec.username || state.user?.username || "")}</span>
      </div>
      <form id="updateCredentialsForm">
        <div class="grid-3">
          <div class="form-group"><label class="form-label">Nome utente</label><input class="form-control" id="credUsernameInput" value="${esc(sec.username || state.user?.username || "")}" required minlength="3" /></div>
          <div class="form-group"><label class="form-label">Nome visualizzato</label><input class="form-control" id="credDisplayNameInput" value="${esc(sec.display_name || state.user?.display_name || "")}" /></div>
          <div class="form-group"><label class="form-label">Password attuale *</label><input type="password" class="form-control" id="credCurrentPasswordInput" required autocomplete="current-password" /></div>
        </div>
        <div class="grid-2">
          <div class="form-group"><label class="form-label">Nuova password (opzionale, min. 10 caratteri)</label><input type="password" class="form-control" id="credNewPasswordInput" autocomplete="new-password" /></div>
          <div class="form-group"><label class="form-label">Conferma nuova password</label><input type="password" class="form-control" id="credConfirmPasswordInput" autocomplete="new-password" /></div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <div id="credentialsResultBox" style="font-size:13px;"></div>
          <button type="submit" class="btn btn-primary">Salva credenziali</button>
        </div>
      </form>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Autenticazione 2FA</h3>
          <span class="tag ${sec.totp_enabled ? "tag-success" : ""}">${sec.totp_enabled ? "Attiva" : "Disattiva"}</span>
        </div>
        <div style="background:var(--bg-hover); border:1px solid var(--border); border-radius:var(--radius-sm); padding:10px; font-family:monospace; font-size:12.5px; margin-bottom:12px;">
          Segreto: <strong>${esc(sec.totp_secret)}</strong>
        </div>
        <form id="toggleTotpForm" style="display:flex; gap:8px; align-items:flex-end;">
          <div class="form-group" style="margin:0; flex:1;"><label class="form-label">Codice TOTP (6 cifre)</label><input class="form-control" id="totpVerifyInput" value="${esc(sec.current_totp_demo_hint || "")}" placeholder="123456" /></div>
          <button type="submit" class="btn ${sec.totp_enabled ? "btn-danger" : "btn-primary"}">${sec.totp_enabled ? "Disattiva" : "Attiva 2FA"}</button>
        </form>
        <div id="recoveryCodesBox" style="margin-top:10px;"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Backup cifrati</h3>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-primary" id="createBackupBtn">Crea backup</button>
            <button class="btn btn-sm btn-secondary" id="verifyLatestBackupBtn">Verifica</button>
          </div>
        </div>
        <div id="backupVerifyResultBox" style="margin-bottom:10px;"></div>
        <div class="table-wrap">
          <table class="data-table data-table-compact">
            <thead><tr><th>ID</th><th>Data</th><th>Dim.</th><th></th></tr></thead>
            <tbody>${bkpRows || `<tr><td colspan="4" style="color:var(--text-muted);">Nessun backup presente.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById("configAppleCalFromSettingsBtn")?.addEventListener("click", () => {
    showAppleCalendarConfigModal(getAgendaContext());
  });
  document.getElementById("openAgendaFromSettingsBtn")?.addEventListener("click", () => {
    navigateTo("agenda");
  });

  document.getElementById("updateCredentialsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = document.getElementById("credentialsResultBox");
    const newPassword = document.getElementById("credNewPasswordInput").value;
    const confirmPassword = document.getElementById("credConfirmPasswordInput").value;
    if (newPassword && newPassword !== confirmPassword) {
      box.innerHTML = `<span style="color:var(--danger);">Le nuove password non coincidono.</span>`;
      return;
    }
    try {
      const res = await apiFetch("/api/security/credentials", {
        method: "POST",
        body: {
          username: document.getElementById("credUsernameInput").value.trim(),
          display_name: document.getElementById("credDisplayNameInput").value.trim(),
          current_password: document.getElementById("credCurrentPasswordInput").value,
          new_password: newPassword
        }
      });
      if (state.user) {
        state.user.username = res.username;
        state.user.display_name = res.display_name;
      }
      await renderSecurityView(container);
      const updatedBox = document.getElementById("credentialsResultBox");
      if (updatedBox) updatedBox.innerHTML = `<span style="color:var(--success); font-weight:500;">Credenziali aggiornate.</span>`;
    } catch (err) {
      box.innerHTML = `<span style="color:var(--danger);">${esc(err.message)}</span>`;
    }
  });

  document.getElementById("toggleTotpForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await apiFetch("/api/security/totp", {
      method: "POST",
      body: { enable: !sec.totp_enabled, code: document.getElementById("totpVerifyInput").value }
    });
    await renderSecurityView(container);
    if (res.recovery_codes) {
      const box = document.getElementById("recoveryCodesBox");
      if (box) {
        box.innerHTML = `<div style="background:var(--success-soft); border:1px solid var(--success-border); padding:8px 10px; border-radius:6px; font-size:12px;">
          Codici di recupero: <code>${res.recovery_codes.join(", ")}</code>
        </div>`;
      }
    }
  });

  document.getElementById("createBackupBtn")?.addEventListener("click", async () => {
    await apiFetch("/api/security/backups", { method: "POST" });
    await renderSecurityView(container);
  });

  const runRestoreCheck = async (filename = null) => {
    const res = await apiFetch("/api/security/backups/verify-restore", {
      method: "POST",
      body: { encrypted_filename: filename }
    });
    const box = document.getElementById("backupVerifyResultBox");
    if (box) {
      box.innerHTML = `<div style="background:var(--success-soft); border:1px solid var(--success-border); padding:8px 10px; border-radius:6px; font-size:12.5px; color:var(--success);">
        Backup verificato (${esc(res.backup_id)} · ${res.people_count} persone · integrità ${esc(res.sqlite_integrity)}).
      </div>`;
    }
  };
  document.getElementById("verifyLatestBackupBtn")?.addEventListener("click", () => runRestoreCheck(null));
  container.querySelectorAll("[data-verify-backup]").forEach((btn) => {
    btn.addEventListener("click", () => runRestoreCheck(btn.getAttribute("data-verify-backup")));
  });
}

// ============================================================================
// MODALE IMPORTAZIONE CSV TALLY (PCS + TSK-13 AUTOMATICO)
// ============================================================================

function showImportTallyCsvModal(episodeId) {
  let parsedRows = [];
  let selectedRowIdx = 0;

  openModal(`
    <h2 class="modal-title">Importa scale da CSV Tally</h2>
    <div class="dropzone" id="csvDropzone">
      <div style="font-weight:600; color:var(--text); margin-bottom:4px;">Seleziona o trascina un file CSV esportato da Tally</div>
      <div style="font-size:12.5px; color:var(--text-muted);">Riconoscimento automatico PCS-I (13 item) e TSK-13 (13 item) con sottoscale</div>
      <input type="file" id="tallyCsvFileInput" accept=".csv,text/csv" style="display:none;" />
    </div>
    <div id="tallyCsvError" class="form-error" style="display:none;"></div>
    <div id="tallyCsvPreview"></div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" id="cancelTallyCsvBtn">Annulla</button>
      <button type="button" class="btn btn-primary" id="confirmTallyCsvBtn" disabled>Importa scale</button>
    </div>
  `);

  const dropzone = document.getElementById("csvDropzone");
  const fileInput = document.getElementById("tallyCsvFileInput");
  const errBox = document.getElementById("tallyCsvError");
  const previewBox = document.getElementById("tallyCsvPreview");
  const confirmBtn = document.getElementById("confirmTallyCsvBtn");

  const renderPreview = () => {
    const row = parsedRows[selectedRowIdx];
    if (!row || !row.scales.length) {
      previewBox.innerHTML = "";
      confirmBtn.disabled = true;
      return;
    }

    const rowSelector =
      parsedRows.length > 1
        ? `
          <div class="form-group">
            <label class="form-label">Compilazione da importare (${parsedRows.length} righe nel CSV)</label>
            <select class="form-control" id="tallyRowSelect">
              ${parsedRows
                .map(
                  (r, i) =>
                    `<option value="${i}" ${i === selectedRowIdx ? "selected" : ""}>Riga #${i + 1} · ${formatDateIt(r.recordedDate)}${r.respondentName ? ` — ${esc(r.respondentName)}` : ""}${r.submissionId ? ` (${esc(r.submissionId)})` : ""}</option>`
                )
                .join("")}
            </select>
          </div>`
        : "";

    previewBox.innerHTML = `
      ${rowSelector}
      <div class="form-group">
        <label class="form-label">Data compilazione</label>
        <input class="form-control" type="date" id="tallyDateInput" value="${esc(row.recordedDate)}" />
      </div>
      ${row.scales
        .map((sc, sIdx) => {
          const bd = computeScaleBreakdown(sc.scale_code, sc.responses, sc.score_value);
          return `
            <label style="display:block; border:1px solid var(--border); border-radius:var(--radius-md); padding:12px; margin-bottom:8px; cursor:pointer; background:var(--bg-hover);">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <input type="checkbox" class="tally-scale-check" data-scale-idx="${sIdx}" checked />
                  <strong>${esc(sc.scale_name)}</strong>
                </div>
                <div style="display:flex; align-items:center; gap:6px;">
                  ${bd.badge ? `<span class="tag ${bd.badge.cls}">${esc(bd.badge.text)}</span>` : ""}
                  <strong class="num" style="font-size:16px;">${sc.score_value}${esc(sc.score_unit)}</strong>
                </div>
              </div>
              <div class="subscale-row">
                ${bd.chips.map((ch) => `<span class="subscale-chip">${esc(ch.label)}: <strong>${esc(ch.value)}</strong></span>`).join("")}
                <span class="subscale-chip">${sc.completed_items}/${sc.total_items} item</span>
              </div>
            </label>
          `;
        })
        .join("")}
    `;

    confirmBtn.disabled = false;
    document.getElementById("tallyRowSelect")?.addEventListener("change", (e) => {
      selectedRowIdx = Number(e.target.value);
      renderPreview();
    });
  };

  const handleFile = (file) => {
    if (!file) return;
    errBox.style.display = "none";
    const reader = new FileReader();
    reader.onload = () => {
      try {
        parsedRows = parseTallyScalesCsv(String(reader.result || ""), file.name);
        selectedRowIdx = 0;
        dropzone.innerHTML = `<div style="font-weight:600; color:var(--accent);">${esc(file.name)}</div><div style="font-size:12px; color:var(--text-muted); margin-top:2px;">Clicca per cambiare file</div>`;
        renderPreview();
      } catch (err) {
        parsedRows = [];
        previewBox.innerHTML = "";
        confirmBtn.disabled = true;
        errBox.textContent = err.message;
        errBox.style.display = "block";
      }
    };
    reader.readAsText(file, "utf-8");
  };

  dropzone?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", (e) => handleFile(e.target.files?.[0]));
  dropzone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    handleFile(e.dataTransfer?.files?.[0]);
  });

  document.getElementById("cancelTallyCsvBtn")?.addEventListener("click", closeModal);
  confirmBtn?.addEventListener("click", async () => {
    const row = parsedRows[selectedRowIdx];
    if (!row) return;
    const recDate = document.getElementById("tallyDateInput")?.value || row.recordedDate;
    const checks = Array.from(document.querySelectorAll(".tally-scale-check"))
      .filter((c) => c.checked)
      .map((c) => Number(c.getAttribute("data-scale-idx")));

    if (!checks.length) return;
    confirmBtn.disabled = true;
    try {
      for (const idx of checks) {
        const sc = row.scales[idx];
        await apiFetch("/api/physio/outcome-measures", {
          method: "POST",
          body: {
            episode_id: episodeId,
            scale_code: sc.scale_code,
            scale_name: sc.scale_name,
            scale_version: sc.scale_version,
            source_mode: sc.source_mode,
            score_unit: sc.score_unit,
            score_value: sc.score_value,
            responses: sc.responses,
            recorded_date: recDate,
            context_label: sc.context_label,
            clinical_note: sc.clinical_note
          }
        });
      }
      closeModal();
      await refreshCurrentView();
    } catch (err) {
      confirmBtn.disabled = false;
      errBox.textContent = err.message;
      errBox.style.display = "block";
    }
  });
}

// ============================================================================
// MODALE REGISTRAZIONE SCALA (CON SUPPORTO PCS & TSK-13 INTERATTIVO)
// ============================================================================

function showRecordOutcomeModal(episodeId, evaluationId = null) {
  const todayStr = todayRomeStr();
  let multiItemMode = "quick";

  openModal(
    `
    <h2 class="modal-title">Registra scala</h2>
    <form id="recordOutcomeForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Scala *</label>
          <select class="form-control" name="scale_code" id="outcomeScaleSelect">
            <option value="PCS">PCS-I — Pain Catastrophizing Scale (0–52)</option>
            <option value="TSK-13">TSK-13 — Tampa Scale of Kinesiophobia (13–52)</option>
            <option value="NPRS">NPRS — Dolore (0–10)</option>
            <option value="PSFS">PSFS — Funzione specifica (0–10)</option>
            <option value="SANE">SANE — Funzione globale (0–100%)</option>
            <option value="QuickDASH">QuickDASH (/100)</option>
            <option value="ODI">ODI — Oswestry Disability Index (%)</option>
            <option value="NDI">NDI — Neck Disability Index (%)</option>
            <option value="LEFS">LEFS — Lower Extremity Functional Scale (/80)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Data *</label>
          <input class="form-control" type="date" name="recorded_date" value="${todayStr}" required />
        </div>
      </div>

      <div id="multiItemToggleRow" style="margin-bottom:12px;">
        <div class="segmented">
          <button type="button" class="seg-btn active" data-entry-mode="quick">Punteggio totale</button>
          <button type="button" class="seg-btn" data-entry-mode="items">Compila i 13 item</button>
        </div>
      </div>

      <div class="form-group" id="singleScoreBox">
        <label class="form-label" id="singleScoreLabel">Punteggio (0–52) *</label>
        <input class="form-control" type="number" step="0.1" name="score_value" id="singleScoreInput" placeholder="Es. 28" />
      </div>

      <div id="itemsFormBox" style="display:none;"></div>

      <div id="psfsItemsBox" style="display:none; margin-bottom:12px;">
        <div class="form-label">Attività specifiche (0–10)</div>
        <div class="grid-2" style="margin-bottom:6px;">
          <input class="form-control" name="psfs_act_1" placeholder="Attività 1" />
          <input class="form-control" type="number" min="0" max="10" step="0.5" name="psfs_score_1" placeholder="Punteggio 0–10" />
        </div>
        <div class="grid-2" style="margin-bottom:6px;">
          <input class="form-control" name="psfs_act_2" placeholder="Attività 2" />
          <input class="form-control" type="number" min="0" max="10" step="0.5" name="psfs_score_2" placeholder="Punteggio 0–10" />
        </div>
        <div class="grid-2">
          <input class="form-control" name="psfs_act_3" placeholder="Attività 3" />
          <input class="form-control" type="number" min="0" max="10" step="0.5" name="psfs_score_3" placeholder="Punteggio 0–10" />
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group"><label class="form-label">Contesto</label><input class="form-control" name="context_label" value="Valutazione in seduta" /></div>
        <div class="form-group"><label class="form-label">Note</label><input class="form-control" name="clinical_note" id="outcomeClinicalNoteInput" /></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelOutcomeBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva scala</button>
      </div>
    </form>
  `,
    { wide: true }
  );

  const scaleSel = document.getElementById("outcomeScaleSelect");
  const toggleRow = document.getElementById("multiItemToggleRow");
  const singleBox = document.getElementById("singleScoreBox");
  const singleLabel = document.getElementById("singleScoreLabel");
  const itemsBox = document.getElementById("itemsFormBox");
  const psfsBox = document.getElementById("psfsItemsBox");

  const render13Items = (code) => {
    const defs = code === "PCS" ? PCS_ITEMS : TSK13_ITEMS;
    const values = code === "PCS" ? [0, 1, 2, 3, 4] : [1, 2, 3, 4];
    const legend =
      code === "PCS"
        ? "0 = Mai · 1 = Poco · 2 = Moderatamente · 3 = Molto · 4 = Sempre"
        : "1 = Per nulla d'accordo · 2 = Poco · 3 = Abbastanza · 4 = Molto d'accordo";

    itemsBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:6px;">
        <span style="font-size:12px; color:var(--text-muted);">${legend}</span>
        <span id="liveScaleTotal" class="tag tag-accent num">Totale: —/52</span>
      </div>
      <div class="scale-items-scroll">
        ${defs
          .map(
            (it) => `
            <div class="scale-item-row">
              <span><strong class="num" style="color:var(--text-muted); margin-right:6px;">${it.item}.</strong>${esc(it.text)}</span>
              <div class="scale-rating-group">
                ${values
                  .map(
                    (v) => `
                    <label class="scale-rating-pill">
                      <input type="radio" name="scale_item_${it.item}" value="${v}" />
                      <span>${v}</span>
                    </label>`
                  )
                  .join("")}
              </div>
            </div>`
          )
          .join("")}
      </div>
    `;

    itemsBox.querySelectorAll('input[type="radio"]').forEach((r) => {
      r.addEventListener("change", () => {
        const checked = defs
          .map((it) => {
            const el = itemsBox.querySelector(`input[name="scale_item_${it.item}"]:checked`);
            return el ? { ...it, score: Number(el.value) } : null;
          })
          .filter(Boolean);
        const sum = checked.reduce((a, x) => a + x.score, 0);
        const liveEl = document.getElementById("liveScaleTotal");
        if (liveEl) liveEl.textContent = `Totale: ${sum}/52 (${checked.length}/13)`;
      });
    });
  };

  const syncScaleUi = () => {
    const code = scaleSel.value;
    const is13 = code === "PCS" || code === "TSK-13";
    const isPsfs = code === "PSFS";

    toggleRow.style.display = is13 ? "block" : "none";
    psfsBox.style.display = isPsfs ? "block" : "none";

    if (is13 && multiItemMode === "items") {
      singleBox.style.display = "none";
      itemsBox.style.display = "block";
      render13Items(code);
    } else if (isPsfs) {
      singleBox.style.display = "none";
      itemsBox.style.display = "none";
    } else {
      singleBox.style.display = "block";
      itemsBox.style.display = "none";
      const hints = {
        PCS: "Punteggio totale (0–52) *",
        "TSK-13": "Punteggio totale (13–52) *",
        NPRS: "Intensità dolore (0–10) *",
        SANE: "Funzione percepita (0–100%) *",
        QuickDASH: "Punteggio (0–100) *",
        ODI: "Percentuale (%) *",
        NDI: "Percentuale (%) *",
        LEFS: "Punteggio (0–80) *"
      };
      singleLabel.textContent = hints[code] || "Punteggio *";
    }
  };

  scaleSel?.addEventListener("change", syncScaleUi);
  toggleRow?.querySelectorAll("[data-entry-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      multiItemMode = btn.getAttribute("data-entry-mode");
      toggleRow.querySelectorAll("[data-entry-mode]").forEach((b) => b.classList.toggle("active", b === btn));
      syncScaleUi();
    });
  });

  syncScaleUi();

  document.getElementById("cancelOutcomeBtn")?.addEventListener("click", closeModal);
  document.getElementById("recordOutcomeForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const scaleCode = fd.get("scale_code");
    let responses = [];
    let scoreVal = fd.get("score_value");
    let clinicalNote = (fd.get("clinical_note") || "").trim();

    if (scaleCode === "PSFS") {
      for (let i = 1; i <= 3; i++) {
        const act = fd.get(`psfs_act_${i}`);
        const sc = fd.get(`psfs_score_${i}`);
        if (act && act.trim()) {
          responses.push({ activity: act.trim(), score: sc !== "" && sc !== null ? Number(sc) : null });
        }
      }
    } else if ((scaleCode === "PCS" || scaleCode === "TSK-13") && multiItemMode === "items") {
      const defs = scaleCode === "PCS" ? PCS_ITEMS : TSK13_ITEMS;
      responses = defs.map((it) => {
        const raw = fd.get(`scale_item_${it.item}`);
        return {
          item: it.item,
          subscale: it.subscale,
          text: it.text,
          score: raw !== null && raw !== "" ? Number(raw) : null
        };
      });
      const valid = responses.filter((r) => r.score !== null);
      if (!valid.length) {
        alert("Seleziona almeno una risposta.");
        return;
      }
      scoreVal = valid.reduce((a, r) => a + r.score, 0);
      if (!clinicalNote) clinicalNote = buildClinicalNoteFromBreakdown(scaleCode, responses, scoreVal);
    }

    try {
      await apiFetch("/api/physio/outcome-measures", {
        method: "POST",
        body: {
          episode_id: episodeId,
          evaluation_id: evaluationId,
          scale_code: scaleCode,
          score_value: scoreVal,
          responses,
          recorded_date: fd.get("recorded_date"),
          context_label: fd.get("context_label"),
          clinical_note: clinicalNote
        }
      });
      closeModal();
      await refreshCurrentView();
    } catch (err) {
      alert(err.message);
    }
  });
}

// ============================================================================
// ALTRI MODALI OPERATIVI
// ============================================================================

function bindCommonActionButtons(root) {
  root.querySelectorAll("[data-open-person]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      await navigateTo("people", {
        personId: Number(el.getAttribute("data-open-person")),
        personTab: el.getAttribute("data-person-tab") || "profilo"
      });
    });
  });
}

function showNewPersonModal() {
  openModal(`
    <h2 class="modal-title">Nuova persona</h2>
    <form id="createPersonModalForm">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Nome *</label><input class="form-control" name="first_name" required /></div>
        <div class="form-group"><label class="form-label">Cognome *</label><input class="form-control" name="last_name" required /></div>
      </div>
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Data di nascita</label><input class="form-control" type="date" name="birth_date" /></div>
        <div class="form-group"><label class="form-label">Telefono</label><input class="form-control" name="phone" /></div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-control" type="email" name="email" /></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Problematiche / Dolori attuali</label><input class="form-control" name="current_pain_notes" /></div>
        <div class="form-group"><label class="form-label">Sport / Obiettivo</label><input class="form-control" name="goals" /></div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Percorso</label>
          <div style="display:flex; gap:18px; padding-top:6px;">
            <label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" name="physio_active" checked /> Fisio</label>
            <label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" name="fitness_active" /> PT</label>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Sedute già svolte in passato (retroattivo)</label>
          <input class="form-control" type="number" min="0" step="1" name="prior_sessions_count" value="0" placeholder="0" />
        </div>
      </div>
      <div class="form-group"><label class="form-label">Note</label><textarea class="form-control" name="general_notes" rows="2"></textarea></div>
      <div id="dupWarningBox" style="display:none; background:var(--warning-soft); border:1px solid var(--warning-border); padding:10px; border-radius:6px; margin-bottom:10px; font-size:13px;"></div>
      <input type="hidden" name="confirm_duplicate_override" id="dupOverrideInput" value="" />
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelModalBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Crea scheda</button>
      </div>
    </form>
  `);
  document.getElementById("cancelModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("createPersonModalForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const created = await apiFetch("/api/people", {
        method: "POST",
        body: {
          first_name: fd.get("first_name"),
          last_name: fd.get("last_name"),
          birth_date: fd.get("birth_date"),
          phone: fd.get("phone"),
          email: fd.get("email"),
          current_pain_notes: fd.get("current_pain_notes"),
          goals: fd.get("goals"),
          physio_active: fd.get("physio_active") === "on",
          fitness_active: fd.get("fitness_active") === "on",
          prior_sessions_count: Math.max(0, Number(fd.get("prior_sessions_count") || 0)),
          general_notes: fd.get("general_notes"),
          confirm_duplicate_override: fd.get("confirm_duplicate_override") === "1"
        }
      });
      closeModal();
      await navigateTo("people", { personId: created.id, personTab: "profilo" });
    } catch (err) {
      if (err.details?.potential_duplicates) {
        const box = document.getElementById("dupWarningBox");
        box.style.display = "block";
        box.innerHTML = `<strong>Possibile duplicato:</strong> ${err.details.potential_duplicates
          .map((d) => `${esc(d.first_name)} ${esc(d.last_name)} (${esc((d.duplicate_reasons || []).join(", "))})`)
          .join("; ")}. Premi di nuovo "Crea scheda" per confermare.`;
        document.getElementById("dupOverrideInput").value = "1";
      } else {
        alert(err.message);
      }
    }
  });
}

async function showNewPackageModal(preselectedPersonId = null) {
  let people = state.allPeopleSearchCache;
  if (!people) {
    const pData = await apiFetch("/api/people?status=attivo");
    people = pData.people || [];
    state.allPeopleSearchCache = people;
  }
  const selectedPid = preselectedPersonId || state.selectedPersonId || people[0]?.id;
  const selectedPerson = people.find((p) => p.id === selectedPid);
  let activeCatKey = selectedPerson?.primary_area === "fitness" ? "pt_normale" : "fisio";
  let activePresetId = PACKAGE_CATALOG.find((c) => c.key === activeCatKey).presets[0].id;
  let isOpenSingleSelected = false;

  openModal(`
    <h2 class="modal-title">Nuovo pacchetto o sedute singole</h2>
    <form id="newPkgModalForm">
      <input type="hidden" name="service_area" id="pkgServiceAreaInput" value="fisio" />

      <div class="form-group">
        <label class="form-label">Persona *</label>
        <select class="form-control" name="person_id" id="pkgPersonSelect" required>
          ${people.map((p) => `<option value="${p.id}" ${p.id === selectedPid ? "selected" : ""}>${esc(p.last_name)} ${esc(p.first_name)}</option>`).join("")}
        </select>
      </div>

      <div class="form-group" style="margin-bottom:8px;">
        <label class="form-label">Tipologia</label>
        <div class="pkg-cat-pills" id="pkgCatPills">
          ${PACKAGE_CATALOG.map(
            (c) =>
              `<button type="button" class="pkg-cat-pill ${c.key === "blvck" ? "pill-blvck" : ""} ${c.key === activeCatKey ? "active" : ""}" data-pkg-cat="${c.key}">${esc(c.label)}</button>`
          ).join("")}
        </div>
        <p class="pkg-cat-desc" id="pkgCatDesc"></p>
      </div>

      <div class="form-group" style="margin-bottom:8px;">
        <label class="form-label">Formula</label>
        <div class="pkg-preset-grid" id="pkgPresetGrid"></div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Nome *</label>
          <input class="form-control" name="name" id="pkgNameInput" required />
        </div>
        <div class="form-group" id="pkgSessionsGroup">
          <label class="form-label">Numero sedute *</label>
          <input class="form-control" type="number" name="total_sessions" id="pkgSessionsInput" min="1" required />
        </div>
        <div class="form-group" id="pkgOpenSingleInfo" style="display:none;">
          <label class="form-label">Numero sedute</label>
          <div class="form-control" style="display:flex; align-items:center; background:var(--bg-hover); color:var(--text-secondary);">Aperte (senza limite)</div>
        </div>
      </div>

      <div id="pkgOpenStartWrap" style="display:none; margin:-2px 0 12px;">
        <label class="anam-toggle-row" style="font-size:12.5px;">
          <span class="toggle-switch">
            <input type="checkbox" id="pkgOpenStartCheck" checked />
            <span class="toggle-track"></span>
          </span>
          <span class="anam-toggle-label">Registra già la 1ª seduta svolta oggi (+1)</span>
        </label>
      </div>

      <div class="grid-2">
        <div class="form-group"><label class="form-label">Data inizio</label><input class="form-control" type="date" name="purchased_date" value="${todayRomeStr()}" required /></div>
        <div class="form-group" id="pkgValidUntilGroup"><label class="form-label">Scadenza (opzionale)</label><input class="form-control" type="date" name="valid_until" /></div>
      </div>

      <div class="form-group">
        <label class="form-label">Note (opzionale)</label>
        <input class="form-control" name="notes" id="pkgNotesInput" />
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelPkgModalBtn">Annulla</button>
        <button type="submit" class="btn btn-primary" id="submitPkgModalBtn">Crea pacchetto</button>
      </div>
    </form>
  `);

  const areaInput = document.getElementById("pkgServiceAreaInput");
  const nameInput = document.getElementById("pkgNameInput");
  const sessionsInput = document.getElementById("pkgSessionsInput");
  const sessionsGroup = document.getElementById("pkgSessionsGroup");
  const openSingleInfo = document.getElementById("pkgOpenSingleInfo");
  const openStartWrap = document.getElementById("pkgOpenStartWrap");
  const openStartCheck = document.getElementById("pkgOpenStartCheck");
  const validUntilGroup = document.getElementById("pkgValidUntilGroup");
  const notesInput = document.getElementById("pkgNotesInput");
  const catDescEl = document.getElementById("pkgCatDesc");
  const presetGrid = document.getElementById("pkgPresetGrid");
  const submitBtn = document.getElementById("submitPkgModalBtn");

  const applyCategoryAndPreset = (catKey, presetId = null) => {
    const cat = PACKAGE_CATALOG.find((c) => c.key === catKey) || PACKAGE_CATALOG[0];
    activeCatKey = cat.key;
    const preset = cat.presets.find((pr) => pr.id === presetId) || cat.presets[0];
    activePresetId = preset.id;
    isOpenSingleSelected = Boolean(preset.openSingle);

    if (areaInput) areaInput.value = cat.serviceArea;
    if (catDescEl) catDescEl.textContent = cat.description;
    if (notesInput) notesInput.placeholder = cat.notePlaceholder;

    document.querySelectorAll("#pkgCatPills [data-pkg-cat]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-pkg-cat") === cat.key);
    });

    if (presetGrid) {
      presetGrid.innerHTML = cat.presets
        .map(
          (pr) => `
          <button type="button" class="pkg-preset-card ${cat.key === "blvck" ? "is-blvck" : ""} ${pr.id === activePresetId ? "active" : ""}" data-pkg-preset="${pr.id}">
            <span class="pkg-preset-title">${esc(pr.label)}</span>
            <span class="pkg-preset-sub">${esc(pr.sub)}</span>
          </button>`
        )
        .join("");

      presetGrid.querySelectorAll("[data-pkg-preset]").forEach((btn) => {
        btn.addEventListener("click", () => {
          applyCategoryAndPreset(activeCatKey, btn.getAttribute("data-pkg-preset"));
        });
      });
    }

    if (nameInput) nameInput.value = preset.name;
    if (sessionsGroup) sessionsGroup.style.display = isOpenSingleSelected ? "none" : "block";
    if (openSingleInfo) openSingleInfo.style.display = isOpenSingleSelected ? "block" : "none";
    if (openStartWrap) openStartWrap.style.display = isOpenSingleSelected ? "block" : "none";
    if (validUntilGroup) validUntilGroup.style.display = isOpenSingleSelected ? "none" : "block";

    if (sessionsInput) {
      sessionsInput.disabled = isOpenSingleSelected;
      sessionsInput.required = !isOpenSingleSelected;
      if (isOpenSingleSelected) {
        sessionsInput.value = "1";
      } else if (preset.sessions !== null) {
        sessionsInput.value = String(preset.sessions);
      } else {
        if (!sessionsInput.value || Number(sessionsInput.value) < 1) sessionsInput.value = "10";
        sessionsInput.focus();
        sessionsInput.select?.();
      }
    }
    if (submitBtn) {
      submitBtn.textContent = isOpenSingleSelected ? "Apri sedute singole" : "Crea pacchetto";
    }
  };

  document.querySelectorAll("#pkgCatPills [data-pkg-cat]").forEach((btn) => {
    btn.addEventListener("click", () => applyCategoryAndPreset(btn.getAttribute("data-pkg-cat")));
  });
  applyCategoryAndPreset(activeCatKey, activePresetId);

  document.getElementById("cancelPkgModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("newPkgModalForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const totalSessions = isOpenSingleSelected ? 0 : Math.max(1, Number(fd.get("total_sessions") || 1));
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiFetch("/api/packages", {
        method: "POST",
        body: {
          person_id: Number(fd.get("person_id")),
          service_area: fd.get("service_area"),
          name: fd.get("name"),
          total_sessions: totalSessions,
          initial_sessions: isOpenSingleSelected && openStartCheck?.checked ? 1 : 0,
          price_eur: 0,
          purchased_date: fd.get("purchased_date"),
          valid_until: isOpenSingleSelected ? "" : fd.get("valid_until"),
          notes: fd.get("notes")
        }
      });
      closeModal();
      await refreshCurrentView();
    } catch (err) {
      if (submitBtn) submitBtn.disabled = false;
      alert(err.message || "Errore nella creazione del pacchetto.");
    }
  });
}

function showEditPriorSessionsModal(dossier) {
  const p = dossier.person;
  const lt = computePersonLifetimeSessions(dossier);

  openModal(`
    <h2 class="modal-title">Sedute pregresse (storico retroattivo)</h2>
    <p style="margin:-6px 0 14px; font-size:13px; color:var(--text-secondary);">
      Inserisci il numero di lezioni o sedute già svolte con <strong>${esc(p.first_name)} ${esc(p.last_name)}</strong> prima di iniziare a usare il gestionale.
      Verranno sommate automaticamente alle sedute tracciate qui.
    </p>
    <form id="editPriorSessionsForm">
      <div class="form-group">
        <label class="form-label">Sedute svolte in passato *</label>
        <input class="form-control" type="number" min="0" step="1" name="prior_sessions_count" id="priorSessionsInput" value="${lt.prior}" required />
      </div>
      <div id="priorPreviewBox" style="padding:10px 12px; border-radius:var(--radius-md); background:var(--bg-hover); border:1px solid var(--border); font-size:13px; color:var(--text-secondary); margin-bottom:12px;"></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelPriorBtn">Annulla</button>
        <button type="submit" class="btn btn-primary" id="savePriorBtn">Salva conteggio</button>
      </div>
    </form>
  `);

  const inp = document.getElementById("priorSessionsInput");
  const prev = document.getElementById("priorPreviewBox");
  const saveBtn = document.getElementById("savePriorBtn");

  const paintPrev = () => {
    const val = Math.max(0, Math.floor(Number(inp?.value || 0)));
    if (prev) {
      prev.innerHTML = `<strong class="num">${val}</strong> pregresse + <strong class="num">${lt.tracked}</strong> sul gestionale = <strong class="num" style="color:var(--text);">${val + lt.tracked} sedute totali svolte</strong>`;
    }
  };
  paintPrev();
  inp?.addEventListener("input", paintPrev);
  inp?.focus();
  inp?.select?.();

  document.getElementById("cancelPriorBtn")?.addEventListener("click", closeModal);
  document.getElementById("editPriorSessionsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const val = Math.max(0, Math.floor(Number(inp?.value || 0)));
    if (saveBtn) saveBtn.disabled = true;
    try {
      await apiFetch(`/api/people/${p.id}`, {
        method: "PUT",
        body: {
          expected_version: p.version,
          prior_sessions_count: val
        }
      });
      closeModal();
      await refreshCurrentView();
    } catch (err) {
      if (saveBtn) saveBtn.disabled = false;
      alert(err.message || "Errore nel salvataggio.");
    }
  });
}

function showRenewPackageModal(pkg) {
  const cat = inferPackageCategory(pkg);
  const shortTitle = shortPackageTitle(pkg);
  const fullName = [pkg.first_name, pkg.last_name].filter(Boolean).join(" ");
  const totalSessions = Math.max(1, Number(pkg.total_sessions || 1));

  openModal(`
    <h2 class="modal-title">Rinnova pacchetto</h2>
    <p style="margin:-6px 0 14px; font-size:13px; color:var(--text-secondary);">
      Avvia un nuovo pacchetto identico${fullName ? ` per <strong class="sensitive-data">${esc(fullName)}</strong>` : ""}, mantenendo il precedente nello storico sedute svolte.
    </p>

    <div style="padding:12px 14px; border-radius:var(--radius-md); background:var(--bg-hover); border:1px solid var(--border); margin-bottom:14px; display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span class="tag ${cat.badgeClass}">${esc(cat.label)}</span>
        <strong style="font-size:14px; color:var(--text);">${esc(shortTitle)}</strong>
      </div>
      <span class="tag tag-accent num"><strong>${totalSessions}</strong> sedute</span>
    </div>

    <form id="renewPkgModalForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Data inizio</label>
          <input class="form-control" type="date" name="purchased_date" value="${todayRomeStr()}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Scadenza (opzionale)</label>
          <input class="form-control" type="date" name="valid_until" />
        </div>
      </div>

      <div style="margin:0 0 12px;">
        <label class="anam-toggle-row" style="font-size:12.5px;">
          <span class="toggle-switch">
            <input type="checkbox" id="renewConsumeFirstCheck" />
            <span class="toggle-track"></span>
          </span>
          <span class="anam-toggle-label">Scala già la 1ª seduta svolta oggi (1 / ${totalSessions})</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-label">Note (opzionale)</label>
        <input class="form-control" name="notes" value="${esc(pkg.notes || "")}" placeholder="${esc(cat.notePlaceholder)}" />
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelRenewPkgBtn">Annulla</button>
        <button type="submit" class="btn btn-primary" id="submitRenewPkgBtn">Avvia nuovo pacchetto</button>
      </div>
    </form>
  `);

  const firstCheck = document.getElementById("renewConsumeFirstCheck");
  const submitBtn = document.getElementById("submitRenewPkgBtn");
  submitBtn?.focus();

  document.getElementById("cancelRenewPkgBtn")?.addEventListener("click", closeModal);
  document.getElementById("renewPkgModalForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (submitBtn) submitBtn.disabled = true;
    try {
      await apiFetch("/api/packages", {
        method: "POST",
        body: {
          person_id: Number(pkg.person_id),
          service_area: pkg.service_area || cat.serviceArea,
          name: pkg.name,
          total_sessions: totalSessions,
          initial_sessions: firstCheck?.checked ? 1 : 0,
          price_eur: 0,
          purchased_date: fd.get("purchased_date"),
          valid_until: fd.get("valid_until"),
          notes: fd.get("notes")
        }
      });
      closeModal();
      await refreshCurrentView();
    } catch (err) {
      if (submitBtn) submitBtn.disabled = false;
      alert(err.message || "Errore nel rinnovo del pacchetto.");
    }
  });
}

function showConvertPackageModal(pkg) {
  const initialCat = inferPackageCategory(pkg);
  const consumed = Number(pkg.consumed_sessions || 0);
  let activeCatKey = initialCat.key;
  const fixedPresetsOf = (cat) => cat.presets.filter((pr) => !pr.openSingle);
  let activePresetId = fixedPresetsOf(initialCat)[0].id;

  openModal(`
    <h2 class="modal-title">Converti sedute singole in pacchetto</h2>
    <p style="margin:-6px 0 14px; font-size:13px; color:var(--text-secondary);">
      Origine: <strong>${esc(pkg.name)}</strong> · <strong class="num">${consumed}</strong> ${consumed === 1 ? "seduta già svolta" : "sedute già svolte"}
    </p>
    <form id="convertPkgModalForm">
      <input type="hidden" name="service_area" id="convServiceAreaInput" value="${esc(initialCat.serviceArea)}" />

      <div class="form-group" style="margin-bottom:8px;">
        <label class="form-label">Tipologia pacchetto</label>
        <div class="pkg-cat-pills" id="convCatPills">
          ${PACKAGE_CATALOG.map(
            (c) =>
              `<button type="button" class="pkg-cat-pill ${c.key === "blvck" ? "pill-blvck" : ""} ${c.key === activeCatKey ? "active" : ""}" data-conv-cat="${c.key}">${esc(c.label)}</button>`
          ).join("")}
        </div>
      </div>

      <div class="form-group" style="margin-bottom:8px;">
        <label class="form-label">Formula pacchetto</label>
        <div class="pkg-preset-grid" id="convPresetGrid"></div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Nome pacchetto *</label>
          <input class="form-control" name="name" id="convNameInput" required />
        </div>
        <div class="form-group">
          <label class="form-label">Totale sedute *</label>
          <input class="form-control" type="number" name="total_sessions" id="convSessionsInput" min="${Math.max(1, consumed)}" required />
        </div>
      </div>

      <div id="convPreviewBox" style="padding:10px 12px; border-radius:var(--radius-md); border:1px solid var(--border); font-size:13px; margin-bottom:12px;"></div>

      <div class="grid-2">
        <div class="form-group"><label class="form-label">Scadenza (opzionale)</label><input class="form-control" type="date" name="valid_until" value="${esc(pkg.valid_until || "")}" /></div>
        <div class="form-group"><label class="form-label">Note (opzionale)</label><input class="form-control" name="notes" id="convNotesInput" value="${esc(pkg.notes || "")}" /></div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelConvModalBtn">Annulla</button>
        <button type="submit" class="btn btn-primary" id="submitConvModalBtn">Converti in pacchetto</button>
      </div>
    </form>
  `);

  const areaInput = document.getElementById("convServiceAreaInput");
  const nameInput = document.getElementById("convNameInput");
  const sessionsInput = document.getElementById("convSessionsInput");
  const notesInput = document.getElementById("convNotesInput");
  const presetGrid = document.getElementById("convPresetGrid");
  const previewBox = document.getElementById("convPreviewBox");
  const submitBtn = document.getElementById("submitConvModalBtn");

  const updatePreview = () => {
    const target = Number(sessionsInput?.value || 0);
    if (!previewBox) return;
    if (target < consumed) {
      previewBox.style.background = "#fef2f2";
      previewBox.style.borderColor = "#fecaca";
      previewBox.style.color = "#991b1b";
      previewBox.innerHTML = `Hai già <strong>${consumed}</strong> sedute svolte: scegli un pacchetto da almeno <strong>${consumed}</strong> sedute.`;
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
    const remAfter = Math.max(0, target - consumed);
    const tone = getSessionCounterTone(remAfter, target);
    previewBox.style.background = tone.bg;
    previewBox.style.borderColor = tone.border;
    previewBox.style.color = tone.text;
    previewBox.innerHTML =
      consumed > 0
        ? `Le <strong>${consumed}</strong> sedute singole già svolte saranno incluse nel pacchetto → resteranno <strong class="num">${remAfter}</strong> ${remAfter === 1 ? "seduta" : "sedute"} su <strong class="num">${target}</strong> (storico date conservato).`
        : `Il contatore diventerà un pacchetto da <strong class="num">${target}</strong> sedute (tutte ancora disponibili).`;
    if (submitBtn) submitBtn.disabled = target <= 0;
  };

  const applyConvertPreset = (catKey, presetId = null) => {
    const cat = PACKAGE_CATALOG.find((c) => c.key === catKey) || PACKAGE_CATALOG[0];
    activeCatKey = cat.key;
    const fixed = fixedPresetsOf(cat);
    const preset = fixed.find((pr) => pr.id === presetId) || fixed[0];
    activePresetId = preset.id;

    if (areaInput) areaInput.value = cat.serviceArea;
    if (notesInput && !notesInput.value) notesInput.placeholder = cat.notePlaceholder;

    document.querySelectorAll("#convCatPills [data-conv-cat]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-conv-cat") === cat.key);
    });

    if (presetGrid) {
      presetGrid.innerHTML = fixed
        .map(
          (pr) => `
          <button type="button" class="pkg-preset-card ${cat.key === "blvck" ? "is-blvck" : ""} ${pr.id === activePresetId ? "active" : ""}" data-conv-preset="${pr.id}">
            <span class="pkg-preset-title">${esc(pr.label)}</span>
            <span class="pkg-preset-sub">${esc(pr.sub)}</span>
          </button>`
        )
        .join("");

      presetGrid.querySelectorAll("[data-conv-preset]").forEach((btn) => {
        btn.addEventListener("click", () => {
          applyConvertPreset(activeCatKey, btn.getAttribute("data-conv-preset"));
        });
      });
    }

    if (nameInput) nameInput.value = preset.name;
    if (sessionsInput) {
      if (preset.sessions !== null) {
        sessionsInput.value = String(preset.sessions);
      } else {
        sessionsInput.value = String(Math.max(10, consumed));
        sessionsInput.focus();
        sessionsInput.select?.();
      }
    }
    updatePreview();
  };

  document.querySelectorAll("#convCatPills [data-conv-cat]").forEach((btn) => {
    btn.addEventListener("click", () => applyConvertPreset(btn.getAttribute("data-conv-cat")));
  });
  sessionsInput?.addEventListener("input", updatePreview);
  applyConvertPreset(activeCatKey, activePresetId);

  document.getElementById("cancelConvModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("convertPkgModalForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await apiFetch(`/api/packages/${pkg.id}/convert`, {
        method: "POST",
        body: {
          service_area: fd.get("service_area"),
          name: fd.get("name"),
          total_sessions: Number(fd.get("total_sessions")),
          valid_until: fd.get("valid_until"),
          notes: fd.get("notes")
        }
      });
      closeModal();
      await refreshCurrentView();
    } catch (err) {
      alert(err.message);
    }
  });
}

function showNewPhysioEpisodeModal(personId) {
  openModal(`
    <h2 class="modal-title">Nuovo episodio clinico</h2>
    <form id="newEpisodeForm">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Titolo *</label><input class="form-control" name="title" placeholder="Es. Spalla destra / Lombalgia" required /></div>
        <div class="form-group">
          <label class="form-label">Distretto e lato</label>
          <div style="display:flex; gap:6px;">
            <input class="form-control" name="body_region" placeholder="Es. Spalla" />
            <select class="form-control" name="laterality" style="width:110px;">
              <option value="DX">DX</option>
              <option value="SX">SX</option>
              <option value="Bilaterale">Bilaterale</option>
              <option value="Centrale">Centrale</option>
            </select>
          </div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Problematica / Motivo *</label><input class="form-control" name="chief_complaint" required /></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Data inizio</label><input class="form-control" type="date" name="start_date" value="${todayRomeStr()}" required /></div>
        <div class="form-group"><label class="form-label">Rivalutazione prevista</label><input class="form-control" type="date" name="reassessment_due_date" /></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Obiettivi persona</label><textarea class="form-control" name="patient_goals" rows="2"></textarea></div>
        <div class="form-group"><label class="form-label">Obiettivi clinici</label><textarea class="form-control" name="therapist_goals" rows="2"></textarea></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelEpBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Crea episodio</button>
      </div>
    </form>
  `);
  document.getElementById("cancelEpBtn")?.addEventListener("click", closeModal);
  document.getElementById("newEpisodeForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const ep = await apiFetch("/api/physio/episodes", {
      method: "POST",
      body: {
        person_id: personId,
        title: fd.get("title"),
        body_region: fd.get("body_region"),
        laterality: fd.get("laterality"),
        chief_complaint: fd.get("chief_complaint"),
        start_date: fd.get("start_date"),
        reassessment_due_date: fd.get("reassessment_due_date"),
        patient_goals: fd.get("patient_goals"),
        therapist_goals: fd.get("therapist_goals"),
        init_default_flags: true
      }
    });
    state.selectedEpisodeId = ep.id;
    closeModal();
    await refreshCurrentView();
  });
}

function showEvaluationModal(episode, existingEval = null, defaultType = "prima_valutazione") {
  const ev = existingEval || {
    eval_type: defaultType,
    eval_date: todayRomeStr(),
    consult_reason: episode.chief_complaint || "",
    patient_goals: episode.patient_goals || "",
    symptom_onset: "",
    aggravating_factors: "",
    easing_factors: "",
    special_tests: "",
    clinical_reasoning: "",
    home_advice: "",
    next_reassessment_date: episode.reassessment_due_date || "",
    body_map_markers: []
  };

  state.bodyMapDraft = {
    viewSide: "anterior",
    markerKind: "point",
    radiusNorm: 24,
    symptomType: "Dolore acuto",
    intensity: 6,
    zoom: { scale: 1, focus: "full" },
    markers: JSON.parse(JSON.stringify(ev.body_map_markers || []))
  };

  openModal(
    `
    <h2 class="modal-title">${existingEval ? "Modifica valutazione" : defaultType === "rivalutazione" ? "Nuova rivalutazione" : "Nuova valutazione"}</h2>
    <form id="clinicalEvalForm">
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Tipo</label>
          <select class="form-control" name="eval_type">
            <option value="prima_valutazione" ${ev.eval_type === "prima_valutazione" ? "selected" : ""}>Prima valutazione</option>
            <option value="rivalutazione" ${ev.eval_type === "rivalutazione" ? "selected" : ""}>Rivalutazione</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Data</label><input class="form-control" type="date" name="eval_date" value="${esc(ev.eval_date)}" required /></div>
        <div class="form-group"><label class="form-label">Prossima rivalutazione</label><input class="form-control" type="date" name="next_reassessment_date" value="${esc(ev.next_reassessment_date || "")}" /></div>
      </div>

      <details class="clean-details" style="margin-bottom:14px;">
        <summary>
          <span>Mappa corporea 2D (<span id="bmMarkersCount">${state.bodyMapDraft.markers.length}</span>)</span>
          ${ico("chevronDown")}
        </summary>
        <div class="details-body">
          <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
            <button type="button" class="btn btn-xs btn-primary" id="bmViewAntBtn">Anteriore</button>
            <button type="button" class="btn btn-xs btn-secondary" id="bmViewPostBtn">Posteriore</button>
            <button type="button" class="btn btn-xs btn-secondary" id="bmZoom1Btn">1x</button>
            <button type="button" class="btn btn-xs btn-secondary" id="bmZoomUpperBtn">Sup</button>
            <button type="button" class="btn btn-xs btn-secondary" id="bmZoomLowerBtn">Inf</button>
          </div>
          <div class="body-map-layout">
            <div class="body-map-stage" id="bmInteractiveStage"></div>
            <div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">Tipo segno</label>
                  <select class="form-control form-control-sm" id="bmKindSelect"><option value="point">Punto</option><option value="area">Area</option></select>
                </div>
                <div class="form-group"><label class="form-label">Intensità (0–10)</label><input class="form-control form-control-sm" type="number" id="bmIntensityInput" value="6" min="0" max="10" /></div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">Sintomo</label>
                  <select class="form-control form-control-sm" id="bmSymptomSelect">
                    ${SYMPTOM_TYPES.map((s) => `<option value="${esc(s.id)}">${esc(s.id)}</option>`).join("")}
                  </select>
                </div>
                <div class="form-group"><label class="form-label">Nota</label><input class="form-control form-control-sm" id="bmNoteInput" /></div>
              </div>
              <div id="bmMarkersListContainer" style="max-height:190px; overflow-y:auto; margin-top:6px;"></div>
            </div>
          </div>
        </div>
      </details>

      <div class="grid-2">
        <div class="form-group"><label class="form-label">Motivo</label><textarea class="form-control" name="consult_reason" rows="2">${esc(ev.consult_reason || "")}</textarea></div>
        <div class="form-group"><label class="form-label">Obiettivi</label><textarea class="form-control" name="patient_goals" rows="2">${esc(ev.patient_goals || "")}</textarea></div>
      </div>
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Esordio e andamento</label><textarea class="form-control" name="symptom_onset" rows="2">${esc(ev.symptom_onset || "")}</textarea></div>
        <div class="form-group"><label class="form-label">Aggravanti</label><textarea class="form-control" name="aggravating_factors" rows="2">${esc(ev.aggravating_factors || "")}</textarea></div>
        <div class="form-group"><label class="form-label">Allevianti / 24h</label><textarea class="form-control" name="easing_factors" rows="2">${esc(ev.easing_factors || "")}</textarea></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Test speciali e osservazioni</label><textarea class="form-control" name="special_tests" rows="2">${esc(ev.special_tests || "")}</textarea></div>
        <div class="form-group"><label class="form-label">Ragionamento clinico e piano</label><textarea class="form-control" name="clinical_reasoning" rows="2">${esc(ev.clinical_reasoning || "")}</textarea></div>
      </div>
      <div class="form-group"><label class="form-label">Indicazioni domiciliari</label><input class="form-control" name="home_advice" value="${esc(ev.home_advice || "")}" /></div>

      <div class="modal-footer" style="justify-content:space-between;">
        <button type="button" class="btn btn-secondary" id="cancelEvalModalBtn">Annulla</button>
        <div style="display:flex; gap:8px;">
          <button type="submit" class="btn btn-secondary" data-save-eval-status="bozza">Salva bozza</button>
          <button type="submit" class="btn btn-primary" data-save-eval-status="finalizzata">Finalizza</button>
        </div>
      </div>
    </form>
  `,
    { wide: true }
  );

  const refreshBodyMap = () => {
    const stage = document.getElementById("bmInteractiveStage");
    if (!stage) return;
    stage.innerHTML = renderBodySvgMarkup(
      state.bodyMapDraft.viewSide,
      state.bodyMapDraft.markers.map((m, i) => ({ ...m, _globalIdx: i })),
      [],
      state.bodyMapDraft.zoom
    );
    const svgEl = stage.querySelector("svg");
    svgEl?.addEventListener("click", (evt) => {
      if (evt.target.closest(".active-marker")) return;
      const coords = clientEventToNormalizedSvgCoords(svgEl, evt);
      const inferred = inferAnatomicalRegionAndSide(state.bodyMapDraft.viewSide, coords.x_norm, coords.y_norm);
      const kind = document.getElementById("bmKindSelect").value;
      state.bodyMapDraft.markers.push({
        view_side: state.bodyMapDraft.viewSide,
        marker_kind: kind,
        x_norm: coords.x_norm,
        y_norm: coords.y_norm,
        radius_norm: kind === "area" ? 48 : 22,
        anatomical_region: inferred.region,
        laterality: inferred.laterality,
        symptom_type: document.getElementById("bmSymptomSelect").value,
        intensity: Number(document.getElementById("bmIntensityInput").value || 5),
        notes: document.getElementById("bmNoteInput").value
      });
      document.getElementById("bmNoteInput").value = "";
      refreshBodyMap();
    });

    document.getElementById("bmMarkersCount").textContent = String(state.bodyMapDraft.markers.length);
    const listBox = document.getElementById("bmMarkersListContainer");
    listBox.innerHTML =
      state.bodyMapDraft.markers
        .map(
          (m, idx) => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:5px 0; border-bottom:1px solid var(--border); font-size:12.5px;">
            <span><strong>${esc(m.anatomical_region)}</strong> (${esc(m.laterality)}) · ${esc(m.symptom_type)} ${m.intensity}/10</span>
            <button type="button" class="btn btn-xs btn-danger-ghost" data-del-bm-idx="${idx}">${ico("x")}</button>
          </div>`
        )
        .join("") || `<div style="font-size:12px; color:var(--text-muted);">Clicca sulla figura per segnare un punto.</div>`;

    listBox.querySelectorAll("[data-del-bm-idx]").forEach((b) => {
      b.addEventListener("click", () => {
        state.bodyMapDraft.markers.splice(Number(b.getAttribute("data-del-bm-idx")), 1);
        refreshBodyMap();
      });
    });
  };
  refreshBodyMap();

  document.getElementById("bmViewAntBtn")?.addEventListener("click", () => {
    state.bodyMapDraft.viewSide = "anterior";
    document.getElementById("bmViewAntBtn").className = "btn btn-xs btn-primary";
    document.getElementById("bmViewPostBtn").className = "btn btn-xs btn-secondary";
    refreshBodyMap();
  });
  document.getElementById("bmViewPostBtn")?.addEventListener("click", () => {
    state.bodyMapDraft.viewSide = "posterior";
    document.getElementById("bmViewPostBtn").className = "btn btn-xs btn-primary";
    document.getElementById("bmViewAntBtn").className = "btn btn-xs btn-secondary";
    refreshBodyMap();
  });
  document.getElementById("bmZoom1Btn")?.addEventListener("click", () => {
    state.bodyMapDraft.zoom = { scale: 1, focus: "full" };
    refreshBodyMap();
  });
  document.getElementById("bmZoomUpperBtn")?.addEventListener("click", () => {
    state.bodyMapDraft.zoom = { scale: 1.5, focus: "upper" };
    refreshBodyMap();
  });
  document.getElementById("bmZoomLowerBtn")?.addEventListener("click", () => {
    state.bodyMapDraft.zoom = { scale: 1.5, focus: "lower" };
    refreshBodyMap();
  });
  document.getElementById("cancelEvalModalBtn")?.addEventListener("click", closeModal);

  let chosenStatus = "bozza";
  document.querySelectorAll("[data-save-eval-status]").forEach((b) => {
    b.addEventListener("click", () => {
      chosenStatus = b.getAttribute("data-save-eval-status");
    });
  });

  document.getElementById("clinicalEvalForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const saved = await apiFetch(existingEval ? `/api/physio/evaluations/${existingEval.id}` : "/api/physio/evaluations", {
      method: existingEval ? "PUT" : "POST",
      body: {
        episode_id: episode.id,
        expected_version: existingEval ? existingEval.version : undefined,
        eval_type: fd.get("eval_type"),
        eval_date: fd.get("eval_date"),
        next_reassessment_date: fd.get("next_reassessment_date") || null,
        status: chosenStatus,
        consult_reason: fd.get("consult_reason"),
        patient_goals: fd.get("patient_goals"),
        symptom_onset: fd.get("symptom_onset"),
        aggravating_factors: fd.get("aggravating_factors"),
        easing_factors: fd.get("easing_factors"),
        special_tests: fd.get("special_tests"),
        clinical_reasoning: fd.get("clinical_reasoning"),
        home_advice: fd.get("home_advice"),
        body_map_markers: state.bodyMapDraft.markers
      }
    });
    state.selectedEvalId = saved.id;
    closeModal();
    await refreshCurrentView();
  });
}

function showEditFlagModal(flag) {
  openModal(`
    <h2 class="modal-title">Dettaglio flag</h2>
    <p style="font-size:13.5px; margin-top:0;">${esc(flag.item_label)}</p>
    <form id="editFlagForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Stato</label>
          <select class="form-control" name="status">
            <option value="non_valutato" ${flag.status === "non_valutato" ? "selected" : ""}>Non valutato</option>
            <option value="assente" ${flag.status === "assente" ? "selected" : ""}>Assente</option>
            <option value="presente" ${flag.status === "presente" ? "selected" : ""}>Presente</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Fonte</label><input class="form-control" name="source_info" value="${esc(flag.source_info || "")}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Note</label><textarea class="form-control" name="notes" rows="2">${esc(flag.notes || "")}</textarea></div>
      <div class="form-group"><label class="form-label">Azione intrapresa</label><input class="form-control" name="action_taken" value="${esc(flag.action_taken || "")}" /></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelFlagBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);
  document.getElementById("cancelFlagBtn")?.addEventListener("click", closeModal);
  document.getElementById("editFlagForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/physio/flags", {
      method: "PUT",
      body: { id: flag.id, status: fd.get("status"), source_info: fd.get("source_info"), notes: fd.get("notes"), action_taken: fd.get("action_taken") }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showCustomFlagModal(episodeId) {
  openModal(`
    <h2 class="modal-title">Nuova flag</h2>
    <form id="customFlagForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Tipo</label>
          <select class="form-control" name="flag_type"><option value="yellow">Yellow Flag</option><option value="red">Red Flag</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Stato</label>
          <select class="form-control" name="status"><option value="presente">Presente</option><option value="assente">Assente</option><option value="non_valutato">Non valutato</option></select>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Descrizione *</label><input class="form-control" name="item_label" required /></div>
      <div class="form-group"><label class="form-label">Note</label><textarea class="form-control" name="notes" rows="2"></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelCustFlagBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Aggiungi</button>
      </div>
    </form>
  `);
  document.getElementById("cancelCustFlagBtn")?.addEventListener("click", closeModal);
  document.getElementById("customFlagForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/physio/flags", {
      method: "POST",
      body: {
        episode_id: episodeId,
        flag_type: fd.get("flag_type"),
        status: fd.get("status"),
        item_label: fd.get("item_label"),
        source_info: "Valutazione clinica",
        action_taken: "",
        notes: fd.get("notes")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showSoapNoteModal(episode, existingNote = null, copiedFromNote = null) {
  const base = existingNote || copiedFromNote || {};
  openModal(`
    <h2 class="modal-title">${existingNote ? "Modifica nota di seduta" : "Nuova nota di seduta"}</h2>
    <form id="soapNoteForm">
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Data *</label><input class="form-control" type="date" name="note_date" value="${esc(existingNote ? existingNote.note_date : todayRomeStr())}" required /></div>
        <div class="form-group"><label class="form-label">Dolore pre (0–10)</label><input class="form-control" type="number" min="0" max="10" name="pain_pre" value="${esc(base.pain_pre ?? "")}" /></div>
        <div class="form-group"><label class="form-label">Dolore post (0–10)</label><input class="form-control" type="number" min="0" max="10" name="pain_post" value="${esc(base.pain_post ?? "")}" /></div>
      </div>
      <div class="form-group"><label class="form-label">S — Soggettivo</label><textarea class="form-control" name="subjective_response" rows="2">${esc(base.subjective_response || "")}</textarea></div>
      <div class="form-group"><label class="form-label">O — Oggettivo</label><textarea class="form-control" name="objective_findings" rows="2">${esc(base.objective_findings || "")}</textarea></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">A — Interventi</label><textarea class="form-control" name="interventions_performed" rows="2">${esc(base.interventions_performed || "")}</textarea></div>
        <div class="form-group"><label class="form-label">Esercizi</label><textarea class="form-control" name="exercises_performed" rows="2">${esc(base.exercises_performed || "")}</textarea></div>
      </div>
      <div class="form-group"><label class="form-label">P — Piano</label><textarea class="form-control" name="plan_next_steps" rows="2">${esc(base.plan_next_steps || "")}</textarea></div>
      <div class="modal-footer" style="justify-content:space-between;">
        <button type="button" class="btn btn-secondary" id="cancelSoapBtn">Annulla</button>
        <div style="display:flex; gap:8px;">
          <button type="submit" class="btn btn-secondary" data-soap-status="bozza">Salva bozza</button>
          <button type="submit" class="btn btn-primary" data-soap-status="finalizzata">Finalizza</button>
        </div>
      </div>
    </form>
  `);
  document.getElementById("cancelSoapBtn")?.addEventListener("click", closeModal);
  let targetStatus = "finalizzata";
  document.querySelectorAll("[data-soap-status]").forEach((b) => {
    b.addEventListener("click", () => {
      targetStatus = b.getAttribute("data-soap-status");
    });
  });
  document.getElementById("soapNoteForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch(existingNote ? `/api/physio/notes/${existingNote.id}` : "/api/physio/notes", {
      method: existingNote ? "PUT" : "POST",
      body: {
        episode_id: episode.id,
        expected_version: existingNote ? existingNote.version : undefined,
        copied_from_note_id: copiedFromNote ? copiedFromNote.id : undefined,
        copied_from_date: copiedFromNote ? copiedFromNote.note_date : undefined,
        note_date: fd.get("note_date"),
        status: targetStatus,
        pain_pre: fd.get("pain_pre"),
        pain_post: fd.get("pain_post"),
        subjective_response: fd.get("subjective_response"),
        objective_findings: fd.get("objective_findings"),
        interventions_performed: fd.get("interventions_performed"),
        exercises_performed: fd.get("exercises_performed"),
        plan_next_steps: fd.get("plan_next_steps")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showAddendumModal({ note_id = null, evaluation_id = null, title = "" }) {
  openModal(`
    <h2 class="modal-title">Integrazione — ${esc(title)}</h2>
    <form id="addendumForm">
      <div class="form-group"><label class="form-label">Motivo *</label><input class="form-control" name="reason" value="Integrazione clinica" required /></div>
      <div class="form-group"><label class="form-label">Testo *</label><textarea class="form-control" name="addendum_text" required></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelAddendumBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);
  document.getElementById("cancelAddendumBtn")?.addEventListener("click", closeModal);
  document.getElementById("addendumForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/physio/addenda", {
      method: "POST",
      body: { note_id, evaluation_id, reason: fd.get("reason"), addendum_text: fd.get("addendum_text") }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showCloseEpisodeModal(episode) {
  openModal(`
    <h2 class="modal-title">Stato episodio</h2>
    <form id="closeEpForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Stato</label>
          <select class="form-control" name="status">
            <option value="attivo" ${episode.status === "attivo" ? "selected" : ""}>Attivo</option>
            <option value="in_pausa" ${episode.status === "in_pausa" ? "selected" : ""}>In pausa</option>
            <option value="concluso" ${episode.status === "concluso" ? "selected" : ""}>Concluso</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Esito</label><input class="form-control" name="closure_outcome" value="${esc(episode.closure_outcome || "")}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Sintesi</label><textarea class="form-control" name="closure_summary" rows="3">${esc(episode.closure_summary || "")}</textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelCloseEpBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);
  document.getElementById("cancelCloseEpBtn")?.addEventListener("click", closeModal);
  document.getElementById("closeEpForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch(`/api/physio/episodes/${episode.id}`, {
      method: "PUT",
      body: { expected_version: episode.version, status: fd.get("status"), closure_outcome: fd.get("closure_outcome"), closure_summary: fd.get("closure_summary") }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showAddSharedLimitationModal(personId, episodes = [], defaultEpId = null) {
  openModal(`
    <h2 class="modal-title">Nuova limitazione / attenzione</h2>
    <form id="sharedLimForm">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Titolo *</label><input class="form-control" name="title" placeholder="Es. Evitare overhead pesante spalla DX" required /></div>
        <div class="form-group">
          <label class="form-label">Distretto e lato</label>
          <div style="display:flex; gap:6px;">
            <input class="form-control" name="body_region" placeholder="Spalla" />
            <select class="form-control" name="laterality" style="width:100px;">
              <option value="DX">DX</option>
              <option value="SX">SX</option>
              <option value="Bilaterale">Bilat.</option>
              <option value="Centrale">Centrale</option>
            </select>
          </div>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Dettaglio *</label><textarea class="form-control" name="description" rows="2" required></textarea></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Fonte</label><input class="form-control" name="source_type" value="Valutazione clinica" required /></div>
        <div class="form-group"><label class="form-label">Data</label><input class="form-control" type="date" name="recorded_date" value="${todayRomeStr()}" required /></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelLimBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);
  document.getElementById("cancelLimBtn")?.addEventListener("click", closeModal);
  document.getElementById("sharedLimForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/shared-limitations", {
      method: "POST",
      body: {
        person_id: personId,
        physio_episode_id: defaultEpId,
        title: fd.get("title"),
        body_region: fd.get("body_region"),
        laterality: fd.get("laterality"),
        description: fd.get("description"),
        source_type: fd.get("source_type"),
        recorded_date: fd.get("recorded_date")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showAddConsentModal(personId) {
  openModal(`
    <h2 class="modal-title">Registra consenso</h2>
    <form id="consentForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Documento</label>
          <select class="form-control" name="doc_type">
            <option value="informativa_privacy">Informativa Privacy</option>
            <option value="consenso_trattamento_sanitario">Consenso Sanitario</option>
            <option value="consenso_comunicazioni">Consenso Comunicazioni</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Versione</label><input class="form-control" name="doc_version" value="v2026.1" required /></div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Stato</label>
          <select class="form-control" name="status"><option value="acquisito">Acquisito</option><option value="revocato">Revocato</option><option value="in_attesa">In attesa</option></select>
        </div>
        <div class="form-group"><label class="form-label">Data</label><input class="form-control" type="date" name="signed_date" value="${todayRomeStr()}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Modalità</label><input class="form-control" name="acquisition_method" value="Modulo firmato" /></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelConsentBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);
  document.getElementById("cancelConsentBtn")?.addEventListener("click", closeModal);
  document.getElementById("consentForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/consents", {
      method: "POST",
      body: {
        person_id: personId,
        doc_type: fd.get("doc_type"),
        doc_version: fd.get("doc_version"),
        status: fd.get("status"),
        signed_date: fd.get("signed_date"),
        acquisition_method: fd.get("acquisition_method")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showUploadAttachmentModal(personId) {
  openModal(`
    <h2 class="modal-title">Carica allegato</h2>
    <form id="uploadAttForm">
      <div class="form-group">
        <label class="form-label">File (PDF, PNG, JPG, WEBP max 5 MB) *</label>
        <input class="form-control" type="file" id="attFileInput" accept=".pdf,image/png,image/jpeg,image/webp" required />
      </div>
      <div class="form-group">
        <label class="form-label">Categoria</label>
        <select class="form-control" name="category">
          <option value="Referto Diagnostico">Referto diagnostico</option>
          <option value="Prescrizione Medica">Prescrizione medica</option>
          <option value="Modulo Consenso Firmato">Consenso firmato</option>
          <option value="Foto Posturale / Test">Foto / Test</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Descrizione</label><input class="form-control" name="description" /></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelAttBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Carica</button>
      </div>
    </form>
  `);
  document.getElementById("cancelAttBtn")?.addEventListener("click", closeModal);
  document.getElementById("uploadAttForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = document.getElementById("attFileInput")?.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("File troppo grande (max 5 MB per mantenere leggero lo spazio cloud).");
      return;
    }
    const fd = new FormData(e.target);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await apiFetch("/api/attachments", {
          method: "POST",
          body: {
            person_id: personId,
            filename: file.name,
            mime_type: file.type || "application/pdf",
            content_base64: reader.result,
            category: fd.get("category"),
            description: fd.get("description")
          }
        });
        closeModal();
        await refreshCurrentView();
      } catch (err) {
        alert(err.message);
      }
    };
    reader.readAsDataURL(file);
  });
}

// ============================================================================
// INIT APP, RICERCA GLOBALE E PRIVACY MODE
// ============================================================================

function togglePrivacyMode(forceValue = null) {
  state.privacyMode = forceValue !== null ? forceValue : !state.privacyMode;
  document.body.classList.toggle("privacy-mode", state.privacyMode);
}

async function initApp() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        silentStatus: true,
        body: {
          username: fd.get("username"),
          password: fd.get("password"),
          totp_code: fd.get("totp_code")
        }
      });
      state.authenticated = true;
      state.csrfToken = res.csrf_token;
      if (res.token) {
        state.sessionToken = res.token;
        try {
          localStorage.setItem("gestionale_cloud_token", res.token);
        } catch {}
      }
      state.user = res.user;
      document.getElementById("practitionerLabel").textContent = res.user?.display_name || "Professionista";
      document.getElementById("loginScreen").style.display = "none";
      document.getElementById("appShell").style.display = "flex";
      setSaveStatus("saved", "Sincronizzato");
      await navigateTo("people", { personId: null });
    } catch (err) {
      if (err.data?.require_totp) {
        document.getElementById("loginTotpGroup").style.display = "block";
      }
      showLoginScreen(err.message);
    }
  });

  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nav = btn.getAttribute("data-nav");
      if (nav === "people") state.selectedPersonId = null;
      await navigateTo(nav);
    });
  });

  document.getElementById("privacyToggleBtn")?.addEventListener("click", () => togglePrivacyMode());
  document.getElementById("disablePrivacyBtn")?.addEventListener("click", () => togglePrivacyMode(false));

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await apiFetch("/api/auth/logout", { method: "POST", silentStatus: true });
    state.authenticated = false;
    state.csrfToken = "";
    state.sessionToken = "";
    invalidateDataCaches();
    try {
      localStorage.removeItem("gestionale_cloud_token");
    } catch {}
    showLoginScreen();
  });

  document.getElementById("qaNewPersonBtn")?.addEventListener("click", () => showNewPersonModal());

  const searchInput = document.getElementById("globalSearchInput");
  const searchDrop = document.getElementById("globalSearchDropdown");
  searchInput?.addEventListener("input", async (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      searchDrop.style.display = "none";
      return;
    }
    // Ricerca locale in memoria (0 chiamate Supabase mentre scrivi)
    let source = state.allPeopleSearchCache || (state.peopleCache.length ? state.peopleCache : null);
    if (!source) {
      const res = await apiFetch(`/api/people?status=tutti`);
      source = res.people || [];
      state.allPeopleSearchCache = source;
    }
    const list = source.filter((p) => {
      const hay = `${p.first_name} ${p.last_name} ${p.last_name} ${p.first_name} ${p.current_pain_notes || ""} ${p.sport_activity || ""} ${p.phone || ""} ${p.email || ""}`.toLowerCase();
      return hay.includes(q);
    });
    if (!list.length) {
      searchDrop.innerHTML = `<div class="search-result-item" style="color:var(--text-muted);">Nessun risultato</div>`;
    } else {
      searchDrop.innerHTML = list
        .map(
          (p) => `
          <div class="search-result-item" data-search-pick="${p.id}">
            <div>
              <div style="font-weight:600;">${esc(p.last_name)} ${esc(p.first_name)}</div>
              <div style="font-size:12px; color:var(--text-muted);">${esc(p.current_pain_notes || p.sport_activity || p.phone || "")}</div>
            </div>
            <div style="display:flex; gap:4px;">
              ${p.physio_active ? `<span class="tag tag-accent">Fisio</span>` : ""}
              ${p.fitness_active ? `<span class="tag">PT</span>` : ""}
            </div>
          </div>`
        )
        .join("");
      searchDrop.querySelectorAll("[data-search-pick]").forEach((item) => {
        item.addEventListener("click", async () => {
          searchDrop.style.display = "none";
          searchInput.value = "";
          await navigateTo("people", { personId: Number(item.getAttribute("data-search-pick")), personTab: "profilo" });
        });
      });
    }
    searchDrop.style.display = "block";
  });

  document.addEventListener("click", (e) => {
    if (searchDrop && !e.target.closest(".search-box")) {
      searchDrop.style.display = "none";
    }
  });

  try {
    const status = await apiFetch("/api/auth/status", { silentStatus: true });
    state.envMode = status.env_mode || "prod";
    if (status.authenticated) {
      state.authenticated = true;
      state.csrfToken = status.csrf_token;
      state.user = status.user;
      document.getElementById("practitionerLabel").textContent = status.user.display_name;
      document.getElementById("loginScreen").style.display = "none";
      document.getElementById("appShell").style.display = "flex";
      setSaveStatus("saved", "Sincronizzato");
      await navigateTo("people", { personId: null });
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen();
  }
}

window.addEventListener("DOMContentLoaded", initApp);
