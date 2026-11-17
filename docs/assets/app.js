import {
  SYMPTOM_TYPES,
  inferAnatomicalRegionAndSide,
  renderBodySvgMarkup,
  clientEventToNormalizedSvgCoords
} from "./body_map.js";

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
  currentNav: "dashboard",
  privacyMode: false,
  selectedPersonId: null,
  selectedPersonTab: "riepilogo",
  selectedEpisodeId: null,
  selectedEvalId: null,
  agendaViewMode: window.innerWidth < 768 ? "iphone_list" : "week",
  agendaDate: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }),
  agendaAreaFilter: "tutti",
  peopleAreaFilter: "tutti",
  peopleStatusFilter: "attivo",
  catalogs: { outcome_scales: {}, templates: [] },
  bodyMapDraft: {
    viewSide: "anterior",
    markerKind: "point",
    radiusNorm: 24,
    symptomType: "Dolore acuto",
    intensity: 5,
    zoom: { scale: 1, focus: "full" },
    showComparison: true,
    markers: []
  }
};

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

function formatRomeDateTime(isoStr) {
  if (!isoStr) return "-";
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
    return isoStr.replace("T", " ").slice(0, 16);
  }
}

function formatRomeTime(isoStr) {
  if (!isoStr) return "";
  return isoStr.slice(11, 16);
}

function setSaveStatus(mode, text) {
  const el = document.getElementById("saveStatusIndicator");
  if (!el) return;
  el.className = `save-status-pill ${mode}`;
  const nowTime = new Date().toLocaleTimeString("it-IT", { timeZone: "Europe/Rome" });
  if (mode === "saving") {
    el.textContent = `⏳ ${text || "Salvataggio bozza..."}`;
  } else if (mode === "saved") {
    el.textContent = `✓ ${text || `Salvato (${nowTime})`}`;
  } else if (mode === "error") {
    el.textContent = `⚠️ ${text || "Errore salvataggio / Conflitto"}`;
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
    setSaveStatus("saving", "Salvataggio in corso...");
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
  } catch (networkErr) {
    setSaveStatus("error", "Connessione assente — le modifiche locali restano nel modulo");
    throw new Error("Impossibile contattare il server. Controlla la connessione di rete.");
  }

  let data = null;
  const ctype = resp.headers.get("Content-Type") || "";
  if (ctype.includes("application/json")) {
    data = await resp.json();
  }

  if (resp.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/status") {
    setSaveStatus("error", "Sessione scaduta — effettua nuovamente l'accesso");
    showLoginScreen("Sessione scaduta o non autenticata. Accedi per continuare senza perdere il lavoro.");
    throw new Error("Non autenticato");
  }

  if (resp.status === 409 && data && data.code === "CONFLICT") {
    setSaveStatus("error", "Conflitto di modifica concorrente rilevato (409)");
    showConflictResolutionModal(data.error, data.server_record, options.body);
    const err = new Error(data.error || "Conflitto di versione");
    err.isConflict = true;
    err.serverRecord = data.server_record;
    throw err;
  }

  if (!resp.ok) {
    if (method !== "GET" && !options.silentStatus) {
      setSaveStatus("error", (data && data.error) || "Errore durante il salvataggio");
    }
    const err = new Error((data && data.error) || `Errore HTTP ${resp.status}`);
    err.details = (data && data.details) || {};
    err.data = data;
    throw err;
  }

  if (method !== "GET" && !options.silentStatus) {
    setSaveStatus("saved");
  }
  return data;
}

function showConflictResolutionModal(message, serverRecord, attemptedPayload) {
  openModal(`
    <div>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <span class="badge badge-danger" style="font-size:14px;">⚠️ CONFLITTO DI MODIFICA CONCORRENTE (HTTP 409)</span>
      </div>
      <h2 style="margin-top:0;">Modifica rilevata da un altro dispositivo</h2>
      <p style="color:#334155;">${esc(message)}</p>
      <p style="font-size:13px; color:#475569;">
        Per evitare <strong>sovrascritture silenziose</strong>, il salvataggio è stato bloccato perché la versione sul server è già avanzata a <strong>v${esc(serverRecord.version)}</strong> (aggiornata il ${esc(formatRomeDateTime(serverRecord.updated_at))}).
      </p>
      <div class="grid-2" style="margin:14px 0;">
        <div class="card" style="background:var(--bg-subtle); margin:0;">
          <h4 style="margin-top:0;">Stato attuale sul Server (v${esc(serverRecord.version)})</h4>
          <pre style="font-size:11.5px; white-space:pre-wrap; max-height:220px; overflow:auto;">${esc(JSON.stringify(serverRecord, null, 2))}</pre>
        </div>
        <div class="card" style="background:#fffbeb; margin:0;">
          <h4 style="margin-top:0;">Modifiche inviate da questo dispositivo</h4>
          <pre style="font-size:11.5px; white-space:pre-wrap; max-height:220px; overflow:auto;">${esc(JSON.stringify(attemptedPayload, null, 2))}</pre>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
        <button class="btn btn-primary" id="conflictReloadBtn">Ricarica dati aggiornati dal server</button>
      </div>
    </div>
  `);
  document.getElementById("conflictReloadBtn")?.addEventListener("click", async () => {
    closeModal();
    await refreshCurrentView();
  });
}

// ============================================================================
// GESTIONE MODALI E NAVIGAZIONE
// ============================================================================

function openModal(htmlContent) {
  const backdrop = document.getElementById("modalContainer");
  const content = document.getElementById("modalContent");
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
  if (e.target.id === "modalContainer") {
    closeModal();
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
  state.currentNav = navKey;
  if (options.personId !== undefined) {
    state.selectedPersonId = options.personId;
  }
  if (options.personTab) {
    state.selectedPersonTab = options.personTab;
  }
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-nav") === navKey);
  });
  await refreshCurrentView();
}

async function refreshCurrentView() {
  const container = document.getElementById("mainViewContainer");
  if (!container) return;
  if (state.currentNav === "dashboard") {
    await renderDashboardView(container);
  } else if (state.currentNav === "agenda") {
    await renderAgendaView(container);
  } else if (state.currentNav === "people") {
    if (state.selectedPersonId) {
      await renderPersonDossierView(container, state.selectedPersonId);
    } else {
      await renderPeopleListView(container);
    }
  } else if (state.currentNav === "packages") {
    await renderPackagesView(container);
  } else if (state.currentNav === "security") {
    await renderSecurityView(container);
  }
}

// ============================================================================
// 1. VISTA DASHBOARD ("OGGI")
// ============================================================================

async function renderDashboardView(container) {
  const data = await apiFetch(`/api/dashboard?date=${encodeURIComponent(state.agendaDate)}`);
  const nextAppt = data.next_appointment;

  const nextPersonHtml = nextAppt
    ? `
      <div class="card" style="border-left: 6px solid var(--primary); background: linear-gradient(135deg, var(--primary-light), var(--bg-surface));">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div>
            <span class="badge ${nextAppt.service_area === "fisio" ? "badge-physio" : "badge-fitness"}">
              ${nextAppt.service_area === "fisio" ? "🩺 PROSSIMA SEDUTA FISIOTERAPIA" : "🏋️ PROSSIMA SEDUTA FITNESS"}
            </span>
            <h2 style="margin:8px 0 4px 0; font-size:21px;" class="sensitive-data">
              ${esc(nextAppt.first_name)} ${esc(nextAppt.last_name)}
            </h2>
            <div style="color:var(--text-secondary); font-size:14px;">
              🕒 <strong>${formatRomeTime(nextAppt.start_at)} – ${formatRomeTime(nextAppt.end_at)}</strong>
              · ${esc(nextAppt.service_name)} · 📍 ${esc(nextAppt.location)}
            </div>
            ${nextAppt.notes ? `<div style="margin-top:6px; font-size:13px; color:var(--text-muted);" class="sensitive-data">📝 ${esc(nextAppt.notes)}</div>` : ""}
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-primary" data-open-appt-drawer="${nextAppt.id}">⚡ Gestisci Seduta / Presenza</button>
            <button class="btn btn-secondary" data-open-person="${nextAppt.person_id}" data-person-tab="${nextAppt.service_area}">📂 Apri Scheda ${nextAppt.service_area === "fisio" ? "Fisio" : "Fitness"}</button>
          </div>
        </div>
      </div>
    `
    : `
      <div class="card" style="border-left: 5px solid #94a3b8;">
        <strong>Nessun altro appuntamento in attesa per oggi (${esc(data.date)}).</strong>
      </div>
    `;

  const todayRows = (data.today_appointments || [])
    .map((a) => {
      const areaBadge =
        a.service_area === "fisio"
          ? `<span class="badge badge-physio">🩺 Fisio</span>`
          : `<span class="badge badge-fitness">🏋️ Fitness</span>`;
      const stBadge = renderApptStatusBadge(a.status);
      return `
        <tr>
          <td><strong>${formatRomeTime(a.start_at)} – ${formatRomeTime(a.end_at)}</strong></td>
          <td>
            <a href="#" data-open-person="${a.person_id}" style="font-weight:700; color:var(--primary); text-decoration:none;" class="sensitive-data">
              ${esc(a.first_name)} ${esc(a.last_name)}
            </a>
          </td>
          <td>${areaBadge} <span style="margin-left:4px;">${esc(a.service_name)}</span></td>
          <td>${stBadge}</td>
          <td style="text-align:right;">
            <button class="btn btn-sm btn-secondary" data-open-appt-drawer="${a.id}">Gestisci / Svolgi</button>
          </td>
        </tr>
      `;
    })
    .join("");

  const draftsRows = (data.drafts_to_complete || [])
    .map(
      (d) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color);">
        <div>
          <span class="badge badge-warning">✏️ BOZZA</span>
          <strong class="sensitive-data" style="margin-left:6px;">${esc(d.first_name)} ${esc(d.last_name)}</strong>
          <div style="font-size:12.5px; color:#475569;" class="sensitive-data">${esc(d.kind)} · ${esc(d.episode_title)} (${esc(d.date)})</div>
        </div>
        <button class="btn btn-sm btn-secondary" data-open-person="${d.person_id}" data-person-tab="fisio">Completa</button>
      </div>
    `
    )
    .join("");

  const reassessRows = (data.reassessments_due || [])
    .map(
      (r) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color);">
        <div>
          <span class="badge badge-physio">🔄 RIVALUTAZIONE</span>
          <strong class="sensitive-data" style="margin-left:6px;">${esc(r.first_name)} ${esc(r.last_name)}</strong>
          <div style="font-size:12.5px; color:#475569;" class="sensitive-data">${esc(r.title)} · Prevista: <strong>${esc(r.reassessment_due_date)}</strong></div>
        </div>
        <button class="btn btn-sm btn-physio" data-open-person="${r.person_id}" data-person-tab="fisio">Rivaluta</button>
      </div>
    `
    )
    .join("");

  const lowPkgRows = (data.low_or_expiring_packages || [])
    .map(
      (p) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color);">
        <div>
          <strong class="sensitive-data">${esc(p.first_name)} ${esc(p.last_name)}</strong> — ${esc(p.name)}
          <div style="font-size:12.5px; color:#475569;">
            Residue: <strong>${p.remaining_sessions}/${p.total_sessions}</strong> (Disponibili: <strong>${p.available_to_book}</strong>, Prenotate: ${p.reserved_sessions})
            ${p.valid_until ? ` · Scad: ${esc(p.valid_until)}` : ""}
          </div>
        </div>
        <button class="btn btn-sm btn-secondary" data-open-person="${p.person_id}" data-person-tab="pacchetti">Apri</button>
      </div>
    `
    )
    .join("");

  const unpaidRows = (data.unpaid_packages || [])
    .map(
      (p) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-color);">
        <div>
          <strong class="sensitive-data">${esc(p.first_name)} ${esc(p.last_name)}</strong> — ${esc(p.name)}
          <div style="font-size:12.5px; color:#b91c1c; font-weight:600;" class="sensitive-data">
            Da incassare: ${formatEur(p.due_cents)} (Pagato: ${formatEur(p.paid_cents)} su ${formatEur(p.price_cents)})
          </div>
        </div>
        <button class="btn btn-sm btn-primary" data-record-payment-pkg="${p.id}" data-person-id="${p.person_id}" data-due-cents="${p.due_cents}">💶 Incassa</button>
      </div>
    `
    )
    .join("");

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
      <div>
        <h1 style="margin:0; font-size:22px;">Oggi in Studio</h1>
        <div style="font-size:13px; color:#64748b;">Data selezionata: <strong>${esc(data.date)}</strong> · Fuso: Europe/Rome</div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <input type="date" class="form-control" id="dashDateInput" value="${esc(data.date)}" style="width:auto;" />
        <button class="btn btn-sm btn-secondary" id="dashTodayBtn">Oggi</button>
      </div>
    </div>

    ${nextPersonHtml}

    <div class="grid-4" style="margin-bottom:16px;">
      <div class="stat-card">
        <div class="stat-label">Appuntamenti Oggi</div>
        <div class="stat-value">${data.today_appointments.length}</div>
        <div class="stat-sub">Fisio &amp; Personal Training</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Note in Bozza</div>
        <div class="stat-value">${data.drafts_to_complete.length}</div>
        <div class="stat-sub">Valutazioni e SOAP da chiudere</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Rivalutazioni Previste</div>
        <div class="stat-value">${data.reassessments_due.length}</div>
        <div class="stat-sub">Entro i prossimi 7 giorni</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Importi da Incassare</div>
        <div class="stat-value sensitive-data" style="color:var(--danger);">${formatEur(data.total_to_collect_cents)}</div>
        <div class="stat-sub">${data.unpaid_packages.length} pacchetti non saldati</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">📅 Appuntamenti del Giorno (${esc(data.date)})</h3>
        <button class="btn btn-sm btn-primary" id="dashNewApptBtn">➕ Nuovo Appuntamento</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Orario</th><th>Persona</th><th>Servizio</th><th>Stato</th><th style="text-align:right;">Azione</th></tr>
          </thead>
          <tbody>
            ${todayRows || '<tr><td colspan="5" style="text-align:center; color:#64748b;">Nessun appuntamento registrato per questa data.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><h3 class="card-title">✏️ Note e Valutazioni in Bozza da Completare</h3></div>
        ${draftsRows || '<div style="color:#64748b; font-size:13.5px;">Tutte le note cliniche sono state finalizzate.</div>'}
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">🔄 Rivalutazioni Cliniche in Scadenza</h3></div>
        ${reassessRows || '<div style="color:#64748b; font-size:13.5px;">Nessuna rivalutazione in scadenza nei prossimi 7 giorni.</div>'}
      </div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><h3 class="card-title">🎟️ Pacchetti Quasi Esauriti (≤ 2 sedute) o in Scadenza</h3></div>
        ${lowPkgRows || '<div style="color:#64748b; font-size:13.5px;">Nessun pacchetto in esaurimento.</div>'}
      </div>
      <div class="card">
        <div class="card-header"><h3 class="card-title">💶 Importi da Incassare</h3></div>
        ${unpaidRows || '<div style="color:#64748b; font-size:13.5px;">Nessun insoluto aperto.</div>'}
      </div>
    </div>
  `;

  document.getElementById("dashDateInput")?.addEventListener("change", async (e) => {
    state.agendaDate = e.target.value;
    await renderDashboardView(container);
  });
  document.getElementById("dashTodayBtn")?.addEventListener("click", async () => {
    state.agendaDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
    await renderDashboardView(container);
  });
  document.getElementById("dashNewApptBtn")?.addEventListener("click", () => showNewAppointmentModal());
  bindCommonActionButtons(container);
}

function renderApptStatusBadge(status) {
  const map = {
    prenotato: { cls: "badge-neutral", icon: "🕒", label: "Prenotato (Riserva seduta)" },
    confermato: { cls: "badge-physio", icon: "✓", label: "Confermato (Riserva seduta)" },
    svolto: { cls: "badge-success", icon: "✔", label: "Svolto (Seduta consumata)" },
    annullato: { cls: "badge-warning", icon: "✖", label: "Annullato" },
    assente: { cls: "badge-danger", icon: "⚠", label: "Assente" }
  };
  const info = map[status] || { cls: "badge-neutral", icon: "•", label: status };
  return `<span class="badge ${info.cls}">${info.icon} ${esc(info.label)}</span>`;
}

// ============================================================================
// 2. LISTA PERSONE (ANAGRAFICA UNICA CON FILTRI FISIO / FITNESS / ENTRAMBI)
// ============================================================================

async function renderPeopleListView(container) {
  const data = await apiFetch(
    `/api/people?area=${encodeURIComponent(state.peopleAreaFilter)}&status=${encodeURIComponent(state.peopleStatusFilter)}`
  );
  const people = data.people || [];

  const rowsHtml = people
    .map((p) => {
      const badges = [];
      if (p.physio_active && p.fitness_active) {
        badges.push(`<span class="badge badge-success">🔗 Entrambi (Fisio + Fitness)</span>`);
      } else if (p.physio_active) {
        badges.push(`<span class="badge badge-physio">🩺 Paziente Fisio</span>`);
      } else if (p.fitness_active) {
        badges.push(`<span class="badge badge-fitness">🏋️ Cliente Fitness</span>`);
      } else {
        badges.push(`<span class="badge badge-neutral">Nessun percorso attivo</span>`);
      }
      return `
        <tr>
          <td>
            <a href="#" data-open-person="${p.id}" style="font-weight:700; font-size:15px; color:var(--primary); text-decoration:none;" class="sensitive-data">
              ${esc(p.last_name)} ${esc(p.first_name)}
            </a>
            ${p.is_fictitious ? `<span class="badge badge-neutral" style="margin-left:6px; font-size:10px;">DATO FITTIZIO</span>` : ""}
          </td>
          <td class="sensitive-data">${esc(p.birth_date || "-")}</td>
          <td class="sensitive-data">${esc(p.phone || "-")}<br><span style="font-size:12px; color:#64748b;">${esc(p.email || "")}</span></td>
          <td>${badges.join(" ")}</td>
          <td>${esc(p.sport_activity || "-")}</td>
          <td><span class="badge ${p.status === "attivo" ? "badge-success" : "badge-neutral"}">${esc(p.status)}</span></td>
          <td style="text-align:right;">
            <button class="btn btn-sm btn-primary" data-open-person="${p.id}">Apri Scheda</button>
          </td>
        </tr>
      `;
    })
    .join("");

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
      <div>
        <h1 style="margin:0; font-size:22px;">Anagrafica Unica Persone</h1>
        <div style="font-size:13px; color:#64748b;">Principio: una sola persona può avere percorsi Fisio, Fitness o entrambi contemporaneamente senza duplicazioni.</div>
      </div>
      <button class="btn btn-primary" id="newPersonTopBtn">➕ Nuova Persona</button>
    </div>

    <div class="card">
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:14px;">
        <div>
          <label class="form-label" style="margin-bottom:2px;">Filtro Percorso</label>
          <select class="form-control" id="peopleAreaSelect" style="min-width:210px;">
            <option value="tutti" ${state.peopleAreaFilter === "tutti" ? "selected" : ""}>Tutti i profili</option>
            <option value="entrambi" ${state.peopleAreaFilter === "entrambi" ? "selected" : ""}>Entrambi (Fisio + Fitness)</option>
            <option value="fisio" ${state.peopleAreaFilter === "fisio" ? "selected" : ""}>Solo Pazienti Fisio</option>
            <option value="fitness" ${state.peopleAreaFilter === "fitness" ? "selected" : ""}>Solo Clienti Fitness</option>
            <option value="con_fisio" ${state.peopleAreaFilter === "con_fisio" ? "selected" : ""}>Tutti con Fisio attivo</option>
            <option value="con_fitness" ${state.peopleAreaFilter === "con_fitness" ? "selected" : ""}>Tutti con Fitness attivo</option>
          </select>
        </div>
        <div>
          <label class="form-label" style="margin-bottom:2px;">Stato Anagrafica</label>
          <select class="form-control" id="peopleStatusSelect" style="min-width:160px;">
            <option value="attivo" ${state.peopleStatusFilter === "attivo" ? "selected" : ""}>Attivi</option>
            <option value="archiviato" ${state.peopleStatusFilter === "archiviato" ? "selected" : ""}>Archiviati</option>
            <option value="tutti" ${state.peopleStatusFilter === "tutti" ? "selected" : ""}>Tutti</option>
          </select>
        </div>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Cognome e Nome</th>
              <th>Nascita</th>
              <th>Contatti</th>
              <th>Percorsi Attivi</th>
              <th>Sport / Attività</th>
              <th>Stato</th>
              <th style="text-align:right;">Scheda</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="7" style="text-align:center; color:#64748b;">Nessuna persona trovata con i filtri selezionati.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("peopleAreaSelect")?.addEventListener("change", async (e) => {
    state.peopleAreaFilter = e.target.value;
    await renderPeopleListView(container);
  });
  document.getElementById("peopleStatusSelect")?.addEventListener("change", async (e) => {
    state.peopleStatusFilter = e.target.value;
    await renderPeopleListView(container);
  });
  document.getElementById("newPersonTopBtn")?.addEventListener("click", () => showNewPersonModal());
  bindCommonActionButtons(container);
}

// ============================================================================
// 3. SCHEDA PERSONALE COMPLETA (8 TAB DISTINTI)
// ============================================================================

async function renderPersonDossierView(container, personId) {
  const dossier = await apiFetch(`/api/people/${personId}`);
  const p = dossier.person;
  const sum = dossier.summary;

  const tabs = [
    { id: "riepilogo", label: "📊 1. Riepilogo" },
    { id: "anagrafica", label: "👤 2. Dati Anagrafici" },
    { id: "fisio", label: `🩺 3. Area Fisio (${dossier.physio.episodes.length})` },
    { id: "fitness", label: `🏋️ 4. Area Fitness (${dossier.fitness.programs.length})` },
    { id: "appuntamenti", label: `📅 5. Appuntamenti (${dossier.appointments.length})` },
    { id: "pacchetti", label: `🎟️ 6. Pacchetti & Pagamenti (${dossier.packages.length})` },
    { id: "documenti", label: `📎 7. Documenti & Consensi (${dossier.attachments.length})` },
    { id: "cronologia", label: `🕒 8. Cronologia (${dossier.audit_history.length})` }
  ];

  const tabsHtml = tabs
    .map(
      (t) =>
        `<button class="tab-btn ${state.selectedPersonTab === t.id ? "active" : ""}" data-person-subtab="${t.id}">${t.label}</button>`
    )
    .join("");

  container.innerHTML = `
    <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <button class="btn btn-sm btn-secondary" id="backToPeopleListBtn">← Torna alla lista persone</button>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <a class="btn btn-sm btn-secondary" href="${esc(buildAuthUrl(`/api/people/${p.id}/export-pdf`))}" target="_blank">🖨️ Scheda PDF / Stampa</a>
        <a class="btn btn-sm btn-secondary" href="${esc(buildAuthUrl(`/api/people/${p.id}/export.json`))}" target="_blank">⬇️ Esporta Dati JSON</a>
        <button class="btn btn-sm btn-danger" id="deletePersonBtn">🗑️ Elimina Anagrafica</button>
      </div>
    </div>

    <div class="card" style="background:linear-gradient(135deg, #07101f, #102544); border:1px solid #274a73; color:#ffffff;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:14px;">
        <div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <h1 style="margin:0; font-size:23px; color:#fff;" class="sensitive-data">${esc(p.first_name)} ${esc(p.last_name)}</h1>
            ${p.physio_active ? `<span class="badge badge-physio">🩺 Percorso Fisio Attivo</span>` : ""}
            ${p.fitness_active ? `<span class="badge badge-fitness">🏋️ Percorso Fitness Attivo</span>` : ""}
            <span class="badge ${p.status === "attivo" ? "badge-success" : "badge-neutral"}">${esc(p.status.toUpperCase())}</span>
          </div>
          <div style="font-size:13.5px; color:#cbd5e1; margin-top:6px;" class="sensitive-data">
            🎂 Nascita: <strong>${esc(p.birth_date || "-")}</strong>
            · 📞 Tel: <strong>${esc(p.phone || "-")}</strong>
            · ✉️ Email: <strong>${esc(p.email || "-")}</strong>
            · 🏃 Sport: <strong>${esc(p.sport_activity || "-")}</strong>
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${
            !p.physio_active
              ? `<button class="btn btn-sm btn-physio" id="quickActivatePhysioBtn">➕ Attiva Area Fisio</button>`
              : ""
          }
          ${
            !p.fitness_active
              ? `<button class="btn btn-sm btn-fitness" id="quickActivateFitnessBtn">➕ Attiva Area Fitness</button>`
              : ""
          }
          <button class="btn btn-sm btn-primary" id="dossierNewApptBtn">📅 Prenota Seduta</button>
        </div>
      </div>
    </div>

    <div class="tabs-bar" role="tablist">
      ${tabsHtml}
    </div>

    <div id="personSubtabViewport"></div>
  `;

  document.getElementById("backToPeopleListBtn")?.addEventListener("click", async () => {
    state.selectedPersonId = null;
    await renderPeopleListView(container);
  });
  document.getElementById("deletePersonBtn")?.addEventListener("click", async () => {
    const fullName = `${p.first_name || ""} ${p.last_name || ""}`.trim();
    if (
      !window.confirm(
        `Eliminare definitivamente l'anagrafica di ${fullName}?\n\nQuesta azione rimuoverà anche appuntamenti, valutazioni, programmi, pacchetti e allegati collegati.`
      )
    ) {
      return;
    }
    await apiFetch(`/api/people/${p.id}`, { method: "DELETE" });
    state.selectedPersonId = null;
    await renderPeopleListView(container);
  });
  document.getElementById("dossierNewApptBtn")?.addEventListener("click", () => showNewAppointmentModal(p.id));
  document.getElementById("quickActivatePhysioBtn")?.addEventListener("click", async () => {
    await apiFetch(`/api/people/${p.id}`, {
      method: "PUT",
      body: { physio_active: true, expected_version: p.version }
    });
    state.selectedPersonTab = "fisio";
    await renderPersonDossierView(container, p.id);
  });
  document.getElementById("quickActivateFitnessBtn")?.addEventListener("click", async () => {
    await apiFetch(`/api/people/${p.id}`, {
      method: "PUT",
      body: { fitness_active: true, expected_version: p.version }
    });
    state.selectedPersonTab = "fitness";
    await renderPersonDossierView(container, p.id);
  });

  container.querySelectorAll("[data-person-subtab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.selectedPersonTab = btn.getAttribute("data-person-subtab");
      await renderPersonDossierView(container, p.id);
    });
  });

  const subViewport = document.getElementById("personSubtabViewport");
  if (state.selectedPersonTab === "riepilogo") {
    renderPersonTabRiepilogo(subViewport, dossier);
  } else if (state.selectedPersonTab === "anagrafica") {
    renderPersonTabAnagrafica(subViewport, dossier);
  } else if (state.selectedPersonTab === "fisio") {
    renderPersonTabFisio(subViewport, dossier);
  } else if (state.selectedPersonTab === "fitness") {
    renderPersonTabFitness(subViewport, dossier);
  } else if (state.selectedPersonTab === "appuntamenti") {
    renderPersonTabAppuntamenti(subViewport, dossier);
  } else if (state.selectedPersonTab === "pacchetti") {
    renderPersonTabPacchetti(subViewport, dossier);
  } else if (state.selectedPersonTab === "documenti") {
    renderPersonTabDocumenti(subViewport, dossier);
  } else if (state.selectedPersonTab === "cronologia") {
    renderPersonTabCronologia(subViewport, dossier);
  }
}

