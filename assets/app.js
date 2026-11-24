import {
  SYMPTOM_TYPES,
  inferAnatomicalRegionAndSide,
  renderBodySvgMarkup,
  clientEventToNormalizedSvgCoords
} from "./body_map.js?v=8";
import {
  PCS_ITEMS,
  TSK13_ITEMS,
  computeScaleBreakdown,
  buildClinicalNoteFromBreakdown,
  parseTallyScalesCsv
} from "./scales.js?v=8";

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
  agendaViewMode: window.innerWidth < 768 ? "iphone_list" : "week",
  agendaDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }),
  agendaAreaFilter: "tutti",
  peopleAreaFilter: "tutti",
  peopleStatusFilter: "attivo",
  peopleLocalQuery: "",
  peopleCache: [],
  catalogs: { outcome_scales: {}, templates: [] },
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
// ICONE SVG MONOCROMATICHE (ZERO EMOJI)
// ============================================================================

const ICONS = {
  plus: `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
  back: `<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>`,
  edit: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  trash: `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>`,
  download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  printer: `<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>`,
  chevronRight: `<polyline points="9 18 15 12 9 6"/>`,
  chevronDown: `<polyline points="6 9 12 15 18 9"/>`,
  search: `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  check: `<polyline points="20 6 9 17 4 12"/>`,
  x: `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  calendar: `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  file: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
  eye: `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`,
  eyeOff: `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>`
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

function formatEur(cents) {
  const num = Number(cents || 0) / 100;
  return `€ ${num.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function formatRomeTime(isoStr) {
  if (!isoStr) return "";
  return String(isoStr).slice(11, 16);
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
  if (mode === "saving") {
    label.textContent = text || "Salvataggio...";
  } else if (mode === "saved") {
    label.textContent = text || "Salvato";
  } else if (mode === "error") {
    label.textContent = text || "Errore";
  }
}

// ============================================================================
// CLIENT API CON PROTEZIONE CSRF E GESTIONE CONFLITTI (409)
// ============================================================================

function buildAuthUrl(path) {
  const base = state.apiBaseUrl ? `${state.apiBaseUrl}${path}` : path;
  if (!state.sessionToken) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(state.sessionToken)}`;
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

  if (method !== "GET" && !options.silentStatus) {
    setSaveStatus("saved", "Salvato");
  }
  return data;
}

function showConflictResolutionModal(message, serverRecord) {
  openModal(`
    <h2 class="modal-title">Modifica da un altro dispositivo</h2>
    <p style="color:var(--text-secondary); margin-top:0;">${esc(message)}</p>
    <p style="font-size:13px; color:var(--text-muted);">
      Versione attuale sul server: <strong>v${esc(serverRecord?.version)}</strong> (${esc(formatRomeDateTime(serverRecord?.updated_at))}).
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

async function navigateTo(navKey, options = {}) {
  state.currentNav = navKey === "dashboard" ? "people" : navKey;
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

function normalizePersonTab(tab) {
  if (tab === "riepilogo" || tab === "anagrafica") return "profilo";
  if (tab === "appuntamenti") return "pacchetti";
  if (tab === "cronologia") return "documenti";
  return tab || "profilo";
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
  } else if (state.currentNav === "packages") {
    await renderPackagesView(container);
  } else if (state.currentNav === "agenda") {
    await renderAgendaView(container);
  } else if (state.currentNav === "security") {
    await renderSecurityView(container);
  }
}

// ============================================================================
// 1. LISTA PERSONE (HOME PRINCIPALE)
// ============================================================================

async function renderPeopleListView(container) {
  const data = await apiFetch(
    `/api/people?area=${encodeURIComponent(state.peopleAreaFilter)}&status=${encodeURIComponent(state.peopleStatusFilter)}`
  );
  state.peopleCache = data.people || [];

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
            placeholder="Filtra per nome, sport, obiettivo..."
            value="${esc(state.peopleLocalQuery)}"
            style="max-width:260px;"
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
              <th>Obiettivo / Attività</th>
              <th>Contatti</th>
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
          const hay = `${p.first_name} ${p.last_name} ${p.sport_activity || ""} ${p.goals || ""} ${p.phone || ""} ${p.email || ""}`.toLowerCase();
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

        const summaryText = p.goals || p.sport_activity || "—";
        const contactLine = p.phone || p.email || "—";

        return `
          <tr class="clickable-row" data-open-person="${p.id}">
            <td>
              <div style="font-weight:600; color:var(--text);" class="sensitive-data">${esc(p.last_name)} ${esc(p.first_name)}</div>
              ${age ? `<div style="font-size:12px; color:var(--text-muted);" class="sensitive-data">${esc(age)}</div>` : ""}
            </td>
            <td><div style="display:flex; gap:4px; flex-wrap:wrap;">${tags.join("")}</div></td>
            <td style="max-width:340px;">
              <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-secondary);" class="sensitive-data" title="${esc(summaryText)}">
                ${esc(summaryText)}
              </div>
            </td>
            <td style="color:var(--text-muted); font-size:13px;" class="sensitive-data">${esc(contactLine)}</td>
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
// 2. SCHEDA PERSONA
// ============================================================================

async function renderPersonDossierView(container, personId) {
  const dossier = await apiFetch(`/api/people/${personId}`);
  const p = dossier.person;
  const sum = dossier.summary || {};

  state.selectedPersonTab = normalizePersonTab(state.selectedPersonTab);

  const totalScalesCount = (dossier.physio.episodes || []).reduce(
    (acc, ep) => acc + (ep.outcome_measures ? ep.outcome_measures.length : 0),
    0
  );

  const tabs = [
    { id: "profilo", label: "Profilo", count: null },
    { id: "fisio", label: "Fisio & Scale", count: totalScalesCount || dossier.physio.episodes.length || null },
    { id: "fitness", label: "PT & Fitness", count: dossier.fitness.programs.length || null },
    { id: "pacchetti", label: "Pacchetti", count: dossier.packages.length || null },
    { id: "documenti", label: "Documenti", count: dossier.attachments.length + dossier.consents.length || null }
  ];

  const age = calcAge(p.birth_date);
  const metaParts = [];
  if (p.birth_date) metaParts.push(`${formatDateIt(p.birth_date)}${age ? ` (${age})` : ""}`);
  if (p.gender) metaParts.push(p.gender);
  if (p.height_cm) metaParts.push(`${p.height_cm} cm`);
  if (p.weight_kg !== null && p.weight_kg !== undefined && p.weight_kg !== "") metaParts.push(`${p.weight_kg} kg`);
  if (p.phone) metaParts.push(p.phone);

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
          sum.total_due_cents > 0
            ? `<span class="tag tag-danger num sensitive-data">Da incassare: ${formatEur(sum.total_due_cents)}</span>`
            : ""
        }
        ${
          sum.total_remaining_sessions > 0
            ? `<span class="tag num">${sum.total_remaining_sessions} sedute residue</span>`
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
            ${t.count ? `<span class="tab-count num">${t.count}</span>` : ""}
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
  } else if (state.selectedPersonTab === "fisio") {
    renderPersonTabFisio(subViewport, dossier);
  } else if (state.selectedPersonTab === "fitness") {
    renderPersonTabFitness(subViewport, dossier);
  } else if (state.selectedPersonTab === "pacchetti") {
    renderPersonTabPacchettiAndAppts(subViewport, dossier);
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
          <strong style="font-size:13px; color:var(--warning);">Limitazioni attive (${lims.length})</strong>
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
    const val = (v) => (v !== null && v !== undefined && String(v).trim() !== "" ? esc(v) : `<span style="color:var(--text-muted);">—</span>`);
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
          <div class="card-header"><h3 class="card-title">Anamnesi e quadro clinico</h3></div>
          <div class="info-block">
            <div class="info-item-label">Dolori e limitazioni attuali</div>
            <div class="info-item-val sensitive-data">${val(p.current_pain_notes)}</div>
          </div>
          <div class="info-block">
            <div class="info-item-label">Storia clinica, infortuni, interventi</div>
            <div class="info-item-val sensitive-data">${val(p.medical_history)}</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 class="card-title">Sport e obiettivi</h3></div>
          <div class="info-block">
            <div class="info-item-label">Obiettivi</div>
            <div class="info-item-val sensitive-data">${val(p.goals)}</div>
          </div>
          <div class="info-block">
            <div class="info-item-label">Attività / Allenamento</div>
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
                  <div class="info-item-label">Note</div>
                  <div class="info-item-val sensitive-data">${esc(p.general_notes)}</div>
                </div>`
              : ""
          }
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 class="card-title">Dati anagrafici e misure</h3></div>
        <div class="info-grid sensitive-data">
          <div><div class="info-item-label">Data di nascita</div><div class="info-item-val num">${p.birth_date ? formatDateIt(p.birth_date) : "—"}</div></div>
          <div><div class="info-item-label">Sesso</div><div class="info-item-val">${val(p.gender)}</div></div>
          <div><div class="info-item-label">Altezza</div><div class="info-item-val num">${p.height_cm ? `${p.height_cm} cm` : "—"}</div></div>
          <div><div class="info-item-label">Peso</div><div class="info-item-val num">${weightStr ? esc(weightStr) : "—"}</div></div>
          <div><div class="info-item-label">Professione</div><div class="info-item-val">${val(p.profession)}</div></div>
          <div><div class="info-item-label">Telefono</div><div class="info-item-val num">${val(p.phone)}</div></div>
          <div><div class="info-item-label">Email</div><div class="info-item-val">${val(p.email)}</div></div>
          <div><div class="info-item-label">CF / Indirizzo</div><div class="info-item-val">${val([p.tax_code, p.address].filter(Boolean).join(" · "))}</div></div>
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
          <div class="form-group">
            <label class="form-label">Nome *</label>
            <input class="form-control" name="first_name" value="${esc(p.first_name)}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Cognome *</label>
            <input class="form-control" name="last_name" value="${esc(p.last_name)}" required />
          </div>
          <div class="form-group">
            <label class="form-label">Data di nascita</label>
            <input class="form-control" type="date" name="birth_date" value="${esc(p.birth_date || "")}" />
          </div>
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
          <div class="form-group">
            <label class="form-label">Altezza (cm)</label>
            <input class="form-control" type="number" min="80" max="240" name="height_cm" value="${p.height_cm ?? ""}" />
          </div>
          <div class="form-group">
            <label class="form-label">Peso (kg)</label>
            <input class="form-control" type="number" min="20" max="250" step="0.1" name="weight_kg" value="${p.weight_kg ?? ""}" />
          </div>
          <div class="form-group">
            <label class="form-label">Data peso</label>
            <input class="form-control" type="date" name="weight_updated_at" value="${esc(p.weight_updated_at || "")}" />
          </div>
        </div>
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">Telefono</label>
            <input class="form-control" name="phone" value="${esc(p.phone || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input class="form-control" type="email" name="email" value="${esc(p.email || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Professione</label>
            <input class="form-control" name="profession" value="${esc(p.profession || "")}" />
          </div>
        </div>
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">Percorsi</label>
            <div style="display:flex; gap:16px; padding-top:6px;">
              <label style="display:flex; align-items:center; gap:6px; font-size:13.5px; cursor:pointer;">
                <input type="checkbox" name="physio_active" ${p.physio_active ? "checked" : ""} /> Fisio
              </label>
              <label style="display:flex; align-items:center; gap:6px; font-size:13.5px; cursor:pointer;">
                <input type="checkbox" name="fitness_active" ${p.fitness_active ? "checked" : ""} /> PT
              </label>
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

        <div class="form-section-title">Anamnesi</div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Dolori e limitazioni attuali</label>
            <textarea class="form-control" rows="3" name="current_pain_notes">${esc(p.current_pain_notes || "")}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Storia clinica, infortuni, interventi</label>
            <textarea class="form-control" rows="3" name="medical_history">${esc(p.medical_history || "")}</textarea>
          </div>
        </div>

        <div class="form-section-title">Sport e obiettivi</div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Obiettivi</label>
            <textarea class="form-control" rows="2" name="goals">${esc(p.goals || "")}</textarea>
          </div>
          <div class="form-group">
            <label class="form-label">Sport / Allenamento</label>
            <textarea class="form-control" rows="2" name="sport_activity">${esc(p.sport_activity || "")}</textarea>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Frequenza settimanale</label>
            <input class="form-control" name="training_frequency" value="${esc(p.training_frequency || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Dove si allena</label>
            <input class="form-control" name="training_location" value="${esc(p.training_location || "")}" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Note generali</label>
          <textarea class="form-control" rows="2" name="general_notes">${esc(p.general_notes || "")}</textarea>
        </div>

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
// TAB 2: FISIO & SCALE (SCALE IN PRIMO PIANO, IMPORT CSV TALLY, FLAGS RICHIUDIBILI)
// ============================================================================

async function ensureActiveEpisode(person, episodes) {
  if (episodes && episodes.length > 0) {
    return episodes.find((e) => e.id === state.selectedEpisodeId) || episodes[0];
  }
  const ep = await apiFetch("/api/physio/episodes", {
    method: "POST",
    body: {
      person_id: person.id,
      title: "Percorso fisioterapico",
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
          <div style="font-weight:600; color:var(--text); margin-bottom:6px;">Nessun percorso fisioterapico attivo</div>
          <div style="margin-bottom:16px;">Crea un episodio clinico oppure importa subito una scala da CSV Tally.</div>
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
          <button class="btn btn-sm btn-ghost" id="newPhysioEpisodeBtn" title="Nuovo episodio">${ico("plus")} Episodio</button>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-ghost" id="shareLimFromPhysioBtn">Limitazione PT</button>
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

    <!-- 1. SCALE E QUESTIONARI (SUBITO IN PRIMO PIANO) -->
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">Scale e questionari</h3>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-secondary" id="importTallyCsvBtn">${ico("upload")} Importa CSV Tally</button>
          <button class="btn btn-sm btn-primary" id="recordOutcomeMeasureBtn">${ico("plus")} Registra scala</button>
        </div>
      </div>
      ${renderOutcomeMeasuresSection(activeEp.outcome_comparisons, activeEp.outcome_measures)}
    </div>

    <!-- 2. NOTE DI SEDUTA (SOAP) -->
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

    <!-- 3. VALUTAZIONI CLINICHE E MAPPA CORPO -->
    <div class="card">
      <div class="card-header">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <h3 class="card-title">Valutazioni cliniche</h3>
          ${
            evals.length
              ? `<select class="form-control form-control-sm" id="evalHistorySelect" style="width:auto;">
                  ${evals
                    .map(
                      (ev) =>
                        `<option value="${ev.id}" ${ev.id === (currentEval && currentEval.id) ? "selected" : ""}>
                          ${ev.eval_type === "prima_valutazione" ? "1ª valutazione" : "Rivalutazione"} · ${formatDateIt(ev.eval_date)} (${esc(ev.status)})
                        </option>`
                    )
                    .join("")}
                </select>`
              : ""
          }
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          ${currentEval && currentEval.status === "bozza" ? `<button class="btn btn-sm btn-secondary" id="editCurrentEvalBtn">${ico("edit")} Modifica</button>` : ""}
          ${currentEval && currentEval.status === "finalizzata" ? `<button class="btn btn-sm btn-ghost" id="addEvalAddendumBtn">+ Integrazione</button>` : ""}
          <button class="btn btn-sm btn-secondary" id="newEvalModalBtn">${ico("plus")} ${evals.length ? "Rivalutazione" : "Valutazione"}</button>
        </div>
      </div>
      ${
        currentEval
          ? renderEvaluationSection(currentEval, previousEval)
          : `<div style="color:var(--text-muted); font-size:13px;">Nessuna valutazione registrata.</div>`
      }
    </div>

    <!-- 4. RED & YELLOW FLAGS (RICHIUDIBILE) -->
    <details class="clean-details" ${fSum.red_present > 0 ? "open" : ""}>
      <summary>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span>Red &amp; Yellow Flags</span>
          ${fSum.red_present > 0 ? `<span class="tag tag-danger">${fSum.red_present} Red presenti</span>` : ""}
          ${fSum.yellow_present > 0 ? `<span class="tag tag-warning">${fSum.yellow_present} Yellow presenti</span>` : ""}
          ${totalPresent === 0 ? `<span class="tag">Nessuna presente</span>` : ""}
          ${totalUnassessed > 0 ? `<span class="tag">${totalUnassessed} da valutare</span>` : ""}
        </div>
        ${ico("chevronDown")}
      </summary>
      <div class="details-body">
        <div style="display:flex; justify-content:flex-end; margin-bottom:10px;">
          <button class="btn btn-sm btn-secondary" id="addCustomFlagBtn">${ico("plus")} Aggiungi flag</button>
        </div>
        ${renderClinicalFlagsTable(activeEp.flags)}
      </div>
    </details>
  `;

  // Event listeners
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
  document.getElementById("addCustomFlagBtn")?.addEventListener("click", () => showCustomFlagModal(activeEp.id));

  // Inline quick-update status on flags
  viewport.querySelectorAll("[data-quick-flag-status]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const fid = Number(sel.getAttribute("data-quick-flag-status"));
      const fl = activeEp.flags.find((x) => x.id === fid);
      if (!fl) return;
      await apiFetch("/api/physio/flags", {
        method: "PUT",
        body: {
          id: fl.id,
          status: sel.value,
          source_info: fl.source_info || "Valutazione clinica",
          notes: fl.notes || "",
          action_taken: fl.action_taken || ""
        }
      });
      await refreshCurrentView();
    });
  });

  viewport.querySelectorAll("[data-edit-flag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fid = Number(btn.getAttribute("data-edit-flag"));
      const fl = activeEp.flags.find((x) => x.id === fid);
      if (fl) showEditFlagModal(fl);
    });
  });

  viewport.querySelectorAll("[data-del-outcome]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const oid = Number(btn.getAttribute("data-del-outcome"));
      if (!window.confirm("Eliminare questa rilevazione?")) return;
      await apiFetch(`/api/physio/outcome-measures/${oid}`, { method: "DELETE" });
      await refreshCurrentView();
    });
  });

  viewport.querySelectorAll("[data-edit-soap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nid = Number(btn.getAttribute("data-edit-soap"));
      const note = activeEp.notes.find((x) => x.id === nid);
      if (note) showSoapNoteModal(activeEp, note);
    });
  });
  viewport.querySelectorAll("[data-addendum-soap]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nid = Number(btn.getAttribute("data-addendum-soap"));
      const note = activeEp.notes.find((x) => x.id === nid);
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
      const latestBreakdown = computeScaleBreakdown(c.scale_code, latest?.responses, latest?.score_value);
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
// TAB 3: PT & FITNESS
// ============================================================================

function renderPersonTabFitness(viewport, dossier) {
  const p = dossier.person;
  const prof = dossier.fitness.profile || {};
  const programs = dossier.fitness.programs || [];
  const logs = dossier.fitness.workout_logs || [];
  const metrics = dossier.fitness.metrics || [];
  const activeLims = (dossier.shared_limitations || []).filter((l) => l.is_active);

  const limsHtml = activeLims.length
    ? `
      <div class="notice-strip">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="font-size:13px; color:var(--warning);">Limitazioni dal percorso Fisio</strong>
          <button class="btn btn-xs btn-secondary" id="jumpToPhysioFromFitnessBtn">Apri Fisio</button>
        </div>
        ${activeLims
          .map(
            (l) =>
              `<div style="font-size:13px; margin-top:4px;" class="sensitive-data"><strong>${esc(l.title)}</strong> (${esc(l.laterality || "N/A")}) — ${esc(l.description)}</div>`
          )
          .join("")}
      </div>
    `
    : "";

  const programsHtml = programs.length
    ? programs
        .map((prog) => {
          const daysHtml = (prog.workouts || [])
            .map(
              (d, dIdx) => `
              <div style="border:1px solid var(--border); border-radius:var(--radius-md); padding:12px; margin-top:10px; background:var(--bg-hover);">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
                  <strong style="font-size:13.5px;">${esc(d.day_name)}</strong>
                  <button class="btn btn-xs btn-secondary" data-log-workout-prog="${prog.id}" data-day-idx="${dIdx}">Registra seduta</button>
                </div>
                <div class="table-wrap">
                  <table class="data-table data-table-compact">
                    <thead><tr><th>Esercizio</th><th>Serie</th><th>Rip.</th><th>Carico</th><th>Rec.</th><th>RPE</th><th>Note</th></tr></thead>
                    <tbody>
                      ${(d.exercises || [])
                        .map(
                          (ex) =>
                            `<tr><td><strong>${esc(ex.name)}</strong></td><td class="num">${esc(ex.sets)}</td><td class="num">${esc(ex.reps)}</td><td class="num">${esc(ex.load)}</td><td class="num">${esc(ex.rest || "—")}</td><td class="num">${esc(ex.rpe || "—")}</td><td style="color:var(--text-muted);">${esc(ex.notes || "—")}</td></tr>`
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>`
            )
            .join("");

          return `
            <div class="card">
              <div class="card-header">
                <div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <h4 class="card-title">${esc(prog.title)}</h4>
                    <span class="tag">v${prog.version} · ${esc(prog.status)}</span>
                  </div>
                  <div class="card-subtitle">${esc(prog.goal)} · dal ${formatDateIt(prog.start_date)}</div>
                </div>
                <button class="btn btn-sm btn-secondary" data-edit-program="${prog.id}">${ico("edit")} Modifica</button>
              </div>
              ${daysHtml}
            </div>
          `;
        })
        .join("")
    : `<div class="card"><div style="color:var(--text-muted); font-size:13px;">Nessun programma di allenamento creato.</div></div>`;

  const logsHtml = logs.length
    ? logs
        .map((wl) => {
          const compRows = (wl.actual_exercises || [])
            .map((act, idx) => {
              const plan = (wl.planned_exercises || [])[idx] || {};
              return `
                <tr>
                  <td><strong>${esc(act.name || plan.name)}</strong></td>
                  <td class="num" style="color:var(--text-muted);">${esc(plan.sets || "—")} × ${esc(plan.reps || "—")} @ ${esc(plan.load || "—")}</td>
                  <td class="num" style="font-weight:600;">${esc(act.sets)} × ${esc(act.reps)} @ ${esc(act.load)}${act.rpe ? ` (RPE ${esc(act.rpe)})` : ""}</td>
                </tr>`;
            })
            .join("");
          return `
            <div style="border:1px solid var(--border); border-radius:var(--radius-md); padding:12px; margin-bottom:10px;">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                <div>
                  <strong>${esc(wl.workout_day_name)}</strong>
                  <span class="num" style="color:var(--text-muted); font-size:12.5px; margin-left:6px;">${formatDateIt(wl.session_date)}</span>
                  ${wl.session_rpe ? `<span class="tag num" style="margin-left:6px;">RPE ${wl.session_rpe}</span>` : ""}
                </div>
                ${wl.reported_symptoms ? `<span class="tag tag-warning">Sintomi (${wl.symptom_severity}/10)</span>` : ""}
              </div>
              <div class="table-wrap">
                <table class="data-table data-table-compact">
                  <thead><tr><th>Esercizio</th><th>Programmato</th><th>Svolto</th></tr></thead>
                  <tbody>${compRows}</tbody>
                </table>
              </div>
              ${
                wl.client_feedback || wl.reported_symptoms || wl.next_session_notes
                  ? `<div style="font-size:12.5px; color:var(--text-secondary); margin-top:8px;" class="sensitive-data">
                      ${wl.client_feedback ? `<div><strong>Feedback:</strong> ${esc(wl.client_feedback)}</div>` : ""}
                      ${wl.reported_symptoms ? `<div style="color:var(--warning);"><strong>Sintomi:</strong> ${esc(wl.reported_symptoms)}</div>` : ""}
                      ${wl.next_session_notes ? `<div><strong>Prossima seduta:</strong> ${esc(wl.next_session_notes)}</div>` : ""}
                    </div>`
                  : ""
              }
            </div>`;
        })
        .join("")
    : `<div style="color:var(--text-muted); font-size:13px;">Nessuna seduta registrata.</div>`;

  viewport.innerHTML = `
    ${limsHtml}

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Profilo PT</h3>
          <button class="btn btn-sm btn-secondary" id="editFitnessProfileBtn">${ico("edit")} Modifica</button>
        </div>
        <div class="info-block"><div class="info-item-label">Obiettivi</div><div class="info-item-val">${esc(prof.primary_goals || p.goals || "—")}</div></div>
        <div class="grid-2" style="gap:10px; margin-bottom:12px;">
          <div><div class="info-item-label">Esperienza</div><div class="info-item-val">${esc(prof.experience_level || "—")}</div></div>
          <div><div class="info-item-label">Disponibilità</div><div class="info-item-val">${esc(prof.weekly_availability || p.training_frequency || "—")}</div></div>
        </div>
        <div class="info-block"><div class="info-item-label">Attrezzatura</div><div class="info-item-val">${esc(prof.available_equipment || "—")}</div></div>
        ${prof.initial_assessment_notes ? `<div class="info-block"><div class="info-item-label">Note iniziali</div><div class="info-item-val">${esc(prof.initial_assessment_notes)}</div></div>` : ""}
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Test e misurazioni</h3>
          <button class="btn btn-sm btn-secondary" id="addFitnessMetricBtn">${ico("plus")} Nuovo test</button>
        </div>
        <div class="table-wrap">
          <table class="data-table data-table-compact">
            <thead><tr><th>Data</th><th>Test</th><th>Valore</th><th>Note</th></tr></thead>
            <tbody>
              ${
                metrics.length
                  ? metrics
                      .map(
                        (m) =>
                          `<tr><td class="num">${formatDateIt(m.recorded_date)}</td><td><strong>${esc(m.metric_name)}</strong></td><td class="num"><strong>${m.value_num} ${esc(m.unit)}</strong></td><td style="color:var(--text-muted);">${esc(m.protocol_notes || "—")}</td></tr>`
                      )
                      .join("")
                  : `<tr><td colspan="4" style="color:var(--text-muted);">Nessun test registrato.</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div style="display:flex; justify-content:space-between; align-items:center; margin:6px 0 12px;">
      <h3 class="card-title">Programmi di allenamento</h3>
      <button class="btn btn-sm btn-primary" id="newFitnessProgramBtn">${ico("plus")} Nuovo programma</button>
    </div>
    ${programsHtml}

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">Diario sedute</h3>
        <button class="btn btn-sm btn-secondary" id="quickLogWorkoutBtn">${ico("plus")} Registra seduta</button>
      </div>
      ${logsHtml}
    </div>
  `;

  document.getElementById("jumpToPhysioFromFitnessBtn")?.addEventListener("click", async () => {
    state.selectedPersonTab = "fisio";
    await refreshCurrentView();
  });
  document.getElementById("editFitnessProfileBtn")?.addEventListener("click", () => showEditFitnessProfileModal(p.id, prof));
  document.getElementById("addFitnessMetricBtn")?.addEventListener("click", () => showAddFitnessMetricModal(p.id));
  document.getElementById("newFitnessProgramBtn")?.addEventListener("click", () => showFitnessProgramModal(p.id, null));
  document.getElementById("quickLogWorkoutBtn")?.addEventListener("click", () =>
    showWorkoutLogModal(p.id, programs[0] || null, 0)
  );
  viewport.querySelectorAll("[data-edit-program]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prog = programs.find((x) => x.id === Number(btn.getAttribute("data-edit-program")));
      if (prog) showFitnessProgramModal(p.id, prog);
    });
  });
  viewport.querySelectorAll("[data-log-workout-prog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const prog = programs.find((x) => x.id === Number(btn.getAttribute("data-log-workout-prog")));
      if (prog) showWorkoutLogModal(p.id, prog, Number(btn.getAttribute("data-day-idx") || 0));
    });
  });
}

// ============================================================================
// TAB 4: PACCHETTI & APPUNTAMENTI DELLA PERSONA
// ============================================================================

function renderPersonTabPacchettiAndAppts(viewport, dossier) {
  const p = dossier.person;
  const packages = dossier.packages || [];
  const appts = dossier.appointments || [];

  const pkgCards = packages.length
    ? packages
        .map((pkg) => {
          const movRows = (pkg.movements || [])
            .map(
              (m) => `
              <tr>
                <td class="num">${formatRomeDateTime(m.created_at)}</td>
                <td><span class="tag ${m.movement_type === "CONSUME" ? "" : "tag-warning"}">${m.movement_type === "CONSUME" ? "Consumo (−1)" : "Storno (+1)"}</span></td>
                <td>${esc(m.reason)}</td>
              </tr>`
            )
            .join("");

          return `
            <div class="card">
              <div class="card-header">
                <div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <h4 class="card-title">${esc(pkg.name)}</h4>
                    <span class="tag">${esc(pkg.status)}</span>
                  </div>
                  <div class="card-subtitle num">Acquistato il ${formatDateIt(pkg.purchased_date)}${pkg.valid_until ? ` · Scadenza ${formatDateIt(pkg.valid_until)}` : ""}</div>
                </div>
                <div style="display:flex; gap:6px;">
                  ${
                    pkg.due_cents > 0
                      ? `<button class="btn btn-sm btn-primary" data-record-payment-pkg="${pkg.id}" data-person-id="${p.id}" data-due-cents="${pkg.due_cents}">Incassa ${formatEur(pkg.due_cents)}</button>`
                      : `<span class="tag tag-success">Saldato</span>`
                  }
                  <button class="btn btn-sm btn-secondary" data-pkg-suspend="${pkg.id}" data-pkg-status="${pkg.status}">
                    ${pkg.status === "sospeso" ? "Riattiva" : "Sospendi"}
                  </button>
                </div>
              </div>

              <div class="grid-4" style="margin-bottom:12px;">
                <div class="stat-card"><div class="stat-label">Acquistate</div><div class="stat-value">${pkg.total_sessions}</div></div>
                <div class="stat-card"><div class="stat-label">Svolte</div><div class="stat-value">${pkg.consumed_sessions}</div></div>
                <div class="stat-card"><div class="stat-label">Residue</div><div class="stat-value" style="color:var(--accent);">${pkg.remaining_sessions}</div></div>
                <div class="stat-card sensitive-data">
                  <div class="stat-label">Da incassare</div>
                  <div class="stat-value" style="color:${pkg.due_cents > 0 ? "var(--danger)" : "var(--success)"};">${formatEur(pkg.due_cents)}</div>
                </div>
              </div>

              ${
                pkg.movements?.length
                  ? `<details class="inline-details">
                      <summary>Movimenti (${pkg.movements.length})</summary>
                      <div class="table-wrap" style="margin-top:8px;">
                        <table class="data-table data-table-compact">
                          <thead><tr><th>Data</th><th>Tipo</th><th>Causale</th></tr></thead>
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
    : `<div class="card"><div style="color:var(--text-muted); font-size:13px;">Nessun pacchetto attivo.</div></div>`;

  const apptRows = appts
    .map(
      (a) => `
      <tr>
        <td class="num"><strong>${formatRomeDateTime(a.start_at)}</strong> (${a.duration_minutes} min)</td>
        <td><span class="tag ${a.service_area === "fisio" ? "tag-accent" : ""}">${a.service_area === "fisio" ? "Fisio" : "PT"}</span> ${esc(a.service_name)}</td>
        <td>${renderApptStatusBadge(a.status)}</td>
        <td style="text-align:right;"><button class="btn btn-xs btn-secondary" data-open-appt-drawer="${a.id}">Gestisci</button></td>
      </tr>`
    )
    .join("");

  viewport.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h3 class="card-title">Pacchetti</h3>
      <button class="btn btn-sm btn-primary" id="personNewPkgBtn">${ico("plus")} Nuovo pacchetto</button>
    </div>
    ${pkgCards}

    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <h3 class="card-title">Appuntamenti</h3>
        <button class="btn btn-sm btn-secondary" id="personNewApptBtn">${ico("plus")} Nuovo appuntamento</button>
      </div>
      <div class="table-wrap">
        <table class="data-table data-table-compact">
          <thead><tr><th>Data e ora</th><th>Servizio</th><th>Stato</th><th style="text-align:right;"></th></tr></thead>
          <tbody>${apptRows || `<tr><td colspan="4" style="color:var(--text-muted);">Nessun appuntamento.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("personNewPkgBtn")?.addEventListener("click", () => showNewPackageModal(p.id));
  document.getElementById("personNewApptBtn")?.addEventListener("click", () => showNewAppointmentModal(p.id));
  viewport.querySelectorAll("[data-pkg-suspend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pkgId = Number(btn.getAttribute("data-pkg-suspend"));
      const nextSt = btn.getAttribute("data-pkg-status") === "sospeso" ? "attivo" : "sospeso";
      await apiFetch(`/api/packages/${pkgId}/status`, { method: "POST", body: { status: nextSt, reason: "Modifica stato" } });
      await refreshCurrentView();
    });
  });
  bindCommonActionButtons(viewport);
}

