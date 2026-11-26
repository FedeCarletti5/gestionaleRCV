/**
 * Report Clinico Stampabile / PDF (Client-side configurabile, compatibile PWA / Safari / Chrome).
 * Usa un overlay anteprima A4 in-page con regole @media print dedicate: zero popup bloccati,
 * zero token in URL, Body Chart anatomica con tratti vettoriali ad alta risoluzione.
 */

import { ADDITIONAL_INFO_SECTIONS, renderBodyChartSvg, isFemaleGender } from "./anamnesis.js?v=22";
import { computeScaleBreakdown } from "./scales.js?v=22";

const CLINICIAN_STORAGE_KEY = "gestionale_report_clinician";

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nl2brEsc(val) {
  return esc(val).replace(/\n/g, "<br>");
}

function safeJson(raw, fallback = {}) {
  if (!raw) return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw) || fallback;
  } catch {
    return fallback;
  }
}

function severityPillHtml(label, rawVal) {
  const v = Math.max(0, Math.min(10, Math.round(Number(rawVal) || 0)));
  let color = "#475569";
  let bg = "#f8fafc";
  let border = "#cbd5e1";
  if (v > 0) {
    const t = v / 10;
    const hue = Math.round(138 * (1 - t));
    const sat = Math.round(70 + 12 * t);
    const light = Math.round(38 + 5 * Math.sin(Math.PI * t));
    color = `hsl(${hue}, ${sat}%, ${light}%)`;
    bg = `hsl(${hue}, ${sat}%, 96%)`;
    border = `hsl(${hue}, ${Math.round(sat * 0.85)}%, 78%)`;
  }
  return `
    <span class="rep-metric-pill" style="color:${color}; background:${bg}; border-color:${border};">
      <span class="rep-metric-lbl">${esc(label)}</span>
      <strong class="num">${v}/10</strong>
    </span>
  `;
}

function hasText(v) {
  return Boolean(v && String(v).trim().length > 0);
}

function inspectEpisodeContent(ep) {
  const intake = safeJson(ep?.intake_json, {});
  const mot = intake.motivo || {};
  const ins = intake.insorgenza || {};
  const dol = intake.dolore || {};
  const info = intake.info_aggiuntive || {};
  const strokes = Array.isArray(intake.body_chart?.strokes) ? intake.body_chart.strokes : [];
  const rf = intake.red_flags || { selected: [], note: "" };
  const yf = intake.yellow_flags || { selected: [], note: "" };

  const hasMotivo = Boolean(
    hasText(mot.problema_principale) ||
      hasText(ep?.chief_complaint) ||
      hasText(mot.note) ||
      hasText(mot.problema_associato) ||
      hasText(mot.fattori_provocativi) ||
      hasText(mot.fattori_allevianti) ||
      Number(mot.nprs_attuale || 0) > 0 ||
      Number(mot.nprs_peggiore || 0) > 0 ||
      hasText(ins.tipo) ||
      hasText(ins.trauma) ||
      hasText(ins.note)
  );
  const infoFilledCount = ADDITIONAL_INFO_SECTIONS.filter((s) => hasText(info[s.key])).length;
  const hasDolore = Boolean(
    (dol.qualita && dol.qualita.length) ||
      Number(dol.nprs || 0) > 0 ||
      Number(dol.situazione_insostenibile || 0) > 0 ||
      hasText(dol.note) ||
      infoFilledCount > 0
  );
  const hasBodyChart = strokes.length > 0;
  const redCount = (rf.selected || []).length;
  const hasRed = redCount > 0 || hasText(rf.note);
  const yellowCount = (yf.selected || []).length;
  const hasYellow = yellowCount > 0 || hasText(yf.note);
  const scalesCount = (ep?.outcome_comparisons || []).length;
  const notesCount = (ep?.notes || []).length;

  return {
    intake,
    hasMotivo,
    hasDolore,
    infoFilledCount,
    hasBodyChart,
    strokesCount: strokes.length,
    redCount,
    hasRed,
    yellowCount,
    hasYellow,
    scalesCount,
    notesCount
  };
}

