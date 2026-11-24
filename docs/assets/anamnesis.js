/**
 * Raccolta Anamnestica Strutturata — Modulo UI & Body Chart vettoriale a mano libera.
 * Archiviazione compatta JSON (~2–4 KB) su people.anamnesis_json (Familiare/Remota)
 * e physio_episodes.intake_json (Consulto, Dolore, Info aggiuntive, Body Chart, Red/Yellow Flags).
 */

export const PAIN_QUALITIES_COL1 = [
  "A fitte",
  "Costrittivo",
  "Diffuso",
  "Irradiato",
  "Notturno",
  "Proiettato",
  "Sordo",
  "Vivo"
];

export const PAIN_QUALITIES_COL2 = [
  "Costante",
  "Crampiforme",
  "Intermittente",
  "Localizzato",
  "Persistente",
  "Riferito",
  "Urente"
];

export const ADDITIONAL_INFO_SECTIONS = [
  { key: "gonfiore", label: "Gonfiore", placeholder: "Presenza, sede, insorgenza, variazione nella giornata..." },
  { key: "funzione", label: "Funzione", placeholder: "Movimenti limitati, gesti difficili, capacità residua..." },
  { key: "sensibilita", label: "Sensibilità", placeholder: "Formicolii, parestesie, ipoestesia, distribuzione..." },
  { key: "alterazione_sonno", label: "Alterazione del sonno", placeholder: "Difficoltà ad addormentarsi, risvegli notturni, posizione..." },
  { key: "aggravanti_allevianti", label: "Fattori Aggravanti/Allevianti", placeholder: "Andamento 24 ore, carichi, posture, cosa migliora/peggiora..." },
  { key: "evoluzione", label: "Evoluzione della problematica", placeholder: "In miglioramento, stabile, in peggioramento, decorso nel tempo..." },
  { key: "preoccupazione_ansia", label: "Preoccupazione/Ansia", placeholder: "Timori del paziente, convinzioni sul problema, impatto emotivo..." },
  { key: "limitazione_adl", label: "Limitazione delle ADL", placeholder: "Attività di vita quotidiana limitate (vestirsi, guidare, lavoro, casa)..." },
  { key: "limitazione_sport", label: "Limitazione dell'attività sportiva", placeholder: "Sport praticati, cosa è sospeso o ridotto, obiettivi di rientro..." },
  { key: "esami_diagnostici", label: "Esami diagnostici effettuati", placeholder: "RX, RMN, ecografie, visite specialistiche e relativi esiti..." },
  { key: "cure_effettuate", label: "Cure effettuate", placeholder: "Farmaci, terapie fisiche/manuali precedenti ed efficacia..." }
];

export const FAMILY_CONDITIONS_COLS = [
  ["Problemi cardiaci", "Problemi circolatori", "Infarti", "Anemia", "Ipertensione", "Osteoporosi"],
  ["Problemi respiratori", "Asma", "Enfisema/Bronchite", "Tubercolosi", "Dispnea / BPCO"],
  ["Artrite reumatoide", "Altre condizioni artritiche", "Epatiti", "Disturbi renali", "Problemi alla tiroide"],
  ["Diabete", "Sclerosi", "Dipendenze", "Depressione", "Epilessia"]
];

export const REMOTE_CONDITIONS_COLS = [
  ["Problemi cardiaci", "Problemi circolatori", "Infarti", "Anemia", "Ipertensione", "Osteoporosi"],
  ["Problemi respiratori", "Asma", "Enfisema/Bronchite", "Tubercolosi", "Dispnea / BPCO", "COVID 19"],
  ["Artrite reumatoide", "Altre condizioni artritiche", "Epatiti", "Disturbi renali", "Problemi alla tiroide"],
  ["Diabete", "Sclerosi", "Dipendenze", "Depressione", "Epilessia"]
];

export const RED_FLAGS_COLS = [
  [
    "Perdita di peso immotivata",
    "Febbre persistente",
    "Neoformazioni o masse",
    "Dolore agli arti",
    "Insorgenza improvvisa di cefalea acuta"
  ],
  [
    "Dolore notturno che interrompe il sonno",
    "Nausea/Vomito",
    "Rigidità mattutina",
    "Alterazioni della sensibilità agli arti",
    "Alterazione della forza agli arti"
  ],
  [
    "Infezioni",
    "Vertigini/Sbandamenti",
    "Gonfiore in più articolazioni",
    "Difficoltà durante la deambulazione",
    "Modificazioni nella sudorazione"
  ]
];

export const YELLOW_FLAGS_LEFT = [
  {
    title: "Atteggiamenti e convinzioni riguardo al dolore",
    items: [
      "Fear Avoidance Beliefs",
      "Aspettarsi che il dolore aumenti con l'attività",
      "Pensare che il dolore sia incontrollabile",
      "Catastrofizzazione del sintomo",
      "Poca aspettativa di guarigione",
      "Ritorno ritardato al lavoro"
    ]
  },
  {
    title: "Compensazioni",
    items: [
      "Coinvolgimento in azioni medico-legali",
      "Mancanza di incentivi per il ritorno al lavoro",
      "Problemi di accesso ai Benefits di malattia"
    ]
  },
  {
    title: "Emozioni",
    items: [
      "Depressione",
      "Ansia",
      "Maggiore irritabilità",
      'Perdita di piacere nel "fare le cose"',
      "Elevata considerazione delle sensazioni corporee",
      "Stress"
    ]
  },
  {
    title: "Lavoro",
    items: [
      "Assenza prolungata dal lavoro",
      "Problematiche con il datore di lavoro",
      "Percezione negativa dell'ambiente di lavoro",
      "Problemi finanziari potenzialmente correlati al/perdita del lavoro"
    ]
  }
];

