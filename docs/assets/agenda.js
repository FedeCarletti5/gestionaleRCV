/**
 * Pagina Agenda (Sola Lettura da Apple Calendar via iCloud CalDAV privato).
 * - Zero appuntamenti salvati su Supabase: specchio live del calendario Apple "Lavoro".
 * - Matching intelligente 100% lato browser sui nomi dei clienti per scalare/aggiungere
 *   sedute sui pacchetti in 1 clic senza creare alcun legame nel database.
 */

const IT_WEEKDAYS = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const IT_MONTHS = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre"
];

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function addDaysYmd(ymd, delta) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function weekBoundsFromYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom..6=Sab
  const offsetMon = dow === 0 ? -6 : 1 - dow;
  const from = addDaysYmd(ymd, offsetMon);
  const to = addDaysYmd(from, 6);
  return { from, to };
}

function formatDayHeadingIt(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${IT_WEEKDAYS[dow]} ${d} ${IT_MONTHS[m - 1]} ${y}`;
}

function formatShortRangeIt(fromYmd, toYmd) {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  if (m1 === m2 && y1 === y2) {
    return `${d1} – ${d2} ${IT_MONTHS[m1 - 1]} ${y1}`;
  }
  return `${d1} ${IT_MONTHS[m1 - 1]} – ${d2} ${IT_MONTHS[m2 - 1]} ${y2}`;
}

function normalizeMatchText(str) {
  return (
    " " +
    String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim() +
    " "
  );
}

/**
 * Matching prudente e non ambiguo tra titolo evento Apple Calendar e anagrafica clienti.
 * 1) Nome + Cognome entrambi presenti come parole intere.
 * 2) In alternativa, Cognome univoco (>= 4 caratteri) presente come parola intera.
 */
export function matchEventToPerson(summary, people) {
  const normSummary = normalizeMatchText(summary);
  if (normSummary.trim().length < 2 || !Array.isArray(people) || !people.length) return null;

  const fullMatches = [];
  for (const p of people) {
    const fn = normalizeMatchText(p.first_name).trim();
    const ln = normalizeMatchText(p.last_name).trim();
    if (fn.length >= 2 && ln.length >= 2) {
      if (normSummary.includes(` ${fn} `) && normSummary.includes(` ${ln} `)) {
        fullMatches.push(p);
      }
    }
  }
  if (fullMatches.length === 1) return fullMatches[0];
  if (fullMatches.length > 1) return null;

  const surnameMatches = [];
  for (const p of people) {
    const ln = normalizeMatchText(p.last_name).trim();
    if (ln.length >= 4 && normSummary.includes(` ${ln} `)) {
      surnameMatches.push(p);
    }
  }
  if (surnameMatches.length === 1) return surnameMatches[0];
  return null;
}

function pickBestPackageForEvent(summary, personPackages, helpers) {
  if (!personPackages || !personPackages.length) return null;
  const active = personPackages.filter((k) => k.status === "attivo");
  if (active.length === 1) return active[0];
  if (active.length > 1) {
    const low = normalizeMatchText(summary);
    const hinted = active.find((k) => {
      const cat = helpers.inferPackageCategory(k);
      if (cat.key === "fisio" && (low.includes(" fisio ") || low.includes(" fisioterapia ") || low.includes(" terapia "))) return true;
      if (cat.key === "blvck" && low.includes(" blvck ")) return true;
      if (cat.key === "pt_duetto" && low.includes(" duetto ")) return true;
      if (cat.key === "pt_sc" && (low.includes(" sc ") || low.includes(" conditioning "))) return true;
      if (cat.key === "pt_normale" && low.includes(" pt ")) return true;
      return false;
    });
    return hinted || active[0];
  }
  // Nessun attivo: se c'è un pacchetto esaurito recente proponiamo Rinnova
  const exhausted = personPackages.find((k) => k.status === "esaurito" && !helpers.isOpenSinglePackage(k));
  return exhausted || null;
}

function renderSetupFormMarkup(existingCfg = null, inline = false) {
  const isEdit = Boolean(existingCfg?.configured);
  return `
    ${inline ? "" : `<h2 class="modal-title">Collegamento Apple Calendar (sola lettura)</h2>`}
    <div style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin-bottom:14px;">
      Collega il tuo calendario <strong>Lavoro</strong> di Apple in modo <strong>100% privato e in sola lettura</strong>:
      nessun evento viene salvato nel database e il gestionale non modifica mai il tuo calendario.
    </div>

    <div style="background:var(--bg-hover); border:1px solid var(--border); border-radius:var(--radius-md); padding:11px 14px; font-size:12.5px; color:var(--text-secondary); margin-bottom:16px;">
      <div style="font-weight:600; color:var(--text); margin-bottom:6px;">Come generare la Password specifica per app (30 secondi):</div>
      <ol style="margin:0; padding-left:18px; display:flex; flex-direction:column; gap:4px;">
        <li>Apri <a href="https://account.apple.com" target="_blank" rel="noopener noreferrer" style="color:var(--accent); font-weight:500;">account.apple.com</a> ed effettua l'accesso.</li>
        <li>Vai in <strong>Accesso e sicurezza</strong> → <strong>Password specifiche per le app</strong> → clicca <strong>+</strong> (es. <em>Gestionale RCV</em>).</li>
        <li>Copia la password generata (formato <code>xxxx-xxxx-xxxx-xxxx</code>) e incollala qui sotto: viene cifrata AES-256 sul server e puoi revocarla in 1 clic quando vuoi.</li>
      </ol>
    </div>

    <form id="appleCalDiscoverForm">
      <div class="grid-2">
        <div class="form-group">
          <label class="form-label">Apple ID (email iCloud) *</label>
          <input class="form-control" type="email" id="calAppleIdInput" name="apple_id" value="${esc(existingCfg?.apple_id || "")}" placeholder="nome@icloud.com" autocomplete="off" required />
        </div>
        <div class="form-group">
          <label class="form-label">Password specifica per app ${isEdit ? "(lascia vuoto per tenere l'attuale)" : "*"}</label>
          <input class="form-control" type="password" id="calAppPassInput" name="app_password" placeholder="xxxx-xxxx-xxxx-xxxx" autocomplete="new-password" ${isEdit ? "" : "required"} />
        </div>
      </div>

      <div id="calSetupError" class="form-error" style="display:none; margin-bottom:10px;"></div>

      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
        <div>
          ${
            isEdit
              ? `<button type="button" class="btn btn-sm btn-danger-ghost" id="calDisconnectBtn">Scollega calendario</button>`
              : ""
          }
        </div>
        <div style="display:flex; gap:8px;">
          ${inline ? "" : `<button type="button" class="btn btn-secondary" id="calCancelModalBtn">Chiudi</button>`}
          <button type="submit" class="btn btn-primary" id="calDiscoverBtn">Cerca calendari iCloud</button>
        </div>
      </div>
    </form>

    <div id="calPickerStep" style="display:none; margin-top:16px; padding-top:14px; border-top:1px solid var(--border);">
      <div style="font-size:13px; font-weight:600; color:var(--text); margin-bottom:8px;">Seleziona il calendario da rispecchiare (sola lettura):</div>
      <div id="calListChoices" class="pkg-preset-grid" style="margin-bottom:12px;"></div>
      <div style="display:flex; justify-content:flex-end; gap:8px;">
        <button type="button" class="btn btn-primary" id="calSaveChoiceBtn">Salva e sincronizza</button>
      </div>
    </div>
  `;
}

function bindSetupFormHandlers(root, existingCfg, ctx, { onSaved, onDisconnected, onCancel }) {
  const form = root.querySelector("#appleCalDiscoverForm");
  const appleIdInp = root.querySelector("#calAppleIdInput");
  const passInp = root.querySelector("#calAppPassInput");
  const errBox = root.querySelector("#calSetupError");
  const discoverBtn = root.querySelector("#calDiscoverBtn");
  const pickerStep = root.querySelector("#calPickerStep");
  const listBox = root.querySelector("#calListChoices");
  const saveBtn = root.querySelector("#calSaveChoiceBtn");

  let discovered = [];
  let selectedCal = null;

  const showErr = (msg) => {
    if (!errBox) return;
    errBox.textContent = msg || "";
    errBox.style.display = msg ? "block" : "none";
  };

  root.querySelector("#calCancelModalBtn")?.addEventListener("click", () => onCancel?.());

  root.querySelector("#calDisconnectBtn")?.addEventListener("click", async () => {
    if (!window.confirm("Scollegare Apple Calendar e rimuovere la password per app cifrata dal gestionale?")) return;
    try {
      await ctx.apiFetch("/api/calendar/config", { method: "DELETE" });
      if (ctx.state.user?.settings) {
        ctx.state.user.settings.apple_caldav = { configured: false, apple_id: "", calendar_name: "", calendar_color: "#1e4976" };
      }
      onDisconnected?.();
    } catch (err) {
      showErr(err.message);
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showErr("");
    const appleId = (appleIdInp?.value || "").trim();
    const appPassword = (passInp?.value || "").trim();
    const useSaved = Boolean(existingCfg?.configured && !appPassword);
    if (!appleId || (!appPassword && !useSaved)) {
      showErr("Inserisci Apple ID e Password specifica per app.");
      return;
    }

    if (discoverBtn) {
      discoverBtn.disabled = true;
      discoverBtn.textContent = "Connessione ad Apple iCloud...";
    }
    try {
      const res = await ctx.apiFetch("/api/calendar/discover", {
        method: "POST",
        body: { apple_id: appleId, app_password: appPassword, use_saved: useSaved }
      });
      discovered = res.calendars || [];
      if (!discovered.length) {
        showErr("Nessun calendario eventi trovato su questo account iCloud.");
        return;
      }

      // Preseleziona automaticamente il calendario attuale oppure "Lavoro" se presente
      selectedCal =
        discovered.find((c) => existingCfg?.calendar_name && c.name.toLowerCase() === existingCfg.calendar_name.toLowerCase()) ||
        discovered.find((c) => c.name.toLowerCase().includes("lavoro")) ||
        discovered[0];

      const paintChoices = () => {
        if (!listBox) return;
        listBox.innerHTML = discovered
          .map(
            (c, idx) => `
            <button type="button" class="pkg-preset-card ${selectedCal && c.url === selectedCal.url ? "active" : ""}" data-cal-idx="${idx}">
              <span class="pkg-preset-title" style="display:flex; align-items:center; gap:7px;">
                <span class="cal-dot" style="background:${esc(c.color || "#1e4976")};"></span>
                <span>${esc(c.name)}</span>
              </span>
              <span class="pkg-preset-sub">Calendario iCloud</span>
            </button>`
          )
          .join("");
        listBox.querySelectorAll("[data-cal-idx]").forEach((btn) => {
          btn.addEventListener("click", () => {
            selectedCal = discovered[Number(btn.getAttribute("data-cal-idx"))];
            paintChoices();
          });
        });
      };

      paintChoices();
      if (pickerStep) pickerStep.style.display = "block";
    } catch (err) {
      showErr(err.message || "Impossibile connettersi ad Apple iCloud.");
    } finally {
      if (discoverBtn) {
        discoverBtn.disabled = false;
        discoverBtn.textContent = "Cerca calendari iCloud";
      }
    }
  });

  saveBtn?.addEventListener("click", async () => {
    if (!selectedCal) return;
    showErr("");
    saveBtn.disabled = true;
    saveBtn.textContent = "Salvataggio...";
    try {
      const saved = await ctx.apiFetch("/api/calendar/config", {
        method: "POST",
        body: {
          apple_id: (appleIdInp?.value || "").trim(),
          app_password: (passInp?.value || "").trim(),
          calendar_url: selectedCal.url,
          calendar_name: selectedCal.name,
          calendar_color: selectedCal.color || "#1e4976"
        }
      });
      if (ctx.state.user) {
        ctx.state.user.settings = ctx.state.user.settings || {};
        ctx.state.user.settings.apple_caldav = saved;
      }
      onSaved?.(saved);
    } catch (err) {
      showErr(err.message || "Errore nel salvataggio della configurazione.");
      saveBtn.disabled = false;
      saveBtn.textContent = "Salva e sincronizza";
    }
  });
}

export async function showAppleCalendarConfigModal(ctx) {
  let existingCfg = ctx.state.user?.settings?.apple_caldav || null;
  try {
    existingCfg = await ctx.apiFetch("/api/calendar/config");
  } catch {
    // usa cache locale se disponibile
  }
  ctx.openModal(renderSetupFormMarkup(existingCfg, false));
  const modalRoot = document.getElementById("modalContent");
  bindSetupFormHandlers(modalRoot, existingCfg, ctx, {
    onCancel: () => ctx.closeModal(),
    onSaved: async () => {
      ctx.closeModal();
      await ctx.refreshCurrentView();
    },
    onDisconnected: async () => {
      ctx.closeModal();
      await ctx.refreshCurrentView();
    }
  });
}

export async function renderAgendaView(container, ctx) {
  const { state, apiFetch, helpers } = ctx;
  const view = state.agendaView === "week" ? "week" : "day";
  const anchorDate = state.agendaDate || helpers.todayRomeStr();
  const todayStr = helpers.todayRomeStr();
  const range = view === "week" ? weekBoundsFromYmd(anchorDate) : { from: anchorDate, to: anchorDate };

  const headerSubtitle =
    view === "week"
      ? formatShortRangeIt(range.from, range.to)
      : formatDayHeadingIt(anchorDate);

  // Render immediato dello scheletro pulito mentre sincronizza live da Apple Calendar
  container.innerHTML = `
    <div class="page-header" style="margin-bottom:14px;">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <h1 class="page-title">Agenda</h1>
        <span id="agendaCalBadge" class="tag" style="display:none;"></span>
        <span class="tag" style="color:var(--text-muted);">Sola lettura</span>
      </div>
      <div class="agenda-header-controls">
        <div class="segmented" role="group" aria-label="Vista agenda">
          <button type="button" class="seg-btn ${view === "day" ? "active" : ""}" data-agenda-view="day">Giorno</button>
          <button type="button" class="seg-btn ${view === "week" ? "active" : ""}" data-agenda-view="week">Settimana</button>
        </div>
        <div class="agenda-nav-group">
          <button type="button" class="btn btn-sm btn-secondary" id="agendaPrevBtn" title="Precedente">‹</button>
          <button type="button" class="btn btn-sm btn-secondary" id="agendaTodayBtn">Oggi</button>
          <button type="button" class="btn btn-sm btn-secondary" id="agendaNextBtn" title="Successivo">›</button>
          <input type="date" class="form-control form-control-sm" id="agendaDateInput" value="${esc(anchorDate)}" style="width:138px;" />
        </div>
        <button type="button" class="btn btn-sm btn-secondary" id="agendaRefreshBtn" title="Sincronizza ora da Apple Calendar">Aggiorna</button>
        <button type="button" class="btn btn-sm btn-ghost" id="agendaConfigBtn">Configura</button>
      </div>
    </div>

    <div id="agendaBodyViewport">
      <div class="card">
        <div class="empty-state">Sincronizzazione con Apple Calendar in corso...</div>
      </div>
    </div>
  `;

  // Collega i controlli di navigazione subito
  container.querySelectorAll("[data-agenda-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.agendaView = btn.getAttribute("data-agenda-view") === "week" ? "week" : "day";
      renderAgendaView(container, ctx);
    });
  });
  document.getElementById("agendaPrevBtn")?.addEventListener("click", () => {
    state.agendaDate = addDaysYmd(anchorDate, view === "week" ? -7 : -1);
    renderAgendaView(container, ctx);
  });
  document.getElementById("agendaNextBtn")?.addEventListener("click", () => {
    state.agendaDate = addDaysYmd(anchorDate, view === "week" ? 7 : 1);
    renderAgendaView(container, ctx);
  });
  document.getElementById("agendaTodayBtn")?.addEventListener("click", () => {
    state.agendaDate = todayStr;
    renderAgendaView(container, ctx);
  });
  document.getElementById("agendaDateInput")?.addEventListener("change", (e) => {
    if (e.target.value) {
      state.agendaDate = e.target.value;
      renderAgendaView(container, ctx);
    }
  });
  document.getElementById("agendaRefreshBtn")?.addEventListener("click", () => {
    renderAgendaView(container, ctx);
  });
  document.getElementById("agendaConfigBtn")?.addEventListener("click", () => {
    showAppleCalendarConfigModal(ctx);
  });

  const bodyViewport = document.getElementById("agendaBodyViewport");
  const calBadge = document.getElementById("agendaCalBadge");

  // Fetch live Apple Calendar + carica cache leggera di Persone/Pacchetti (solo se assente in RAM)
  let calResp;
  try {
    const promises = [
      apiFetch(`/api/calendar/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`)
    ];
    if (!state.allPeopleSearchCache) {
      promises.push(apiFetch("/api/people?status=attivo").then((d) => { state.allPeopleSearchCache = d.people || []; }));
    }
    if (!state.packagesCache) {
      promises.push(apiFetch("/api/packages").then((d) => { state.packagesCache = d.packages || []; }));
    }
    const results = await Promise.all(promises);
    calResp = results[0];
  } catch (err) {
    if (bodyViewport) {
      bodyViewport.innerHTML = `
        <div class="card">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:600; color:var(--danger); margin-bottom:4px;">Impossibile leggere Apple Calendar</div>
              <div style="font-size:13px; color:var(--text-secondary);">${esc(err.message || "Errore di connessione.")}</div>
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn btn-sm btn-secondary" id="agendaRetryBtn">Riprova</button>
              <button type="button" class="btn btn-sm btn-primary" id="agendaReconfigBtn">Verifica credenziali</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById("agendaRetryBtn")?.addEventListener("click", () => renderAgendaView(container, ctx));
      document.getElementById("agendaReconfigBtn")?.addEventListener("click", () => showAppleCalendarConfigModal(ctx));
    }
    return;
  }

  // Se non ancora configurato -> card guidata pulita
  if (!calResp?.configured) {
    if (bodyViewport) {
      bodyViewport.innerHTML = `<div class="card">${renderSetupFormMarkup(null, true)}</div>`;
      bindSetupFormHandlers(bodyViewport, null, ctx, {
        onSaved: () => renderAgendaView(container, ctx)
      });
    }
    return;
  }

  const calColor = calResp.calendar_color || "#1e4976";
  const calName = calResp.calendar_name || "Apple Calendar";
  if (calBadge) {
    calBadge.style.display = "inline-flex";
    calBadge.innerHTML = `<span class="cal-dot" style="background:${esc(calColor)};"></span><span>${esc(calName)}</span>`;
  }

  const people = state.allPeopleSearchCache || [];
  const allPackages = helpers.sortPackagesActiveFirst(state.packagesCache || []);
  const packagesByPerson = new Map();
  for (const pkg of allPackages) {
    if (!packagesByPerson.has(pkg.person_id)) packagesByPerson.set(pkg.person_id, []);
    packagesByPerson.get(pkg.person_id).push(pkg);
  }

  const events = calResp.events || [];
  const syncedHhMm = calResp.synced_at ? String(calResp.synced_at).slice(11, 16) : "";
  const nowHm = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());

  const matchedPkgMap = new Map();

  const renderEventRow = (ev) => {
    const person = matchEventToPerson(ev.summary, people);
    const pkg = person ? pickBestPackageForEvent(ev.summary, packagesByPerson.get(person.id) || [], helpers) : null;
    if (pkg) matchedPkgMap.set(pkg.id, pkg);

    const isDoneNow = state.agendaDoneUids?.has(ev.uid);
    const isOngoing = !ev.all_day && ev.date === todayStr && ev.start_time <= nowHm && ev.end_time > nowHm;

    let shortcutHtml = "";
    if (person) {
      if (pkg) {
        const isOpen = helpers.isOpenSinglePackage(pkg);
        const cat = helpers.inferPackageCategory(pkg);
        const tone = helpers.getSessionCounterTone(pkg.remaining_sessions, pkg.total_sessions);
        const isExhausted = !isOpen && pkg.remaining_sessions <= 0;

        const counterPill = isOpen
          ? `<span class="tag tag-accent pkg-rem-pill num"><strong>${pkg.consumed_sessions}</strong> svolte</span>`
          : `<span class="tag pkg-rem-pill num" style="color:${tone.text}; background:${tone.bg}; border:1px solid ${tone.border};"><strong>${pkg.remaining_sessions}</strong> rim.</span>`;

        let actionBtn = "";
        if (isDoneNow) {
          actionBtn = `
            <span class="tag tag-success" style="height:28px; padding:0 10px;">Registrata</span>
            <button type="button" class="btn btn-xs btn-secondary" data-agenda-undo="${pkg.id}" data-agenda-uid="${esc(ev.uid)}" title="Annulla ultima registrazione">${isOpen ? "−1" : "+1"}</button>
          `;
        } else if (isOpen) {
          actionBtn = `<button type="button" class="btn btn-xs btn-primary" data-agenda-consume="${pkg.id}" data-agenda-uid="${esc(ev.uid)}" data-agenda-is-open="1">+1 seduta</button>`;
        } else if (isExhausted) {
          actionBtn = `<button type="button" class="btn btn-xs btn-primary" data-agenda-renew="${pkg.id}">Rinnova</button>`;
        } else {
          actionBtn = `<button type="button" class="btn btn-xs btn-primary" data-agenda-consume="${pkg.id}" data-agenda-uid="${esc(ev.uid)}">−1 seduta</button>`;
        }

        shortcutHtml = `
          <div class="agenda-shortcut-group">
            ${counterPill}
            ${actionBtn}
            <button type="button" class="btn btn-xs btn-ghost" data-open-person="${person.id}" data-person-tab="pacchetti">Scheda</button>
          </div>
        `;
      } else {
        shortcutHtml = `
          <div class="agenda-shortcut-group">
            <span class="tag" style="color:var(--text-muted);">Nessun pacchetto</span>
            <button type="button" class="btn btn-xs btn-ghost" data-open-person="${person.id}" data-person-tab="pacchetti">Scheda</button>
          </div>
        `;
      }
    }

    const catTag = pkg ? `<span class="tag ${helpers.inferPackageCategory(pkg).badgeClass}" style="font-size:11px;">${esc(helpers.inferPackageCategory(pkg).label)}</span>` : "";

    return `
      <div class="agenda-event-row ${isOngoing ? "is-now" : ""}">
        <div class="agenda-time-col num">
          ${
            ev.all_day
              ? `<span class="tag" style="font-size:11px;">Giorno</span>`
              : `<div class="agenda-time-start">${esc(ev.start_time)}</div><div class="agenda-time-end">${esc(ev.end_time)}</div>`
          }
        </div>
        <div class="agenda-color-bar" style="background:${esc(calColor)};"></div>
        <div class="agenda-event-main">
          <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <span class="agenda-event-title sensitive-data">${esc(ev.summary)}</span>
            ${catTag}
            ${isOngoing ? `<span class="tag tag-accent" style="font-size:11px;">In corso</span>` : ""}
          </div>
          ${
            ev.location || (person && !pkg)
              ? `<div class="agenda-event-meta">${[ev.location, person ? `Anagrafica: ${person.first_name} ${person.last_name}` : ""].filter(Boolean).map(esc).join(" · ")}</div>`
              : ""
          }
        </div>
        ${shortcutHtml}
      </div>
    `;
  };

  let contentHtml = "";
  if (view === "day") {
    contentHtml = `
      <div class="card card-flush">
        <div class="toolbar">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <strong style="font-size:14px; color:var(--text);">${esc(headerSubtitle)}</strong>
            ${anchorDate === todayStr ? `<span class="tag tag-accent">Oggi</span>` : ""}
            <span class="count-pill num">${events.length}</span>
          </div>
          <div style="font-size:12px; color:var(--text-muted);" class="num">
            ${syncedHhMm ? `Sincronizzato alle ${esc(syncedHhMm)}` : ""}
          </div>
        </div>
        <div class="agenda-list">
          ${
            events.length
              ? events.map(renderEventRow).join("")
              : `<div class="empty-state">Nessun evento sul calendario «${esc(calName)}» per questa giornata.</div>`
          }
        </div>
      </div>
    `;
  } else {
    // Vista settimanale raggruppata per giorno (Lun..Dom)
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDaysYmd(range.from, i));
    const byDate = new Map();
    for (const d of days) byDate.set(d, []);
    for (const ev of events) {
      if (byDate.has(ev.date)) byDate.get(ev.date).push(ev);
    }

    contentHtml = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding:0 2px; flex-wrap:wrap; gap:6px;">
        <div style="font-size:13.5px; font-weight:600; color:var(--text);">
          Settimana ${esc(headerSubtitle)} <span class="count-pill num">${events.length}</span>
        </div>
        <div style="font-size:12px; color:var(--text-muted);" class="num">
          ${syncedHhMm ? `Sincronizzato alle ${esc(syncedHhMm)}` : ""}
        </div>
      </div>
      ${days
        .map((dayYmd) => {
          const dayEvs = byDate.get(dayYmd) || [];
          const isToday = dayYmd === todayStr;
          return `
            <div class="card card-flush" style="margin-bottom:10px; ${isToday ? "border-color:var(--accent);" : ""}">
              <div class="toolbar" style="padding:9px 16px; ${isToday ? "background:var(--accent-soft);" : ""}">
                <div style="display:flex; align-items:center; gap:8px;">
                  <strong style="font-size:13px; color:${isToday ? "var(--accent)" : "var(--text)"};">${esc(formatDayHeadingIt(dayYmd))}</strong>
                  ${isToday ? `<span class="tag tag-accent">Oggi</span>` : ""}
                </div>
                <span style="font-size:12px; color:var(--text-muted);" class="num">${dayEvs.length ? `${dayEvs.length} ${dayEvs.length === 1 ? "evento" : "eventi"}` : "Libero"}</span>
              </div>
              ${
                dayEvs.length
                  ? `<div class="agenda-list">${dayEvs.map(renderEventRow).join("")}</div>`
                  : ""
              }
            </div>
          `;
        })
        .join("")}
    `;
  }

  if (bodyViewport) {
    bodyViewport.innerHTML = contentHtml;

    // Azioni rapide sui pacchetti direttamente dall'Agenda (senza ricaricare l'intero calendario se non serve)
    bodyViewport.querySelectorAll("[data-agenda-consume]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const pkgId = Number(btn.getAttribute("data-agenda-consume"));
        const uid = btn.getAttribute("data-agenda-uid");
        const isOpen = btn.getAttribute("data-agenda-is-open") === "1";
        try {
          await apiFetch(`/api/packages/${pkgId}/movements`, {
            method: "POST",
            body: { action: "consume", reason: isOpen ? "Seduta singola svolta (da Agenda)" : "Seduta svolta (da Agenda)" }
          });
          if (uid) state.agendaDoneUids.add(uid);
          // Ricarica i pacchetti aggiornati e ridisegna l'agenda
          const fresh = await apiFetch("/api/packages");
          state.packagesCache = fresh.packages || [];
          await renderAgendaView(container, ctx);
        } catch (err) {
          btn.disabled = false;
          alert(err.message);
        }
      });
    });

    bodyViewport.querySelectorAll("[data-agenda-undo]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const pkgId = Number(btn.getAttribute("data-agenda-undo"));
        const uid = btn.getAttribute("data-agenda-uid");
        try {
          await apiFetch(`/api/packages/${pkgId}/movements`, {
            method: "POST",
            body: { action: "undo", reason: "Annullamento rapido (da Agenda)" }
          });
          if (uid) state.agendaDoneUids.delete(uid);
          const fresh = await apiFetch("/api/packages");
          state.packagesCache = fresh.packages || [];
          await renderAgendaView(container, ctx);
        } catch (err) {
          btn.disabled = false;
          alert(err.message);
        }
      });
    });

    bodyViewport.querySelectorAll("[data-agenda-renew]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pkgId = Number(btn.getAttribute("data-agenda-renew"));
        const pkg = matchedPkgMap.get(pkgId);
        if (pkg) ctx.showRenewPackageModal(pkg);
      });
    });

    ctx.bindCommonActionButtons(bodyViewport);
  }
}