// ============================================================================
// TAB 5: DOCUMENTI, CONSENSI E CRONOLOGIA
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
// 3. VISTA GLOBALE PACCHETTI
// ============================================================================

async function renderPackagesView(container) {
  const data = await apiFetch("/api/packages");
  const packages = data.packages || [];

  const activeCount = packages.filter((k) => k.status === "attivo").length;
  const remainingTotal = packages.filter((k) => k.status === "attivo").reduce((a, k) => a + Number(k.remaining_sessions || 0), 0);
  const dueTotal = packages.filter((k) => k.status !== "annullato").reduce((a, k) => a + Number(k.due_cents || 0), 0);

  const rows = packages
    .map(
      (pkg) => `
      <tr>
        <td>
          <a href="#" data-open-person="${pkg.person_id}" data-person-tab="pacchetti" style="font-weight:600; color:var(--text); text-decoration:none;" class="sensitive-data">
            ${esc(pkg.last_name)} ${esc(pkg.first_name)}
          </a>
        </td>
        <td><strong>${esc(pkg.name)}</strong> <span class="tag" style="margin-left:4px;">${esc(pkg.service_area)}</span></td>
        <td class="num"><strong>${pkg.consumed_sessions}</strong> / ${pkg.total_sessions} <span style="color:var(--text-muted);">(${pkg.remaining_sessions} residue)</span></td>
        <td class="num sensitive-data">
          ${formatEur(pkg.price_cents)}
          ${
            pkg.due_cents > 0
              ? ` · <span style="color:var(--danger); font-weight:600;">Da incassare ${formatEur(pkg.due_cents)}</span>`
              : ` · <span style="color:var(--success);">Saldato</span>`
          }
        </td>
        <td style="text-align:right; white-space:nowrap;">
          ${
            pkg.due_cents > 0
              ? `<button class="btn btn-xs btn-primary" data-record-payment-pkg="${pkg.id}" data-person-id="${pkg.person_id}" data-due-cents="${pkg.due_cents}">Incassa</button>`
              : ""
          }
          <button class="btn btn-xs btn-ghost" data-open-person="${pkg.person_id}" data-person-tab="pacchetti">Scheda</button>
        </td>
      </tr>`
    )
    .join("");

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Pacchetti <span class="count-pill num">${packages.length}</span></h1>
      <button class="btn btn-primary" id="globalNewPkgBtn">${ico("plus")} <span>Nuovo pacchetto</span></button>
    </div>

    <div class="grid-3" style="margin-bottom:16px;">
      <div class="stat-card"><div class="stat-label">Pacchetti attivi</div><div class="stat-value">${activeCount}</div></div>
      <div class="stat-card"><div class="stat-label">Sedute residue</div><div class="stat-value">${remainingTotal}</div></div>
      <div class="stat-card sensitive-data">
        <div class="stat-label">Da incassare</div>
        <div class="stat-value" style="color:${dueTotal > 0 ? "var(--danger)" : "var(--text)"};">${formatEur(dueTotal)}</div>
      </div>
    </div>

    <div class="card card-flush">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Pacchetto</th>
              <th>Sedute</th>
              <th>Saldo</th>
              <th style="text-align:right;"></th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="5" class="empty-state">Nessun pacchetto registrato.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("globalNewPkgBtn")?.addEventListener("click", () => showNewPackageModal());
  bindCommonActionButtons(container);
}