export const YELLOW_FLAGS_RIGHT = [
  {
    title: "Comportamenti",
    items: [
      "Cattiva qualità del sonno dall'insorgenza del disturbo",
      "Assunzione di alcool o altre sostanze dall'insorgenza del disturbo",
      "Abuso di farmaci",
      "Riduzione del livello di attività o evitamento di attività quotidiane",
      "Dipendenza da trattamenti passivi",
      "Catastrofizzazione"
    ]
  },
  {
    title: "Diagnosi e trattamenti proposti",
    items: [
      "Diagnosi e spiegazioni conflittuali",
      "Ricerca o ricevimento continuo di cure passive",
      "Attesa di cure facili con risoluzione del disturbo a breve termine",
      "Aver visto diversi specialisti"
    ]
  },
  {
    title: "Famiglia",
    items: [
      "Famiglia o partner iperprotettivi",
      "Famiglia o partner ipoprotettivi",
      "Famiglia o partner che rinforzano le paure",
      "Famiglia o partner che incoraggiano il catastrofismo",
      "Risposta relazione punitiva (commenti negativi, indifferenza)"
    ]
  }
];

const INK_COLORS = [
  { id: "#dc2626", label: "Dolore (Rosso)" },
  { id: "#2563eb", label: "Parestesia (Blu)" },
  { id: "#d97706", label: "Rigidità (Ambra)" }
];

function esc(val) {
  if (val === null || val === undefined) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonParse(raw, fallback = {}) {
  if (!raw) return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw) || fallback;
  } catch {
    return fallback;
  }
}

function toggleSwitchHtml(name, value, label, checked, extraClass = "") {
  return `
    <label class="anam-toggle-row ${extraClass}">
      <span class="toggle-switch">
        <input type="checkbox" name="${esc(name)}" value="${esc(value)}" ${checked ? "checked" : ""} />
        <span class="toggle-track"></span>
      </span>
      <span class="anam-toggle-label">${esc(label)}</span>
    </label>
  `;
}

function strokeToSvgPath(points) {
  if (!points || !points.length) return "";
  if (points.length === 1) {
    const [x, y] = points[0];
    return `M ${x} ${y} L ${x + 0.5} ${y + 0.5}`;
  }
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i][0]} ${points[i][1]}`;
  }
  return d;
}

const BODY_VB_W = 1000;
const BODY_VB_H = 671;

const BODY_CHART_VARIANTS = {
  male: {
    href: "./assets/body_chart.png?v=14",
    labels: { dorso: 65, anteriore: 173, posteriore: 833, pianta: 936 }
  },
  female: {
    href: "./assets/body_chart_female.png?v=14",
    labels: { dorso: 77, anteriore: 168, posteriore: 832, pianta: 926 }
  }
};

function isFemaleGender(gender) {
  const g = String(gender || "").trim().toLowerCase();
  return g === "donna" || g === "f" || g === "femmina" || g === "female";
}

function severityColorForValue(rawVal) {
  const v = Math.max(0, Math.min(10, Number(rawVal) || 0));
  if (v <= 0.05) {
    return { color: "#64748b", bg: "#ffffff", border: "#d1d5db" };
  }
  const t = Math.max(0, Math.min(1, v / 10));
  const hue = Math.round(138 * (1 - t));
  const sat = Math.round(70 + 12 * t);
  const light = Math.round(40 + 6 * Math.sin(Math.PI * t));
  return {
    color: `hsl(${hue}, ${sat}%, ${light}%)`,
    bg: `hsl(${hue}, ${sat}%, 96%)`,
    border: `hsl(${hue}, ${Math.round(sat * 0.85)}%, 78%)`
  };
}

function applySeveritySliderVisual(slider, badgeEl) {
  if (!slider) return;
  const raw = Math.max(0, Math.min(10, Number(slider.value || 0)));
  const max = Number(slider.max || 10);
  const pct = Math.max(0, Math.min(100, (raw / max) * 100));
  const rounded = Math.round(raw);
  const { color, bg, border } = severityColorForValue(raw);
  slider.style.background =
    `linear-gradient(to right, transparent 0%, transparent ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%), ` +
    `linear-gradient(to right, #22c55e 0%, #84cc16 28%, #eab308 52%, #f97316 76%, #dc2626 100%)`;
  slider.style.setProperty("--thumb-color", color);
  if (badgeEl) {
    badgeEl.textContent = String(rounded);
    badgeEl.style.color = rounded > 0 ? color : "var(--text)";
    badgeEl.style.backgroundColor = rounded > 0 ? bg : "var(--bg-surface)";
    badgeEl.style.borderColor = rounded > 0 ? border : "var(--border-strong)";
  }
}