// --- TAB 1: RIEPILOGO ---
function renderPersonTabRiepilogo(viewport, dossier) {
  const p = dossier.person;
  const sum = dossier.summary;
  const lims = (dossier.shared_limitations || []).filter((l) => l.is_active);

  const limsHtml = lims
    .map(
      (l) => `
      <div style="padding:10px; background:#fffbeb; border-left:4px solid #d97706; border-radius:6px; margin-bottom:8px;">
        <div style="font-weight:700; color:#92400e;">⚠️ ${esc(l.title)} (${esc(l.body_region || "Generale")} · Lato: ${esc(l.laterality)})</div>
        <div style="font-size:13.5px; color:#1e293b; margin-top:4px;" class="sensitive-data">${esc(l.description)}</div>
        <div style="font-size:11.5px; color:#64748b; margin-top:4px;">
          📌 <strong>Fonte:</strong> ${esc(l.source_type)} (${esc(l.source_reference || "-")}) · <strong>Data:</strong> ${esc(l.recorded_date)} · <strong>Autore:</strong> ${esc(l.recorded_by)}
        </div>
      </div>
    `
    )
    .join("");

  viewport.innerHTML = `
    <div class="grid-4" style="margin-bottom:16px;">
      <div class="stat-card">
        <div class="stat-label">Episodi Fisio Attivi</div>
        <div class="stat-value">${sum.active_physio_episodes}</div>
        <div class="stat-sub">Storico totale: ${dossier.physio.episodes.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Programmi Fitness Attivi</div>
        <div class="stat-value">${sum.active_fitness_programs}</div>
        <div class="stat-sub">Sedute registrate: ${dossier.fitness.workout_logs.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Sedute Disponibili</div>
        <div class="stat-value">${sum.total_available_sessions}</div>
        <div class="stat-sub">Al netto delle prenotazioni riservate</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Saldo Economico da Incassare</div>
        <div class="stat-value sensitive-data" style="color:${sum.total_due_cents > 0 ? "var(--danger)" : "var(--success)"};">
          ${formatEur(sum.total_due_cents)}
        </div>
        <div class="stat-sub">Distinto dal saldo sedute</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3 class="card-title">🔗 Limitazioni Rilevanti Condivise (Ponte Controllato Fisio ↔ Fitness)</h3>
        <button class="btn btn-sm btn-secondary" id="addSharedLimBtn">➕ Aggiungi Limitazione Condivisa</button>
      </div>
      <p style="font-size:12.5px; color:#475569; margin-top:0;">
        Le limitazioni qui elencate vengono richiamate nella scheda Fitness mantenendo fonte e data, <strong>senza copiare indiscriminatamente la cartella clinica</strong>.
      </p>
      ${limsHtml || '<div style="color:#64748b; font-size:13.5px;">Nessuna limitazione attiva condivisa tra Fisio e Fitness.</div>'}
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🩺 Sintesi Area Fisioterapia</h3>
          <button class="btn btn-sm btn-physio" data-switch-tab="fisio">Vai all'Area Fisio →</button>
        </div>
        ${
          dossier.physio.episodes.length
            ? dossier.physio.episodes
                .map(
                  (ep) => `
                <div style="padding:8px 0; border-bottom:1px solid var(--border-color);">
                  <strong>${esc(ep.title)}</strong> <span class="badge badge-physio">${esc(ep.status)}</span>
                  <div style="font-size:12.5px; color:#475569;">Inizio: ${esc(ep.start_date)} · Valutazioni: ${ep.evaluations.length} · Note SOAP: ${ep.notes.length}</div>
                </div>
              `
                )
                .join("")
            : '<div style="color:#64748b;">Nessun episodio fisioterapico presente.</div>'
        }
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🏋️ Sintesi Area Fitness</h3>
          <button class="btn btn-sm btn-fitness" data-switch-tab="fitness">Vai all'Area Fitness →</button>
        </div>
        ${
          dossier.fitness.programs.length
            ? dossier.fitness.programs
                .map(
                  (fp) => `
                <div style="padding:8px 0; border-bottom:1px solid var(--border-color);">
                  <strong>${esc(fp.title)}</strong> <span class="badge badge-fitness">v${fp.version} · ${esc(fp.status)}</span>
                  <div style="font-size:12.5px; color:#475569;">Obiettivo: ${esc(fp.goal)} · Frequenza: ${fp.frequency_per_week}x/sett</div>
                </div>
              `
                )
                .join("")
            : '<div style="color:#64748b;">Nessun programma fitness presente.</div>'
        }
      </div>
    </div>
  `;

  document.getElementById("addSharedLimBtn")?.addEventListener("click", () => showAddSharedLimitationModal(p.id, dossier.physio.episodes));
  viewport.querySelectorAll("[data-switch-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.selectedPersonTab = btn.getAttribute("data-switch-tab");
      await refreshCurrentView();
    });
  });
}