// ============================================================================
// 4. AGENDA (SECONDARIA, PULITA)
// ============================================================================

function renderApptStatusBadge(status) {
  const map = {
    prenotato: { cls: "tag", label: "Prenotato" },
    confermato: { cls: "tag tag-accent", label: "Confermato" },
    svolto: { cls: "tag tag-success", label: "Svolto" },
    annullato: { cls: "tag tag-warning", label: "Annullato" },
    assente: { cls: "tag tag-danger", label: "Assente" }
  };
  const info = map[status] || { cls: "tag", label: status };
  return `<span class="${info.cls}">${esc(info.label)}</span>`;
}

async function renderAgendaView(container) {
  const baseDate = new Date(`${state.agendaDate}T12:00:00`);
  let fromDate = state.agendaDate;
  let toDate = state.agendaDate;

  if (state.agendaViewMode === "week") {
    const dayOfWeek = (baseDate.getDay() + 6) % 7;
    const mon = new Date(baseDate);
    mon.setDate(baseDate.getDate() - dayOfWeek);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    fromDate = mon.toISOString().slice(0, 10);
    toDate = sun.toISOString().slice(0, 10);
  } else if (state.agendaViewMode === "month") {
    fromDate = `${state.agendaDate.slice(0, 7)}-01`;
    toDate = `${state.agendaDate.slice(0, 7)}-31`;
  }

  const data = await apiFetch(
    `/api/appointments?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}&area=${encodeURIComponent(state.agendaAreaFilter)}`
  );
  const appts = data.appointments || [];
  const byDay = {};
  for (const a of appts) {
    const dKey = a.start_at.slice(0, 10);
    if (!byDay[dKey]) byDay[dKey] = [];
    byDay[dKey].push(a);
  }

  let bodyHtml = "";
  if (state.agendaViewMode === "week") {
    const startMon = new Date(`${fromDate}T12:00:00`);
    const cols = [];
    for (let i = 0; i < 7; i++) {
      const cur = new Date(startMon);
      cur.setDate(startMon.getDate() + i);
      const dStr = cur.toISOString().slice(0, 10);
      const label = cur.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" });
      const items = (byDay[dStr] || [])
        .map(
          (a) => `
          <div class="agenda-item" data-open-appt-drawer="${a.id}">
            <div class="num" style="font-size:11.5px; font-weight:600; color:var(--text-muted);">${formatRomeTime(a.start_at)} – ${formatRomeTime(a.end_at)}</div>
            <div style="font-weight:600; font-size:13px;" class="sensitive-data">${esc(a.first_name)} ${esc(a.last_name)}</div>
            <div style="font-size:11.5px; color:var(--text-muted);">${esc(a.service_name)}</div>
            <div style="margin-top:4px;">${renderApptStatusBadge(a.status)}</div>
          </div>`
        )
        .join("");
      cols.push(`
        <div class="agenda-day-col">
          <div class="agenda-day-header ${dStr === state.agendaDate ? "is-today" : ""}">${esc(label)}</div>
          ${items || `<div style="font-size:12px; color:var(--text-muted);">—</div>`}
        </div>`);
    }
    bodyHtml = `<div class="agenda-week-grid">${cols.join("")}</div>`;
  } else {
    const days = Object.keys(byDay).sort();
    bodyHtml = days.length
      ? days
          .map(
            (dKey) => `
            <div class="card">
              <div class="card-header"><h3 class="card-title num">${formatDateIt(dKey)}</h3></div>
              ${byDay[dKey]
                .map(
                  (a) => `
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--border); flex-wrap:wrap;">
                    <div>
                      <div style="display:flex; align-items:center; gap:8px;">
                        <strong class="num">${formatRomeTime(a.start_at)} – ${formatRomeTime(a.end_at)}</strong>
                        <span class="tag ${a.service_area === "fisio" ? "tag-accent" : ""}">${a.service_area === "fisio" ? "Fisio" : "PT"}</span>
                        ${renderApptStatusBadge(a.status)}
                      </div>
                      <div style="font-weight:600; margin-top:2px;" class="sensitive-data">${esc(a.first_name)} ${esc(a.last_name)} · <span style="font-weight:400; color:var(--text-secondary);">${esc(a.service_name)}</span></div>
                    </div>
                    <div style="display:flex; gap:6px;">
                      <button class="btn btn-sm btn-secondary" data-open-appt-drawer="${a.id}">Gestisci</button>
                      <button class="btn btn-sm btn-ghost" data-open-person="${a.person_id}">Scheda</button>
                    </div>
                  </div>`
                )
                .join("")}
            </div>`
          )
          .join("")
      : `<div class="card"><div class="empty-state">Nessun appuntamento nel periodo selezionato.</div></div>`;
  }

  container.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Agenda</h1>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <a class="btn btn-sm btn-secondary" href="${esc(buildAuthUrl("/api/appointments/export.ics?privacy=initials_only"))}" target="_blank">${ico("download")} Esporta .ics</a>
        <button class="btn btn-primary" id="agendaNewApptBtn">${ico("plus")} <span>Nuovo appuntamento</span></button>
      </div>
    </div>

    <div class="card" style="padding:12px 14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div class="segmented">
          <button class="seg-btn ${state.agendaViewMode === "week" ? "active" : ""}" data-agenda-mode="week">Settimana</button>
          <button class="seg-btn ${state.agendaViewMode === "day" ? "active" : ""}" data-agenda-mode="day">Giorno</button>
          <button class="seg-btn ${state.agendaViewMode === "month" ? "active" : ""}" data-agenda-mode="month">Mese</button>
          <button class="seg-btn ${state.agendaViewMode === "iphone_list" ? "active" : ""}" data-agenda-mode="iphone_list">Lista</button>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <input type="date" class="form-control form-control-sm" id="agendaDatePicker" value="${esc(state.agendaDate)}" style="width:auto;" />
          <button class="btn btn-sm btn-secondary" id="agendaTodayBtn">Oggi</button>
          <select class="form-control form-control-sm" id="agendaAreaSelect" style="width:auto;">
            <option value="tutti" ${state.agendaAreaFilter === "tutti" ? "selected" : ""}>Tutte</option>
            <option value="fisio" ${state.agendaAreaFilter === "fisio" ? "selected" : ""}>Fisio</option>
            <option value="fitness" ${state.agendaAreaFilter === "fitness" ? "selected" : ""}>PT</option>
          </select>
        </div>
      </div>
    </div>

    ${bodyHtml}
  `;

  container.querySelectorAll("[data-agenda-mode]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.agendaViewMode = btn.getAttribute("data-agenda-mode");
      await renderAgendaView(container);
    });
  });
  document.getElementById("agendaDatePicker")?.addEventListener("change", async (e) => {
    state.agendaDate = e.target.value;
    await renderAgendaView(container);
  });
  document.getElementById("agendaTodayBtn")?.addEventListener("click", async () => {
    state.agendaDate = todayRomeStr();
    await renderAgendaView(container);
  });
  document.getElementById("agendaAreaSelect")?.addEventListener("change", async (e) => {
    state.agendaAreaFilter = e.target.value;
    await renderAgendaView(container);
  });
  document.getElementById("agendaNewApptBtn")?.addEventListener("click", () => showNewAppointmentModal());
  bindCommonActionButtons(container);
}

// ============================================================================
// 5. IMPOSTAZIONI (ACCOUNT, 2FA, BACKUP — ESSENZIALE)
// ============================================================================

async function renderSecurityView(container) {
  const sec = await apiFetch("/api/security/overview");
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
        <h3 class="card-title">Credenziali account</h3>
        <span class="tag">${esc(sec.username || state.user?.username || "")}</span>
      </div>
      <form id="updateCredentialsForm">
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">Nome utente</label>
            <input class="form-control" id="credUsernameInput" value="${esc(sec.username || state.user?.username || "")}" required minlength="3" />
          </div>
          <div class="form-group">
            <label class="form-label">Nome visualizzato</label>
            <input class="form-control" id="credDisplayNameInput" value="${esc(sec.display_name || state.user?.display_name || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Password attuale *</label>
            <input type="password" class="form-control" id="credCurrentPasswordInput" required autocomplete="current-password" />
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label class="form-label">Nuova password (opzionale, min. 10 caratteri)</label>
            <input type="password" class="form-control" id="credNewPasswordInput" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="form-label">Conferma nuova password</label>
            <input type="password" class="form-control" id="credConfirmPasswordInput" autocomplete="new-password" />
          </div>
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
          <div>Segreto: <strong>${esc(sec.totp_secret)}</strong></div>
        </div>
        <form id="toggleTotpForm" style="display:flex; gap:8px; align-items:flex-end;">
          <div class="form-group" style="margin:0; flex:1;">
            <label class="form-label">Codice TOTP (6 cifre)</label>
            <input class="form-control" id="totpVerifyInput" value="${esc(sec.current_totp_demo_hint || "")}" placeholder="123456" />
          </div>
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
  let multiItemMode = "quick"; // 'quick' | 'items'

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
        <div class="form-group">
          <label class="form-label">Contesto</label>
          <input class="form-control" name="context_label" value="Valutazione in seduta" />
        </div>
        <div class="form-group">
          <label class="form-label">Note</label>
          <input class="form-control" name="clinical_note" id="outcomeClinicalNoteInput" />
        </div>
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
      if (!clinicalNote) {
        clinicalNote = buildClinicalNoteFromBreakdown(scaleCode, responses, scoreVal);
      }
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
// ALTRI MODALI OPERATIVI (PULITI, ZERO TESTO SUPERFLUO)
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

  root.querySelectorAll("[data-open-appt-drawer]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      await showAppointmentSessionDrawer(Number(el.getAttribute("data-open-appt-drawer")));
    });
  });

  root.querySelectorAll("[data-record-payment-pkg]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      showRecordPaymentModal(
        Number(el.getAttribute("data-person-id")),
        Number(el.getAttribute("data-record-payment-pkg")),
        Number(el.getAttribute("data-due-cents") || 0)
      );
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
        <div class="form-group"><label class="form-label">Sport / Attività</label><input class="form-control" name="sport_activity" /></div>
        <div class="form-group"><label class="form-label">Obiettivo</label><input class="form-control" name="goals" /></div>
      </div>
      <div class="form-group">
        <label class="form-label">Percorso</label>
        <div style="display:flex; gap:18px; padding-top:4px;">
          <label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" name="physio_active" checked /> Fisio</label>
          <label style="display:flex; align-items:center; gap:6px;"><input type="checkbox" name="fitness_active" /> PT</label>
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
          sport_activity: fd.get("sport_activity"),
          goals: fd.get("goals"),
          physio_active: fd.get("physio_active") === "on",
          fitness_active: fd.get("fitness_active") === "on",
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

async function showAppointmentSessionDrawer(appointmentId) {
  const allAppts = await apiFetch("/api/appointments");
  const appt = (allAppts.appointments || []).find((a) => a.id === appointmentId);
  if (!appt) return;

  const dossier = await apiFetch(`/api/people/${appt.person_id}`);
  const pkg = dossier.packages.find((k) => k.id === appt.package_id);
  const idemKey = `ui_svolto_appt_${appt.id}_v${appt.version}`;

  openModal(`
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:14px;">
      <div>
        <span class="tag ${appt.service_area === "fisio" ? "tag-accent" : ""}">${appt.service_area === "fisio" ? "Fisio" : "PT"}</span>
        <h2 class="modal-title" style="margin:6px 0 2px;">${esc(appt.first_name)} ${esc(appt.last_name)}</h2>
        <div class="num" style="font-size:13px; color:var(--text-muted);">${formatRomeDateTime(appt.start_at)} (${appt.duration_minutes} min) · ${esc(appt.location)}</div>
      </div>
      <button class="btn btn-sm btn-secondary" id="drawerOpenFullPersonBtn">Apri scheda</button>
    </div>

    ${
      pkg
        ? `<div style="background:var(--bg-hover); border:1px solid var(--border); padding:10px 12px; border-radius:6px; margin-bottom:14px; font-size:13px;">
            <strong>${esc(pkg.name)}</strong> · Residue: <strong class="num">${pkg.remaining_sessions}/${pkg.total_sessions}</strong>
            ${pkg.due_cents > 0 ? ` · <span style="color:var(--danger); font-weight:600;">Da incassare: ${formatEur(pkg.due_cents)}</span>` : " · Saldato"}
          </div>`
        : ""
    }

    <div class="form-group">
      <label class="form-label">Stato appuntamento</label>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn btn-sm ${appt.status === "svolto" ? "btn-primary" : "btn-secondary"}" data-set-appt-status="svolto">Svolto</button>
        <button class="btn btn-sm ${appt.status === "confermato" ? "btn-primary" : "btn-secondary"}" data-set-appt-status="confermato">Confermato</button>
        <button class="btn btn-sm ${appt.status === "prenotato" ? "btn-primary" : "btn-secondary"}" data-set-appt-status="prenotato">Prenotato</button>
        <button class="btn btn-sm ${appt.status === "annullato" ? "btn-danger" : "btn-secondary"}" data-set-appt-status="annullato" data-charge="no_charge">Annullato</button>
        <button class="btn btn-sm btn-secondary" data-set-appt-status="annullato" data-charge="charge">Disdetta tardiva</button>
        <button class="btn btn-sm ${appt.status === "assente" ? "btn-danger" : "btn-secondary"}" data-set-appt-status="assente" data-charge="charge">Assente</button>
      </div>
    </div>

    <form id="rescheduleApptForm" style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; margin-top:12px; padding-top:12px; border-top:1px solid var(--border);">
      <div class="form-group" style="margin:0; flex:1; min-width:180px;">
        <label class="form-label">Sposta data/ora</label>
        <input class="form-control" type="datetime-local" name="start_at" value="${esc(appt.start_at.slice(0, 16))}" required />
      </div>
      <div class="form-group" style="margin:0; width:96px;">
        <label class="form-label">Minuti</label>
        <input class="form-control" type="number" name="duration_minutes" value="${appt.duration_minutes}" required />
      </div>
      <button type="submit" class="btn btn-secondary">Sposta</button>
    </form>

    <div class="modal-footer" style="justify-content:space-between;">
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        ${appt.service_area === "fisio" && dossier.physio.episodes.length ? `<button class="btn btn-sm btn-secondary" id="drawerWriteSoapBtn">Nota SOAP</button>` : ""}
        ${appt.service_area === "fitness" ? `<button class="btn btn-sm btn-secondary" id="drawerLogWorkoutBtn">Registra seduta</button>` : ""}
        ${pkg && pkg.due_cents > 0 ? `<button class="btn btn-sm btn-primary" id="drawerCollectPayBtn">Incassa ${formatEur(pkg.due_cents)}</button>` : ""}
      </div>
      <button class="btn btn-sm btn-ghost" id="closeDrawerBtn">Chiudi</button>
    </div>
  `);

  document.getElementById("closeDrawerBtn")?.addEventListener("click", closeModal);
  document.getElementById("drawerOpenFullPersonBtn")?.addEventListener("click", async () => {
    closeModal();
    await navigateTo("people", { personId: appt.person_id, personTab: appt.service_area });
  });
  document.querySelectorAll("[data-set-appt-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const newStatus = btn.getAttribute("data-set-appt-status");
      await apiFetch(`/api/appointments/${appt.id}`, {
        method: "PUT",
        body: {
          status: newStatus,
          charge_override: btn.getAttribute("data-charge") || null,
          idempotency_key: newStatus === "svolto" ? idemKey : undefined,
          expected_version: appt.version
        }
      });
      closeModal();
      await refreshCurrentView();
    });
  });
  document.getElementById("rescheduleApptForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch(`/api/appointments/${appt.id}`, {
      method: "PUT",
      body: { start_at: fd.get("start_at"), duration_minutes: Number(fd.get("duration_minutes")), expected_version: appt.version }
    });
    closeModal();
    await refreshCurrentView();
  });
  document.getElementById("drawerWriteSoapBtn")?.addEventListener("click", () => {
    closeModal();
    showSoapNoteModal(dossier.physio.episodes[0], null, null, appt.id);
  });
  document.getElementById("drawerLogWorkoutBtn")?.addEventListener("click", () => {
    closeModal();
    showWorkoutLogModal(appt.person_id, dossier.fitness.programs[0] || null, 0, appt.id);
  });
  document.getElementById("drawerCollectPayBtn")?.addEventListener("click", () => {
    closeModal();
    showRecordPaymentModal(appt.person_id, pkg.id, pkg.due_cents);
  });
}

async function showNewAppointmentModal(preselectedPersonId = null) {
  const pData = await apiFetch("/api/people?status=attivo");
  const people = pData.people || [];
  const selectedPid = preselectedPersonId || state.selectedPersonId || people[0]?.id;

  let packages = [];
  if (selectedPid) {
    const pkgData = await apiFetch(`/api/packages?person_id=${selectedPid}`);
    packages = (pkgData.packages || []).filter((k) => k.status === "attivo");
  }

  openModal(`
    <h2 class="modal-title">Nuovo appuntamento</h2>
    <form id="newApptModalForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Persona *</label>
          <select class="form-control" name="person_id" id="apptPersonSelect" required>
            ${people.map((p) => `<option value="${p.id}" ${p.id === selectedPid ? "selected" : ""}>${esc(p.last_name)} ${esc(p.first_name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Area *</label>
          <select class="form-control" name="service_area">
            <option value="fisio">Fisioterapia</option>
            <option value="fitness">Personal Training</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Servizio</label><input class="form-control" name="service_name" value="Seduta Fisioterapia" required /></div>
        <div class="form-group">
          <label class="form-label">Pacchetto</label>
          <select class="form-control" name="package_id" id="apptPkgSelect">
            <option value="">Fuori pacchetto</option>
            ${packages.map((k) => `<option value="${k.id}" selected>${esc(k.name)} (${k.available_to_book} disp.)</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Data e ora *</label><input class="form-control" type="datetime-local" name="start_at" value="${state.agendaDate}T10:00" required /></div>
        <div class="form-group"><label class="form-label">Durata (min)</label><input class="form-control" type="number" name="duration_minutes" value="60" min="15" step="5" required /></div>
        <div class="form-group"><label class="form-label">Ricorrenze</label><input class="form-control" type="number" name="recurrence_count" value="1" min="1" max="24" /></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Luogo</label><input class="form-control" name="location" value="Studio" /></div>
        <div class="form-group">
          <label class="form-label">Stato</label>
          <select class="form-control" name="status">
            <option value="prenotato">Prenotato</option>
            <option value="confermato">Confermato</option>
            <option value="svolto">Già svolto</option>
          </select>
        </div>
      </div>
      <div class="form-group"><label class="form-label">Note</label><input class="form-control" name="notes" /></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelApptModalBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);

  document.getElementById("cancelApptModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("apptPersonSelect")?.addEventListener("change", async (e) => {
    const pkgData = await apiFetch(`/api/packages?person_id=${Number(e.target.value)}`);
    const activePkgs = (pkgData.packages || []).filter((k) => k.status === "attivo");
    document.getElementById("apptPkgSelect").innerHTML =
      `<option value="">Fuori pacchetto</option>` +
      activePkgs.map((k) => `<option value="${k.id}" selected>${esc(k.name)} (${k.available_to_book} disp.)</option>`).join("");
  });
  document.getElementById("newApptModalForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pkgVal = fd.get("package_id");
    try {
      const res = await apiFetch("/api/appointments", {
        method: "POST",
        body: {
          person_id: Number(fd.get("person_id")),
          service_area: fd.get("service_area"),
          service_name: fd.get("service_name"),
          package_id: pkgVal ? Number(pkgVal) : null,
          out_of_package: !pkgVal,
          start_at: fd.get("start_at"),
          duration_minutes: Number(fd.get("duration_minutes")),
          buffer_minutes: 10,
          location: fd.get("location"),
          status: fd.get("status"),
          recurrence_count: Number(fd.get("recurrence_count") || 1),
          recurrence_interval_days: 7,
          notes: fd.get("notes")
        }
      });
      closeModal();
      if (res.conflicts?.length) alert(res.conflicts.map((c) => c.message).join("\n"));
      await refreshCurrentView();
    } catch (err) {
      alert(err.message);
    }
  });
}