function applyBrushSliderVisual(slider, color) {
  if (!slider) return;
  const min = Number(slider.min || 3);
  const max = Number(slider.max || 24);
  const val = Number(slider.value || 10);
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  const activeColor = color || "#1e4976";
  slider.style.background = `linear-gradient(to right, ${activeColor} 0%, ${activeColor} ${pct}%, #e2e8f0 ${pct}%, #e2e8f0 100%)`;
  slider.style.setProperty("--thumb-color", activeColor);
}

/**
 * Body Chart anatomica clinica ad alta precisione (6 viste: Anteriore, Laterale DX,
 * Laterale SX, Posteriore, Dorso e Pianta piedi) con livello vettoriale per il disegno a mano libera.
 * L'immagine di base è un asset statico (0 byte su Supabase); nel DB salviamo solo i tratti vettoriali.
 */
function renderBodyChartSvg(strokes = [], variant = "male") {
  const cfg = BODY_CHART_VARIANTS[variant === "female" ? "female" : "male"];

  const strokePaths = (strokes || [])
    .map(
      (st) => `
      <path
        d="${strokeToSvgPath(st.points)}"
        stroke="${esc(st.color || "#dc2626")}"
        stroke-width="${Number(st.width || 10)}"
        stroke-linecap="round"
        stroke-linejoin="round"
        fill="none"
        opacity="0.68"
      />`
    )
    .join("");

  return `
    <svg id="freehandBodySvg" class="body-chart-svg" viewBox="0 0 ${BODY_VB_W} ${BODY_VB_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Body chart anatomica interattiva">
      <rect x="0" y="0" width="${BODY_VB_W}" height="${BODY_VB_H}" fill="#ffffff" />
      <image
        id="bodyChartBgImg"
        href="${cfg.href}"
        x="0"
        y="0"
        width="${BODY_VB_W}"
        height="${BODY_VB_H}"
        preserveAspectRatio="xMidYMid meet"
        style="pointer-events:none; user-select:none;"
      />

      <!-- Etichette anatomiche discrete -->
      <g fill="#6b7280" font-size="11.5" font-weight="600" letter-spacing="0.04em" text-anchor="middle" style="user-select:none; pointer-events:none;">
        <text x="84" y="34">DX</text>
        <text x="262" y="34">SX</text>
        <text x="748" y="34">SX</text>
        <text x="918" y="34">DX</text>
        <text x="500" y="334">LATO DX</text>
        <text id="bcLblDorso" x="${cfg.labels.dorso}" y="656">DORSO</text>
        <text id="bcLblAnteriore" x="${cfg.labels.anteriore}" y="656">ANTERIORE</text>
        <text x="500" y="656">LATO SX</text>
        <text id="bcLblPosteriore" x="${cfg.labels.posteriore}" y="656">POSTERIORE</text>
        <text id="bcLblPianta" x="${cfg.labels.pianta}" y="656">PIANTA</text>
      </g>

      <!-- Tratti disegnati a mano libera -->
      <g id="freehandStrokesLayer" style="pointer-events:none;">${strokePaths}</g>
    </svg>
  `;
}