function renderEpisodeReportBlock(ep, person, opts, helpers) {
  const { formatDateIt } = helpers;
  const intake = safeJson(ep.intake_json, {});
  const mot = intake.motivo || {};
  const ins = intake.insorgenza || {};
  const dol = intake.dolore || {};
  const info = intake.info_aggiuntive || {};
  const strokes = Array.isArray(intake.body_chart?.strokes) ? intake.body_chart.strokes : [];
  const bcVariant = intake.body_chart?.variant || (isFemaleGender(person.gender) ? "female" : "male");
  const rf = intake.red_flags || { selected: [], note: "" };
  const yf = intake.yellow_flags || { selected: [], note: "" };

  const regionTag = ep.body_region
    ? `${ep.body_region}${ep.laterality && ep.laterality !== "N/A" ? ` · ${ep.laterality}` : ""}`
    : "";

  const blocks = [];

  // 1. Motivo del consulto & Insorgenza
  if (opts.includeMotivo) {
    const mainProblem = mot.problema_principale || ep.chief_complaint || "";
    const tipoEp = mot.episodio_tipo === "precedenti" ? "Episodi precedenti" : "Primo episodio";
    const hasAnyMot =
      hasText(mainProblem) ||
      hasText(mot.note) ||
      hasText(mot.problema_associato) ||
      hasText(mot.fattori_provocativi) ||
      hasText(mot.fattori_allevianti) ||
      Number(mot.nprs_attuale || 0) > 0 ||
      Number(mot.nprs_peggiore || 0) > 0;
    const hasAnyIns = hasText(ins.tipo) || hasText(ins.trauma) || hasText(ins.note);

    if (hasAnyMot || hasAnyIns) {
      blocks.push(`
        <section class="rep-section">
          <h3 class="rep-sec-title">Motivo del consulto e Insorgenza</h3>
          ${
            hasAnyMot
              ? `
            <div class="rep-grid-2">
              <div class="rep-field">
                <div class="rep-field-lbl">Problema principale</div>
                <div class="rep-field-val">${hasText(mainProblem) ? nl2brEsc(mainProblem) : "—"}</div>
              </div>
              <div class="rep-field">
                <div class="rep-field-lbl">Natura · ${esc(tipoEp)}</div>
                <div class="rep-field-val">${hasText(mot.note) ? nl2brEsc(mot.note) : "—"}</div>
              </div>
            </div>
            ${
              hasText(mot.problema_associato) || Number(mot.nprs_attuale || 0) > 0 || Number(mot.nprs_peggiore || 0) > 0
                ? `<div class="rep-grid-2" style="margin-top:8px; align-items:center;">
                    <div class="rep-box rep-box-blue">
                      <div class="rep-field-lbl">Problema associato</div>
                      <div class="rep-field-val">${hasText(mot.problema_associato) ? nl2brEsc(mot.problema_associato) : "Nessuno segnalato"}</div>
                    </div>
                    <div class="rep-metrics-row">
                      ${severityPillHtml("NPRS attuale", mot.nprs_attuale)}
                      ${severityPillHtml("NPRS peggiore", mot.nprs_peggiore)}
                    </div>
                  </div>`
                : ""
            }
            ${
              hasText(mot.fattori_provocativi) || hasText(mot.fattori_allevianti)
                ? `<div class="rep-grid-2" style="margin-top:8px;">
                    <div class="rep-box rep-box-rose">
                      <div class="rep-field-lbl">Fattori provocativi</div>
                      <div class="rep-field-val">${hasText(mot.fattori_provocativi) ? nl2brEsc(mot.fattori_provocativi) : "—"}</div>
                    </div>
                    <div class="rep-box rep-box-green">
                      <div class="rep-field-lbl">Fattori allevianti</div>
                      <div class="rep-field-val">${hasText(mot.fattori_allevianti) ? nl2brEsc(mot.fattori_allevianti) : "—"}</div>
                    </div>
                  </div>`
                : ""
            }
          `
              : ""
          }
          ${
            hasAnyIns
              ? `<div class="rep-insorgenza-bar">
                  <div class="rep-ins-col">
                    <span class="rep-field-lbl">Insorgenza:</span>
                    <strong>${esc(ins.tipo || "—")}</strong>
                  </div>
                  <div class="rep-ins-col">
                    <span class="rep-field-lbl">Trauma:</span>
                    <strong>${esc(ins.trauma || "—")}</strong>
                  </div>
                  ${
                    hasText(ins.note)
                      ? `<div class="rep-ins-note"><span class="rep-field-lbl">Tempo / Note:</span> ${nl2brEsc(ins.note)}</div>`
                      : ""
                  }
                </div>`
              : ""
          }
        </section>
      `);
    }
  }

  // 2. Dolore e Informazioni aggiuntive
  if (opts.includeDolore) {
    const painQuals = Array.isArray(dol.qualita) ? dol.qualita : [];
    const filledInfo = ADDITIONAL_INFO_SECTIONS.map((s) => ({ label: s.label, val: String(info[s.key] || "").trim() })).filter(
      (x) => x.val.length > 0
    );
    const hasPainData =
      painQuals.length > 0 ||
      Number(dol.nprs || 0) > 0 ||
      Number(dol.situazione_insostenibile || 0) > 0 ||
      hasText(dol.note);

    if (hasPainData || filledInfo.length) {
      blocks.push(`
        <section class="rep-section">
          <h3 class="rep-sec-title">Caratteristiche del dolore e Dettagli clinici</h3>
          ${
            hasPainData
              ? `<div class="rep-pain-summary">
                  ${
                    painQuals.length
                      ? `<div class="rep-chips">${painQuals.map((q) => `<span class="rep-chip">${esc(q)}</span>`).join("")}</div>`
                      : ""
                  }
                  <div class="rep-metrics-row">
                    ${Number(dol.nprs || 0) > 0 ? severityPillHtml("NPRS dolore", dol.nprs) : ""}
                    ${Number(dol.situazione_insostenibile || 0) > 0 ? severityPillHtml("Situazione insostenibile", dol.situazione_insostenibile) : ""}
                  </div>
                  ${hasText(dol.note) ? `<div class="rep-field-val" style="margin-top:6px;"><strong>Note dolore:</strong> ${nl2brEsc(dol.note)}</div>` : ""}
                </div>`
              : ""
          }
          ${
            filledInfo.length
              ? `<div class="rep-info-grid">
                  ${filledInfo
                    .map(
                      (item) => `
                    <div class="rep-info-item">
                      <div class="rep-field-lbl">${esc(item.label)}</div>
                      <div class="rep-field-val">${nl2brEsc(item.val)}</div>
                    </div>`
                    )
                    .join("")}
                </div>`
              : ""
          }
        </section>
      `);
    }
  }

  // 3. Body Chart
  if (opts.includeBodyChart) {
    blocks.push(`
      <section class="rep-section rep-avoid-break">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:6px;">
          <h3 class="rep-sec-title" style="margin:0;">Body Chart (${bcVariant === "female" ? "Donna" : "Uomo"})</h3>
          <div class="rep-bc-legend">
            <span><i style="background:#dc2626;"></i>Dolore</span>
            <span><i style="background:#2563eb;"></i>Parestesia</span>
            <span><i style="background:#d97706;"></i>Rigidità</span>
          </div>
        </div>
        <div class="rep-bc-frame">
          ${renderBodyChartSvg(strokes, bcVariant, { interactive: false })}
        </div>
      </section>
    `);
  }

  // 4. Red Flags & Yellow Flags
  if (opts.includeRedFlags || opts.includeYellowFlags) {
    const redList = Array.isArray(rf.selected) ? rf.selected : [];
    const yellowList = Array.isArray(yf.selected) ? yf.selected : [];
    const flagsHtml = [];
    if (opts.includeRedFlags) {
      flagsHtml.push(`
        <div class="rep-box ${redList.length ? "rep-box-rose" : "rep-box-neutral"}">
          <div class="rep-field-lbl" style="${redList.length ? "color:#b91c1c;" : ""}">Red Flags (${redList.length})</div>
          ${
            redList.length
              ? `<ul class="rep-ul">${redList.map((it) => `<li>${esc(it)}</li>`).join("")}</ul>`
              : `<div class="rep-field-val" style="color:#64748b;">Nessuna Red Flag rilevata allo screening.</div>`
          }
          ${hasText(rf.note) ? `<div class="rep-field-val" style="margin-top:6px;"><strong>Note:</strong> ${nl2brEsc(rf.note)}</div>` : ""}
        </div>
      `);
    }
    if (opts.includeYellowFlags) {
      flagsHtml.push(`
        <div class="rep-box ${yellowList.length ? "rep-box-amber" : "rep-box-neutral"}">
          <div class="rep-field-lbl" style="${yellowList.length ? "color:#9a3412;" : ""}">Yellow Flags (${yellowList.length})</div>
          ${
            yellowList.length
              ? `<ul class="rep-ul">${yellowList.map((it) => `<li>${esc(it)}</li>`).join("")}</ul>`
              : `<div class="rep-field-val" style="color:#64748b;">Nessuna Yellow Flag rilevata.</div>`
          }
          ${hasText(yf.note) ? `<div class="rep-field-val" style="margin-top:6px;"><strong>Note:</strong> ${nl2brEsc(yf.note)}</div>` : ""}
        </div>
      `);
    }
    blocks.push(`
      <section class="rep-section rep-avoid-break">
        <h3 class="rep-sec-title">Screening clinico</h3>
        <div class="${flagsHtml.length === 2 ? "rep-grid-2" : ""}">
          ${flagsHtml.join("")}
        </div>
      </section>
    `);
  }

  // 5. Scale e Outcomes
  if (opts.includeScales && (ep.outcome_comparisons || []).length) {
    const rowsHtml = ep.outcome_comparisons
      .map((c) => {
        const series = c.series || [];
        const latest = series[series.length - 1];
        const bd = latest ? computeScaleBreakdown(latest.scale_code, latest.responses, latest.score_value) : { chips: [], badge: null };
        const subText = bd.chips.length ? bd.chips.map((ch) => `${ch.label}: ${ch.value}`).join(" · ") : "";
        const deltaStr =
          c.numeric_delta !== null && c.numeric_delta !== undefined
            ? `${c.numeric_delta > 0 ? "+" : ""}${c.numeric_delta}${c.score_unit}`
            : "—";
        const deltaColor =
          c.numeric_delta !== null && c.numeric_delta !== undefined
            ? c.numeric_delta < 0
              ? "#15803d"
              : c.numeric_delta > 0
                ? "#b45309"
                : "#475569"
            : "#64748b";
        return `
          <tr>
            <td>
              <strong>${esc(c.scale_name)}</strong>
              <div style="font-size:11px; color:#64748b;">${esc(c.scale_version)}${subText ? ` · ${esc(subText)}` : ""}</div>
            </td>
            <td class="num">${esc(c.initial_score ?? "—")}${esc(c.score_unit)}<div style="font-size:11px; color:#64748b;">${formatDateIt(c.initial_date)}</div></td>
            <td class="num"><strong>${esc(c.latest_score ?? "—")}${esc(c.score_unit)}</strong><div style="font-size:11px; color:#64748b;">${formatDateIt(c.latest_date)}</div></td>
            <td class="num" style="font-weight:700; color:${deltaColor};">${esc(deltaStr)}</td>
          </tr>
        `;
      })
      .join("");

    blocks.push(`
      <section class="rep-section rep-avoid-break">
        <h3 class="rep-sec-title">Scale e Outcomes (${ep.outcome_comparisons.length})</h3>
        <table class="rep-table">
          <thead>
            <tr>
              <th>Scala / Questionario</th>
              <th>Iniziale (T0)</th>
              <th>Attuale</th>
              <th>Variazione</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </section>
    `);
  }

  // 6. Note di seduta (Diario SOAP)
  if (opts.includeNotes && (ep.notes || []).length) {
    const notesHtml = ep.notes
      .map((n) => {
        const soapRows = [
          ["S", n.subjective_response],
          ["O", n.objective_findings],
          ["A", [n.interventions_performed, n.exercises_performed].filter(Boolean).join(" · ")],
          ["P", n.plan_next_steps]
        ].filter(([, v]) => hasText(v));
        const addendaHtml = (n.addenda || [])
          .map(
            (a) => `<div class="rep-addendum"><strong>Integrazione:</strong> ${nl2brEsc(a.addendum_text)}</div>`
          )
          .join("");
        return `
          <div class="rep-note-card rep-avoid-break">
            <div class="rep-note-head">
              <strong class="num">${formatDateIt(n.note_date)}</strong>
              ${n.status ? `<span class="rep-chip">${esc(n.status)}</span>` : ""}
            </div>
            ${soapRows
              .map(
                ([k, v]) => `
                <div class="rep-soap-row">
                  <span class="rep-soap-k">${k}</span>
                  <span>${nl2brEsc(v)}</span>
                </div>`
              )
              .join("")}
            ${addendaHtml}
          </div>
        `;
      })
      .join("");

    blocks.push(`
      <section class="rep-section">
        <h3 class="rep-sec-title">Diario sedute (${ep.notes.length})</h3>
        ${notesHtml}
      </section>
    `);
  }

  return `
    <div class="rep-episode-block">
      <div class="rep-episode-banner">
        <div>
          <h2 class="rep-ep-title">${esc(ep.title || "Episodio clinico")}</h2>
          <div class="rep-ep-sub num">
            Inizio: ${formatDateIt(ep.start_date)} · Stato: ${esc(ep.status || "attivo")}
            ${regionTag ? ` · ${esc(regionTag)}` : ""}
          </div>
        </div>
      </div>
      ${blocks.length ? blocks.join("") : `<div style="font-size:12.5px; color:#64748b; padding:8px 0;">Nessun dato compilato nelle sezioni selezionate.</div>`}
    </div>
  `;
}