async function showNewPackageModal(preselectedPersonId = null) {
  const pData = await apiFetch("/api/people?status=attivo");
  const people = pData.people || [];
  const selectedPid = preselectedPersonId || state.selectedPersonId || people[0]?.id;

  openModal(`
    <h2 class="modal-title">Nuovo pacchetto</h2>
    <form id="newPkgModalForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Persona *</label>
          <select class="form-control" name="person_id" required>
            ${people.map((p) => `<option value="${p.id}" ${p.id === selectedPid ? "selected" : ""}>${esc(p.last_name)} ${esc(p.first_name)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Area</label>
          <select class="form-control" name="service_area">
            <option value="fisio">Fisioterapia</option>
            <option value="fitness">Personal Training</option>
            <option value="misto">Misto</option>
          </select>
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Nome *</label><input class="form-control" name="name" value="Pacchetto 10 sedute" required /></div>
        <div class="form-group"><label class="form-label">Sedute *</label><input class="form-control" type="number" name="total_sessions" value="10" min="1" required /></div>
        <div class="form-group"><label class="form-label">Prezzo (€) *</label><input class="form-control" type="number" step="0.01" name="price_eur" value="500.00" min="0" required /></div>
      </div>
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Data acquisto</label><input class="form-control" type="date" name="purchased_date" value="${todayRomeStr()}" required /></div>
        <div class="form-group"><label class="form-label">Scadenza</label><input class="form-control" type="date" name="valid_until" /></div>
        <div class="form-group"><label class="form-label">Acconto (€)</label><input class="form-control" type="number" step="0.01" name="initial_payment_eur" value="0.00" min="0" /></div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Metodo</label>
          <select class="form-control" name="payment_method">
            <option value="POS/Carta">POS / Carta</option>
            <option value="Bonifico">Bonifico</option>
            <option value="Contanti">Contanti</option>
            <option value="Satispay/Altro">Altro</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Disdetta tardiva</label>
          <select class="form-control" name="late_cancel_policy">
            <option value="charge">Addebita</option>
            <option value="no_charge">Non addebitare</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Assenza</label>
          <select class="form-control" name="no_show_policy">
            <option value="charge">Addebita</option>
            <option value="no_charge">Non addebitare</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelPkgModalBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Crea pacchetto</button>
      </div>
    </form>
  `);
  document.getElementById("cancelPkgModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("newPkgModalForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/packages", {
      method: "POST",
      body: {
        person_id: Number(fd.get("person_id")),
        service_area: fd.get("service_area"),
        name: fd.get("name"),
        total_sessions: Number(fd.get("total_sessions")),
        price_eur: Number(fd.get("price_eur")),
        purchased_date: fd.get("purchased_date"),
        valid_until: fd.get("valid_until"),
        initial_payment_eur: Number(fd.get("initial_payment_eur") || 0),
        payment_method: fd.get("payment_method"),
        late_cancel_policy: fd.get("late_cancel_policy"),
        no_show_policy: fd.get("no_show_policy")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showRecordPaymentModal(personId, packageId, dueCents = 0) {
  openModal(`
    <h2 class="modal-title">Registra pagamento</h2>
    <form id="recordPayForm">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Importo (€) *</label><input class="form-control" type="number" step="0.01" name="amount_eur" value="${(dueCents / 100).toFixed(2)}" min="0.01" required /></div>
        <div class="form-group">
          <label class="form-label">Metodo *</label>
          <select class="form-control" name="payment_method">
            <option value="POS/Carta">POS / Carta</option>
            <option value="Bonifico">Bonifico</option>
            <option value="Contanti">Contanti</option>
            <option value="Satispay/Altro">Altro</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Data</label><input class="form-control" type="date" name="payment_date" value="${todayRomeStr()}" required /></div>
        <div class="form-group"><label class="form-label">Note</label><input class="form-control" name="reference_note" /></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelPayBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva pagamento</button>
      </div>
    </form>
  `);
  document.getElementById("cancelPayBtn")?.addEventListener("click", closeModal);
  document.getElementById("recordPayForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/payments", {
      method: "POST",
      body: {
        person_id: personId,
        package_id: packageId,
        amount_eur: Number(fd.get("amount_eur")),
        payment_method: fd.get("payment_method"),
        payment_date: fd.get("payment_date"),
        reference_note: fd.get("reference_note")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showNewPhysioEpisodeModal(personId) {
  openModal(`
    <h2 class="modal-title">Nuovo episodio fisioterapico</h2>
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
      <div class="form-group"><label class="form-label">Motivo principale *</label><input class="form-control" name="chief_complaint" required /></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Data inizio</label><input class="form-control" type="date" name="start_date" value="${todayRomeStr()}" required /></div>
        <div class="form-group"><label class="form-label">Rivalutazione prevista</label><input class="form-control" type="date" name="reassessment_due_date" /></div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Obiettivi paziente</label><textarea class="form-control" name="patient_goals" rows="2"></textarea></div>
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
    medical_history: "",
    work_sport_load: "",
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
                  <select class="form-control form-control-sm" id="bmKindSelect">
                    <option value="point">Punto</option>
                    <option value="area">Area</option>
                  </select>
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
        <div class="form-group"><label class="form-label">Obiettivi paziente</label><textarea class="form-control" name="patient_goals" rows="2">${esc(ev.patient_goals || "")}</textarea></div>
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
          <select class="form-control" name="flag_type">
            <option value="yellow">Yellow Flag</option>
            <option value="red">Red Flag</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Stato</label>
          <select class="form-control" name="status">
            <option value="presente">Presente</option>
            <option value="assente">Assente</option>
            <option value="non_valutato">Non valutato</option>
          </select>
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

function showSoapNoteModal(episode, existingNote = null, copiedFromNote = null, appointmentId = null) {
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
        appointment_id: appointmentId,
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
    <h2 class="modal-title">Nuova limitazione condivisa</h2>
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
      <div class="form-group"><label class="form-label">Indicazione operativa *</label><textarea class="form-control" name="description" rows="2" required></textarea></div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Fonte</label><input class="form-control" name="source_type" value="Valutazione Fisio" required /></div>
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

function showEditFitnessProfileModal(personId, prof = {}) {
  openModal(`
    <h2 class="modal-title">Modifica profilo PT</h2>
    <form id="fitProfForm">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Obiettivi</label><input class="form-control" name="primary_goals" value="${esc(prof.primary_goals || "")}" /></div>
        <div class="form-group">
          <label class="form-label">Livello</label>
          <select class="form-control" name="experience_level">
            <option value="Principiante" ${prof.experience_level === "Principiante" ? "selected" : ""}>Principiante</option>
            <option value="Intermedio" ${prof.experience_level === "Intermedio" ? "selected" : ""}>Intermedio</option>
            <option value="Avanzato / Agonista" ${prof.experience_level === "Avanzato / Agonista" ? "selected" : ""}>Avanzato</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Disponibilità</label><input class="form-control" name="weekly_availability" value="${esc(prof.weekly_availability || "")}" /></div>
        <div class="form-group"><label class="form-label">Attrezzatura</label><input class="form-control" name="available_equipment" value="${esc(prof.available_equipment || "")}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Note</label><textarea class="form-control" name="initial_assessment_notes" rows="2">${esc(prof.initial_assessment_notes || "")}</textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelFitProfBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);
  document.getElementById("cancelFitProfBtn")?.addEventListener("click", closeModal);
  document.getElementById("fitProfForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch(`/api/people/${personId}/fitness-profile`, {
      method: "PUT",
      body: {
        expected_version: prof.version,
        primary_goals: fd.get("primary_goals"),
        experience_level: fd.get("experience_level"),
        weekly_availability: fd.get("weekly_availability"),
        available_equipment: fd.get("available_equipment"),
        initial_assessment_notes: fd.get("initial_assessment_notes")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showAddFitnessMetricModal(personId) {
  openModal(`
    <h2 class="modal-title">Nuovo test / misura</h2>
    <form id="fitMetricForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Categoria</label>
          <select class="form-control" name="metric_category">
            <option value="Forza">Forza</option>
            <option value="Antropometria">Antropometria</option>
            <option value="Performance">Performance</option>
          </select>
        </div>
        <div class="form-group"><label class="form-label">Data</label><input class="form-control" type="date" name="recorded_date" value="${todayRomeStr()}" required /></div>
      </div>
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Test *</label><input class="form-control" name="metric_name" placeholder="Es. Squat 5RM" required /></div>
        <div class="form-group"><label class="form-label">Valore *</label><input class="form-control" type="number" step="0.1" name="value_num" required /></div>
        <div class="form-group"><label class="form-label">Unità *</label><input class="form-control" name="unit" value="kg" required /></div>
      </div>
      <div class="form-group"><label class="form-label">Note</label><input class="form-control" name="protocol_notes" /></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelFitMetricBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);
  document.getElementById("cancelFitMetricBtn")?.addEventListener("click", closeModal);
  document.getElementById("fitMetricForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/fitness/metrics", {
      method: "POST",
      body: {
        person_id: personId,
        metric_category: fd.get("metric_category"),
        recorded_date: fd.get("recorded_date"),
        metric_name: fd.get("metric_name"),
        value_num: Number(fd.get("value_num")),
        unit: fd.get("unit"),
        protocol_notes: fd.get("protocol_notes")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showFitnessProgramModal(personId, existingProg = null) {
  const defaultWorkouts = existingProg?.workouts || [
    {
      day_name: "Scheda A",
      exercises: [
        { name: "Squat / Trap Bar", sets: 4, reps: "8", load: "60 kg", rest: "120s", rpe: "7.5", notes: "" },
        { name: "Spinte manubri", sets: 3, reps: "10", load: "2x16 kg", rest: "90s", rpe: "8", notes: "" }
      ]
    }
  ];
  openModal(`
    <h2 class="modal-title">${existingProg ? `Modifica programma (v${existingProg.version + 1})` : "Nuovo programma PT"}</h2>
    <form id="fitProgForm">
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Titolo *</label><input class="form-control" name="title" value="${esc(existingProg?.title || "Programma Forza")}" required /></div>
        <div class="form-group"><label class="form-label">Obiettivo *</label><input class="form-control" name="goal" value="${esc(existingProg?.goal || "")}" required /></div>
      </div>
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Data inizio</label><input class="form-control" type="date" name="start_date" value="${esc(existingProg?.start_date || todayRomeStr())}" required /></div>
        <div class="form-group"><label class="form-label">Sedute/sett.</label><input class="form-control" type="number" name="frequency_per_week" value="${existingProg?.frequency_per_week || 2}" min="1" max="7" /></div>
        <div class="form-group"><label class="form-label">Nota versione</label><input class="form-control" name="change_note" value="Aggiornamento" /></div>
      </div>
      <div class="form-group">
        <label class="form-label">Schede (JSON)</label>
        <textarea class="form-control" name="workouts_json" style="font-family:monospace; min-height:170px;">${esc(JSON.stringify(defaultWorkouts, null, 2))}</textarea>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelFitProgBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva</button>
      </div>
    </form>
  `);
  document.getElementById("cancelFitProgBtn")?.addEventListener("click", closeModal);
  document.getElementById("fitProgForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let workouts;
    try {
      workouts = JSON.parse(fd.get("workouts_json"));
    } catch {
      alert("JSON non valido.");
      return;
    }
    await apiFetch(existingProg ? `/api/fitness/programs/${existingProg.id}` : "/api/fitness/programs", {
      method: existingProg ? "PUT" : "POST",
      body: {
        person_id: personId,
        expected_version: existingProg ? existingProg.version : undefined,
        title: fd.get("title"),
        goal: fd.get("goal"),
        start_date: fd.get("start_date"),
        frequency_per_week: Number(fd.get("frequency_per_week")),
        change_note: fd.get("change_note"),
        workouts
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showWorkoutLogModal(personId, program = null, dayIdx = 0, appointmentId = null) {
  const dayObj = program?.workouts?.[dayIdx] || {
    day_name: "Seduta PT",
    exercises: [{ name: "Esercizio 1", sets: 3, reps: "10", load: "", rpe: "" }]
  };
  const planned = dayObj.exercises || [];

  openModal(
    `
    <h2 class="modal-title">Registra seduta PT</h2>
    <form id="workoutLogForm">
      <div class="grid-3">
        <div class="form-group"><label class="form-label">Scheda</label><input class="form-control" name="workout_day_name" value="${esc(dayObj.day_name)}" required /></div>
        <div class="form-group"><label class="form-label">Data</label><input class="form-control" type="date" name="session_date" value="${todayRomeStr()}" required /></div>
        <div class="form-group"><label class="form-label">RPE (1–10)</label><input class="form-control" type="number" step="0.5" min="1" max="10" name="session_rpe" value="7.5" /></div>
      </div>
      <div class="table-wrap" style="margin-bottom:12px;">
        <table class="data-table data-table-compact">
          <thead><tr><th>Esercizio</th><th>Serie</th><th>Rip.</th><th>Carico</th><th>RPE</th></tr></thead>
          <tbody>
            ${planned
              .map(
                (ex, i) => `
                <tr>
                  <td><input class="form-control form-control-sm" name="ex_name_${i}" value="${esc(ex.name)}" /></td>
                  <td><input class="form-control form-control-sm" name="ex_sets_${i}" value="${esc(ex.sets)}" style="width:62px;" /></td>
                  <td><input class="form-control form-control-sm" name="ex_reps_${i}" value="${esc(ex.reps)}" style="width:76px;" /></td>
                  <td><input class="form-control form-control-sm" name="ex_load_${i}" value="${esc(ex.load)}" /></td>
                  <td><input class="form-control form-control-sm" name="ex_rpe_${i}" value="${esc(ex.rpe || "")}" style="width:66px;" /></td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="grid-2">
        <div class="form-group"><label class="form-label">Feedback</label><input class="form-control" name="client_feedback" /></div>
        <div class="form-group"><label class="form-label">Sintomi (se presenti)</label><input class="form-control" name="reported_symptoms" /></div>
      </div>
      <div class="form-group"><label class="form-label">Note prossima seduta</label><input class="form-control" name="next_session_notes" /></div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="cancelWLogBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva seduta</button>
      </div>
    </form>
  `,
    { wide: true }
  );
  document.getElementById("cancelWLogBtn")?.addEventListener("click", closeModal);
  document.getElementById("workoutLogForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const actual = planned.map((_, i) => ({
      name: fd.get(`ex_name_${i}`),
      sets: fd.get(`ex_sets_${i}`),
      reps: fd.get(`ex_reps_${i}`),
      load: fd.get(`ex_load_${i}`),
      rpe: fd.get(`ex_rpe_${i}`),
      done: true
    }));
    await apiFetch("/api/fitness/workout-logs", {
      method: "POST",
      body: {
        person_id: personId,
        program_id: program ? program.id : null,
        appointment_id: appointmentId,
        workout_day_name: fd.get("workout_day_name"),
        session_date: fd.get("session_date"),
        session_rpe: fd.get("session_rpe"),
        planned_exercises: planned,
        actual_exercises: actual,
        client_feedback: fd.get("client_feedback"),
        reported_symptoms: fd.get("reported_symptoms"),
        symptom_severity: fd.get("reported_symptoms") ? 3 : 0,
        next_session_notes: fd.get("next_session_notes")
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
          <select class="form-control" name="status">
            <option value="acquisito">Acquisito</option>
            <option value="revocato">Revocato</option>
            <option value="in_attesa">In attesa</option>
          </select>
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
        <label class="form-label">File (PDF, PNG, JPG, WEBP max 15 MB) *</label>
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

  // Login
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
      state.catalogs = await apiFetch("/api/catalogs", { silentStatus: true });
      await navigateTo("people", { personId: null });
    } catch (err) {
      if (err.data?.require_totp) {
        document.getElementById("loginTotpGroup").style.display = "block";
      }
      showLoginScreen(err.message);
    }
  });

  // Navigazione
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
    try {
      localStorage.removeItem("gestionale_cloud_token");
    } catch {}
    showLoginScreen();
  });

  document.getElementById("qaNewPersonBtn")?.addEventListener("click", () => showNewPersonModal());

  // Ricerca globale
  const searchInput = document.getElementById("globalSearchInput");
  const searchDrop = document.getElementById("globalSearchDropdown");
  searchInput?.addEventListener("input", async (e) => {
    const q = e.target.value.trim();
    if (!q) {
      searchDrop.style.display = "none";
      return;
    }
    const res = await apiFetch(`/api/people?q=${encodeURIComponent(q)}&status=tutti`);
    const list = res.people || [];
    if (!list.length) {
      searchDrop.innerHTML = `<div class="search-result-item" style="color:var(--text-muted);">Nessun risultato</div>`;
    } else {
      searchDrop.innerHTML = list
        .map(
          (p) => `
          <div class="search-result-item" data-search-pick="${p.id}">
            <div>
              <div style="font-weight:600;">${esc(p.last_name)} ${esc(p.first_name)}</div>
              <div style="font-size:12px; color:var(--text-muted);">${esc(p.sport_activity || p.phone || "")}</div>
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

  // Stato auth iniziale
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
      state.catalogs = await apiFetch("/api/catalogs", { silentStatus: true });
      await navigateTo("people", { personId: null });
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen();
  }
}

window.addEventListener("DOMContentLoaded", initApp);