// --- TAB 2: DATI ANAGRAFICI ---
function renderPersonTabAnagrafica(viewport, dossier) {
  const p = dossier.person;
  viewport.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">👤 Dati Anagrafici e Attivazione Percorsi (Versione record: v${p.version})</h3>
      </div>
      <form id="editPersonForm">
        <input type="hidden" name="expected_version" value="${p.version}" />
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
            <label class="form-label">Codice Fiscale / Dati Amm. (Facoltativo)</label>
            <input class="form-control" name="tax_code" value="${esc(p.tax_code || "")}" />
          </div>
        </div>
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">Indirizzo (Facoltativo)</label>
            <input class="form-control" name="address" value="${esc(p.address || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Professione</label>
            <input class="form-control" name="profession" value="${esc(p.profession || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Attività Sportiva Praticata</label>
            <input class="form-control" name="sport_activity" value="${esc(p.sport_activity || "")}" />
          </div>
        </div>
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">Percorsi Abilitati sull'Anagrafica Unica</label>
            <div style="display:flex; gap:16px; padding-top:8px;">
              <label style="display:flex; align-items:center; gap:6px; font-weight:600;">
                <input type="checkbox" name="physio_active" ${p.physio_active ? "checked" : ""} /> 🩺 Paziente Fisio
              </label>
              <label style="display:flex; align-items:center; gap:6px; font-weight:600;">
                <input type="checkbox" name="fitness_active" ${p.fitness_active ? "checked" : ""} /> 🏋️ Cliente Fitness
              </label>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Stato Scheda</label>
            <select class="form-control" name="status">
              <option value="attivo" ${p.status === "attivo" ? "selected" : ""}>Attivo</option>
              <option value="archiviato" ${p.status === "archiviato" ? "selected" : ""}>Archiviato</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Note Generali Condivise (non cliniche)</label>
          <textarea class="form-control" name="general_notes">${esc(p.general_notes || "")}</textarea>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:12px;">
          <span style="font-size:12px; color:#64748b;">Controllo concorrenza attivo: se un altro dispositivo modifica questa scheda, riceverai un avviso 409 senza perdere dati.</span>
          <button type="submit" class="btn btn-primary">💾 Salva Dati Anagrafici</button>
        </div>
      </form>
    </div>
  `;

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
        phone: fd.get("phone"),
        email: fd.get("email"),
        tax_code: fd.get("tax_code"),
        address: fd.get("address"),
        profession: fd.get("profession"),
        sport_activity: fd.get("sport_activity"),
        physio_active: fd.get("physio_active") === "on",
        fitness_active: fd.get("fitness_active") === "on",
        status: fd.get("status"),
        general_notes: fd.get("general_notes")
      }
    });
    await refreshCurrentView();
  });
}

// ============================================================================
// TAB 3: AREA FISIOTERAPIA (EPISODI, VALUTAZIONI, BODY MAP 2D, FLAGS, SCALE, SOAP)
// ============================================================================

function renderPersonTabFisio(viewport, dossier) {
  const p = dossier.person;
  const episodes = dossier.physio.episodes || [];
  if (!state.selectedEpisodeId || !episodes.some((e) => e.id === state.selectedEpisodeId)) {
    state.selectedEpisodeId = episodes.length ? episodes[0].id : null;
  }
  const activeEp = episodes.find((e) => e.id === state.selectedEpisodeId) || null;

  const epSelectOptions = episodes
    .map(
      (e) =>
        `<option value="${e.id}" ${e.id === state.selectedEpisodeId ? "selected" : ""}>#${e.id} — ${esc(e.title)} (${esc(e.status)} · dal ${esc(e.start_date)})</option>`
    )
    .join("");

  if (!activeEp) {
    viewport.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🩺 Area Fisioterapia</h3>
          <button class="btn btn-physio" id="createFirstEpisodeBtn">➕ Nuovo Episodio Fisioterapico</button>
        </div>
        <p style="color:#475569;">Nessun episodio clinico registrato per questa persona. Crea il primo episodio per compilare Prima Valutazione, Mappa del Dolore 2D, Red/Yellow Flags, Scale di Esito e Note SOAP.</p>
      </div>
    `;
    document.getElementById("createFirstEpisodeBtn")?.addEventListener("click", () => showNewPhysioEpisodeModal(p.id));
    return;
  }

  // Seleziona la valutazione da visualizzare nella Mappa del Dolore / Dettaglio
  const evals = activeEp.evaluations || [];
  if (!state.selectedEvalId || !evals.some((ev) => ev.id === state.selectedEvalId)) {
    state.selectedEvalId = evals.length ? evals[evals.length - 1].id : null;
  }
  const currentEval = evals.find((ev) => ev.id === state.selectedEvalId) || null;
  const previousEval = evals.length > 1 ? evals.find((ev) => ev.id !== (currentEval && currentEval.id)) : null;

  const fSum = activeEp.flag_summary || { red_present: 0, red_unassessed: 0, yellow_present: 0, yellow_unassessed: 0 };

  viewport.innerHTML = `
    <!-- Selettore Episodio e Azioni Rapide Episodio -->
    <div class="card" style="border-left: 5px solid var(--physio-accent);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div style="flex:1; min-width:260px;">
          <label class="form-label">Episodio Fisioterapico Selezionato</label>
          <select class="form-control" id="physioEpisodeSelect">${epSelectOptions}</select>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-physio" id="newPhysioEpisodeBtn">➕ Nuovo Episodio</button>
          <button class="btn btn-sm btn-secondary" id="newEvalModalBtn">🩺 Nuova Valutazione / Rivalutazione</button>
          <button class="btn btn-sm btn-secondary" id="newSoapNoteModalBtn">📝 Nuova Nota Seduta (SOAP)</button>
          <button class="btn btn-sm btn-secondary" id="shareLimFromPhysioBtn">🔗 Condividi Limitazione col Fitness</button>
          <button class="btn btn-sm btn-secondary" id="closeEpisodeModalBtn">🏁 Stato / Chiusura Percorso</button>
        </div>
      </div>
      <div style="margin-top:10px; font-size:13.5px; color:#334155;" class="sensitive-data">
        <strong>Problema principale:</strong> ${esc(activeEp.chief_complaint)}
        · <strong>Distretto:</strong> ${esc(activeEp.body_region || "-")} (${esc(activeEp.laterality)})
        · <strong>Rivalutazione prevista:</strong> <strong>${esc(activeEp.reassessment_due_date || "Non pianificata")}</strong>
        ${activeEp.closure_summary ? `<br><strong>Esito Chiusura:</strong> ${esc(activeEp.closure_outcome)} — ${esc(activeEp.closure_summary)}` : ""}
      </div>
    </div>

    <!-- SEZIONE A: VALUTAZIONI CLINICHE E MAPPA DEL CORPO 2D SVG INTERATTIVA -->
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">1. Prima Valutazione, Rivalutazioni e Mappa Interattiva del Corpo 2D</h3>
          <div style="font-size:12px; color:#64748b;">Ogni rilevazione conserva lo storico precedente per confrontare l'evoluzione.</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          ${
            evals.length
              ? `<select class="form-control" id="evalHistorySelect" style="width:auto;">
                  ${evals
                    .map(
                      (ev) =>
                        `<option value="${ev.id}" ${ev.id === (currentEval && currentEval.id) ? "selected" : ""}>
                          ${ev.eval_type === "prima_valutazione" ? "1ª Valutazione" : "Rivalutazione"} del ${esc(ev.eval_date)} (${esc(ev.status)})
                        </option>`
                    )
                    .join("")}
                </select>`
              : ""
          }
          ${
            currentEval && currentEval.status === "bozza"
              ? `<button class="btn btn-sm btn-primary" id="editCurrentEvalBtn">✏️ Modifica / Finalizza Bozza</button>`
              : ""
          }
          ${
            currentEval && currentEval.status === "finalizzata"
              ? `<button class="btn btn-sm btn-secondary" id="addEvalAddendumBtn">➕ Aggiungi Rettifica Datata</button>`
              : ""
          }
          <button class="btn btn-sm btn-physio" id="addReassessmentBtn">🔄 Registra Rivalutazione</button>
        </div>
      </div>

      ${
        currentEval
          ? renderEvaluationAndBodyMapSection(currentEval, previousEval)
          : `<div style="color:#64748b; padding:12px 0;">Nessuna valutazione ancora presente per questo episodio. Clicca su "Nuova Valutazione" per iniziare.</div>`
      }
    </div>

    <!-- SEZIONE B: RED FLAGS E YELLOW FLAGS STRUTTURATE -->
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">2. Red Flags &amp; Yellow Flags Documentate</h3>
          <div style="font-size:12px; color:#64748b;">
            Stati distinti: <strong>Presente</strong>, <strong>Assente</strong>, <strong>Non valutato</strong>.
            <em>L'assenza di una segnalazione non costituisce diagnosi automatica né conferma automatica di sicurezza.</em>
          </div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <span class="badge ${fSum.red_present > 0 ? "badge-danger" : "badge-success"}">Red Flags presenti: ${fSum.red_present}</span>
          <span class="badge ${fSum.red_unassessed + fSum.yellow_unassessed > 0 ? "badge-warning" : "badge-neutral"}">
            Ancora da approfondire (Non valutati): ${fSum.red_unassessed + fSum.yellow_unassessed}
          </span>
          <button class="btn btn-sm btn-secondary" id="addCustomFlagBtn">➕ Aggiungi Flag Personalizzata</button>
        </div>
      </div>
      ${renderClinicalFlagsTable(activeEp.flags)}
    </div>

    <!-- SEZIONE C: SCALE E MISURE DI ESITO (CON VERIFICA VERSIONE E CONFRONTO) -->
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">3. Scale e Misure di Esito (Confronto Longitudinale per Stessa Versione)</h3>
          <div style="font-size:12px; color:#64748b;">
            Un dato mancante non equivale a zero. Una variazione numerica non equivale automaticamente a un miglioramento clinicamente significativo.
          </div>
        </div>
        <button class="btn btn-sm btn-physio" id="recordOutcomeMeasureBtn">📏 Registra Misura (NPRS, PSFS, ODI, QuickDASH, LEFS...)</button>
      </div>
      ${renderOutcomeMeasuresSection(activeEp.outcome_comparisons, activeEp.outcome_measures)}
    </div>

    <!-- SEZIONE D: SEDUTE SUCCESSIVE (NOTE SOAP, BOZZE, RICHIAMO PRECEDENTE E RETTIFICHE DATATE) -->
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">4. Sedute Successive — Note Strutturate SOAP</h3>
          <div style="font-size:12px; color:#64748b;">
            Puoi salvare in bozza, richiamare una nota precedente conservando la data d'origine, o aggiungere rettifiche datate alle note finalizzate.
          </div>
        </div>
        <div style="display:flex; gap:8px;">
          ${
            activeEp.notes.length
              ? `<button class="btn btn-sm btn-secondary" id="copyPrevNoteAsDraftBtn">📋 Richiama ultima nota come bozza</button>`
              : ""
          }
          <button class="btn btn-sm btn-primary" id="newSoapNoteBtn2">➕ Nuova Nota SOAP</button>
        </div>
      </div>
      ${renderClinicalNotesList(activeEp.notes)}
    </div>
  `;

  // Event listeners Area Fisio
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
  document.getElementById("newEvalModalBtn")?.addEventListener("click", () =>
    showEvaluationModal(activeEp, null, "prima_valutazione")
  );
  document.getElementById("addReassessmentBtn")?.addEventListener("click", () =>
    showEvaluationModal(activeEp, null, "rivalutazione")
  );
  document.getElementById("editCurrentEvalBtn")?.addEventListener("click", () =>
    showEvaluationModal(activeEp, currentEval, currentEval.eval_type)
  );
  document.getElementById("addEvalAddendumBtn")?.addEventListener("click", () =>
    showAddendumModal({ evaluation_id: currentEval.id, title: `Valutazione del ${currentEval.eval_date}` })
  );
  document.getElementById("newSoapNoteModalBtn")?.addEventListener("click", () => showSoapNoteModal(activeEp, null));
  document.getElementById("newSoapNoteBtn2")?.addEventListener("click", () => showSoapNoteModal(activeEp, null));
  document.getElementById("copyPrevNoteAsDraftBtn")?.addEventListener("click", () =>
    showSoapNoteModal(activeEp, null, activeEp.notes[0])
  );
  document.getElementById("shareLimFromPhysioBtn")?.addEventListener("click", () =>
    showAddSharedLimitationModal(p.id, episodes, activeEp.id)
  );
  document.getElementById("closeEpisodeModalBtn")?.addEventListener("click", () => showCloseEpisodeModal(activeEp));
  document.getElementById("addCustomFlagBtn")?.addEventListener("click", () => showCustomFlagModal(activeEp.id));
  document.getElementById("recordOutcomeMeasureBtn")?.addEventListener("click", () =>
    showRecordOutcomeModal(activeEp.id, currentEval ? currentEval.id : null)
  );

  // Eventi per aggiornare stato flags direttamente in tabella
  viewport.querySelectorAll("[data-edit-flag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fid = Number(btn.getAttribute("data-edit-flag"));
      const fl = activeEp.flags.find((x) => x.id === fid);
      if (fl) showEditFlagModal(fl);
    });
  });

  // Eventi per modificare bozza SOAP o aggiungere rettifica datata
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
      if (note) showAddendumModal({ note_id: note.id, title: `Nota SOAP del ${note.note_date}` });
    });
  });
}

function renderEvaluationAndBodyMapSection(ev, prevEval) {
  const measRows = (ev.objective_measurements || [])
    .map(
      (m) =>
        `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(m.value)} ${esc(m.unit)}</td><td><span class="badge badge-neutral">${esc(m.side)}</span></td><td>${esc(m.notes || "-")}</td></tr>`
    )
    .join("");

  const markers = ev.body_map_markers || [];
  const prevMarkers = prevEval ? prevEval.body_map_markers || [] : [];

  const accessibleMarkersTable = markers
    .map(
      (m, i) => `
      <tr>
        <td>#${i + 1} (${m.view_side === "anterior" ? "Anteriore" : "Posteriore"})</td>
        <td><strong>${esc(m.anatomical_region)}</strong></td>
        <td><span class="badge badge-physio">${esc(m.laterality)}</span></td>
        <td>${esc(m.symptom_type)} (${m.marker_kind === "area" ? "Area" : "Punto"})</td>
        <td><strong>${m.intensity}/10</strong></td>
        <td class="sensitive-data">${esc(m.notes || "-")}</td>
      </tr>
    `
    )
    .join("");

  const addendaHtml = (ev.addenda || [])
    .map(
      (a) => `
      <div style="background:#fffbeb; border-left:4px solid #d97706; padding:8px 12px; margin-top:8px; font-size:13px;">
        <strong>📌 Rettifica/Integrazione datata (${esc(formatRomeDateTime(a.created_at))} — ${esc(a.author_name)}):</strong>
        Motivo: <em>${esc(a.reason)}</em><br>${esc(a.addendum_text)}
      </div>
    `
    )
    .join("");

  return `
    <div style="margin-bottom:12px;">
      <span class="badge ${ev.eval_type === "prima_valutazione" ? "badge-physio" : "badge-success"}">
        ${ev.eval_type === "prima_valutazione" ? "1ª VALUTAZIONE INIZIALE" : "RIVALUTAZIONE"}
      </span>
      <span class="badge ${ev.status === "finalizzata" ? "badge-success" : "badge-warning"}" style="margin-left:6px;">
        ${ev.status === "finalizzata" ? `🔒 Finalizzata (${esc(formatRomeDateTime(ev.finalized_at))})` : "✏️ In Bozza"}
      </span>
      <span style="font-size:13px; color:#64748b; margin-left:8px;">Data: <strong>${esc(ev.eval_date)}</strong> · Versione: v${ev.version}</span>
    </div>

    <div class="grid-2 sensitive-data" style="margin-bottom:14px;">
      <div style="background:var(--bg-subtle); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
        <h4 style="margin:0 0 8px 0;">Anamnesi e Comportamento dei Sintomi</h4>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Motivo consultazione:</strong> ${esc(ev.consult_reason || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Obiettivi e attività importanti:</strong> ${esc(ev.patient_goals || "-")} | ${esc(ev.important_activities || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Esordio e distribuzione:</strong> ${esc(ev.symptom_onset || "-")} — ${esc(ev.symptom_distribution || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Comportamento e 24h:</strong> ${esc(ev.symptom_behavior || "-")} | 24h: ${esc(ev.pattern_24h || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Fattori Aggravanti / Allevianti:</strong> ⬆️ ${esc(ev.aggravating_factors || "-")} | ⬇️ ${esc(ev.easing_factors || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Storia clinica, traumi, farmaci, imaging:</strong> ${esc(ev.medical_history || "-")} | ${esc(ev.surgeries_traumas || "-")} | ${esc(ev.imaging_reports || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Sonno, carico lavoro/sport e psicosociale:</strong> ${esc(ev.sleep_quality || "-")} | ${esc(ev.work_sport_load || "-")} | ${esc(ev.psychosocial_factors || "-")}</p>
      </div>

      <div style="background:var(--bg-subtle); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
        <h4 style="margin:0 0 8px 0;">Esame Obiettivo e Ragionamento Clinico</h4>
        <div class="table-wrap" style="margin-bottom:8px;">
          <table class="data-table">
            <thead><tr><th>Parametro / Movimento</th><th>Misura</th><th>Lato</th><th>Osservazioni</th></tr></thead>
            <tbody>${measRows || '<tr><td colspan="4">Nessuna misurazione tabellare</td></tr>'}</tbody>
          </table>
        </div>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Test speciali &amp; Osservazioni:</strong> ${esc(ev.special_tests || "-")} | ${esc(ev.clinical_observations || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Ragionamento clinico del professionista:</strong> ${esc(ev.clinical_reasoning || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Piano terapeutico &amp; Indicazioni:</strong> ${esc(ev.treatment_plan || "-")} | ${esc(ev.home_advice || "-")}</p>
      </div>
    </div>

    ${addendaHtml}

    <!-- Vista Doppia Mappa del Corpo (Anteriore + Posteriore) + Alternativa Testuale Accessibile -->
    <div style="background:var(--bg-subtle); padding:14px; border-radius:10px; border:1px solid var(--border-strong); margin-top:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
        <h4 style="margin:0;">🧍 Mappa Anatomica del Corpo 2D (Vista Anteriore &amp; Posteriore con Lateralità Esplicita)</h4>
        ${
          prevEval
            ? `<span class="badge badge-neutral">Confronto attivo: tratteggio grigio = rilevazione del ${esc(prevEval.eval_date)}</span>`
            : ""
        }
      </div>
      <div class="grid-2">
        <div class="body-map-stage">
          ${renderBodySvgMarkup("anterior", markers, prevMarkers)}
        </div>
        <div class="body-map-stage">
          ${renderBodySvgMarkup("posterior", markers, prevMarkers)}
        </div>
      </div>

      <h5 style="margin:14px 0 6px 0;">Alternativa Testuale Accessibile — Elenco Punti e Aree Segnate (${markers.length})</h5>
      <div class="table-wrap">
        <table class="data-table" aria-label="Elenco testuale accessibile dei marcatori sulla mappa del corpo">
          <thead>
            <tr><th>Vista</th><th>Regione Anatomica</th><th>Lateralità</th><th>Tipo Sintomo</th><th>Intensità</th><th>Note</th></tr>
          </thead>
          <tbody>
            ${accessibleMarkersTable || '<tr><td colspan="6">Nessun punto o area registrata su questa mappa.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderClinicalFlagsTable(flags) {
  const rows = (flags || [])
    .map((f) => {
      const typeBadge =
        f.flag_type === "red"
          ? `<span class="badge badge-danger">🚩 RED FLAG</span>`
          : `<span class="badge badge-warning">⚠️ YELLOW FLAG</span>`;
      let statusBadge = `<span class="badge badge-warning">❓ NON VALUTATO (Da approfondire)</span>`;
      if (f.status === "assente") {
        statusBadge = `<span class="badge badge-success">✓ Assente</span>`;
      } else if (f.status === "presente") {
        statusBadge = `<span class="badge badge-danger">❗ PRESENTE</span>`;
      }
      return `
        <tr style="${f.status === "non_valutato" ? "background:#fffbeb;" : f.status === "presente" ? "background:#fef2f2;" : ""}">
          <td>${typeBadge}<div style="font-size:11px; color:#64748b; margin-top:2px;">${esc(f.category)}</div></td>
          <td>
            <strong>${esc(f.item_label)}</strong>
            <div style="font-size:11px; color:#64748b;">Fonte: ${esc(f.guideline_source)} (${esc(f.guideline_version)})</div>
          </td>
          <td>${statusBadge}</td>
          <td class="sensitive-data" style="font-size:12.5px;">
            <strong>Note:</strong> ${esc(f.notes || "-")}<br>
            <strong>Fonte dato:</strong> ${esc(f.source_info || "-")} (${esc(f.recorded_date)})<br>
            <strong>Azione intrapresa:</strong> ${esc(f.action_taken || "-")}
          </td>
          <td style="text-align:right;">
            <button class="btn btn-sm btn-secondary" data-edit-flag="${f.id}">Aggiorna</button>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr><th>Tipologia</th><th>Elemento / Criterio di Screening</th><th>Stato Rilevato</th><th>Note, Fonte e Azione del Professionista</th><th style="text-align:right;">Azione</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderOutcomeMeasuresSection(comparisons, allMeasures) {
  const compCards = (comparisons || [])
    .map((c) => {
      const seriesPoints = c.series
        .map(
          (s) =>
            `<span class="badge badge-neutral" style="margin-right:4px;">${esc(s.recorded_date)}: <strong>${s.score_value}${esc(s.score_unit)}</strong> ${s.missing_items > 0 ? `(mancanti: ${s.missing_items})` : ""}</span>`
        )
        .join(" → ");
      const deltaStr =
        c.numeric_delta !== null ? (c.numeric_delta > 0 ? `+${c.numeric_delta}` : `${c.numeric_delta}`) : "N/A (1 sola rilevazione)";
      return `
        <div style="padding:10px 12px; border:1px solid var(--border-color); border-radius:8px; margin-bottom:10px; background:var(--bg-subtle);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <strong>${esc(c.scale_name)}</strong>
              <span class="badge badge-physio" style="margin-left:6px;">Versione: ${esc(c.scale_version)}</span>
            </div>
            <div>
              Variazione numerica (stessa versione): <strong>${esc(deltaStr)} ${esc(c.score_unit)}</strong>
            </div>
          </div>
          <div style="margin-top:8px;">${seriesPoints}</div>
          <div style="font-size:11.5px; color:#64748b; margin-top:6px;">ℹ️ ${esc(c.clinical_warning)}</div>
        </div>
      `;
    })
    .join("");

  return compCards || '<div style="color:#64748b;">Nessuna scala di esito ancora registrata per questo episodio.</div>';
}

function renderClinicalNotesList(notes) {
  if (!notes || !notes.length) {
    return '<div style="color:#64748b;">Nessuna nota di seduta successiva registrata.</div>';
  }
  return notes
    .map((n) => {
      const addenda = (n.addenda || [])
        .map(
          (a) => `
          <div style="background:#fffbeb; border-left:3px solid #d97706; padding:6px 10px; margin-top:6px; font-size:12.5px;">
            <strong>📌 Rettifica datata (${esc(formatRomeDateTime(a.created_at))}):</strong> ${esc(a.addendum_text)} <em>(Motivo: ${esc(a.reason)})</em>
          </div>
        `
        )
        .join("");

      return `
        <div style="border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:10px; background:var(--bg-surface);">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
            <div>
              <strong>Seduta del ${esc(n.note_date)}</strong>
              <span class="badge ${n.status === "finalizzata" ? "badge-success" : "badge-warning"}" style="margin-left:6px;">
                ${n.status === "finalizzata" ? "🔒 Finalizzata" : "✏️ Bozza"}
              </span>
              ${
                n.copied_from_note_id
                  ? `<span class="badge badge-neutral" style="margin-left:6px;">Richiamata da nota del ${esc(n.copied_from_date || "#" + n.copied_from_note_id)}</span>`
                  : ""
              }
              ${
                n.pain_pre !== null || n.pain_post !== null
                  ? `<span class="badge badge-physio" style="margin-left:6px;">Dolore Pre/Post: ${n.pain_pre ?? "-"} → ${n.pain_post ?? "-"}/10</span>`
                  : ""
              }
            </div>
            <div>
              ${
                n.status === "bozza"
                  ? `<button class="btn btn-sm btn-primary" data-edit-soap="${n.id}">✏️ Modifica / Finalizza Bozza</button>`
                  : `<button class="btn btn-sm btn-secondary" data-addendum-soap="${n.id}">➕ Rettifica/Integrazione datata</button>`
              }
            </div>
          </div>
          <div class="grid-2 sensitive-data" style="font-size:13.5px;">
            <div>
              <strong>S (Risposta seduta prec. / Soggettivo):</strong> ${esc(n.subjective_response || "-")}<br>
              <strong>O (Esame / Osservazioni):</strong> ${esc(n.objective_findings || "-")}
            </div>
            <div>
              <strong>A (Interventi &amp; Esercizi svolti):</strong> ${esc(n.interventions_performed || "-")} | ${esc(n.exercises_performed || "-")}<br>
              <strong>P (Prossimi passi):</strong> ${esc(n.plan_next_steps || "-")}
            </div>
          </div>
          ${addenda}
        </div>
      `;
    })
    .join("");
}

// ============================================================================
// TAB 4: AREA FITNESS (PROFILO, LIMITAZIONI CONDIVISE, PROGRAMMI VERSIONATI, SEDUTE)
// ============================================================================

function renderPersonTabFitness(viewport, dossier) {
  const p = dossier.person;
  const prof = dossier.fitness.profile || {};
  const programs = dossier.fitness.programs || [];
  const logs = dossier.fitness.workout_logs || [];
  const metrics = dossier.fitness.metrics || [];
  const activeLims = (dossier.shared_limitations || []).filter((l) => l.is_active);

  const limsBannerHtml = activeLims.length
    ? activeLims
        .map(
          (l) => `
        <div style="background:#fffbeb; border-left:4px solid #d97706; padding:10px 12px; border-radius:6px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
            <strong style="color:#92400e;">⚠️ Limitazione Rilevante: ${esc(l.title)} (${esc(l.laterality)})</strong>
            <span class="badge badge-warning">Fonte: ${esc(l.source_type)} · Data: ${esc(l.recorded_date)}</span>
          </div>
          <div style="font-size:13.5px; margin-top:4px;" class="sensitive-data">${esc(l.description)}</div>
        </div>
      `
        )
        .join("")
    : '<div style="color:#64748b; font-size:13.5px;">Nessuna limitazione clinica condivisa attiva.</div>';

  const programsHtml = programs
    .map((prog) => {
      const daysHtml = (prog.workouts || [])
        .map(
          (d, dIdx) => `
          <div style="background:var(--bg-subtle); border:1px solid var(--border-color); border-radius:8px; padding:10px; margin-top:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <strong>🏋️ ${esc(d.day_name)}</strong>
              <button class="btn btn-sm btn-fitness" data-log-workout-prog="${prog.id}" data-day-idx="${dIdx}">⚡ Registra Seduta Svolta su questa scheda</button>
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Esercizio</th><th>Serie</th><th>Ripetizioni</th><th>Carico Prog.</th><th>Recupero</th><th>RPE/RIR</th><th>Note</th></tr></thead>
                <tbody>
                  ${(d.exercises || [])
                    .map(
                      (ex) =>
                        `<tr><td><strong>${esc(ex.name)}</strong></td><td>${esc(ex.sets)}</td><td>${esc(ex.reps)}</td><td>${esc(ex.load)}</td><td>${esc(ex.rest || "-")}</td><td>${esc(ex.rpe || "-")}</td><td>${esc(ex.notes || "-")}</td></tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        `
        )
        .join("");

      const historyPills = (prog.version_history || [])
        .map(
          (vh) =>
            `<span class="badge badge-neutral" style="margin-right:4px;">v${vh.version_number} (${esc(vh.saved_at.slice(0, 10))}: ${esc(vh.change_note || "modifica")})</span>`
        )
        .join("");

      return `
        <div class="card" style="border-left:5px solid var(--fitness-accent);">
          <div class="card-header">
            <div>
              <h4 style="margin:0; font-size:17px;">${esc(prog.title)} <span class="badge badge-fitness">Versione v${prog.version} · ${esc(prog.status)}</span></h4>
              <div style="font-size:13px; color:#475569;">Obiettivo: ${esc(prog.goal)} · Fase: ${esc(prog.phase_name || "-")} · Dal ${esc(prog.start_date)}</div>
            </div>
            <button class="btn btn-sm btn-secondary" data-edit-program="${prog.id}">✏️ Modifica Programma (Salva nuova versione)</button>
          </div>
          ${daysHtml}
          <div style="margin-top:10px; font-size:12px; color:#64748b;">
            📜 <strong>Storico Versioni Conservate:</strong> ${historyPills}
          </div>
        </div>
      `;
    })
    .join("");

  const logsHtml = logs
    .map((wl) => {
      const compRows = (wl.actual_exercises || [])
        .map((act, idx) => {
          const plan = (wl.planned_exercises || [])[idx] || {};
          return `
            <tr>
              <td><strong>${esc(act.name || plan.name)}</strong></td>
              <td style="color:#64748b;">${esc(plan.sets || "-")} × ${esc(plan.reps || "-")} @ ${esc(plan.load || "-")} (RPE ${esc(plan.rpe || "-")})</td>
              <td style="font-weight:700; color:var(--primary);">${esc(act.sets)} × ${esc(act.reps)} @ ${esc(act.load)} (RPE ${esc(act.rpe || "-")})</td>
            </tr>
          `;
        })
        .join("");

      return `
        <div style="border:1px solid var(--border-color); border-radius:8px; padding:12px; margin-bottom:10px; background:var(--bg-surface);">
          <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">
            <div>
              <strong>✅ ${esc(wl.workout_day_name)}</strong> — Data: <strong>${esc(wl.session_date)}</strong>
              <span class="badge badge-fitness" style="margin-left:6px;">Programma v${wl.program_version}</span>
              ${wl.session_rpe ? `<span class="badge badge-neutral">RPE Seduta: ${wl.session_rpe}/10</span>` : ""}
            </div>
            ${
              wl.reported_symptoms
                ? `<span class="badge badge-warning">⚠️ Sintomi segnalati (${wl.symptom_severity}/10)</span>`
                : `<span class="badge badge-success">Nessun sintomo anomalo</span>`
            }
          </div>
          <div class="table-wrap" style="margin:8px 0;">
            <table class="data-table">
              <thead><tr><th>Esercizio</th><th>Programmato</th><th>Effettivamente Svolto</th></tr></thead>
              <tbody>${compRows}</tbody>
            </table>
          </div>
          <div style="font-size:13px; color:#334155;" class="sensitive-data">
            <strong>Risposta del cliente:</strong> ${esc(wl.client_feedback || "-")}
            ${wl.reported_symptoms ? `<br><strong style="color:#b45309;">Sintomi emersi:</strong> ${esc(wl.reported_symptoms)}` : ""}
            <br><strong>Indicazioni per la prossima seduta:</strong> ${esc(wl.next_session_notes || "-")}
          </div>
        </div>
      `;
    })
    .join("");

  viewport.innerHTML = `
    <!-- Barra Collegamento Rapido al Percorso Fisio + Limitazioni Condivise -->
    <div class="card" style="background:#fffbeb; border-color:#fcd34d;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:8px;">
        <h3 style="margin:0; font-size:16px;">🔗 Limitazioni Rilevanti dal Percorso Fisioterapico (con Fonte e Data)</h3>
        <button class="btn btn-sm btn-physio" id="jumpToPhysioFromFitnessBtn">🩺 Apri Percorso Fisio della Persona</button>
      </div>
      ${limsBannerHtml}
    </div>

    <!-- Profilo Fitness e Test / Misurazioni -->
    <div class="grid-2">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🎯 Profilo Fitness, Esperienza e Attrezzatura</h3>
          <button class="btn btn-sm btn-secondary" id="editFitnessProfileBtn">✏️ Modifica Profilo</button>
        </div>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Obiettivi primari:</strong> ${esc(prof.primary_goals || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Esperienza:</strong> ${esc(prof.experience_level || "-")} · <strong>Disponibilità:</strong> ${esc(prof.weekly_availability || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Preferenze:</strong> ${esc(prof.preferences || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Attrezzatura disponibile:</strong> ${esc(prof.available_equipment || "-")}</p>
        <p style="margin:4px 0; font-size:13.5px;"><strong>Valutazione iniziale fitness:</strong> ${esc(prof.initial_assessment_notes || "-")}</p>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">📈 Test Fisici e Misurazioni nel Tempo</h3>
          <button class="btn btn-sm btn-secondary" id="addFitnessMetricBtn">➕ Nuovo Test / Misura</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Data</th><th>Parametro / Test</th><th>Valore</th><th>Lato / Note</th></tr></thead>
            <tbody>
              ${
                metrics
                  .map(
                    (m) =>
                      `<tr><td>${esc(m.recorded_date)}</td><td><strong>${esc(m.metric_name)}</strong> (${esc(m.metric_category)})</td><td><strong>${m.value_num} ${esc(m.unit)}</strong></td><td>${esc(m.side)} · ${esc(m.protocol_notes || "")}</td></tr>`
                  )
                  .join("") || '<tr><td colspan="4">Nessuna misurazione registrata.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Programmi di Allenamento -->
    <div style="display:flex; justify-content:space-between; align-items:center; margin:14px 0 10px 0;">
      <h3 style="margin:0;">📋 Programmi di Allenamento (con Storico Versioni)</h3>
      <button class="btn btn-fitness" id="newFitnessProgramBtn">➕ Nuovo Programma Fitness</button>
    </div>
    ${programsHtml || '<div class="card">Nessun programma fitness creato.</div>'}

    <!-- Storico Sedute Svolte vs Programmate -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">⚡ Storico Sedute Allenamento (Programmato vs Effettivamente Svolto)</h3>
        <button class="btn btn-sm btn-fitness" id="quickLogWorkoutBtn">➕ Registra Seduta Veloce</button>
      </div>
      ${logsHtml || '<div style="color:#64748b;">Nessuna seduta fitness ancora registrata.</div>'}
    </div>
  `;

  document.getElementById("jumpToPhysioFromFitnessBtn")?.addEventListener("click", async () => {
    state.selectedPersonTab = "fisio";
    await refreshCurrentView();
  });
  document.getElementById("editFitnessProfileBtn")?.addEventListener("click", () =>
    showEditFitnessProfileModal(p.id, prof)
  );
  document.getElementById("addFitnessMetricBtn")?.addEventListener("click", () => showAddFitnessMetricModal(p.id));
  document.getElementById("newFitnessProgramBtn")?.addEventListener("click", () => showFitnessProgramModal(p.id, null));
  document.getElementById("quickLogWorkoutBtn")?.addEventListener("click", () =>
    showWorkoutLogModal(p.id, programs[0] || null, 0)
  );

  viewport.querySelectorAll("[data-edit-program]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = Number(btn.getAttribute("data-edit-program"));
      const prog = programs.find((x) => x.id === pid);
      if (prog) showFitnessProgramModal(p.id, prog);
    });
  });

  viewport.querySelectorAll("[data-log-workout-prog]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = Number(btn.getAttribute("data-log-workout-prog"));
      const dIdx = Number(btn.getAttribute("data-day-idx") || 0);
      const prog = programs.find((x) => x.id === pid);
      if (prog) showWorkoutLogModal(p.id, prog, dIdx);
    });
  });
}

// ============================================================================
// TAB 5: APPUNTAMENTI DELLA PERSONA
// ============================================================================

function renderPersonTabAppuntamenti(viewport, dossier) {
  const p = dossier.person;
  const rows = (dossier.appointments || [])
    .map(
      (a) => `
      <tr>
        <td><strong>${esc(formatRomeDateTime(a.start_at))}</strong> (${a.duration_minutes} min)</td>
        <td><span class="badge ${a.service_area === "fisio" ? "badge-physio" : "badge-fitness"}">${esc(a.service_area.toUpperCase())}</span> ${esc(a.service_name)}</td>
        <td>${a.package_id ? `Pacchetto #${a.package_id}` : `<span class="badge badge-warning">Fuori pacchetto</span>`}</td>
        <td>${renderApptStatusBadge(a.status)}</td>
        <td style="text-align:right;">
          <button class="btn btn-sm btn-secondary" data-open-appt-drawer="${a.id}">Gestisci Seduta</button>
        </td>
      </tr>
    `
    )
    .join("");

  viewport.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h3 class="card-title">📅 Storico e Prossimi Appuntamenti di ${esc(p.first_name)} ${esc(p.last_name)}</h3>
        <button class="btn btn-sm btn-primary" id="personNewApptBtn">➕ Nuovo Appuntamento</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Data e Ora (Europe/Rome)</th><th>Servizio</th><th>Associazione Pacchetto</th><th>Stato</th><th style="text-align:right;">Azione</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">Nessun appuntamento registrato.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById("personNewApptBtn")?.addEventListener("click", () => showNewAppointmentModal(p.id));
  bindCommonActionButtons(viewport);
}

// ============================================================================
// TAB 6: PACCHETTI, PRESENZE E PAGAMENTI (SALDO SEDUTE != SALDO ECONOMICO)
// ============================================================================

function renderPersonTabPacchetti(viewport, dossier) {
  const p = dossier.person;
  const packages = dossier.packages || [];

  const pkgCards = packages
    .map((pkg) => {
      const movRows = (pkg.movements || [])
        .map(
          (m) => `
          <tr>
            <td>#${m.id} (${esc(formatRomeDateTime(m.created_at))})</td>
            <td>
              <span class="badge ${m.movement_type === "CONSUME" ? "badge-physio" : "badge-warning"}">
                ${m.movement_type === "CONSUME" ? "CONSUMO (-1 dal residuo)" : "STORNO TRACCIATO (+1 al residuo)"}
              </span>
            </td>
            <td>${esc(m.reason)} ${m.appointment_id ? `(Appuntamento #${m.appointment_id})` : ""}</td>
            <td style="font-family:monospace; font-size:11px;">${esc(m.idempotency_key)}</td>
          </tr>
        `
        )
        .join("");

      return `
        <div class="card" style="border-left:5px solid var(--primary);">
          <div class="card-header">
            <div>
              <h4 style="margin:0; font-size:17px;">🎟️ ${esc(pkg.name)} <span class="badge badge-neutral">${esc(pkg.status.toUpperCase())}</span></h4>
              <div style="font-size:12.5px; color:#64748b;">
                Acquistato il ${esc(pkg.purchased_date)} · Validità: ${esc(pkg.valid_until || "Illimitata")}
                · Politica disdetta tardiva: <strong>${esc(pkg.late_cancel_policy)}</strong> · Assenza: <strong>${esc(pkg.no_show_policy)}</strong>
              </div>
            </div>
            <div style="display:flex; gap:8px;">
              ${
                pkg.due_cents > 0
                  ? `<button class="btn btn-sm btn-primary" data-record-payment-pkg="${pkg.id}" data-person-id="${p.id}" data-due-cents="${pkg.due_cents}">💶 Registra Pagamento (${formatEur(pkg.due_cents)})</button>`
                  : `<span class="badge badge-success">✓ Interamente Saldato</span>`
              }
              <button class="btn btn-sm btn-secondary" data-pkg-suspend="${pkg.id}" data-pkg-status="${pkg.status}">
                ${pkg.status === "sospeso" ? "▶️ Riattiva" : "⏸️ Sospendi"}
              </button>
            </div>
          </div>

          <!-- Relazione Matematica Chiara tra i Valori del Pacchetto -->
          <div class="grid-4" style="margin-bottom:12px;">
            <div class="stat-card" style="background:var(--bg-subtle);">
              <div class="stat-label">1. Sedute Acquistate</div>
              <div class="stat-value">${pkg.total_sessions}</div>
              <div class="stat-sub">Capienza totale iniziale</div>
            </div>
            <div class="stat-card" style="background:var(--bg-subtle);">
              <div class="stat-label">2. Consumate (Svolte)</div>
              <div class="stat-value">${pkg.consumed_sessions}</div>
              <div class="stat-sub">Somma movimenti netti</div>
            </div>
            <div class="stat-card" style="background:#f0fdfa; border-color:#5eead4;">
              <div class="stat-label">3. Residue (${pkg.total_sessions} - ${pkg.consumed_sessions})</div>
              <div class="stat-value" style="color:var(--primary);">${pkg.remaining_sessions}</div>
              <div class="stat-sub">Di cui <strong>${pkg.reserved_sessions} riservate</strong> da prenotazioni</div>
            </div>
            <div class="stat-card" style="background:#eff6ff; border-color:#93c5fd;">
              <div class="stat-label">4. Disponibili per nuove prenotazioni</div>
              <div class="stat-value" style="color:#1d4ed8;">${pkg.available_to_book}</div>
              <div class="stat-sub">Residue (${pkg.remaining_sessions}) − Prenotate (${pkg.reserved_sessions})</div>
            </div>
          </div>

          <div style="background:var(--bg-subtle); padding:10px 12px; border-radius:8px; margin-bottom:10px; display:flex; justify-content:space-between; flex-wrap:wrap;" class="sensitive-data">
            <div><strong>Saldo Economico (distinto dal saldo sedute):</strong> Prezzo pattuito: <strong>${formatEur(pkg.price_cents)}</strong></div>
            <div>Incassato: <strong style="color:var(--success);">${formatEur(pkg.paid_cents)}</strong> · Residuo da incassare: <strong style="color:${pkg.due_cents > 0 ? "var(--danger)" : "var(--success)"};">${formatEur(pkg.due_cents)}</strong></div>
          </div>

          <details>
            <summary style="cursor:pointer; font-weight:600; font-size:13px; color:var(--primary);">
              📜 Mostra Movimenti Tracciati e Storni del Pacchetto (${pkg.movements.length})
            </summary>
            <div class="table-wrap" style="margin-top:8px;">
              <table class="data-table">
                <thead><tr><th>ID / Data</th><th>Tipo Movimento</th><th>Causale / Seduta Collegata</th><th>Chiave Idempotenza</th></tr></thead>
                <tbody>${movRows || '<tr><td colspan="4">Nessun movimento ancora registrato.</td></tr>'}</tbody>
              </table>
            </div>
          </details>
        </div>
      `;
    })
    .join("");

  viewport.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:12px;">
      <div>
        <h3 style="margin:0;">🎟️ Pacchetti, Saldi Sedute e Pagamenti</h3>
        <div style="font-size:12px; color:#64748b;">
          Riepilogo amministrativo gestionale interno (non costituisce fattura fiscale conforme; nessun dato di carte di pagamento viene memorizzato).
        </div>
      </div>
      <button class="btn btn-primary" id="personNewPkgBtn">➕ Vendi Nuovo Pacchetto</button>
    </div>
    ${pkgCards || '<div class="card">Nessun pacchetto acquistato da questa persona.</div>'}
  `;

  document.getElementById("personNewPkgBtn")?.addEventListener("click", () => showNewPackageModal(p.id));
  viewport.querySelectorAll("[data-pkg-suspend]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pkgId = Number(btn.getAttribute("data-pkg-suspend"));
      const curSt = btn.getAttribute("data-pkg-status");
      const nextSt = curSt === "sospeso" ? "attivo" : "sospeso";
      await apiFetch(`/api/packages/${pkgId}/status`, {
        method: "POST",
        body: { status: nextSt, reason: "Variazione stato manuale dalla scheda" }
      });
      await refreshCurrentView();
    });
  });
  bindCommonActionButtons(viewport);
}

// ============================================================================
// TAB 7: DOCUMENTI, INFORMATIVE PRIVACY E ALLEGATI PRIVATI AUTENTICATI
// ============================================================================

function renderPersonTabDocumenti(viewport, dossier) {
  const p = dossier.person;
  const consents = dossier.consents || [];
  const attachments = dossier.attachments || [];

  const consentRows = consents
    .map(
      (c) => `
      <tr>
        <td><strong>${esc(c.doc_type.replace(/_/g, " ").toUpperCase())}</strong></td>
        <td>${esc(c.doc_version)}</td>
        <td><span class="badge ${c.status === "acquisito" ? "badge-success" : "badge-danger"}">${esc(c.status)}</span></td>
        <td>${esc(c.signed_date || "-")}</td>
        <td>${esc(c.acquisition_method)}</td>
        <td>${esc(c.notes || "-")}</td>
      </tr>
    `
    )
    .join("");

  const attRows = attachments
    .map(
      (a) => `
      <tr>
        <td><strong>${esc(a.original_filename)}</strong><div style="font-size:11px; color:#64748b;">SHA256: ${esc(a.sha256_hash.slice(0, 16))}...</div></td>
        <td><span class="badge badge-neutral">${esc(a.category)}</span></td>
        <td>${(a.size_bytes / 1024).toFixed(1)} KB (${esc(a.mime_type)})</td>
        <td class="sensitive-data">${esc(a.description || "-")}</td>
        <td>${esc(formatRomeDateTime(a.uploaded_at))}</td>
        <td style="text-align:right;">
          <a class="btn btn-sm btn-secondary" href="${esc(buildAuthUrl(`/attachments/${a.id}`))}" target="_blank">🔒 Apri Allegato Autenticato</a>
        </td>
      </tr>
    `
    )
    .join("");

  viewport.innerHTML = `
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">🛡️ Gestione Distinta Informative Privacy e Consenso al Trattamento Sanitario</h3>
          <div style="font-size:12px; color:#64748b;">
            Una semplice casella spuntata non basta a dimostrare conformità: registra versione documento, data, modalità di acquisizione e allegato firmato.
          </div>
        </div>
        <button class="btn btn-sm btn-primary" id="addConsentBtn">➕ Registra Informativa / Consenso</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Tipologia Documento</th><th>Versione</th><th>Stato</th><th>Data Firma</th><th>Modalità Acquisizione</th><th>Note</th></tr></thead>
          <tbody>${consentRows || '<tr><td colspan="6">Nessun documento di consenso registrato.</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">📎 Allegati Privati (PDF e Immagini con Accesso Autenticato)</h3>
          <div style="font-size:12px; color:#64748b;">
            Custoditi fuori dalla cartella pubblica; ogni lettura richiede sessione autenticata ed è tracciata nell'audit log.
          </div>
        </div>
        <button class="btn btn-sm btn-primary" id="uploadAttachmentBtn">⬆️ Carica PDF / Immagine</button>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>File</th><th>Categoria</th><th>Dimensione</th><th>Descrizione</th><th>Data Caricamento</th><th style="text-align:right;">Accesso</th></tr></thead>
          <tbody>${attRows || '<tr><td colspan="6">Nessun allegato privato caricato.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("addConsentBtn")?.addEventListener("click", () => showAddConsentModal(p.id));
  document.getElementById("uploadAttachmentBtn")?.addEventListener("click", () => showUploadAttachmentModal(p.id));
}

// --- TAB 8: CRONOLOGIA OPERAZIONI (AUDIT LOG) ---
function renderPersonTabCronologia(viewport, dossier) {
  const rows = (dossier.audit_history || [])
    .map(
      (a) => `
      <tr>
        <td>${esc(formatRomeDateTime(a.timestamp))}</td>
        <td><span class="badge badge-neutral">${esc(a.action)}</span></td>
        <td>${esc(a.actor)}</td>
        <td class="sensitive-data">${esc(a.summary)}</td>
      </tr>
    `
    )
    .join("");

  viewport.innerHTML = `
    <div class="card">
      <div class="card-header"><h3 class="card-title">🕒 Cronologia Tracciata delle Operazioni Rilevanti</h3></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Data e Ora (Europe/Rome)</th><th>Operazione</th><th>Operatore</th><th>Dettaglio</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">Nessuna operazione registrata.</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ============================================================================
// 4. VISTA AGENDA UNIFICATA (GIORNO, SETTIMANA, MESE, LISTA IPHONE + DRAWER SEDUTA)
// ============================================================================

async function renderAgendaView(container) {
  const baseDate = new Date(`${state.agendaDate}T12:00:00`);
  let fromDate = state.agendaDate;
  let toDate = state.agendaDate;

  if (state.agendaViewMode === "week") {
    const dayOfWeek = (baseDate.getDay() + 6) % 7; // Lunedì = 0
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

  // Raggruppa per giorno YYYY-MM-DD
  const byDay = {};
  for (const a of appts) {
    const dKey = a.start_at.slice(0, 10);
    if (!byDay[dKey]) byDay[dKey] = [];
    byDay[dKey].push(a);
  }

  let calendarBodyHtml = "";
  if (state.agendaViewMode === "week") {
    const dayCols = [];
    const startMon = new Date(`${fromDate}T12:00:00`);
    for (let i = 0; i < 7; i++) {
      const cur = new Date(startMon);
      cur.setDate(startMon.getDate() + i);
      const dStr = cur.toISOString().slice(0, 10);
      const dayLabel = cur.toLocaleDateString("it-IT", { weekday: "short", day: "2-digit", month: "2-digit" });
      const dayItems = (byDay[dStr] || [])
        .map(
          (a) => `
          <div
            data-open-appt-drawer="${a.id}"
            style="padding:8px; margin-bottom:8px; border-radius:8px; cursor:pointer; border-left:4px solid ${a.service_area === "fisio" ? "var(--physio-accent)" : "var(--fitness-accent)"}; background:${a.status === "svolto" ? "#dcfce7" : "#f8fafc"}; border-top:1px solid #cbd5e1; border-right:1px solid #cbd5e1; border-bottom:1px solid #cbd5e1;"
          >
            <div style="font-size:12px; font-weight:700;">${formatRomeTime(a.start_at)} – ${formatRomeTime(a.end_at)}</div>
            <div style="font-weight:700; font-size:13.5px;" class="sensitive-data">${esc(a.first_name)} ${esc(a.last_name)}</div>
            <div style="font-size:11.5px; color:#475569;">${a.service_area === "fisio" ? "🩺" : "🏋️"} ${esc(a.service_name)}</div>
            <div style="margin-top:4px;">${renderApptStatusBadge(a.status)}</div>
          </div>
        `
        )
        .join("");
      dayCols.push(`
        <div style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:10px; padding:10px; min-height:220px;">
          <div style="font-weight:800; font-size:13px; padding-bottom:6px; margin-bottom:8px; border-bottom:2px solid ${dStr === state.agendaDate ? "var(--primary)" : "var(--border-color)"};">
            ${esc(dayLabel.toUpperCase())}
          </div>
          ${dayItems || '<div style="font-size:12px; color:#94a3b8;">Nessun impegno</div>'}
        </div>
      `);
    }
    calendarBodyHtml = `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(175px, 1fr)); gap:10px;">${dayCols.join("")}</div>`;
  } else {
    // Vista Giorno, Mese o Lista Giornaliera Mobile (iPhone)
    const sortedDays = Object.keys(byDay).sort();
    calendarBodyHtml = sortedDays.length
      ? sortedDays
          .map((dKey) => {
            const listItems = byDay[dKey]
              .map(
                (a) => `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:12px; border:1px solid var(--border-color); border-radius:10px; margin-bottom:8px; background:var(--bg-surface);">
                  <div>
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                      <strong style="font-size:16px;">🕒 ${formatRomeTime(a.start_at)} – ${formatRomeTime(a.end_at)}</strong>
                      <span class="badge ${a.service_area === "fisio" ? "badge-physio" : "badge-fitness"}">
                        ${a.service_area === "fisio" ? "🩺 FISIO" : "🏋️ FITNESS"}
                      </span>
                      ${renderApptStatusBadge(a.status)}
                      ${a.recurrence_group_id ? `<span class="badge badge-neutral">🔁 Ricorrente</span>` : ""}
                    </div>
                    <div style="font-size:16px; font-weight:700; margin-top:4px;" class="sensitive-data">
                      ${esc(a.first_name)} ${esc(a.last_name)} — <span style="font-weight:500;">${esc(a.service_name)}</span>
                    </div>
                    <div style="font-size:12.5px; color:#64748b;">
                      📍 ${esc(a.location)} · ${a.package_name ? `🎟️ ${esc(a.package_name)}` : "Fuori pacchetto"}
                    </div>
                  </div>
                  <div style="display:flex; gap:8px;">
                    <button class="btn btn-primary" data-open-appt-drawer="${a.id}">⚡ Azioni Seduta / Presenza</button>
                    <button class="btn btn-secondary" data-open-person="${a.person_id}">Scheda</button>
                  </div>
                </div>
              `
              )
              .join("");
            return `
              <div class="card">
                <h3 style="margin:0 0 10px 0; font-size:16px; color:var(--primary);">📆 Giorno: ${esc(dKey)}</h3>
                ${listItems}
              </div>
            `;
          })
          .join("")
      : `<div class="card">Nessun appuntamento nel periodo selezionato (${esc(fromDate)} → ${esc(toDate)}).</div>`;
  }

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
      <div>
        <h1 style="margin:0; font-size:22px;">Agenda Unificata Fisio &amp; Fitness</h1>
        <div style="font-size:13px; color:#64748b;">Fuso orario: <strong>Europe/Rome</strong> (gestione ora legale CET/CEST) · Periodo: ${esc(fromDate)} → ${esc(toDate)}</div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <a class="btn btn-sm btn-secondary" href="${esc(buildAuthUrl("/api/appointments/export.ics?privacy=initials_only"))}" target="_blank">
          🍎 Esporta .ics (Apple Calendar Privacy-Safe)
        </a>
        <button class="btn btn-primary" id="agendaNewApptBtn">➕ Nuovo Appuntamento</button>
      </div>
    </div>

    <div class="card" style="padding:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button class="btn btn-sm ${state.agendaViewMode === "day" ? "btn-primary" : "btn-secondary"}" data-agenda-mode="day">Giorno</button>
          <button class="btn btn-sm ${state.agendaViewMode === "week" ? "btn-primary" : "btn-secondary"}" data-agenda-mode="week">Settimana</button>
          <button class="btn btn-sm ${state.agendaViewMode === "month" ? "btn-primary" : "btn-secondary"}" data-agenda-mode="month">Mese</button>
          <button class="btn btn-sm ${state.agendaViewMode === "iphone_list" ? "btn-primary" : "btn-secondary"}" data-agenda-mode="iphone_list">📱 Lista Giornaliera</button>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <input type="date" class="form-control" id="agendaDatePicker" value="${esc(state.agendaDate)}" style="width:auto;" />
          <select class="form-control" id="agendaAreaSelect" style="width:auto;">
            <option value="tutti" ${state.agendaAreaFilter === "tutti" ? "selected" : ""}>Tutte le aree (Fisio + Fitness)</option>
            <option value="fisio" ${state.agendaAreaFilter === "fisio" ? "selected" : ""}>Solo Fisioterapia</option>
            <option value="fitness" ${state.agendaAreaFilter === "fitness" ? "selected" : ""}>Solo Personal Training</option>
          </select>
        </div>
      </div>
    </div>

    ${calendarBodyHtml}

    <div class="card" style="background:var(--bg-subtle); font-size:12.5px; color:#475569;">
      <strong>ℹ️ Nota sull'integrazione con Apple Calendar:</strong>
      L'agenda interna è la fonte principale. Il pulsante <em>Esporta .ics</em> genera un file standard iCalendar con <strong>sole iniziali</strong> (nessun dettaglio clinico o diagnosi nei titoli/notifiche). Nessun messaggio automatico viene mai inviato ai clienti.
    </div>
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
  document.getElementById("agendaAreaSelect")?.addEventListener("change", async (e) => {
    state.agendaAreaFilter = e.target.value;
    await renderAgendaView(container);
  });
  document.getElementById("agendaNewApptBtn")?.addEventListener("click", () => showNewAppointmentModal());
  bindCommonActionButtons(container);
}

// ============================================================================
// 5. VISTA GLOBALE PACCHETTI E AMMINISTRAZIONE
// ============================================================================

async function renderPackagesView(container) {
  const data = await apiFetch("/api/packages");
  const packages = data.packages || [];

  const rows = packages
    .map(
      (pkg) => `
      <tr>
        <td>
          <a href="#" data-open-person="${pkg.person_id}" data-person-tab="pacchetti" style="font-weight:700; color:var(--primary); text-decoration:none;" class="sensitive-data">
            ${esc(pkg.first_name)} ${esc(pkg.last_name)}
          </a>
        </td>
        <td><strong>${esc(pkg.name)}</strong> <span class="badge badge-neutral">${esc(pkg.service_area)}</span></td>
        <td><strong>${pkg.total_sessions}</strong></td>
        <td>${pkg.consumed_sessions}</td>
        <td><strong>${pkg.remaining_sessions}</strong></td>
        <td>${pkg.reserved_sessions}</td>
        <td><span class="badge ${pkg.available_to_book > 0 ? "badge-success" : "badge-warning"}">${pkg.available_to_book} disponibili</span></td>
        <td class="sensitive-data">
          Prezzo: ${formatEur(pkg.price_cents)}<br>
          <span style="color:${pkg.due_cents > 0 ? "var(--danger)" : "var(--success)"}; font-weight:700;">
            ${pkg.due_cents > 0 ? `Da incassare: ${formatEur(pkg.due_cents)}` : "Saldato"}
          </span>
        </td>
        <td style="text-align:right;">
          ${
            pkg.due_cents > 0
              ? `<button class="btn btn-sm btn-primary" data-record-payment-pkg="${pkg.id}" data-person-id="${pkg.person_id}" data-due-cents="${pkg.due_cents}">💶 Incassa</button>`
              : ""
          }
          <button class="btn btn-sm btn-secondary" data-open-person="${pkg.person_id}" data-person-tab="pacchetti">Dettagli</button>
        </td>
      </tr>
    `
    )
    .join("");

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:14px;">
      <div>
        <h1 style="margin:0; font-size:22px;">Pacchetti, Presenze e Riepilogo Amministrativo</h1>
        <div style="font-size:13px; color:#64748b;">
          Relazione rigorosa: <strong>Residue = Acquistate − Consumate</strong> · <strong>Disponibili = Residue − Prenotate (Riservate)</strong>.
        </div>
      </div>
      <button class="btn btn-primary" id="globalNewPkgBtn">➕ Nuovo Pacchetto</button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Persona</th>
              <th>Pacchetto</th>
              <th>Acquistate</th>
              <th>Consumate</th>
              <th>Residue</th>
              <th>Prenotate</th>
              <th>Disponibili</th>
              <th>Saldo Economico</th>
              <th style="text-align:right;">Azioni</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="9">Nessun pacchetto registrato.</td></tr>'}</tbody>
        </table>
      </div>
      <div style="margin-top:10px; font-size:12px; color:#64748b;">
        ⚠️ <strong>Avvertenza fiscale:</strong> Il presente riepilogo ha esclusiva finalità di controllo gestionale interno e non sostituisce la fatturazione elettronica/sanitaria né l'invio al Sistema Tessera Sanitaria (STS). Nessun dato di carte di credito/debito viene mai memorizzato.
      </div>
    </div>
  `;

  document.getElementById("globalNewPkgBtn")?.addEventListener("click", () => showNewPackageModal());
  bindCommonActionButtons(container);
}

// ============================================================================
// 6. VISTA SICUREZZA, SECONDO FATTORE 2FA, BACKUP CIFRATI E CHECKLIST GDPR
// ============================================================================

async function renderSecurityView(container) {
  const sec = await apiFetch("/api/security/overview");
  const bkpRows = (sec.backups || [])
    .map(
      (b) => `
      <tr>
        <td><strong>${esc(b.backup_id)}</strong></td>
        <td>${esc(formatRomeDateTime(b.created_at))}</td>
        <td>${(b.size_bytes / 1024).toFixed(1)} KB (${b.attachments_count} allegati)</td>
        <td style="font-family:monospace; font-size:11px;">HMAC: ${esc((b.hmac_sha256 || "").slice(0, 16))}...</td>
        <td style="text-align:right;">
          <button class="btn btn-sm btn-secondary" data-verify-backup="${esc(b.encrypted_filename)}">🧪 Verifica Ripristino di Prova</button>
        </td>
      </tr>
    `
    )
    .join("");

  container.innerHTML = `
    <div style="margin-bottom:14px;">
      <h1 style="margin:0; font-size:22px;">Sicurezza, Backup Cifrati e Tutela Dati Sanitari</h1>
      <div style="font-size:13px; color:#64748b;">Ambiente attivo: <strong>${esc(sec.env_mode.toUpperCase())}</strong> · Registrazione pubblica disabilitata</div>
    </div>

    <!-- Credenziali Account (Username, Nome Visualizzato, Password) -->
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header">
        <h3 class="card-title">👤 Credenziali Account (Username e Password)</h3>
        <span class="badge badge-neutral">Utente: ${esc(sec.username || state.user?.username || "")}</span>
      </div>
      <form id="updateCredentialsForm">
        <div class="grid-3">
          <div class="form-group">
            <label class="form-label">Nome utente (Username)</label>
            <input class="form-control" id="credUsernameInput" value="${esc(sec.username || state.user?.username || "")}" required minlength="3" />
          </div>
          <div class="form-group">
            <label class="form-label">Nome visualizzato</label>
            <input class="form-control" id="credDisplayNameInput" value="${esc(sec.display_name || state.user?.display_name || "")}" />
          </div>
          <div class="form-group">
            <label class="form-label">Password attuale (richiesta per salvare)</label>
            <input type="password" class="form-control" id="credCurrentPasswordInput" placeholder="Password attuale" required autocomplete="current-password" />
          </div>
        </div>
        <div class="grid-2" style="margin-top:8px;">
          <div class="form-group">
            <label class="form-label">Nuova password (opzionale, min. 10 caratteri)</label>
            <input type="password" class="form-control" id="credNewPasswordInput" placeholder="Lascia vuoto per non cambiarla" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="form-label">Conferma nuova password</label>
            <input type="password" class="form-control" id="credConfirmPasswordInput" placeholder="Ripeti la nuova password" autocomplete="new-password" />
          </div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-top:8px;">
          <div id="credentialsResultBox" style="font-size:13px;"></div>
          <button type="submit" class="btn btn-primary">💾 Salva Credenziali</button>
        </div>
      </form>
    </div>

    <div class="grid-2">
      <!-- 2FA TOTP -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">🔐 Autenticazione e Secondo Fattore (2FA TOTP RFC 6238)</h3>
          <span class="badge ${sec.totp_enabled ? "badge-success" : "badge-warning"}">
            ${sec.totp_enabled ? "✓ 2FA TOTP Attivo" : "2FA TOTP Disattivato"}
          </span>
        </div>
        <p style="font-size:13.5px; color:#334155;">
          Configura il segreto TOTP nella tua app di autenticazione (Apple Passwords, Google Authenticator, 1Password, Authy):
        </p>
        <div style="background:var(--bg-subtle); padding:10px; border-radius:6px; font-family:monospace; font-size:13px; border:1px solid var(--border-color); margin-bottom:10px;">
          <div><strong>Segreto Base32:</strong> ${esc(sec.totp_secret)}</div>
          <div style="font-size:11px; color:#64748b; word-break:break-all; margin-top:4px;">${esc(sec.otpauth_uri)}</div>
          ${
            sec.current_totp_demo_hint
              ? `<div style="margin-top:6px; color:var(--primary); font-weight:700;">Codice TOTP attuale (visibile in DEMO per test rapido): ${esc(sec.current_totp_demo_hint)}</div>`
              : ""
          }
        </div>
        <form id="toggleTotpForm" style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">
          <div class="form-group" style="margin:0; flex:1;">
            <label class="form-label">Codice TOTP a 6 cifre</label>
            <input class="form-control" id="totpVerifyInput" value="${esc(sec.current_totp_demo_hint || "")}" placeholder="123456" />
          </div>
          <button type="submit" class="btn ${sec.totp_enabled ? "btn-danger" : "btn-primary"}">
            ${sec.totp_enabled ? "Disattiva 2FA" : "Verifica e Attiva 2FA"}
          </button>
        </form>
        <div id="recoveryCodesBox" style="margin-top:10px;"></div>
      </div>

      <!-- Backup Automatici Cifrati e Ripristino Verificato -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">💾 Backup Cifrati (AES-256) e Ripristino Verificato</h3>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-sm btn-primary" id="createBackupBtn">🔒 Crea Backup Cifrato Ora</button>
            <button class="btn btn-sm btn-secondary" id="verifyLatestBackupBtn">🧪 Verifica Ripristino</button>
          </div>
        </div>
        <p style="font-size:13px; color:#475569; margin-top:0;">
          Il backup salva un'immagine consistente del database SQLite e tutti gli allegati privati, cifrata con <strong>AES-256-CBC + PBKDF2 (600.000 iterazioni) + firma HMAC-SHA256</strong>.
          È distinto dall'esportazione PDF/JSON della singola scheda.
        </p>
        <div id="backupVerifyResultBox" style="margin-bottom:10px;"></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>ID Backup</th><th>Data</th><th>Dimensione</th><th>Integrità</th><th style="text-align:right;">Test Ripristino</th></tr></thead>
            <tbody>${bkpRows || '<tr><td colspan="5">Nessun backup ancora generato. Clicca su "Crea Backup Cifrato Ora".</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Checklist GDPR e Aspetti da Verificare prima dell'Uso con Dati Reali -->
    <div class="card" style="border-left:5px solid var(--warning);">
      <h3 style="margin-top:0;">⚖️ Aspetti da Verificare Prima dell'Uso con Dati Reali (Protezione Dati Sanitari &amp; GDPR)</h3>
      <p style="font-size:13.5px; color:#334155;">
        Il software implementa misure tecniche di protezione (autenticazione robusta + 2FA, minimizzazione, separazione contesti Fisio/Fitness, storage allegati privato, cifratura backup AES-256, assenza di cache offline per dati clinici, zero analytics/AI esterne). Tuttavia, <strong>la conformità normativa non dipende dal solo codice</strong>: prima di passare dall'ambiente <code>demo</code> all'ambiente <code>prod</code> con pazienti reali, verifica:
      </p>
      <ul style="font-size:13.5px; color:#334155; line-height:1.6;">
        <li><strong>Informativa e Consenso Sanitario:</strong> utilizza i testi redatti dal tuo consulente privacy/ordine professionale, distinguendo la presa visione dell'Informativa Privacy dal Consenso al Trattamento dei Dati Sanitari.</li>
        <li><strong>Localizzazione e Fornitori (Hosting / VPS):</strong> se esponi l'app su rete per sincronizzare Mac, iPad e iPhone, utilizza una rete privata cifrata (es. Tailscale sul tuo Mac) oppure un server VPS situato esclusivamente nell'<strong>Unione Europea</strong> con sottoscrizione del DPA (art. 28 GDPR) e certificato TLS/HTTPS attivo.</li>
        <li><strong>Custodia Separata delle Chiavi:</strong> conserva la passphrase di cifratura dei backup (presente in <code>data/secrets.json</code>) e i codici di recupero 2FA in un gestore password esterno e sicuro.</li>
        <li><strong>Separazione Ambiente di Prova / Reale:</strong> avvia con <code>GESTIONALE_ENV=prod python3 run.py</code> per operare su un database pulito e fisicamente separato dai presenti dati fittizi.</li>
      </ul>
    </div>
  `;

  document.getElementById("updateCredentialsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const box = document.getElementById("credentialsResultBox");
    const username = document.getElementById("credUsernameInput").value.trim();
    const displayName = document.getElementById("credDisplayNameInput").value.trim();
    const currentPassword = document.getElementById("credCurrentPasswordInput").value;
    const newPassword = document.getElementById("credNewPasswordInput").value;
    const confirmPassword = document.getElementById("credConfirmPasswordInput").value;

    if (newPassword && newPassword !== confirmPassword) {
      if (box) {
        box.innerHTML = `<span style="color:var(--danger); font-weight:600;">Le nuove password non coincidono.</span>`;
      }
      return;
    }

    try {
      const res = await apiFetch("/api/security/credentials", {
        method: "POST",
        body: {
          username,
          display_name: displayName,
          current_password: currentPassword,
          new_password: newPassword
        }
      });
      if (state.user) {
        state.user.username = res.username;
        state.user.display_name = res.display_name;
      }
      await renderSecurityView(container);
      const updatedBox = document.getElementById("credentialsResultBox");
      if (updatedBox) {
        updatedBox.innerHTML = `<span style="color:#15803d; font-weight:600;">✓ Credenziali aggiornate con successo!</span>`;
      }
    } catch (err) {
      if (box) {
        box.innerHTML = `<span style="color:var(--danger); font-weight:600;">${esc(err.message || "Errore durante l'aggiornamento.")}</span>`;
      }
    }
  });

  document.getElementById("toggleTotpForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("totpVerifyInput").value;
    const res = await apiFetch("/api/security/totp", {
      method: "POST",
      body: { enable: !sec.totp_enabled, code }
    });
    await renderSecurityView(container);
    if (res.recovery_codes) {
      const box = document.getElementById("recoveryCodesBox");
      if (box) {
        box.innerHTML = `<div style="background:#dcfce7; padding:10px; border-radius:6px; font-size:12.5px;">
          <strong>✓ 2FA Attivato! Codici di recupero monouso:</strong> <code>${res.recovery_codes.join(", ")}</code>
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
      box.innerHTML = `
        <div style="background:#dcfce7; border:1px solid #86efac; padding:10px 12px; border-radius:8px; font-size:13px; color:#14532d;">
          <strong>✓ Ripristino verificato con successo in ambiente di prova isolato!</strong><br>
          Backup ID: <code>${esc(res.backup_id)}</code> · Integrità SQLite: <strong>${esc(res.sqlite_integrity)}</strong> ·
          Persone verificate: <strong>${res.people_count}</strong> · Valutazioni: <strong>${res.evaluations_count}</strong> ·
          Pacchetti: <strong>${res.packages_count}</strong> · Allegati verificati (SHA-256): <strong>${res.attachments_verified}</strong>.
        </div>
      `;
    }
  };

  document.getElementById("verifyLatestBackupBtn")?.addEventListener("click", () => runRestoreCheck(null));
  container.querySelectorAll("[data-verify-backup]").forEach((btn) => {
    btn.addEventListener("click", () => runRestoreCheck(btn.getAttribute("data-verify-backup")));
  });
}

// ============================================================================
// MODALI OPERATIVI (PERSONA, APPUNTAMENTO, DRAWER SEDUTA, VALUTAZIONE + BODY MAP, ECC.)
// ============================================================================

function bindCommonActionButtons(root) {
  root.querySelectorAll("[data-open-person]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      const pid = Number(el.getAttribute("data-open-person"));
      const tab = el.getAttribute("data-person-tab") || "riepilogo";
      await navigateTo("people", { personId: pid, personTab: tab });
    });
  });

  root.querySelectorAll("[data-open-appt-drawer]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      const apptId = Number(el.getAttribute("data-open-appt-drawer"));
      await showAppointmentSessionDrawer(apptId);
    });
  });

  root.querySelectorAll("[data-record-payment-pkg]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      const pkgId = Number(el.getAttribute("data-record-payment-pkg"));
      const personId = Number(el.getAttribute("data-person-id"));
      const dueCents = Number(el.getAttribute("data-due-cents") || 0);
      showRecordPaymentModal(personId, pkgId, dueCents);
    });
  });
}

// --- MODALE NUOVA PERSONA (CON RILEVAZIONE OMONIMIE / DUPLICATI) ---
function showNewPersonModal() {
  openModal(`
    <h2 style="margin-top:0;">➕ Registra Nuova Persona (Anagrafica Unica)</h2>
    <p style="font-size:13px; color:#64748b;">Solo Nome e Cognome sono obbligatori. Puoi attivare Fisio, Fitness o entrambi.</p>
    <form id="createPersonModalForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Nome *</label>
          <input class="form-control" name="first_name" required />
        </div>
        <div class="form-group">
          <label class="form-label">Cognome *</label>
          <input class="form-control" name="last_name" required />
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Data di Nascita</label>
          <input class="form-control" type="date" name="birth_date" />
        </div>
        <div class="form-group">
          <label class="form-label">Telefono</label>
          <input class="form-control" name="phone" />
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input class="form-control" type="email" name="email" />
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Professione</label>
          <input class="form-control" name="profession" />
        </div>
        <div class="form-group">
          <label class="form-label">Sport / Attività</label>
          <input class="form-control" name="sport_activity" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Percorsi da attivare su questa anagrafica</label>
        <div style="display:flex; gap:18px; padding-top:4px;">
          <label style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <input type="checkbox" name="physio_active" checked /> 🩺 Area Fisioterapia
          </label>
          <label style="display:flex; align-items:center; gap:6px; font-weight:600;">
            <input type="checkbox" name="fitness_active" /> 🏋️ Area Fitness / Personal Training
          </label>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Note Generali</label>
        <textarea class="form-control" name="general_notes"></textarea>
      </div>
      <div id="dupWarningBox" style="display:none; background:#fffbeb; border:1px solid #fcd34d; padding:10px; border-radius:8px; margin-bottom:12px;"></div>
      <input type="hidden" name="confirm_duplicate_override" id="dupOverrideInput" value="" />
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelModalBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Crea Anagrafica</button>
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
          profession: fd.get("profession"),
          sport_activity: fd.get("sport_activity"),
          physio_active: fd.get("physio_active") === "on",
          fitness_active: fd.get("fitness_active") === "on",
          general_notes: fd.get("general_notes"),
          confirm_duplicate_override: fd.get("confirm_duplicate_override") === "1"
        }
      });
      closeModal();
      await navigateTo("people", { personId: created.id, personTab: "riepilogo" });
    } catch (err) {
      if (err.details && err.details.potential_duplicates) {
        const box = document.getElementById("dupWarningBox");
        box.style.display = "block";
        const list = err.details.potential_duplicates
          .map(
            (d) =>
              `<li><strong>${esc(d.first_name)} ${esc(d.last_name)}</strong> (${esc(d.birth_date || "-")}) — Motivo: ${esc((d.duplicate_reasons || []).join(", "))}</li>`
          )
          .join("");
        box.innerHTML = `
          <strong>⚠️ Possibile duplicato rilevato (nessuna unione automatica effettuata):</strong>
          <ul style="margin:6px 0;">${list}</ul>
          <div style="font-size:12.5px;">Clicca nuovamente su "Crea Anagrafica" se confermi che si tratta di una persona distinta.</div>
        `;
        document.getElementById("dupOverrideInput").value = "1";
      } else {
        alert(err.message);
      }
    }
  });
}

// --- DRAWER / MODALE RAPIDO GESTIONE SEDUTA E PRESENZA DALL'APPUNTAMENTO ---
async function showAppointmentSessionDrawer(appointmentId) {
  const allAppts = await apiFetch("/api/appointments");
  const appt = (allAppts.appointments || []).find((a) => a.id === appointmentId);
  if (!appt) return;

  const dossier = await apiFetch(`/api/people/${appt.person_id}`);
  const pkg = dossier.packages.find((k) => k.id === appt.package_id);
  const idemKey = `ui_svolto_appt_${appt.id}_v${appt.version}`;

  openModal(`
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; margin-bottom:12px;">
      <div>
        <span class="badge ${appt.service_area === "fisio" ? "badge-physio" : "badge-fitness"}">
          ${appt.service_area === "fisio" ? "🩺 SEDUTA FISIOTERAPIA" : "🏋️ SEDUTA PERSONAL TRAINING"}
        </span>
        <h2 style="margin:6px 0 2px 0;" class="sensitive-data">${esc(appt.first_name)} ${esc(appt.last_name)}</h2>
        <div style="font-size:13.5px; color:#475569;">
          🕒 <strong>${esc(formatRomeDateTime(appt.start_at))}</strong> (${appt.duration_minutes} min) · 📍 ${esc(appt.location)}
        </div>
      </div>
      <button class="btn btn-sm btn-secondary" id="drawerOpenFullPersonBtn">📂 Apri Scheda Completa</button>
    </div>

    ${
      pkg
        ? `<div style="background:#f0fdfa; border:1px solid #5eead4; padding:10px 12px; border-radius:8px; margin-bottom:14px; font-size:13px;">
            🎟️ <strong>Pacchetto collegato:</strong> ${esc(pkg.name)}<br>
            Acquistate: <strong>${pkg.total_sessions}</strong> · Consumate: <strong>${pkg.consumed_sessions}</strong> ·
            Residue: <strong>${pkg.remaining_sessions}</strong> · Prenotate: <strong>${pkg.reserved_sessions}</strong> ·
            Disponibili: <strong>${pkg.available_to_book}</strong>
            ${pkg.due_cents > 0 ? ` · <span style="color:var(--danger); font-weight:700;">Da incassare: ${formatEur(pkg.due_cents)}</span>` : " · ✓ Saldato"}
          </div>`
        : `<div style="background:#fffbeb; border:1px solid #fcd34d; padding:10px 12px; border-radius:8px; margin-bottom:14px; font-size:13px;">
            ⚠️ Prestazione registrata <strong>Fuori Pacchetto</strong>.
          </div>`
    }

    <!-- Azione Rapida Presenza / Stato Appuntamento (con protezione doppio clic / idempotenza) -->
    <div class="card" style="background:var(--bg-subtle);">
      <h4 style="margin:0 0 8px 0;">1. Stato Presenza e Consumo Pacchetto (Idempotente)</h4>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
        <button class="btn ${appt.status === "svolto" ? "btn-primary" : "btn-secondary"}" data-set-appt-status="svolto">
          ✔ Segna come SVOLTA (Scala 1 seduta)
        </button>
        <button class="btn ${appt.status === "confermato" ? "btn-primary" : "btn-secondary"}" data-set-appt-status="confermato">
          ✓ Confermato (Riserva)
        </button>
        <button class="btn ${appt.status === "prenotato" ? "btn-primary" : "btn-secondary"}" data-set-appt-status="prenotato">
          🕒 Prenotato (Riserva)
        </button>
        <button class="btn ${appt.status === "annullato" ? "btn-danger" : "btn-secondary"}" data-set-appt-status="annullato" data-charge="no_charge">
          ✖ Annullato (Non addebitato / Storna se già svolta)
        </button>
        <button class="btn btn-secondary" data-set-appt-status="annullato" data-charge="charge">
          ⚠️ Disdetta Tardiva (Addebita seduta)
        </button>
        <button class="btn ${appt.status === "assente" ? "btn-danger" : "btn-secondary"}" data-set-appt-status="assente" data-charge="charge">
          🚫 Assente No-Show (Addebita)
        </button>
      </div>

      <!-- Spostamento Orario/Data (Non consuma una nuova seduta) -->
      <form id="rescheduleApptForm" style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; padding-top:8px; border-top:1px solid var(--border-color);">
        <div class="form-group" style="margin:0; flex:1; min-width:200px;">
          <label class="form-label">Sposta Data/Ora (non scala una seconda seduta)</label>
          <input class="form-control" type="datetime-local" name="start_at" value="${esc(appt.start_at.slice(0, 16))}" required />
        </div>
        <div class="form-group" style="margin:0; width:110px;">
          <label class="form-label">Durata (min)</label>
          <input class="form-control" type="number" name="duration_minutes" value="${appt.duration_minutes}" required />
        </div>
        <button type="submit" class="btn btn-secondary">🕒 Sposta Orario</button>
      </form>
    </div>

    <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${
          appt.service_area === "fisio" && dossier.physio.episodes.length
            ? `<button class="btn btn-physio" id="drawerWriteSoapBtn">📝 Scrivi Nota SOAP della Seduta</button>`
            : ""
        }
        ${
          appt.service_area === "fitness"
            ? `<button class="btn btn-fitness" id="drawerLogWorkoutBtn">🏋️ Registra Scheda Seduta Fitness</button>`
            : ""
        }
        ${
          pkg && pkg.due_cents > 0
            ? `<button class="btn btn-secondary" id="drawerCollectPayBtn">💶 Incassa Pagamento (${formatEur(pkg.due_cents)})</button>`
            : ""
        }
      </div>
      <button class="btn btn-secondary" id="closeDrawerBtn">Chiudi</button>
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
      const chargeOverride = btn.getAttribute("data-charge") || null;
      await apiFetch(`/api/appointments/${appt.id}`, {
        method: "PUT",
        body: {
          status: newStatus,
          charge_override: chargeOverride,
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
      body: {
        start_at: fd.get("start_at"),
        duration_minutes: Number(fd.get("duration_minutes")),
        expected_version: appt.version
      }
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

// --- MODALE NUOVO APPUNTAMENTO (CON RICORRENZE E VERIFICA BUFFER / SOVRAPPOSIZIONI) ---
async function showNewAppointmentModal(preselectedPersonId = null) {
  const pData = await apiFetch("/api/people?status=attivo");
  const people = pData.people || [];
  const selectedPid = preselectedPersonId || (state.selectedPersonId ? state.selectedPersonId : people[0]?.id);

  let packages = [];
  if (selectedPid) {
    const pkgData = await apiFetch(`/api/packages?person_id=${selectedPid}`);
    packages = (pkgData.packages || []).filter((k) => k.status === "attivo");
  }

  const defaultStart = `${state.agendaDate}T10:00`;

  openModal(`
    <h2 style="margin-top:0;">📅 Nuovo Appuntamento (Agenda Unificata)</h2>
    <form id="newApptModalForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Persona *</label>
          <select class="form-control" name="person_id" id="apptPersonSelect" required>
            ${people
              .map(
                (p) =>
                  `<option value="${p.id}" ${p.id === selectedPid ? "selected" : ""}>${esc(p.last_name)} ${esc(p.first_name)}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Area Servizio *</label>
          <select class="form-control" name="service_area" id="apptAreaSelect">
            <option value="fisio">🩺 Fisioterapia</option>
            <option value="fitness">🏋️ Personal Training / Fitness</option>
          </select>
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Prestazione / Servizio</label>
          <input class="form-control" name="service_name" value="Seduta Fisioterapia" required />
        </div>
        <div class="form-group">
          <label class="form-label">Pacchetto Collegato (Riserva 1 seduta per occorrenza)</label>
          <select class="form-control" name="package_id" id="apptPkgSelect">
            <option value="">-- Fuori pacchetto (Prestazione singola) --</option>
            ${packages
              .map(
                (k) =>
                  `<option value="${k.id}" selected>${esc(k.name)} (Disponibili: ${k.available_to_book} / Residue: ${k.remaining_sessions})</option>`
              )
              .join("")}
          </select>
        </div>
      </div>

      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Data e Ora Inizio (Europe/Rome) *</label>
          <input class="form-control" type="datetime-local" name="start_at" value="${defaultStart}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Durata (minuti)</label>
          <input class="form-control" type="number" name="duration_minutes" value="60" min="15" step="5" required />
        </div>
        <div class="form-group">
          <label class="form-label">Buffer tra sedute (min)</label>
          <input class="form-control" type="number" name="buffer_minutes" value="10" min="0" />
        </div>
      </div>

      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Luogo</label>
          <input class="form-control" name="location" value="Studio Principale" />
        </div>
        <div class="form-group">
          <label class="form-label">Stato Iniziale</label>
          <select class="form-control" name="status">
            <option value="prenotato">Prenotato (Riserva seduta)</option>
            <option value="confermato">Confermato (Riserva seduta)</option>
            <option value="svolto">Già Svolto (Consuma subito 1 seduta)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Ricorrenza Settimanale (N occorrenze)</label>
          <input class="form-control" type="number" name="recurrence_count" value="1" min="1" max="24" />
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Note operative appuntamento</label>
        <input class="form-control" name="notes" placeholder="Es. Portare esami / Focus controllo carico..." />
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelApptModalBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva Appuntamento</button>
      </div>
    </form>
  `);

  document.getElementById("cancelApptModalBtn")?.addEventListener("click", closeModal);
  document.getElementById("apptPersonSelect")?.addEventListener("change", async (e) => {
    const pid = Number(e.target.value);
    const pkgData = await apiFetch(`/api/packages?person_id=${pid}`);
    const activePkgs = (pkgData.packages || []).filter((k) => k.status === "attivo");
    const pkgSel = document.getElementById("apptPkgSelect");
    pkgSel.innerHTML =
      `<option value="">-- Fuori pacchetto (Prestazione singola) --</option>` +
      activePkgs
        .map(
          (k) =>
            `<option value="${k.id}" selected>${esc(k.name)} (Disponibili: ${k.available_to_book} / Residue: ${k.remaining_sessions})</option>`
        )
        .join("");
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
          buffer_minutes: Number(fd.get("buffer_minutes")),
          location: fd.get("location"),
          status: fd.get("status"),
          recurrence_count: Number(fd.get("recurrence_count") || 1),
          recurrence_interval_days: 7,
          notes: fd.get("notes")
        }
      });
      closeModal();
      if (res.conflicts && res.conflicts.length) {
        alert(
          "Appuntamento salvato con avviso di sovrapposizione/buffer:\n" +
            res.conflicts.map((c) => `• ${c.message}`).join("\n")
        );
      }
      await refreshCurrentView();
    } catch (err) {
      alert(err.message);
    }
  });
}

// --- MODALE NUOVO PACCHETTO ---
async function showNewPackageModal(preselectedPersonId = null) {
  const pData = await apiFetch("/api/people?status=attivo");
  const people = pData.people || [];
  const selectedPid = preselectedPersonId || state.selectedPersonId || people[0]?.id;
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });

  openModal(`
    <h2 style="margin-top:0;">🎟️ Vendi / Attiva Nuovo Pacchetto</h2>
    <form id="newPkgModalForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Persona *</label>
          <select class="form-control" name="person_id" required>
            ${people
              .map(
                (p) =>
                  `<option value="${p.id}" ${p.id === selectedPid ? "selected" : ""}>${esc(p.last_name)} ${esc(p.first_name)}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Tipologia Servizio *</label>
          <select class="form-control" name="service_area">
            <option value="fisio">Fisioterapia</option>
            <option value="fitness">Personal Training / Fitness</option>
            <option value="misto">Integrato / Misto (Fisio + Fitness)</option>
          </select>
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Nome Pacchetto *</label>
          <input class="form-control" name="name" value="Pacchetto 10 Sedute" required />
        </div>
        <div class="form-group">
          <label class="form-label">Numero di Sedute *</label>
          <input class="form-control" type="number" name="total_sessions" value="10" min="1" required />
        </div>
        <div class="form-group">
          <label class="form-label">Prezzo Totale (€) *</label>
          <input class="form-control" type="number" step="0.01" name="price_eur" value="500.00" min="0" required />
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Data Acquisto</label>
          <input class="form-control" type="date" name="purchased_date" value="${todayStr}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Data Scadenza / Validità</label>
          <input class="form-control" type="date" name="valid_until" />
        </div>
        <div class="form-group">
          <label class="form-label">Acconto / Pagamento Immediato (€)</label>
          <input class="form-control" type="number" step="0.01" name="initial_payment_eur" value="0.00" min="0" />
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Metodo Pagamento Acconto</label>
          <select class="form-control" name="payment_method">
            <option value="POS/Carta">POS / Carta (nessun dato carta salvato)</option>
            <option value="Bonifico">Bonifico Bancario</option>
            <option value="Contanti">Contanti</option>
            <option value="Satispay/Altro">Satispay / Altro</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Politica Disdetta Tardiva</label>
          <select class="form-control" name="late_cancel_policy">
            <option value="charge">Addebita seduta</option>
            <option value="no_charge">Non addebitare</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Politica Assenza (No-Show)</label>
          <select class="form-control" name="no_show_policy">
            <option value="charge">Addebita seduta</option>
            <option value="no_charge">Non addebitare</option>
          </select>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
        <button type="button" class="btn btn-secondary" id="cancelPkgModalBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Attiva Pacchetto</button>
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
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  openModal(`
    <h2 style="margin-top:0;">💶 Registra Pagamento (Totale o Parziale)</h2>
    <p style="font-size:12.5px; color:#64748b;">Non viene memorizzato alcun numero di carta di credito/debito.</p>
    <form id="recordPayForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Importo Incassato (€) *</label>
          <input class="form-control" type="number" step="0.01" name="amount_eur" value="${(dueCents / 100).toFixed(2)}" min="0.01" required />
        </div>
        <div class="form-group">
          <label class="form-label">Metodo di Pagamento *</label>
          <select class="form-control" name="payment_method">
            <option value="POS/Carta">POS / Carta</option>
            <option value="Bonifico">Bonifico</option>
            <option value="Contanti">Contanti</option>
            <option value="Satispay/Altro">Satispay / Altro</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Data Pagamento</label>
          <input class="form-control" type="date" name="payment_date" value="${todayStr}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Note / Riferimento</label>
          <input class="form-control" name="reference_note" placeholder="Es. Saldo / 2a rata" />
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelPayBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Registra Incasso</button>
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

// ============================================================================
// MODALI CLINICI FISIOTERAPIA (EPISODIO, VALUTAZIONE + BODY MAP 2D, FLAGS, SCALE, SOAP)
// ============================================================================

function showNewPhysioEpisodeModal(personId) {
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  openModal(`
    <h2 style="margin-top:0;">🩺 Nuovo Episodio Fisioterapico</h2>
    <form id="newEpisodeForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Titolo Episodio Clinico *</label>
          <input class="form-control" name="title" placeholder="Es. Lombalgia acuta / Sindrome subacromiale DX" required />
        </div>
        <div class="form-group">
          <label class="form-label">Distretto Corporeo &amp; Lato</label>
          <div style="display:flex; gap:6px;">
            <input class="form-control" name="body_region" placeholder="Es. Spalla / Ginocchio / Rachide" />
            <select class="form-control" name="laterality" style="width:130px;">
              <option value="DX">DX</option>
              <option value="SX">SX</option>
              <option value="Bilaterale">Bilaterale</option>
              <option value="Centrale">Centrale</option>
            </select>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Motivo Principale della Consultazione *</label>
        <input class="form-control" name="chief_complaint" required />
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Data Inizio</label>
          <input class="form-control" type="date" name="start_date" value="${todayStr}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Data Rivalutazione Prevista</label>
          <input class="form-control" type="date" name="reassessment_due_date" />
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Obiettivi del Paziente</label>
          <textarea class="form-control" name="patient_goals"></textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Obiettivi del Fisioterapista</label>
          <textarea class="form-control" name="therapist_goals"></textarea>
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelEpBtn">Annulla</button>
        <button type="submit" class="btn btn-physio">Crea Episodio e Inizializza Checklist Flags</button>
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

// --- MODALE INTERATTIVO DI VALUTAZIONE / RIVALUTAZIONE CON EDITOR BODY MAP 2D SVG ---
function showEvaluationModal(episode, existingEval = null, defaultType = "prima_valutazione") {
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  const ev = existingEval || {
    eval_type: defaultType,
    eval_date: todayStr,
    status: "bozza",
    consult_reason: episode.chief_complaint || "",
    patient_goals: episode.patient_goals || "",
    important_activities: "",
    symptom_onset: "",
    symptom_distribution: "",
    symptom_behavior: "",
    aggravating_factors: "",
    easing_factors: "",
    pattern_24h: "",
    functional_impact: "",
    medical_history: "",
    surgeries_traumas: "",
    medications: "",
    imaging_reports: "",
    sleep_quality: "",
    work_sport_load: "",
    psychosocial_factors: "",
    objective_measurements: [
      { name: "ROM Attivo", value: "", unit: "°", side: episode.laterality || "DX", notes: "" }
    ],
    special_tests: "",
    clinical_observations: "",
    clinical_reasoning: "",
    treatment_plan: "",
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

  openModal(`
    <h2 style="margin-top:0;">
      🩺 ${existingEval ? `Modifica Valutazione #${existingEval.id}` : defaultType === "rivalutazione" ? "Nuova Rivalutazione Clinica (conserva le precedenti)" : "Nuova Prima Valutazione Clinica"}
    </h2>
    <form id="clinicalEvalForm">
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Tipo Valutazione</label>
          <select class="form-control" name="eval_type">
            <option value="prima_valutazione" ${ev.eval_type === "prima_valutazione" ? "selected" : ""}>Prima Valutazione</option>
            <option value="rivalutazione" ${ev.eval_type === "rivalutazione" ? "selected" : ""}>Rivalutazione</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Data Valutazione</label>
          <input class="form-control" type="date" name="eval_date" value="${esc(ev.eval_date)}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Prossima Rivalutazione Prevista</label>
          <input class="form-control" type="date" name="next_reassessment_date" value="${esc(ev.next_reassessment_date || "")}" />
        </div>
      </div>

      <!-- Editor Interattivo Mappa del Corpo 2D (Mouse & Touch Mac/iPad/iPhone) -->
      <div class="card" style="background:var(--bg-subtle); border:2px solid var(--physio-accent);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
          <h4 style="margin:0;">🧍 Mappa Interattiva del Corpo 2D (Tocca o clicca sulla silhouette per segnare punti o aree)</h4>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn btn-sm btn-primary" id="bmViewAntBtn">Vista Anteriore</button>
            <button type="button" class="btn btn-sm btn-secondary" id="bmViewPostBtn">Vista Posteriore</button>
            <button type="button" class="btn btn-sm btn-secondary" id="bmZoom1Btn">Zoom 1x</button>
            <button type="button" class="btn btn-sm btn-secondary" id="bmZoomUpperBtn">Zoom 1.5x Sup</button>
            <button type="button" class="btn btn-sm btn-secondary" id="bmZoomLowerBtn">Zoom 1.5x Inf</button>
          </div>
        </div>

        <div class="body-map-layout">
          <div class="body-map-stage" id="bmInteractiveStage"></div>
          <div>
            <div style="background:var(--bg-surface); padding:12px; border-radius:8px; border:1px solid var(--border-color); margin-bottom:10px;">
              <h5 style="margin:0 0 8px 0;">Impostazioni Pennello / Marcatore</h5>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">Tipo Segno</label>
                  <select class="form-control" id="bmKindSelect">
                    <option value="point">Punto preciso (●)</option>
                    <option value="area">Area diffusa (◯)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Raggio Area (20-85)</label>
                  <input class="form-control" type="number" id="bmRadiusInput" value="48" min="18" max="90" />
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label class="form-label">Tipo di Sintomo</label>
                  <select class="form-control" id="bmSymptomSelect">
                    ${SYMPTOM_TYPES.map((s) => `<option value="${esc(s.id)}">${s.symbol} ${esc(s.id)}</option>`).join("")}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Intensità (0–10)</label>
                  <input class="form-control" type="number" id="bmIntensityInput" value="6" min="0" max="10" />
                </div>
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label">Nota sul punto/area (opzionale)</label>
                <input class="form-control" id="bmNoteInput" placeholder="Es. Comparsa a 45° di flessione..." />
              </div>
            </div>

            <!-- Inserimento manuale/testuale accessibile e lista marcatori -->
            <div style="background:var(--bg-surface); padding:12px; border-radius:8px; border:1px solid var(--border-color);">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <h5 style="margin:0;">Punti/Aree Segnate (<span id="bmMarkersCount">0</span>)</h5>
                <button type="button" class="btn btn-sm btn-secondary" id="bmAddTextualMarkerBtn">➕ Aggiungi da Tastiera</button>
              </div>
              <div id="bmMarkersListContainer" style="max-height:210px; overflow-y:auto;"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sezioni Cliniche Strutturate -->
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Motivo della consultazione</label>
          <textarea class="form-control" name="consult_reason">${esc(ev.consult_reason || "")}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Obiettivi del paziente &amp; Attività importanti</label>
          <textarea class="form-control" name="patient_goals">${esc(ev.patient_goals || "")}</textarea>
        </div>
      </div>

      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Esordio e Andamento Sintomi</label>
          <textarea class="form-control" name="symptom_onset">${esc(ev.symptom_onset || "")}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Fattori Aggravanti</label>
          <textarea class="form-control" name="aggravating_factors">${esc(ev.aggravating_factors || "")}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Fattori Allevianti &amp; 24 Ore</label>
          <textarea class="form-control" name="easing_factors">${esc(ev.easing_factors || "")}</textarea>
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Storia Clinica, Traumi, Chirurgia, Farmaci e Referti</label>
          <textarea class="form-control" name="medical_history">${esc(ev.medical_history || "")}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Sonno, Lavoro, Sport, Carico Abituale e Fattori Psicosociali</label>
          <textarea class="form-control" name="work_sport_load">${esc(ev.work_sport_load || "")}</textarea>
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Test Clinici Speciali &amp; Osservazioni</label>
          <textarea class="form-control" name="special_tests">${esc(ev.special_tests || "")}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Ragionamento Clinico Documentato &amp; Piano Terapeutico</label>
          <textarea class="form-control" name="clinical_reasoning">${esc(ev.clinical_reasoning || "")}</textarea>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Indicazioni Domiciliari ed Esercizi</label>
        <input class="form-control" name="home_advice" value="${esc(ev.home_advice || "")}" />
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-top:14px;">
        <button type="button" class="btn btn-secondary" id="cancelEvalModalBtn">Annulla</button>
        <div style="display:flex; gap:8px;">
          <button type="submit" class="btn btn-secondary" data-save-eval-status="bozza">💾 Salva come Bozza</button>
          <button type="submit" class="btn btn-physio" data-save-eval-status="finalizzata">🔒 Salva e Finalizza Valutazione</button>
        </div>
      </div>
    </form>
  `);

  const refreshBodyMapInteractive = () => {
    const stage = document.getElementById("bmInteractiveStage");
    if (!stage) return;
    const indexedMarkers = state.bodyMapDraft.markers.map((m, i) => ({ ...m, _globalIdx: i }));
    stage.innerHTML = renderBodySvgMarkup(
      state.bodyMapDraft.viewSide,
      indexedMarkers,
      [],
      state.bodyMapDraft.zoom
    );

    const svgEl = stage.querySelector("svg");
    svgEl?.addEventListener("click", (evt) => {
      const targetGroup = evt.target.closest(".active-marker");
      if (targetGroup) {
        return;
      }
      const coords = clientEventToNormalizedSvgCoords(svgEl, evt);
      const inferred = inferAnatomicalRegionAndSide(state.bodyMapDraft.viewSide, coords.x_norm, coords.y_norm);
      const kind = document.getElementById("bmKindSelect").value;
      const rad = Number(document.getElementById("bmRadiusInput").value || 48);
      const sym = document.getElementById("bmSymptomSelect").value;
      const intensity = Number(document.getElementById("bmIntensityInput").value || 5);
      const note = document.getElementById("bmNoteInput").value;

      state.bodyMapDraft.markers.push({
        view_side: state.bodyMapDraft.viewSide,
        marker_kind: kind,
        x_norm: coords.x_norm,
        y_norm: coords.y_norm,
        radius_norm: kind === "area" ? rad : 22,
        anatomical_region: inferred.region,
        laterality: inferred.laterality,
        symptom_type: sym,
        intensity: intensity,
        notes: note
      });
      document.getElementById("bmNoteInput").value = "";
      refreshBodyMapInteractive();
    });

    document.getElementById("bmMarkersCount").textContent = String(state.bodyMapDraft.markers.length);
    const listBox = document.getElementById("bmMarkersListContainer");
    listBox.innerHTML =
      state.bodyMapDraft.markers
        .map(
          (m, idx) => `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:6px 0; border-bottom:1px solid var(--border-color); font-size:12.5px;">
            <div>
              <strong>#${idx + 1} [${m.view_side === "anterior" ? "Ant" : "Post"} · ${esc(m.laterality)}]</strong>
              ${esc(m.anatomical_region)} — ${esc(m.symptom_type)} (<strong>${m.intensity}/10</strong>)
              ${m.notes ? `<div style="color:#64748b;">${esc(m.notes)}</div>` : ""}
            </div>
            <button type="button" class="btn btn-sm btn-danger" data-del-bm-idx="${idx}">✕</button>
          </div>
        `
        )
        .join("") || '<div style="color:#64748b; font-size:12px;">Tocca il corpo 2D a sinistra per aggiungere un punto o un\'area.</div>';

    listBox.querySelectorAll("[data-del-bm-idx]").forEach((b) => {
      b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-del-bm-idx"));
        state.bodyMapDraft.markers.splice(i, 1);
        refreshBodyMapInteractive();
      });
    });
  };

  refreshBodyMapInteractive();

  document.getElementById("bmViewAntBtn")?.addEventListener("click", () => {
    state.bodyMapDraft.viewSide = "anterior";
    document.getElementById("bmViewAntBtn").className = "btn btn-sm btn-primary";
    document.getElementById("bmViewPostBtn").className = "btn btn-sm btn-secondary";
    refreshBodyMapInteractive();
  });
  document.getElementById("bmViewPostBtn")?.addEventListener("click", () => {
    state.bodyMapDraft.viewSide = "posterior";
    document.getElementById("bmViewPostBtn").className = "btn btn-sm btn-primary";
    document.getElementById("bmViewAntBtn").className = "btn btn-sm btn-secondary";
    refreshBodyMapInteractive();
  });
  document.getElementById("bmZoom1Btn")?.addEventListener("click", () => {
    state.bodyMapDraft.zoom = { scale: 1, focus: "full" };
    refreshBodyMapInteractive();
  });
  document.getElementById("bmZoomUpperBtn")?.addEventListener("click", () => {
    state.bodyMapDraft.zoom = { scale: 1.5, focus: "upper" };
    refreshBodyMapInteractive();
  });
  document.getElementById("bmZoomLowerBtn")?.addEventListener("click", () => {
    state.bodyMapDraft.zoom = { scale: 1.5, focus: "lower" };
    refreshBodyMapInteractive();
  });
  document.getElementById("bmAddTextualMarkerBtn")?.addEventListener("click", () => {
    const region = prompt("Regione anatomica (es. Spalla, Ginocchio, Rachide Lombare):", "Spalla");
    if (!region) return;
    const lat = prompt("Lateralità anatomica (DX, SX, Centrale, Bilaterale):", "DX") || "DX";
    state.bodyMapDraft.markers.push({
      view_side: state.bodyMapDraft.viewSide,
      marker_kind: document.getElementById("bmKindSelect").value,
      x_norm: lat === "DX" ? 440 : lat === "SX" ? 560 : 500,
      y_norm: 320,
      radius_norm: 24,
      anatomical_region: region,
      laterality: ["DX", "SX", "Centrale", "Bilaterale"].includes(lat) ? lat : "Centrale",
      symptom_type: document.getElementById("bmSymptomSelect").value,
      intensity: Number(document.getElementById("bmIntensityInput").value || 5),
      notes: document.getElementById("bmNoteInput").value
    });
    refreshBodyMapInteractive();
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
    const body = {
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
      medical_history: fd.get("medical_history"),
      work_sport_load: fd.get("work_sport_load"),
      special_tests: fd.get("special_tests"),
      clinical_reasoning: fd.get("clinical_reasoning"),
      home_advice: fd.get("home_advice"),
      body_map_markers: state.bodyMapDraft.markers
    };
    const saved = await apiFetch(
      existingEval ? `/api/physio/evaluations/${existingEval.id}` : "/api/physio/evaluations",
      {
        method: existingEval ? "PUT" : "POST",
        body
      }
    );
    state.selectedEvalId = saved.id;
    closeModal();
    await refreshCurrentView();
  });
}

// --- MODALE AGGIORNAMENTO RED / YELLOW FLAG ---
function showEditFlagModal(flag) {
  openModal(`
    <h2 style="margin-top:0;">🚩 Aggiorna Stato Flag Clinica</h2>
    <p style="font-weight:700;">${esc(flag.item_label)}</p>
    <p style="font-size:12px; color:#64748b;">Fonte: ${esc(flag.guideline_source)} (${esc(flag.guideline_version)})</p>
    <form id="editFlagForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Stato Rilevato *</label>
          <select class="form-control" name="status">
            <option value="non_valutato" ${flag.status === "non_valutato" ? "selected" : ""}>❓ Non valutato (Da approfondire)</option>
            <option value="assente" ${flag.status === "assente" ? "selected" : ""}>✓ Assente</option>
            <option value="presente" ${flag.status === "presente" ? "selected" : ""}>❗ Presente</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Fonte dell'informazione</label>
          <input class="form-control" name="source_info" value="${esc(flag.source_info || "Colloquio anamnestico / Test clinico")}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Note Cliniche</label>
        <textarea class="form-control" name="notes">${esc(flag.notes || "")}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Azione Intrapresa dal Professionista</label>
        <input class="form-control" name="action_taken" value="${esc(flag.action_taken || "")}" placeholder="Es. Nessuna / Monitoraggio / Invio al medico curante per approfondimento" />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelFlagBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva Flag</button>
      </div>
    </form>
  `);
  document.getElementById("cancelFlagBtn")?.addEventListener("click", closeModal);
  document.getElementById("editFlagForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/physio/flags", {
      method: "PUT",
      body: {
        id: flag.id,
        status: fd.get("status"),
        source_info: fd.get("source_info"),
        notes: fd.get("notes"),
        action_taken: fd.get("action_taken")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showCustomFlagModal(episodeId) {
  openModal(`
    <h2 style="margin-top:0;">➕ Aggiungi Red / Yellow Flag Personalizzata</h2>
    <form id="customFlagForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Tipologia</label>
          <select class="form-control" name="flag_type">
            <option value="red">🚩 Red Flag (Clinica / Biologica)</option>
            <option value="yellow">⚠️ Yellow Flag (Psicosociale / Contesto)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Stato Iniziale</label>
          <select class="form-control" name="status">
            <option value="presente">❗ Presente</option>
            <option value="assente">✓ Assente</option>
            <option value="non_valutato">❓ Non valutato</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Elemento / Segno Clinico *</label>
        <input class="form-control" name="item_label" required />
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Fonte</label>
          <input class="form-control" name="source_info" value="Anamnesi / Valutazione diretta" />
        </div>
        <div class="form-group">
          <label class="form-label">Azione Intrapresa</label>
          <input class="form-control" name="action_taken" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <textarea class="form-control" name="notes"></textarea>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
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
        source_info: fd.get("source_info"),
        action_taken: fd.get("action_taken"),
        notes: fd.get("notes")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

// --- MODALE REGISTRAZIONE SCALE E MISURE DI ESITO ---
function showRecordOutcomeModal(episodeId, evaluationId = null) {
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  openModal(`
    <h2 style="margin-top:0;">📏 Registra Scala o Misura di Esito</h2>
    <p style="font-size:12.5px; color:#64748b;">
      NPRS, PSFS e SANE sono calcolate internamente secondo protocollo verificato (i dati mancanti restano vuoti/null e non valgono zero).
      Per QuickDASH, ODI, NDI e LEFS registra il punteggio ottenuto dal modulo validato indicando la versione.
    </p>
    <form id="recordOutcomeForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Strumento / Scala *</label>
          <select class="form-control" name="scale_code" id="outcomeScaleSelect">
            <option value="NPRS">NPRS — Intensità del Dolore (0-10)</option>
            <option value="PSFS">PSFS — Funzione Specifica del Paziente (0-10)</option>
            <option value="SANE">SANE — Percezione Funzione Globale (0-100%)</option>
            <option value="QuickDASH">QuickDASH (Punteggio esterno verificato /100)</option>
            <option value="ODI">ODI v2.1a IT — Oswestry Disability Index (%)</option>
            <option value="NDI">NDI IT — Neck Disability Index (%)</option>
            <option value="LEFS">LEFS IT — Lower Extremity Functional Scale (/80)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Data Rilevazione *</label>
          <input class="form-control" type="date" name="recorded_date" value="${todayStr}" required />
        </div>
      </div>

      <div class="form-group" id="singleScoreBox">
        <label class="form-label">Punteggio Rilevato *</label>
        <input class="form-control" type="number" step="0.1" name="score_value" placeholder="Es. 5" />
      </div>

      <div id="psfsItemsBox" style="display:none; background:var(--bg-subtle); padding:12px; border-radius:8px; margin-bottom:12px;">
        <h5 style="margin:0 0 8px 0;">Attività Specifiche PSFS (Lascia vuoto il punteggio se un item non è valutato: non verrà contato come 0)</h5>
        <div class="grid-2">
          <input class="form-control" name="psfs_act_1" placeholder="Attività 1 (es. Correre 10 km)" />
          <input class="form-control" type="number" min="0" max="10" step="0.5" name="psfs_score_1" placeholder="Punteggio 0-10" />
        </div>
        <div class="grid-2" style="margin-top:6px;">
          <input class="form-control" name="psfs_act_2" placeholder="Attività 2 (es. Scendere le scale)" />
          <input class="form-control" type="number" min="0" max="10" step="0.5" name="psfs_score_2" placeholder="Punteggio 0-10 (o vuoto se mancante)" />
        </div>
        <div class="grid-2" style="margin-top:6px;">
          <input class="form-control" name="psfs_act_3" placeholder="Attività 3 (opzionale)" />
          <input class="form-control" type="number" min="0" max="10" step="0.5" name="psfs_score_3" placeholder="Punteggio 0-10 (o vuoto se mancante)" />
        </div>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Contesto Rilevazione</label>
          <input class="form-control" name="context_label" value="Valutazione in seduta" />
        </div>
        <div class="form-group">
          <label class="form-label">Note Cliniche</label>
          <input class="form-control" name="clinical_note" />
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelOutcomeBtn">Annulla</button>
        <button type="submit" class="btn btn-physio">Salva Misura</button>
      </div>
    </form>
  `);

  document.getElementById("outcomeScaleSelect")?.addEventListener("change", (e) => {
    const isPsfs = e.target.value === "PSFS";
    document.getElementById("psfsItemsBox").style.display = isPsfs ? "block" : "none";
    document.getElementById("singleScoreBox").style.display = isPsfs ? "none" : "block";
  });
  document.getElementById("cancelOutcomeBtn")?.addEventListener("click", closeModal);
  document.getElementById("recordOutcomeForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const scaleCode = fd.get("scale_code");
    let responses = [];
    if (scaleCode === "PSFS") {
      for (let i = 1; i <= 3; i++) {
        const act = fd.get(`psfs_act_${i}`);
        const sc = fd.get(`psfs_score_${i}`);
        if (act && act.trim()) {
          responses.push({ activity: act.trim(), score: sc !== "" && sc !== null ? Number(sc) : null });
        }
      }
    }
    try {
      await apiFetch("/api/physio/outcome-measures", {
        method: "POST",
        body: {
          episode_id: episodeId,
          evaluation_id: evaluationId,
          scale_code: scaleCode,
          score_value: fd.get("score_value"),
          responses,
          recorded_date: fd.get("recorded_date"),
          context_label: fd.get("context_label"),
          clinical_note: fd.get("clinical_note")
        }
      });
      closeModal();
      await refreshCurrentView();
    } catch (err) {
      alert(err.message);
    }
  });
}

// --- MODALE NOTA DI SEDUTA SOAP (CON BOZZA, RICHIAMO NOTA PRECEDENTE E FINALIZZAZIONE) ---
function showSoapNoteModal(episode, existingNote = null, copiedFromNote = null, appointmentId = null) {
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  const base = existingNote || copiedFromNote || {};
  openModal(`
    <h2 style="margin-top:0;">
      📝 ${existingNote ? `Modifica Nota SOAP #${existingNote.id}` : copiedFromNote ? `Nuova Nota SOAP (Bozza richiamata dalla seduta del ${copiedFromNote.note_date})` : "Nuova Nota di Seduta (SOAP)"}
    </h2>
    ${
      copiedFromNote
        ? `<div style="background:#e0f2fe; padding:8px 12px; border-radius:6px; font-size:12.5px; margin-bottom:10px;">
            ℹ️ Testo precompilato come bozza a partire dalla nota del <strong>${esc(copiedFromNote.note_date)}</strong> (la data della nota originaria viene conservata nel tracciamento).
          </div>`
        : ""
    }
    <form id="soapNoteForm">
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Data Seduta *</label>
          <input class="form-control" type="date" name="note_date" value="${esc(existingNote ? existingNote.note_date : todayStr)}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Dolore Pre-Seduta (0-10)</label>
          <input class="form-control" type="number" min="0" max="10" name="pain_pre" value="${esc(base.pain_pre ?? "")}" />
        </div>
        <div class="form-group">
          <label class="form-label">Dolore Post-Seduta (0-10)</label>
          <input class="form-control" type="number" min="0" max="10" name="pain_post" value="${esc(base.pain_post ?? "")}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">S — Soggettivo / Risposta alla seduta precedente</label>
        <textarea class="form-control" name="subjective_response">${esc(base.subjective_response || "")}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">O — Oggettivo / Rivalutazione rapida in seduta</label>
        <textarea class="form-control" name="objective_findings">${esc(base.objective_findings || "")}</textarea>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">A — Interventi svolti in seduta</label>
          <textarea class="form-control" name="interventions_performed">${esc(base.interventions_performed || "")}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Esercizi terapeutici eseguiti / assegnati</label>
          <textarea class="form-control" name="exercises_performed">${esc(base.exercises_performed || "")}</textarea>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">P — Piano e prossimi passi</label>
        <textarea class="form-control" name="plan_next_steps">${esc(base.plan_next_steps || "")}</textarea>
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:12px;">
        <button type="button" class="btn btn-secondary" id="cancelSoapBtn">Annulla</button>
        <div style="display:flex; gap:8px;">
          <button type="submit" class="btn btn-secondary" data-soap-status="bozza">💾 Salva come Bozza</button>
          <button type="submit" class="btn btn-primary" data-soap-status="finalizzata">🔒 Salva e Finalizza Nota</button>
        </div>
      </div>
    </form>
  `);

  document.getElementById("cancelSoapBtn")?.addEventListener("click", closeModal);
  let targetStatus = "bozza";
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
    <h2 style="margin-top:0;">📌 Aggiungi Integrazione / Rettifica Datata</h2>
    <p style="font-size:13px; color:#475569;">
      Il documento finalizzato (<strong>${esc(title)}</strong>) resta immutabile. Questa rettifica verrà allegata con data, ora e autore.
    </p>
    <form id="addendumForm">
      <div class="form-group">
        <label class="form-label">Motivo della rettifica / integrazione *</label>
        <input class="form-control" name="reason" value="Precisazione clinica successiva" required />
      </div>
      <div class="form-group">
        <label class="form-label">Testo dell'integrazione *</label>
        <textarea class="form-control" name="addendum_text" required></textarea>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelAddendumBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Registra Rettifica Datata</button>
      </div>
    </form>
  `);
  document.getElementById("cancelAddendumBtn")?.addEventListener("click", closeModal);
  document.getElementById("addendumForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch("/api/physio/addenda", {
      method: "POST",
      body: {
        note_id,
        evaluation_id,
        reason: fd.get("reason"),
        addendum_text: fd.get("addendum_text")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

function showCloseEpisodeModal(episode) {
  openModal(`
    <h2 style="margin-top:0;">🏁 Stato e Chiusura Episodio Fisioterapico</h2>
    <form id="closeEpForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Stato Episodio</label>
          <select class="form-control" name="status">
            <option value="attivo" ${episode.status === "attivo" ? "selected" : ""}>Attivo</option>
            <option value="in_pausa" ${episode.status === "in_pausa" ? "selected" : ""}>In Pausa</option>
            <option value="concluso" ${episode.status === "concluso" ? "selected" : ""}>Concluso</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Esito alla Chiusura</label>
          <input class="form-control" name="closure_outcome" value="${esc(episode.closure_outcome || "Obiettivi funzionali raggiunti")}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Sintesi Finale del Percorso</label>
        <textarea class="form-control" name="closure_summary">${esc(episode.closure_summary || "")}</textarea>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelCloseEpBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Salva Stato Episodio</button>
      </div>
    </form>
  `);
  document.getElementById("cancelCloseEpBtn")?.addEventListener("click", closeModal);
  document.getElementById("closeEpForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await apiFetch(`/api/physio/episodes/${episode.id}`, {
      method: "PUT",
      body: {
        expected_version: episode.version,
        status: fd.get("status"),
        closure_outcome: fd.get("closure_outcome"),
        closure_summary: fd.get("closure_summary")
      }
    });
    closeModal();
    await refreshCurrentView();
  });
}

// --- MODALE PONTE LIMITAZIONE CONDIVISA FISIO -> FITNESS ---
function showAddSharedLimitationModal(personId, episodes = [], defaultEpId = null) {
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  openModal(`
    <h2 style="margin-top:0;">🔗 Condividi Limitazione Funzionale Rilevante con l'Area Fitness</h2>
    <p style="font-size:12.5px; color:#64748b;">
      Registra solo l'indicazione operativa utile per l'allenamento mantenendo fonte e data, senza esporre l'intera cartella clinica.
    </p>
    <form id="sharedLimForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Titolo Sintetico Limitazione *</label>
          <input class="form-control" name="title" placeholder="Es. Evitare overhead pesante > 90° spalla DX" required />
        </div>
        <div class="form-group">
          <label class="form-label">Distretto &amp; Lato</label>
          <div style="display:flex; gap:6px;">
            <input class="form-control" name="body_region" placeholder="Es. Ginocchio / Spalla" />
            <select class="form-control" name="laterality" style="width:120px;">
              <option value="DX">DX</option>
              <option value="SX">SX</option>
              <option value="Bilaterale">Bilaterale</option>
              <option value="Centrale">Centrale</option>
            </select>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Indicazione Operativa per il Personal Training *</label>
        <textarea class="form-control" name="description" required placeholder="Cosa evitare, quale range/carico utilizzare e soglia di tolleranza..."></textarea>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Fonte della Limitazione *</label>
          <input class="form-control" name="source_type" value="Valutazione Fisioterapica" required />
        </div>
        <div class="form-group">
          <label class="form-label">Data Rilevazione *</label>
          <input class="form-control" type="date" name="recorded_date" value="${todayStr}" required />
        </div>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelLimBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Pubblica Limitazione Condivisa</button>
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

// ============================================================================
// MODALI AREA FITNESS (PROFILO, METRICHE, PROGRAMMA VERSIONATO E WORKOUT LOG)
// ============================================================================

function showEditFitnessProfileModal(personId, prof = {}) {
  openModal(`
    <h2 style="margin-top:0;">🎯 Modifica Profilo Fitness</h2>
    <form id="fitProfForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Obiettivi Primari</label>
          <input class="form-control" name="primary_goals" value="${esc(prof.primary_goals || "")}" />
        </div>
        <div class="form-group">
          <label class="form-label">Livello di Esperienza</label>
          <select class="form-control" name="experience_level">
            <option value="Principiante" ${prof.experience_level === "Principiante" ? "selected" : ""}>Principiante</option>
            <option value="Intermedio" ${prof.experience_level === "Intermedio" ? "selected" : ""}>Intermedio</option>
            <option value="Avanzato / Agonista" ${prof.experience_level === "Avanzato / Agonista" ? "selected" : ""}>Avanzato / Agonista</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Disponibilità Settimanale</label>
          <input class="form-control" name="weekly_availability" value="${esc(prof.weekly_availability || "")}" />
        </div>
        <div class="form-group">
          <label class="form-label">Attrezzatura Disponibile</label>
          <input class="form-control" name="available_equipment" value="${esc(prof.available_equipment || "")}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Preferenze e Note Valutazione Iniziale</label>
        <textarea class="form-control" name="initial_assessment_notes">${esc(prof.initial_assessment_notes || "")}</textarea>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelFitProfBtn">Annulla</button>
        <button type="submit" class="btn btn-fitness">Salva Profilo</button>
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
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  openModal(`
    <h2 style="margin-top:0;">📈 Registra Test o Misurazione Fitness</h2>
    <form id="fitMetricForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Categoria</label>
          <select class="form-control" name="metric_category">
            <option value="Forza">Forza (RM / Isometrica)</option>
            <option value="Antropometria">Antropometria / Peso</option>
            <option value="Cardio / Performance">Cardio / Salto / Performance</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Data</label>
          <input class="form-control" type="date" name="recorded_date" value="${todayStr}" required />
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Nome Test / Parametro *</label>
          <input class="form-control" name="metric_name" placeholder="Es. Squat 5RM / Peso Corporeo" required />
        </div>
        <div class="form-group">
          <label class="form-label">Valore Numerico *</label>
          <input class="form-control" type="number" step="0.1" name="value_num" required />
        </div>
        <div class="form-group">
          <label class="form-label">Unità *</label>
          <input class="form-control" name="unit" value="kg" required />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Protocollo / Note</label>
        <input class="form-control" name="protocol_notes" />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelFitMetricBtn">Annulla</button>
        <button type="submit" class="btn btn-fitness">Salva Misura</button>
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
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  const defaultWorkouts = existingProg?.workouts || [
    {
      day_name: "Scheda A — Full Body / Forza",
      exercises: [
        { name: "Goblet Squat / Trap Bar Deadlift", sets: 4, reps: "8", load: "60 kg", rest: "120s", rpe: "7.5", notes: "Controllo eccentrico" },
        { name: "Push-up / Panca Manubri", sets: 3, reps: "10", load: "2x18 kg", rest: "90s", rpe: "8", notes: "" },
        { name: "Rematore con Manubrio", sets: 3, reps: "10", load: "20 kg", rest: "90s", rpe: "8", notes: "" }
      ]
    }
  ];

  openModal(`
    <h2 style="margin-top:0;">
      🏋️ ${existingProg ? `Modifica Programma (Crea versione v${existingProg.version + 1} conservando storico)` : "Nuovo Programma Fitness"}
    </h2>
    <form id="fitProgForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Titolo Programma *</label>
          <input class="form-control" name="title" value="${esc(existingProg?.title || "Programma Forza & Ricondizionamento")}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Obiettivo *</label>
          <input class="form-control" name="goal" value="${esc(existingProg?.goal || "Ipertrofia funzionale e controllo motorio")}" required />
        </div>
      </div>
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Data Inizio</label>
          <input class="form-control" type="date" name="start_date" value="${esc(existingProg?.start_date || todayStr)}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Frequenza / Sett</label>
          <input class="form-control" type="number" name="frequency_per_week" value="${existingProg?.frequency_per_week || 2}" min="1" max="7" />
        </div>
        <div class="form-group">
          <label class="form-label">Motivo Modifica Versione</label>
          <input class="form-control" name="change_note" value="Progressione carichi e volume" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Schede ed Esercizi (JSON strutturato modificabile)</label>
        <textarea class="form-control" name="workouts_json" style="font-family:monospace; min-height:170px;">${esc(JSON.stringify(defaultWorkouts, null, 2))}</textarea>
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelFitProgBtn">Annulla</button>
        <button type="submit" class="btn btn-fitness">Salva Programma</button>
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
      alert("Formato JSON degli esercizi non valido.");
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

// --- MODALE REGISTRAZIONE VELOCE SEDUTA FITNESS (PROGRAMMATO VS SVOLTO) ---
function showWorkoutLogModal(personId, program = null, dayIdx = 0, appointmentId = null) {
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  const dayObj = program?.workouts?.[dayIdx] || {
    day_name: "Seduta Personal Training",
    exercises: [
      { name: "Squat / Leg Press", sets: 4, reps: "8", load: "70 kg", rpe: "7.5" },
      { name: "Spinte Manubri", sets: 3, reps: "10", load: "2x20 kg", rpe: "8" }
    ]
  };
  const planned = dayObj.exercises || [];

  const exRowsHtml = planned
    .map(
      (ex, i) => `
      <tr>
        <td>
          <input class="form-control" name="ex_name_${i}" value="${esc(ex.name)}" />
          <div style="font-size:11px; color:#64748b;">Prog: ${esc(ex.sets)}×${esc(ex.reps)} @ ${esc(ex.load)} (RPE ${esc(ex.rpe || "-")})</div>
        </td>
        <td><input class="form-control" name="ex_sets_${i}" value="${esc(ex.sets)}" style="width:70px;" /></td>
        <td><input class="form-control" name="ex_reps_${i}" value="${esc(ex.reps)}" style="width:90px;" /></td>
        <td><input class="form-control" name="ex_load_${i}" value="${esc(ex.load)}" /></td>
        <td><input class="form-control" name="ex_rpe_${i}" value="${esc(ex.rpe || "")}" style="width:80px;" /></td>
      </tr>
    `
    )
    .join("");

  openModal(`
    <h2 style="margin-top:0;">⚡ Registra Seduta Fitness Veloce (Programmato vs Svolto)</h2>
    <form id="workoutLogForm">
      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Giornata / Scheda</label>
          <input class="form-control" name="workout_day_name" value="${esc(dayObj.day_name)}" required />
        </div>
        <div class="form-group">
          <label class="form-label">Data Seduta</label>
          <input class="form-control" type="date" name="session_date" value="${todayStr}" required />
        </div>
        <div class="form-group">
          <label class="form-label">RPE Globale Seduta (1-10)</label>
          <input class="form-control" type="number" step="0.5" min="1" max="10" name="session_rpe" value="7.5" />
        </div>
      </div>

      <div class="table-wrap" style="margin-bottom:12px;">
        <table class="data-table">
          <thead><tr><th>Esercizio (e riferimento programmato)</th><th>Serie Svolte</th><th>Rip. Svolte</th><th>Carico Svolto</th><th>RPE Effettivo</th></tr></thead>
          <tbody>${exRowsHtml}</tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Risposta / Feedback del Cliente</label>
          <input class="form-control" name="client_feedback" placeholder="Es. Buona tenuta tecnica, energia alta..." />
        </div>
        <div class="form-group">
          <label class="form-label">Eventuali Sintomi Emersi (lasciare vuoto se assenti)</label>
          <input class="form-control" name="reported_symptoms" placeholder="Es. Lieve fastidio rotuleo 2/10 su ultima serie..." />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Indicazioni per la Seduta Successiva</label>
        <input class="form-control" name="next_session_notes" placeholder="Es. Aumentare 2.5 kg sulla Trap Bar..." />
      </div>

      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelWLogBtn">Annulla</button>
        <button type="submit" class="btn btn-fitness">Salva Seduta Fitness</button>
      </div>
    </form>
  `);
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

// --- MODALI CONSENSI E UPLOAD ALLEGATI PRIVATI ---
function showAddConsentModal(personId) {
  const todayStr = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
  openModal(`
    <h2 style="margin-top:0;">🛡️ Registra Informativa Privacy o Consenso Sanitario</h2>
    <form id="consentForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Tipologia Documento *</label>
          <select class="form-control" name="doc_type">
            <option value="informativa_privacy">Presa visione Informativa Privacy (Art. 13 GDPR)</option>
            <option value="consenso_trattamento_sanitario">Consenso al Trattamento Dati Sanitari</option>
            <option value="consenso_comunicazioni">Consenso Comunicazioni Organizzative</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Versione Documento *</label>
          <input class="form-control" name="doc_version" value="v2026.1" required />
        </div>
      </div>
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Stato</label>
          <select class="form-control" name="status">
            <option value="acquisito">Acquisito</option>
            <option value="revocato">Revocato</option>
            <option value="in_attesa">In attesa di firma</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Data Firma / Acquisizione</label>
          <input class="form-control" type="date" name="signed_date" value="${todayStr}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Modalità di Acquisizione</label>
        <input class="form-control" name="acquisition_method" value="Modulo firmato in studio" />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelConsentBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Registra Documento</button>
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
    <h2 style="margin-top:0;">📎 Carica Allegato Privato (PDF o Immagine)</h2>
    <p style="font-size:12.5px; color:#64748b;">Il file viene salvato nello storage privato e sarà accessibile solo previa autenticazione.</p>
    <form id="uploadAttForm">
      <div class="form-group">
        <label class="form-label">Seleziona File (PDF, PNG, JPG, WEBP max 15 MB) *</label>
        <input class="form-control" type="file" id="attFileInput" accept=".pdf,image/png,image/jpeg,image/webp" required />
      </div>
      <div class="form-group">
        <label class="form-label">Categoria</label>
        <select class="form-control" name="category">
          <option value="Referto Diagnostico">Referto Diagnostico (RMN, RX, Eco)</option>
          <option value="Prescrizione Medica">Prescrizione / Impegnativa Medica</option>
          <option value="Modulo Consenso Firmato">Modulo Consenso / Informativa Firmato</option>
          <option value="Foto Posturale / Test">Foto Valutazione / Esercizio</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Descrizione</label>
        <input class="form-control" name="description" placeholder="Es. RMN spalla DX del 10/11/2026" />
      </div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancelAttBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Carica in Sicurezza</button>
      </div>
    </form>
  `);
  document.getElementById("cancelAttBtn")?.addEventListener("click", closeModal);
  document.getElementById("uploadAttForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fileInput = document.getElementById("attFileInput");
    const file = fileInput.files[0];
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
// INIZIALIZZAZIONE APP, RICERCA GLOBALE, PRIVACY MODE E SERVICE WORKER
// ============================================================================

function applyTheme(theme) {
  const mode = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", mode);
  try {
    localStorage.setItem("gestionale_rcv_theme", mode);
  } catch {}
  const btn = document.getElementById("themeToggleBtn");
  if (btn) {
    btn.textContent = mode === "dark" ? "☀️ Tema Chiaro" : "🌙 Tema Scuro";
  }
}

function togglePrivacyMode(forceValue = null) {
  state.privacyMode = forceValue !== null ? forceValue : !state.privacyMode;
  document.body.classList.toggle("privacy-mode", state.privacyMode);
  const btn = document.getElementById("privacyToggleBtn");
  if (btn) {
    btn.textContent = state.privacyMode ? "👁️ Mostra dati sensibili" : "👁️ Oscura dati sensibili";
  }
}

async function initApp() {
  const savedTheme = (typeof localStorage !== "undefined" && localStorage.getItem("gestionale_rcv_theme")) || "dark";
  applyTheme(savedTheme);

  // Registra Service Worker Online-First (solo asset statici, mai cartelle cliniche)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Binding Login
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
      setSaveStatus("saved", "Connesso");
      const cats = await apiFetch("/api/catalogs", { silentStatus: true });
      state.catalogs = cats;
      await refreshCurrentView();
    } catch (err) {
      if (err.data && err.data.require_totp) {
        document.getElementById("loginTotpGroup").style.display = "block";
      }
      showLoginScreen(err.message);
    }
  });

  // Binding Navigazione Sidebar e Bottom Bar Mobile
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nav = btn.getAttribute("data-nav");
      if (nav === "people") {
        state.selectedPersonId = null;
      }
      await navigateTo(nav);
    });
  });

  // Binding Tema e Privacy Mode
  document.getElementById("themeToggleBtn")?.addEventListener("click", () => {
    const curr = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(curr === "dark" ? "light" : "dark");
  });
  document.getElementById("privacyToggleBtn")?.addEventListener("click", () => togglePrivacyMode());
  document.getElementById("disablePrivacyBtn")?.addEventListener("click", () => togglePrivacyMode(false));

  // Binding Logout
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

  // Binding Azioni Rapide Globali
  document.getElementById("qaNewPersonBtn")?.addEventListener("click", () => showNewPersonModal());
  document.getElementById("qaNewApptBtn")?.addEventListener("click", () => showNewAppointmentModal());
  document.getElementById("qaNewPackageBtn")?.addEventListener("click", () => showNewPackageModal());
  document.getElementById("qaNewEvalBtn")?.addEventListener("click", async () => {
    if (state.selectedPersonId) {
      state.selectedPersonTab = "fisio";
      await navigateTo("people", { personId: state.selectedPersonId, personTab: "fisio" });
    } else {
      await navigateTo("people");
    }
  });
  document.getElementById("qaLogSessionBtn")?.addEventListener("click", async () => {
    if (state.selectedPersonId) {
      state.selectedPersonTab = "fitness";
      await navigateTo("people", { personId: state.selectedPersonId, personTab: "fitness" });
    } else {
      await navigateTo("agenda");
    }
  });

  // Ricerca Rapida Globale
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
      searchDrop.innerHTML = `<div class="search-result-item" style="color:#64748b;">Nessuna persona trovata</div>`;
    } else {
      searchDrop.innerHTML = list
        .map(
          (p) => `
          <div class="search-result-item" data-search-pick="${p.id}">
            <div>
              <strong>${esc(p.last_name)} ${esc(p.first_name)}</strong>
              <div style="font-size:12px; color:#64748b;">${esc(p.phone || "")} · ${esc(p.sport_activity || "")}</div>
            </div>
            <div>
              ${p.physio_active ? `<span class="badge badge-physio">Fisio</span>` : ""}
              ${p.fitness_active ? `<span class="badge badge-fitness">Fitness</span>` : ""}
            </div>
          </div>
        `
        )
        .join("");
      searchDrop.querySelectorAll("[data-search-pick]").forEach((item) => {
        item.addEventListener("click", async () => {
          const pid = Number(item.getAttribute("data-search-pick"));
          searchDrop.style.display = "none";
          searchInput.value = "";
          await navigateTo("people", { personId: pid, personTab: "riepilogo" });
        });
      });
    }
    searchDrop.style.display = "block";
  });

  // Stato iniziale autenticazione
  try {
    const status = await apiFetch("/api/auth/status", { silentStatus: true });
    state.envMode = status.env_mode || "demo";
    document.getElementById("sidebarEnvBadge").textContent =
      state.envMode === "demo" ? "Ambiente DEMO (Dati fittizi)" : `Ambiente ${state.envMode.toUpperCase()}`;
    if (status.authenticated) {
      state.authenticated = true;
      state.csrfToken = status.csrf_token;
      state.user = status.user;
      document.getElementById("practitionerLabel").textContent = status.user.display_name;
      document.getElementById("loginScreen").style.display = "none";
      document.getElementById("appShell").style.display = "flex";
      setSaveStatus("saved", "Connesso");
      const cats = await apiFetch("/api/catalogs", { silentStatus: true });
      state.catalogs = cats;
      await refreshCurrentView();
    } else {
      showLoginScreen();
    }
  } catch {
    showLoginScreen();
  }
}

window.addEventListener("DOMContentLoaded", initApp);