function openReportPreviewOverlay(dossier, opts, helpers, onEditOptions) {
  const existing = document.getElementById("clinicalReportOverlay");
  if (existing) existing.remove();

  const p = dossier.person;
  const episodes = dossier.physio?.episodes || [];
  const selectedEpisodes =
    opts.episodeScope === "all"
      ? episodes
      : opts.episodeScope === "none"
        ? []
        : episodes.filter((e) => String(e.id) === String(opts.episodeScope));

  const { formatDateIt, calcAge } = helpers;
  const age = calcAge(p.birth_date);
  const nowRome = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(new Date());
  const todayIso = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome" }).format(new Date());

  const personAnam = safeJson(p.anamnesis_json, {});
  const fam = personAnam.familiare || { selected: [], note: "" };
  const rem = personAnam.remota || { selected: [], note: "" };
  const activeLimitations = (dossier.shared_limitations || []).filter((l) => l.is_active);

  const demoItems = [
    ["Data di nascita", p.birth_date ? `${formatDateIt(p.birth_date)}${age ? ` (${age})` : ""}` : ""],
    ["Genere", p.gender || ""],
    ["Codice Fiscale", p.tax_code || ""],
    ["Telefono", p.phone || ""],
    ["Email", p.email || ""],
    ["Altezza / Peso", [p.height_cm ? `${p.height_cm} cm` : "", p.weight_kg ? `${p.weight_kg} kg` : ""].filter(Boolean).join(" · ")],
    ["Attività / Sport", p.sport_activity || ""],
    ["Professione", p.profession || ""]
  ].filter(([, v]) => hasText(v));

  const famRemHtml =
    opts.includeFamRem && ((fam.selected || []).length || hasText(fam.note) || (rem.selected || []).length || hasText(rem.note))
      ? `
        <section class="rep-section rep-avoid-break">
          <h3 class="rep-sec-title">Anamnesi familiare e remota</h3>
          <div class="rep-grid-2">
            <div class="rep-box rep-box-neutral">
              <div class="rep-field-lbl">Anamnesi familiare</div>
              <div class="rep-field-val">${(fam.selected || []).length ? esc(fam.selected.join(", ")) : "Nessuna condizione segnalata."}</div>
              ${hasText(fam.note) ? `<div class="rep-field-val" style="margin-top:4px;"><strong>Note:</strong> ${nl2brEsc(fam.note)}</div>` : ""}
            </div>
            <div class="rep-box rep-box-neutral">
              <div class="rep-field-lbl">Anamnesi remota</div>
              <div class="rep-field-val">${(rem.selected || []).length ? esc(rem.selected.join(", ")) : "Nessuna condizione segnalata."}</div>
              ${hasText(rem.note) ? `<div class="rep-field-val" style="margin-top:4px;"><strong>Note:</strong> ${nl2brEsc(rem.note)}</div>` : ""}
            </div>
          </div>
        </section>
      `
      : "";

  const limHtml =
    opts.includeLimitations && activeLimitations.length
      ? `
        <section class="rep-section rep-avoid-break">
          <h3 class="rep-sec-title">Limitazioni funzionali condivise</h3>
          <ul class="rep-ul">
            ${activeLimitations
              .map(
                (l) => `
              <li>
                <strong>${esc(l.title)}</strong>${l.body_region ? ` (${esc(l.body_region)}${l.laterality && l.laterality !== "N/A" ? ` ${esc(l.laterality)}` : ""})` : ""}:
                ${esc(l.description)}
                <span style="color:#64748b; font-size:11.5px;"> — ${formatDateIt(l.recorded_date)}</span>
              </li>`
              )
              .join("")}
          </ul>
        </section>
      `
      : "";

  const conclusionHtml =
    hasText(opts.conclusionNotes) || hasText(opts.clinicianSignature)
      ? `
        <section class="rep-section rep-avoid-break rep-footer-sign">
          ${
            hasText(opts.conclusionNotes)
              ? `<div style="margin-bottom:14px;">
                  <h3 class="rep-sec-title">Note conclusive e indicazioni</h3>
                  <div class="rep-field-val">${nl2brEsc(opts.conclusionNotes)}</div>
                </div>`
              : ""
          }
          <div class="rep-sign-row">
            <div class="rep-sign-date num">Data: ${esc(nowRome)}</div>
            <div class="rep-sign-box">
              <div class="rep-sign-line"></div>
              <div class="rep-sign-name">${esc(opts.clinicianSignature || "Il Fisioterapista")}</div>
            </div>
          </div>
        </section>
      `
      : "";

  const overlay = document.createElement("div");
  overlay.id = "clinicalReportOverlay";
  overlay.className = "report-overlay";
  overlay.innerHTML = `
    <div class="report-toolbar no-print">
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <strong style="font-size:14px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          Anteprima Report · ${esc(p.first_name)} ${esc(p.last_name)}
        </strong>
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn-sm btn-secondary" id="repEditOptsBtn">Modifica sezioni</button>
        <button type="button" class="btn btn-sm btn-primary" id="repPrintNowBtn">Stampa / Salva PDF</button>
        <button type="button" class="btn btn-sm btn-ghost" id="repCloseOverlayBtn">Chiudi</button>
      </div>
    </div>

    <div class="report-stage">
      <article class="report-sheet">
        <header class="rep-header">
          <div class="rep-brand-col">
            <img src="./assets/logo.png" alt="Gestionale RCV" class="rep-logo" />
            <div>
              <div class="rep-kicker">RELAZIONE CLINICA FISIOTERAPICA</div>
              <h1 class="rep-patient-name">${esc(p.first_name)} ${esc(p.last_name)}</h1>
            </div>
          </div>
          <div class="rep-header-meta num">
            <div>Data report: <strong>${esc(nowRome)}</strong></div>
            ${hasText(opts.clinicianSignature) ? `<div>${esc(opts.clinicianSignature)}</div>` : ""}
          </div>
        </header>

        ${
          demoItems.length
            ? `<section class="rep-demo-grid">
                ${demoItems
                  .map(
                    ([k, v]) => `
                  <div class="rep-demo-item">
                    <span class="rep-demo-k">${esc(k)}</span>
                    <span class="rep-demo-v">${esc(v)}</span>
                  </div>`
                  )
                  .join("")}
              </section>`
            : ""
        }

        ${selectedEpisodes.map((ep) => renderEpisodeReportBlock(ep, p, opts, helpers)).join("")}
        ${famRemHtml}
        ${limHtml}
        ${conclusionHtml}
      </article>
    </div>
  `;

  const prevTitle = document.title;
  const safeFileSlug = `Report_${p.last_name || ""}_${p.first_name || ""}_${todayIso}`
    .replace(/[^\p{L}\p{N}_-]+/gu, "_")
    .replace(/_+/g, "_");
  document.title = safeFileSlug;
  document.body.classList.add("report-preview-open");
  document.body.appendChild(overlay);

  const cleanup = () => {
    document.removeEventListener("keydown", onEsc);
    document.body.classList.remove("report-preview-open");
    document.title = prevTitle || "Gestionale RCV";
    overlay.remove();
  };

  const onEsc = (e) => {
    if (e.key === "Escape") cleanup();
  };
  document.addEventListener("keydown", onEsc);

  document.getElementById("repCloseOverlayBtn")?.addEventListener("click", cleanup);
  document.getElementById("repEditOptsBtn")?.addEventListener("click", () => {
    cleanup();
    onEditOptions?.(opts);
  });
  document.getElementById("repPrintNowBtn")?.addEventListener("click", () => {
    window.print();
  });
}