export function renderAnamnesisTab(viewport, dossier, { selectedEpisodeId, onSelectEpisode, onNewEpisode, onSave }) {
  const p = dossier.person;
  const episodes = dossier.physio.episodes || [];
  const activeEp = episodes.find((e) => e.id === selectedEpisodeId) || episodes[0] || null;

  const personAnam = safeJsonParse(p.anamnesis_json, {});
  const famData = personAnam.familiare || { selected: [], note: "" };
  const remData = personAnam.remota || { selected: [], note: "" };

  const epIntake = activeEp ? safeJsonParse(activeEp.intake_json, {}) : {};
  const motivo = epIntake.motivo || {
    problema_principale: activeEp?.chief_complaint || p.current_pain_notes || "",
    episodio_tipo: "primo",
    note: "",
    problema_associato: "",
    nprs_attuale: 0,
    nprs_peggiore: 0,
    fattori_provocativi: "",
    fattori_allevianti: ""
  };
  const dolore = epIntake.dolore || {
    qualita: [],
    nprs: 0,
    situazione_insostenibile: 0,
    note: ""
  };
  const infoAgg = epIntake.info_aggiuntive || {};
  const strokes = Array.isArray(epIntake.body_chart?.strokes) ? JSON.parse(JSON.stringify(epIntake.body_chart.strokes)) : [];
  let bodyChartVariant = epIntake.body_chart?.variant || (isFemaleGender(p.gender) ? "female" : "male");
  const redFlags = epIntake.red_flags || { selected: [], note: "" };
  const yellowFlags = epIntake.yellow_flags || { selected: [], note: "" };

  const famSet = new Set(famData.selected || []);
  const remSet = new Set(remData.selected || []);
  const painSet = new Set(dolore.qualita || []);
  const redSet = new Set(redFlags.selected || []);
  const yellowSet = new Set(yellowFlags.selected || []);

  let drawEnabled = true;
  let brushColor = INK_COLORS[0].id;
  let brushWidth = 10;

  const epBarHtml = `
    <div class="anam-sticky-bar">
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        ${
          episodes.length
            ? `<select class="form-control form-control-sm" id="anamEpisodeSelect" style="max-width:290px; font-weight:600;">
                ${episodes.map((e) => `<option value="${e.id}" ${activeEp && e.id === activeEp.id ? "selected" : ""}>${esc(e.title)} (${esc(e.start_date)})</option>`).join("")}
              </select>`
            : `<span style="font-size:13px; color:var(--text-muted); font-weight:500;">Nuova scheda anamnestica</span>`
        }
        <button type="button" class="btn btn-sm btn-ghost" id="anamNewEpBtn">+ Nuovo consulto</button>
      </div>
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <span id="anamDirtyBadge" class="tag tag-warning" style="display:none;">Modifiche non salvate</span>
        <button type="button" class="btn btn-sm btn-primary" id="saveAnamnesisTopBtn">Salva anamnesi</button>
      </div>
    </div>

    <div class="anam-jump-bar">
      <a href="#sec-motivo" class="anam-jump-pill">Motivo</a>
      <a href="#sec-dolore" class="anam-jump-pill">Dolore</a>
      <a href="#sec-info" class="anam-jump-pill">Dettagli</a>
      <a href="#sec-bodychart" class="anam-jump-pill">Body chart</a>
      <a href="#sec-fam-rem" class="anam-jump-pill">Familiare &amp; Remota</a>
      <a href="#sec-redflags" class="anam-jump-pill">Red Flags ${redSet.size ? `(${redSet.size})` : ""}</a>
      <a href="#sec-yellowflags" class="anam-jump-pill">Yellow Flags ${yellowSet.size ? `(${yellowSet.size})` : ""}</a>
    </div>
  `;

  viewport.innerHTML = `
    ${epBarHtml}

    <form id="anamnesisMasterForm">
      <!-- 1. MOTIVO DEL CONSULTO -->
      <section id="sec-motivo" class="card">
        <div class="card-header"><h3 class="card-title">Motivo del consulto</h3></div>

        <div class="grid-2" style="margin-bottom:14px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">Problema principale</label>
            <textarea class="form-control" name="problema_principale" rows="3" placeholder="Descrivi il problema principale...">${esc(motivo.problema_principale || "")}</textarea>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <div style="display:flex; align-items:center; gap:16px; margin-bottom:6px; flex-wrap:wrap;">
              <label style="display:inline-flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;">
                <input type="radio" name="episodio_tipo" value="primo" ${(motivo.episodio_tipo || "primo") === "primo" ? "checked" : ""} /> Primo episodio
              </label>
              <label style="display:inline-flex; align-items:center; gap:6px; font-size:13px; cursor:pointer;">
                <input type="radio" name="episodio_tipo" value="precedenti" ${motivo.episodio_tipo === "precedenti" ? "checked" : ""} /> Episodi precedenti
              </label>
            </div>
            <textarea class="form-control" name="motivo_note" rows="3" placeholder="Note su esordio o episodi precedenti...">${esc(motivo.note || "")}</textarea>
          </div>
        </div>

        <div class="grid-2" style="margin-bottom:14px; align-items:center;">
          <div class="tint-box tint-blue">
            <label class="form-label">Problema associato</label>
            <textarea class="form-control" name="problema_associato" rows="3" placeholder="Problema associato...">${esc(motivo.problema_associato || "")}</textarea>
          </div>
          <div style="display:flex; flex-direction:column; gap:18px; padding:4px 6px;">
            <div class="slider-row">
              <div class="slider-meta">
                <span class="slider-label">NPRS ATTUALE</span>
                <span class="slider-val num" id="valNprsAttuale">${Math.round(Number(motivo.nprs_attuale || 0))}</span>
              </div>
              <input type="range" class="clean-slider" min="0" max="10" step="0.05" name="nprs_attuale" id="sliderNprsAttuale" value="${Math.round(Number(motivo.nprs_attuale || 0))}" />
            </div>
            <div class="slider-row">
              <div class="slider-meta">
                <span class="slider-label">NPRS PEGGIORE</span>
                <span class="slider-val num" id="valNprsPeggiore">${Math.round(Number(motivo.nprs_peggiore || 0))}</span>
              </div>
              <input type="range" class="clean-slider" min="0" max="10" step="0.05" name="nprs_peggiore" id="sliderNprsPeggiore" value="${Math.round(Number(motivo.nprs_peggiore || 0))}" />
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="tint-box tint-rose">
            <label class="form-label">Fattori provocativi</label>
            <textarea class="form-control" name="fattori_provocativi" rows="3" placeholder="Movimenti, posture o carichi che provocano il sintomo...">${esc(motivo.fattori_provocativi || "")}</textarea>
          </div>
          <div class="tint-box tint-green">
            <label class="form-label">Fattori allevianti</label>
            <textarea class="form-control" name="fattori_allevianti" rows="3" placeholder="Cosa riduce o allevia il sintomo...">${esc(motivo.fattori_allevianti || "")}</textarea>
          </div>
        </div>
      </section>

      <!-- 2. DOLORE -->
      <section id="sec-dolore">
        <details class="clean-details" open>
          <summary>
            <div style="display:flex; align-items:center; gap:8px;">
              <span>Dolore</span>
              <span class="tag num" id="painActiveCount">${painSet.size ? `${painSet.size} selezionati` : "0 selezionati"}</span>
            </div>
            <span style="font-size:12px; color:var(--text-muted);">Apri / Chiudi</span>
          </summary>
          <div class="details-body">
            <div class="anam-pain-grid">
              <div class="anam-toggle-col">
                ${PAIN_QUALITIES_COL1.map((q) => toggleSwitchHtml("pain_quality", q, q, painSet.has(q))).join("")}
              </div>
              <div class="anam-toggle-col">
                ${PAIN_QUALITIES_COL2.map((q) => toggleSwitchHtml("pain_quality", q, q, painSet.has(q))).join("")}
              </div>
              <div style="display:flex; flex-direction:column; gap:14px;">
                <div class="slider-row">
                  <div class="slider-meta">
                    <span class="slider-label">NPRS</span>
                    <span class="slider-val num" id="valDoloreNprs">${Math.round(Number(dolore.nprs || 0))}</span>
                  </div>
                  <input type="range" class="clean-slider" min="0" max="10" step="0.05" name="dolore_nprs" id="sliderDoloreNprs" value="${Math.round(Number(dolore.nprs || 0))}" />
                </div>
                <div class="slider-row">
                  <div class="slider-meta">
                    <span class="slider-label">Situazione insostenibile</span>
                    <span class="slider-val num" id="valInsostenibile">${Math.round(Number(dolore.situazione_insostenibile || 0))}</span>
                  </div>
                  <input type="range" class="clean-slider" min="0" max="10" step="0.05" name="situazione_insostenibile" id="sliderInsostenibile" value="${Math.round(Number(dolore.situazione_insostenibile || 0))}" />
                </div>
                <div class="form-group" style="margin:0;">
                  <label class="form-label">Note dolore</label>
                  <textarea class="form-control" name="dolore_note" rows="3" placeholder="Note...">${esc(dolore.note || "")}</textarea>
                </div>
              </div>
            </div>
          </div>
        </details>
      </section>

      <!-- 3. INFORMAZIONI AGGIUNTIVE (11 BARRE RICHIUDIBILI) -->
      <section id="sec-info" style="margin-bottom:16px;">
        <div style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-muted); margin:0 0 8px 2px;">
          Informazioni aggiuntive
        </div>
        <div class="anam-accordion-stack">
          ${ADDITIONAL_INFO_SECTIONS.map((sec) => {
            const val = String(infoAgg[sec.key] || "");
            const filled = val.trim().length > 0;
            return `
              <details class="anam-bar ${sec.amber ? "anam-bar-amber" : ""}" ${filled ? "open" : ""}>
                <summary>
                  <div style="display:flex; align-items:center; gap:8px; min-width:0;">
                    <span style="font-weight:600;">${esc(sec.label)}</span>
                    ${filled ? `<span class="tag tag-accent">Compilato</span>` : ""}
                  </div>
                  <span style="font-size:12px; color:var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:45%;">
                    ${filled ? esc(val.slice(0, 60)) : ""}
                  </span>
                </summary>
                <div class="anam-bar-body">
                  <textarea class="form-control" name="info_${sec.key}" rows="2" placeholder="${esc(sec.placeholder)}">${esc(val)}</textarea>
                </div>
              </details>
            `;
          }).join("")}
        </div>
      </section>

      <!-- 4. BODY CHART (DISEGNO A MANO LIBERA) -->
      <section id="sec-bodychart" class="card">
        <div class="card-header" style="margin-bottom:12px;">
          <h3 class="card-title">Body chart</h3>
          <div class="body-chart-toolbar">
            <div class="bc-variant-switch" role="group" aria-label="Modello anatomico">
              <button type="button" class="bc-variant-btn ${bodyChartVariant !== "female" ? "active" : ""}" data-bc-variant="male">Uomo</button>
              <button type="button" class="bc-variant-btn ${bodyChartVariant === "female" ? "active" : ""}" data-bc-variant="female">Donna</button>
            </div>
            <label class="anam-toggle-row" style="margin:0;">
              <span class="toggle-switch">
                <input type="checkbox" id="bcDrawToggle" checked />
                <span class="toggle-track"></span>
              </span>
              <span style="font-size:12.5px; font-weight:500;">Disegna</span>
            </label>
            <div class="ink-palette" role="group" aria-label="Colore tratto">
              ${INK_COLORS.map(
                (c, i) =>
                  `<button type="button" class="ink-dot ${i === 0 ? "active" : ""}" data-ink-color="${c.id}" title="${esc(c.label)}" style="background:${c.id};"></button>`
              ).join("")}
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="slider-val num" id="bcWidthVal" style="min-width:26px; font-size:12px;">10</span>
              <input type="range" class="clean-slider" id="bcWidthSlider" min="3" max="24" value="10" style="width:96px;" />
            </div>
            <button type="button" class="btn btn-xs btn-secondary" id="bcUndoBtn">Annulla</button>
            <button type="button" class="btn btn-xs btn-danger-ghost" id="bcClearBtn">Pulisci</button>
          </div>
        </div>
        <div class="body-chart-wrap" id="bodyChartWrap">
          ${renderBodyChartSvg(strokes, bodyChartVariant)}
        </div>
      </section>

      <!-- 5. ANAMNESI FAMILIARE & REMOTA -->
      <section id="sec-fam-rem">
        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Anamnesi familiare</h3>
              <div class="card-subtitle">C'è qualcuno all'interno della sua famiglia che è stato curato per una delle seguenti condizioni?</div>
            </div>
            <span class="tag num" id="famCountBadge">${famSet.size} selezionate</span>
          </div>
          <div class="anam-top-cancro">
            ${toggleSwitchHtml("fam_cond", "Cancro", "Cancro", famSet.has("Cancro"))}
            <input class="form-control form-control-sm" name="fam_note" value="${esc(famData.note || "")}" placeholder="Note aggiuntive anamnesi familiare..." />
          </div>
          <div class="anam-4col">
            ${FAMILY_CONDITIONS_COLS.map(
              (col) => `<div class="anam-toggle-col">${col.map((c) => toggleSwitchHtml("fam_cond", c, c, famSet.has(c))).join("")}</div>`
            ).join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h3 class="card-title">Anamnesi remota</h3>
              <div class="card-subtitle">Le è mai stata diagnosticata una delle seguenti condizioni?</div>
            </div>
            <span class="tag num" id="remCountBadge">${remSet.size} selezionate</span>
          </div>
          <div class="anam-top-cancro">
            ${toggleSwitchHtml("rem_cond", "Cancro", "Cancro", remSet.has("Cancro"))}
            <input class="form-control form-control-sm" name="rem_note" value="${esc(remData.note || "")}" placeholder="Note aggiuntive anamnesi remota..." />
          </div>
          <div class="anam-4col">
            ${REMOTE_CONDITIONS_COLS.map(
              (col) => `<div class="anam-toggle-col">${col.map((c) => toggleSwitchHtml("rem_cond", c, c, remSet.has(c))).join("")}</div>`
            ).join("")}
          </div>
        </div>
      </section>

      <!-- 6. RED FLAGS -->
      <section id="sec-redflags" class="card">
        <div class="card-header">
          <h3 class="card-title rf-card-title">Red Flags</h3>
          <span class="tag ${redSet.size ? "tag-danger" : ""} num" id="redCountBadge">${redSet.size} presenti</span>
        </div>
        <div class="rf-group-header">Notato di recente</div>
        <div class="anam-3col" style="padding:8px 4px 0;">
          ${RED_FLAGS_COLS.map(
            (col) => `<div class="anam-toggle-col">${col.map((rf) => toggleSwitchHtml("red_flag", rf, rf, redSet.has(rf), "anam-toggle-danger")).join("")}</div>`
          ).join("")}
        </div>
        <div class="form-group" style="margin:14px 0 0;">
          <input class="form-control form-control-sm" name="red_flags_note" value="${esc(redFlags.note || "")}" placeholder="Note Red Flags / eventuale referral..." />
        </div>
      </section>

      <!-- 7. YELLOW FLAGS -->
      <section id="sec-yellowflags" class="card">
        <div class="card-header">
          <h3 class="card-title yf-card-title">Yellow Flags</h3>
          <span class="tag ${yellowSet.size ? "tag-warning" : ""} num" id="yellowCountBadge">${yellowSet.size} presenti</span>
        </div>
        <div class="grid-2" style="align-items:start;">
          <div style="display:flex; flex-direction:column; gap:14px;">
            ${YELLOW_FLAGS_LEFT.map(
              (grp) => `
              <div>
                <div class="yf-group-header">${esc(grp.title)}</div>
                <div class="anam-toggle-col" style="padding:6px 4px 0;">
                  ${grp.items.map((it) => toggleSwitchHtml("yellow_flag", it, it, yellowSet.has(it), "anam-toggle-amber")).join("")}
                </div>
              </div>`
            ).join("")}
          </div>
          <div style="display:flex; flex-direction:column; gap:14px;">
            ${YELLOW_FLAGS_RIGHT.map(
              (grp) => `
              <div>
                <div class="yf-group-header">${esc(grp.title)}</div>
                <div class="anam-toggle-col" style="padding:6px 4px 0;">
                  ${grp.items.map((it) => toggleSwitchHtml("yellow_flag", it, it, yellowSet.has(it), "anam-toggle-amber")).join("")}
                </div>
              </div>`
            ).join("")}
          </div>
        </div>
        <div class="form-group" style="margin:14px 0 0;">
          <input class="form-control form-control-sm" name="yellow_flags_note" value="${esc(yellowFlags.note || "")}" placeholder="Note Yellow Flags..." />
        </div>
      </section>

      <div style="display:flex; justify-content:flex-end; margin-top:4px;">
        <button type="submit" class="btn btn-primary" id="saveAnamnesisBottomBtn">Salva anamnesi</button>
      </div>
    </form>
  `;

  // --- Interazioni live: Dirty badge, Sliders, Contatori toggle ---
  const form = document.getElementById("anamnesisMasterForm");
  const dirtyBadge = document.getElementById("anamDirtyBadge");
  const markDirty = () => {
    if (dirtyBadge) dirtyBadge.style.display = "inline-flex";
  };

  form?.addEventListener("input", markDirty);
  form?.addEventListener("change", () => {
    markDirty();
    const countChecked = (name) => form.querySelectorAll(`input[name="${name}"]:checked`).length;
    const pCnt = countChecked("pain_quality");
    const fCnt = countChecked("fam_cond");
    const rCnt = countChecked("rem_cond");
    const rfCnt = countChecked("red_flag");
    const yfCnt = countChecked("yellow_flag");

    const setEl = (id, text, cls) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = text;
        if (cls !== undefined) el.className = cls;
      }
    };
    setEl("painActiveCount", `${pCnt} selezionati`);
    setEl("famCountBadge", `${fCnt} selezionate`);
    setEl("remCountBadge", `${rCnt} selezionate`);
    setEl("redCountBadge", `${rfCnt} presenti`, `tag ${rfCnt ? "tag-danger" : ""} num`);
    setEl("yellowCountBadge", `${yfCnt} presenti`, `tag ${yfCnt ? "tag-warning" : ""} num`);
  });

  const bindSeveritySlider = (sliderId, valId) => {
    const sl = document.getElementById(sliderId);
    const vl = document.getElementById(valId);
    if (!sl) return;
    applySeveritySliderVisual(sl, vl);
    sl.addEventListener("input", () => {
      applySeveritySliderVisual(sl, vl);
    });
    sl.addEventListener("change", () => {
      sl.value = String(Math.round(Number(sl.value || 0)));
      applySeveritySliderVisual(sl, vl);
    });
    sl.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        sl.value = String(Math.min(10, Math.round(Number(sl.value || 0)) + 1));
        applySeveritySliderVisual(sl, vl);
        markDirty();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        sl.value = String(Math.max(0, Math.round(Number(sl.value || 0)) - 1));
        applySeveritySliderVisual(sl, vl);
        markDirty();
      }
    });
  };
  bindSeveritySlider("sliderNprsAttuale", "valNprsAttuale");
  bindSeveritySlider("sliderNprsPeggiore", "valNprsPeggiore");
  bindSeveritySlider("sliderDoloreNprs", "valDoloreNprs");
  bindSeveritySlider("sliderInsostenibile", "valInsostenibile");

  // --- Body Chart Freehand Drawing (Mouse / Touch / Apple Pencil) ---
  const svgEl = document.getElementById("freehandBodySvg");
  const strokesLayer = document.getElementById("freehandStrokesLayer");
  let activeStroke = null;
  let activePathEl = null;

  const clientToSvg = (evt) => {
    const ctm = svgEl?.getScreenCTM?.();
    if (ctm) {
      const pt = svgEl.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const svgPt = pt.matrixTransform(ctm.inverse());
      return [
        Math.round(Math.max(0, Math.min(BODY_VB_W, svgPt.x)) * 10) / 10,
        Math.round(Math.max(0, Math.min(BODY_VB_H, svgPt.y)) * 10) / 10
      ];
    }
    const rect = svgEl.getBoundingClientRect();
    const x = ((evt.clientX - rect.left) / rect.width) * BODY_VB_W;
    const y = ((evt.clientY - rect.top) / rect.height) * BODY_VB_H;
    return [
      Math.round(Math.max(0, Math.min(BODY_VB_W, x)) * 10) / 10,
      Math.round(Math.max(0, Math.min(BODY_VB_H, y)) * 10) / 10
    ];
  };

  const redrawStrokes = () => {
    if (!strokesLayer) return;
    strokesLayer.innerHTML = strokes
      .map(
        (st) => `
        <path
          d="${strokeToSvgPath(st.points)}"
          stroke="${esc(st.color || "#dc2626")}"
          stroke-width="${Number(st.width || 10)}"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
          opacity="0.68"
        />`
      )
      .join("");
  };

  svgEl?.addEventListener("pointerdown", (evt) => {
    if (!drawEnabled) return;
    evt.preventDefault();
    svgEl.setPointerCapture?.(evt.pointerId);
    const pt = clientToSvg(evt);
    activeStroke = { color: brushColor, width: brushWidth, points: [pt] };
    strokes.push(activeStroke);
    activePathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
    activePathEl.setAttribute("stroke", brushColor);
    activePathEl.setAttribute("stroke-width", String(brushWidth));
    activePathEl.setAttribute("stroke-linecap", "round");
    activePathEl.setAttribute("stroke-linejoin", "round");
    activePathEl.setAttribute("fill", "none");
    activePathEl.setAttribute("opacity", "0.68");
    activePathEl.setAttribute("d", strokeToSvgPath(activeStroke.points));
    strokesLayer.appendChild(activePathEl);
    markDirty();
  });

  svgEl?.addEventListener("pointermove", (evt) => {
    if (!activeStroke || !activePathEl) return;
    evt.preventDefault();
    const pt = clientToSvg(evt);
    const last = activeStroke.points[activeStroke.points.length - 1];
    const distSq = (pt[0] - last[0]) ** 2 + (pt[1] - last[1]) ** 2;
    if (distSq >= 6) {
      activeStroke.points.push(pt);
      activePathEl.setAttribute("d", strokeToSvgPath(activeStroke.points));
    }
  });

  const finishStroke = () => {
    activeStroke = null;
    activePathEl = null;
  };
  svgEl?.addEventListener("pointerup", finishStroke);
  svgEl?.addEventListener("pointercancel", finishStroke);

  document.getElementById("bcDrawToggle")?.addEventListener("change", (e) => {
    drawEnabled = e.target.checked;
    if (svgEl) svgEl.style.cursor = drawEnabled ? "crosshair" : "default";
  });

  const widthSlider = document.getElementById("bcWidthSlider");
  const widthVal = document.getElementById("bcWidthVal");
  applyBrushSliderVisual(widthSlider, brushColor);

  viewport.querySelectorAll("[data-bc-variant]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.getAttribute("data-bc-variant") === "female" ? "female" : "male";
      if (next === bodyChartVariant) return;
      bodyChartVariant = next;
      const cfg = BODY_CHART_VARIANTS[bodyChartVariant];
      const bgImg = document.getElementById("bodyChartBgImg");
      if (bgImg) bgImg.setAttribute("href", cfg.href);
      document.getElementById("bcLblDorso")?.setAttribute("x", String(cfg.labels.dorso));
      document.getElementById("bcLblAnteriore")?.setAttribute("x", String(cfg.labels.anteriore));
      document.getElementById("bcLblPosteriore")?.setAttribute("x", String(cfg.labels.posteriore));
      document.getElementById("bcLblPianta")?.setAttribute("x", String(cfg.labels.pianta));
      viewport.querySelectorAll("[data-bc-variant]").forEach((b) => b.classList.toggle("active", b === btn));
      markDirty();
    });
  });

  viewport.querySelectorAll("[data-ink-color]").forEach((dot) => {
    dot.addEventListener("click", () => {
      brushColor = dot.getAttribute("data-ink-color");
      viewport.querySelectorAll("[data-ink-color]").forEach((d) => d.classList.toggle("active", d === dot));
      applyBrushSliderVisual(widthSlider, brushColor);
    });
  });

  widthSlider?.addEventListener("input", () => {
    brushWidth = Number(widthSlider.value || 10);
    if (widthVal) widthVal.textContent = String(brushWidth);
    applyBrushSliderVisual(widthSlider, brushColor);
  });

  document.getElementById("bcUndoBtn")?.addEventListener("click", () => {
    if (strokes.length) {
      strokes.pop();
      redrawStrokes();
      markDirty();
    }
  });

  document.getElementById("bcClearBtn")?.addEventListener("click", () => {
    if (strokes.length && window.confirm("Cancellare tutti i tratti dalla Body chart?")) {
      strokes.length = 0;
      redrawStrokes();
      markDirty();
    }
  });

  // --- Episodi e salvataggio ---
  document.getElementById("anamEpisodeSelect")?.addEventListener("change", (e) => {
    onSelectEpisode?.(Number(e.target.value));
  });
  document.getElementById("anamNewEpBtn")?.addEventListener("click", () => onNewEpisode?.());

  const collectAndSave = async () => {
    const fd = new FormData(form);
    const getAll = (name) => fd.getAll(name).map(String);

    const info_aggiuntive = {};
    for (const sec of ADDITIONAL_INFO_SECTIONS) {
      const v = String(fd.get(`info_${sec.key}`) || "").trim();
      if (v) info_aggiuntive[sec.key] = v;
    }

    const payload = {
      episode_id: activeEp ? activeEp.id : null,
      person_anamnesis: {
        familiare: { selected: getAll("fam_cond"), note: String(fd.get("fam_note") || "").trim() },
        remota: { selected: getAll("rem_cond"), note: String(fd.get("rem_note") || "").trim() }
      },
      episode_intake: {
        motivo: {
          problema_principale: String(fd.get("problema_principale") || "").trim(),
          episodio_tipo: String(fd.get("episodio_tipo") || "primo"),
          note: String(fd.get("motivo_note") || "").trim(),
          problema_associato: String(fd.get("problema_associato") || "").trim(),
          nprs_attuale: Math.round(Number(fd.get("nprs_attuale") || 0)),
          nprs_peggiore: Math.round(Number(fd.get("nprs_peggiore") || 0)),
          fattori_provocativi: String(fd.get("fattori_provocativi") || "").trim(),
          fattori_allevianti: String(fd.get("fattori_allevianti") || "").trim()
        },
        dolore: {
          qualita: getAll("pain_quality"),
          nprs: Math.round(Number(fd.get("dolore_nprs") || 0)),
          situazione_insostenibile: Math.round(Number(fd.get("situazione_insostenibile") || 0)),
          note: String(fd.get("dolore_note") || "").trim()
        },
        info_aggiuntive,
        body_chart: { strokes, variant: bodyChartVariant },
        red_flags: {
          selected: getAll("red_flag"),
          note: String(fd.get("red_flags_note") || "").trim()
        },
        yellow_flags: {
          selected: getAll("yellow_flag"),
          note: String(fd.get("yellow_flags_note") || "").trim()
        }
      }
    };

    const topBtn = document.getElementById("saveAnamnesisTopBtn");
    const botBtn = document.getElementById("saveAnamnesisBottomBtn");
    if (topBtn) topBtn.disabled = true;
    if (botBtn) botBtn.disabled = true;
    try {
      await onSave?.(payload);
      if (dirtyBadge) dirtyBadge.style.display = "none";
    } finally {
      if (topBtn) topBtn.disabled = false;
      if (botBtn) botBtn.disabled = false;
    }
  };

  document.getElementById("saveAnamnesisTopBtn")?.addEventListener("click", collectAndSave);
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await collectAndSave();
  });
}