export function showClinicalReportModal(dossier, ctx, prevOpts = null) {
  const { openModal, closeModal, selectedEpisodeId, formatDateIt, calcAge, defaultClinicianName } = ctx;
  const p = dossier.person;
  const episodes = dossier.physio?.episodes || [];
  const defaultEpId =
    prevOpts?.episodeScope ??
    (selectedEpisodeId && episodes.some((e) => e.id === selectedEpisodeId)
      ? String(selectedEpisodeId)
      : episodes.length
        ? String(episodes[0].id)
        : "none");

  const storedClinician =
    (typeof localStorage !== "undefined" && localStorage.getItem(CLINICIAN_STORAGE_KEY)) ||
    defaultClinicianName ||
    "";

  const personAnam = safeJson(p.anamnesis_json, {});
  const hasFamRem = Boolean(
    (personAnam.familiare?.selected || []).length ||
      hasText(personAnam.familiare?.note) ||
      (personAnam.remota?.selected || []).length ||
      hasText(personAnam.remota?.note)
  );
  const activeLimCount = (dossier.shared_limitations || []).filter((l) => l.is_active).length;

  const currentEpForHints =
    defaultEpId === "all"
      ? episodes[0] || null
      : episodes.find((e) => String(e.id) === String(defaultEpId)) || null;
  const epStats = currentEpForHints ? inspectEpisodeContent(currentEpForHints) : null;

  const opts = prevOpts || {
    episodeScope: defaultEpId,
    includeMotivo: epStats ? epStats.hasMotivo : true,
    includeDolore: epStats ? epStats.hasDolore : false,
    includeBodyChart: epStats ? epStats.hasBodyChart : false,
    includeFamRem: hasFamRem,
    includeRedFlags: epStats ? epStats.hasRed : false,
    includeYellowFlags: false,
    includeScales: epStats ? epStats.scalesCount > 0 : false,
    includeNotes: epStats ? epStats.notesCount > 0 : false,
    includeLimitations: activeLimCount > 0,
    conclusionNotes: "",
    clinicianSignature: storedClinician
  };

  openModal(
    `
    <h2 class="modal-title">Report Clinico PDF</h2>
    <p style="margin:-6px 0 14px; font-size:13px; color:var(--text-muted);">
      Configura le sezioni da includere nel documento stampabile / PDF per <strong>${esc(p.first_name)} ${esc(p.last_name)}</strong>.
    </p>
    <form id="clinicalReportConfigForm">
      ${
        episodes.length
          ? `<div class="form-group">
              <label class="form-label" for="repEpisodeScopeSel">Episodio clinico</label>
              <select class="form-control" id="repEpisodeScopeSel" name="episodeScope">
                ${episodes
                  .map(
                    (e) =>
                      `<option value="${e.id}" ${String(opts.episodeScope) === String(e.id) ? "selected" : ""}>${esc(e.title)} (${formatDateIt(e.start_date)} · ${esc(e.status)})</option>`
                  )
                  .join("")}
                ${episodes.length > 1 ? `<option value="all" ${opts.episodeScope === "all" ? "selected" : ""}>Tutti gli episodi (${episodes.length})</option>` : ""}
                <option value="none" ${opts.episodeScope === "none" ? "selected" : ""}>Solo anagrafica e dati generali</option>
              </select>
            </div>`
          : `<input type="hidden" name="episodeScope" value="none" />`
      }

      <div class="form-group">
        <label class="form-label">Sezioni cliniche</label>
        <div class="rep-check-grid">
          <label class="rep-check-item">
            <input type="checkbox" name="includeMotivo" ${opts.includeMotivo ? "checked" : ""} />
            <span><strong>Motivo e Insorgenza</strong><small>Consulto, NPRS, trauma e fattori</small></span>
          </label>
          <label class="rep-check-item">
            <input type="checkbox" name="includeDolore" ${opts.includeDolore ? "checked" : ""} />
            <span><strong>Dolore e Dettagli</strong><small>Qualità dolore e info aggiuntive</small></span>
          </label>
          <label class="rep-check-item">
            <input type="checkbox" name="includeBodyChart" ${opts.includeBodyChart ? "checked" : ""} />
            <span><strong>Body Chart</strong><small id="repHintBc">${epStats ? (epStats.strokesCount ? `${epStats.strokesCount} tratti disegnati` : "Nessun segno") : "Mappa anatomica"}</small></span>
          </label>
          <label class="rep-check-item">
            <input type="checkbox" name="includeFamRem" ${opts.includeFamRem ? "checked" : ""} />
            <span><strong>Familiare &amp; Remota</strong><small>${hasFamRem ? "Compilata" : "Nessuna segnalazione"}</small></span>
          </label>
          <label class="rep-check-item">
            <input type="checkbox" name="includeRedFlags" ${opts.includeRedFlags ? "checked" : ""} />
            <span><strong>Red Flags</strong><small id="repHintRf">${epStats ? `${epStats.redCount} presenti` : "Screening medico"}</small></span>
          </label>
          <label class="rep-check-item">
            <input type="checkbox" name="includeYellowFlags" ${opts.includeYellowFlags ? "checked" : ""} />
            <span><strong>Yellow Flags</strong><small id="repHintYf">${epStats ? `${epStats.yellowCount} presenti · opzionale per consegna` : "Fattori psicosociali"}</small></span>
          </label>
          <label class="rep-check-item">
            <input type="checkbox" name="includeScales" ${opts.includeScales ? "checked" : ""} />
            <span><strong>Scale e Outcomes</strong><small id="repHintScales">${epStats ? `${epStats.scalesCount} scale registrate` : "Andamento T0 → T1"}</small></span>
          </label>
          <label class="rep-check-item">
            <input type="checkbox" name="includeNotes" ${opts.includeNotes ? "checked" : ""} />
            <span><strong>Diario sedute (SOAP)</strong><small id="repHintNotes">${epStats ? `${epStats.notesCount} note registrate` : "Note cliniche"}</small></span>
          </label>
          <label class="rep-check-item">
            <input type="checkbox" name="includeLimitations" ${opts.includeLimitations ? "checked" : ""} />
            <span><strong>Limitazioni condivise</strong><small>${activeLimCount} attive</small></span>
          </label>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="repConclusionTxt">Note conclusive / Indicazioni (opzionale)</label>
        <textarea class="form-control" id="repConclusionTxt" name="conclusionNotes" rows="2" placeholder="Sintesi clinica, obiettivi o indicazioni per medico / paziente...">${esc(opts.conclusionNotes || "")}</textarea>
      </div>

      <div class="form-group">
        <label class="form-label" for="repClinicianInp">Intestazione / Firma professionista</label>
        <input class="form-control" id="repClinicianInp" name="clinicianSignature" value="${esc(opts.clinicianSignature || "")}" placeholder="Es. Dott. Federico Carletti — Fisioterapista" />
      </div>

      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" id="repCancelBtn">Annulla</button>
        <button type="submit" class="btn btn-primary">Anteprima e stampa PDF</button>
      </div>
    </form>
  `,
    { wide: true }
  );

  // Aggiorna i suggerimenti dinamici quando l'utente cambia episodio
  const scopeSel = document.getElementById("repEpisodeScopeSel");
  scopeSel?.addEventListener("change", () => {
    const val = scopeSel.value;
    const setTxt = (id, t) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    };
    if (val === "none") {
      setTxt("repHintBc", "Escluso (solo anagrafica)");
      setTxt("repHintRf", "Escluso");
      setTxt("repHintYf", "Escluso");
      setTxt("repHintScales", "Escluso");
      setTxt("repHintNotes", "Escluso");
      return;
    }
    const targetEps = val === "all" ? episodes : episodes.filter((e) => String(e.id) === String(val));
    if (!targetEps.length) return;
    const statsList = targetEps.map(inspectEpisodeContent);
    const strokesSum = statsList.reduce((a, s) => a + s.strokesCount, 0);
    const rfSum = statsList.reduce((a, s) => a + s.redCount, 0);
    const yfSum = statsList.reduce((a, s) => a + s.yellowCount, 0);
    const scalesSum = statsList.reduce((a, s) => a + s.scalesCount, 0);
    const notesSum = statsList.reduce((a, s) => a + s.notesCount, 0);
    setTxt("repHintBc", strokesSum ? `${strokesSum} tratti disegnati` : "Nessun segno");
    setTxt("repHintRf", `${rfSum} presenti`);
    setTxt("repHintYf", `${yfSum} presenti · opzionale per consegna`);
    setTxt("repHintScales", `${scalesSum} scale registrate`);
    setTxt("repHintNotes", `${notesSum} note registrate`);
  });

  document.getElementById("repCancelBtn")?.addEventListener("click", closeModal);
  document.getElementById("clinicalReportConfigForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const clinicianSignature = String(fd.get("clinicianSignature") || "").trim();
    if (typeof localStorage !== "undefined") {
      if (clinicianSignature) localStorage.setItem(CLINICIAN_STORAGE_KEY, clinicianSignature);
      else localStorage.removeItem(CLINICIAN_STORAGE_KEY);
    }
    const chosenOpts = {
      episodeScope: String(fd.get("episodeScope") || "none"),
      includeMotivo: fd.get("includeMotivo") === "on",
      includeDolore: fd.get("includeDolore") === "on",
      includeBodyChart: fd.get("includeBodyChart") === "on",
      includeFamRem: fd.get("includeFamRem") === "on",
      includeRedFlags: fd.get("includeRedFlags") === "on",
      includeYellowFlags: fd.get("includeYellowFlags") === "on",
      includeScales: fd.get("includeScales") === "on",
      includeNotes: fd.get("includeNotes") === "on",
      includeLimitations: fd.get("includeLimitations") === "on",
      conclusionNotes: String(fd.get("conclusionNotes") || "").trim(),
      clinicianSignature
    };
    closeModal();
    openReportPreviewOverlay(
      dossier,
      chosenOpts,
      { formatDateIt, calcAge },
      (prev) => showClinicalReportModal(dossier, ctx, prev)
    );
  });
}
