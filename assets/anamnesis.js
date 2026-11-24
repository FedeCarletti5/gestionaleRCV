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
  { key: "preoccupazione_ansia", label: "Preoccupazione/Ansia", placeholder: "Timori del paziente, convinzioni sul problema, impatto emotivo...", amber: true },
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

/**
 * Silhouette anatomica pulita a tratto medico (Anteriore, Laterale DX, Laterale SX, Posteriore, Dorso e Pianta piedi)
 * ViewBox normalizzato 0 0 1000 680.
 */
function renderBodyChartSvg(strokes = []) {
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
    <svg id="freehandBodySvg" class="body-chart-svg" viewBox="0 0 1000 680" role="img" aria-label="Body chart anatomica interattiva">
      <rect x="0" y="0" width="1000" height="680" fill="#fbfcfd" />

      <!-- Etichette discrete -->
      <g fill="#9ca3af" font-size="13" font-weight="600" text-anchor="middle" style="user-select:none; pointer-events:none;">
        <text x="275" y="28">ANTERIORE</text>
        <text x="175" y="48">DX</text>
        <text x="375" y="48">SX</text>
        <text x="510" y="24">LATO DX</text>
        <text x="510" y="366">LATO SX</text>
        <text x="745" y="28">POSTERIORE</text>
        <text x="645" y="48">SX</text>
        <text x="845" y="48">DX</text>
        <text x="90" y="510">DORSO PIEDI</text>
        <text x="910" y="510">PIANTA PIEDI</text>
      </g>

      <!-- Figure anatomiche line-art (non intercettano pointer) -->
      <g fill="#ffffff" stroke="#1f2937" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;">
        <!-- 1. ANTERIORE (centro x=275) -->
        <g id="fig-anterior">
          <!-- Testa e collo -->
          <path d="M 275 58 C 254 58, 245 76, 247 98 C 248 115, 259 128, 275 128 C 291 128, 302 115, 303 98 C 305 76, 296 58, 275 58 Z" />
          <!-- Orecchie -->
          <path d="M 247 90 C 242 90, 242 106, 248 106" fill="none" />
          <path d="M 303 90 C 308 90, 308 106, 302 106" fill="none" />
          <!-- Corpo completo anteriore -->
          <path d="
            M 260 124 L 258 144 C 242 152, 212 156, 202 174
            C 194 190, 190 232, 184 268
            C 178 302, 166 336, 156 364
            L 140 388 C 137 394, 144 398, 149 392 L 158 380
            L 150 410 C 149 415, 155 417, 158 411 L 166 386
            L 164 414 C 164 419, 170 419, 172 413 L 177 386
            L 179 406 C 180 411, 186 410, 186 404 L 185 376
            C 194 348, 206 312, 212 276
            C 216 250, 219 224, 222 214
            C 226 244, 228 278, 226 308
            C 222 332, 216 356, 216 388
            C 216 426, 226 472, 232 508
            C 236 534, 232 568, 238 606
            L 236 628 C 228 638, 220 644, 222 650 C 226 655, 254 654, 260 648
            C 262 642, 258 630, 258 614
            C 263 576, 268 540, 267 506
            C 269 472, 272 426, 275 384
            C 278 426, 281 472, 283 506
            C 282 540, 287 576, 292 614
            C 292 630, 288 642, 290 648
            C 296 654, 324 655, 328 650 C 330 644, 322 638, 314 628
            L 312 606 C 318 568, 314 534, 318 508
            C 324 472, 334 426, 334 388
            C 334 356, 328 332, 324 308
            C 322 278, 324 244, 328 214
            C 331 224, 334 250, 338 276
            C 344 312, 356 348, 365 376
            L 364 404 C 364 410, 370 411, 371 406 L 373 386
            L 378 413 C 380 419, 386 419, 386 414 L 384 386
            L 392 411 C 395 417, 401 415, 400 410 L 392 380
            L 401 392 C 406 398, 413 394, 410 388 L 394 364
            C 384 336, 372 302, 366 268
            C 360 232, 356 190, 348 174
            C 338 156, 308 152, 292 144 L 290 124
          " />
          <!-- Dettagli anatomici anteriori leggeri -->
          <g fill="none" stroke="#94a3b8" stroke-width="1.3">
            <path d="M 232 168 Q 254 176 275 170 Q 296 176 318 168" />
            <path d="M 230 220 Q 252 228 272 220 M 278 220 Q 298 228 320 220" />
            <circle cx="275" cy="306" r="2.2" />
            <path d="M 238 492 Q 248 502 258 492 M 292 492 Q 302 502 312 492" />
            <path d="M 263 360 Q 275 374 287 360" />
          </g>
        </g>

        <!-- 2. LATERALE DX (in alto centro, rivolto a destra, x=510, y=38..336) -->
        <g id="fig-lat-dx">
          <path d="M 505 42 C 520 42, 526 52, 526 62 L 530 68 L 525 72 L 526 78 C 526 84, 518 88, 512 88 L 512 96 C 524 102, 530 116, 530 138 C 530 158, 524 172, 524 190 C 524 206, 528 224, 524 246 C 520 264, 516 284, 516 306 L 516 322 L 536 330 C 538 334, 532 336, 518 336 L 498 336 C 494 336, 494 328, 498 322 L 498 298 C 494 276, 492 258, 496 238 C 492 216, 488 198, 492 178 C 488 158, 492 132, 492 112 C 492 102, 496 96, 498 88 C 492 84, 490 74, 490 62 C 490 48, 496 42, 505 42 Z" />
          <!-- Braccio laterale DX -->
          <path d="M 508 110 C 516 112, 520 132, 518 158 C 518 178, 522 198, 520 218 L 512 222 C 508 202, 506 180, 504 156 C 502 134, 502 114, 508 110 Z" fill="#ffffff" />
        </g>

        <!-- 3. LATERALE SX (in basso centro, rivolto a sinistra, x=510, y=380..666) -->
        <g id="fig-lat-sx">
          <path d="M 515 380 C 500 380, 494 390, 494 400 L 490 406 L 495 410 L 494 416 C 494 422, 502 426, 508 426 L 508 434 C 496 440, 490 454, 490 476 C 490 496, 496 510, 496 528 C 496 544, 492 562, 496 584 C 500 602, 504 622, 504 644 L 504 654 L 484 662 C 482 666, 488 668, 502 668 L 522 668 C 526 668, 526 660, 522 654 L 522 634 C 526 614, 528 596, 524 576 C 528 554, 532 536, 528 516 C 532 496, 528 470, 528 450 C 528 440, 524 434, 522 426 C 528 422, 530 412, 530 400 C 530 386, 524 380, 515 380 Z" />
          <!-- Braccio laterale SX -->
          <path d="M 512 448 C 504 450, 500 470, 502 496 C 502 516, 498 536, 500 556 L 508 560 C 512 540, 514 518, 516 494 C 518 472, 518 452, 512 448 Z" fill="#ffffff" />
        </g>

        <!-- 4. POSTERIORE (centro x=745) -->
        <g id="fig-posterior">
          <path d="M 745 58 C 724 58, 715 76, 717 98 C 718 115, 729 126, 745 126 C 761 126, 772 115, 773 98 C 775 76, 766 58, 745 58 Z" />
          <path d="M 717 90 C 712 90, 712 106, 718 106" fill="none" />
          <path d="M 773 90 C 778 90, 778 106, 772 106" fill="none" />
          <path d="
            M 730 122 L 728 144 C 712 152, 682 156, 672 174
            C 664 190, 660 232, 654 268
            C 648 302, 636 336, 626 364
            L 610 388 C 607 394, 614 398, 619 392 L 628 380
            L 620 410 C 619 415, 625 417, 628 411 L 636 386
            L 634 414 C 634 419, 640 419, 642 413 L 647 386
            L 649 406 C 650 411, 656 410, 656 404 L 655 376
            C 664 348, 676 312, 682 276
            C 686 250, 689 224, 692 214
            C 696 244, 698 278, 696 308
            C 692 332, 686 356, 686 388
            C 686 426, 696 472, 702 508
            C 706 534, 702 568, 708 606
            L 706 628 C 700 638, 696 646, 702 652 C 708 656, 728 654, 732 648
            C 734 640, 728 628, 728 614
            C 733 576, 738 540, 737 506
            C 739 472, 742 426, 745 388
            C 748 426, 751 472, 753 506
            C 752 540, 757 576, 762 614
            C 762 628, 756 640, 758 648
            C 762 654, 782 656, 788 652 C 794 646, 790 638, 784 628
            L 782 606 C 788 568, 784 534, 788 508
            C 794 472, 804 426, 804 388
            C 804 356, 798 332, 794 308
            C 792 278, 794 244, 798 214
            C 801 224, 804 250, 808 276
            C 814 312, 826 348, 835 376
            L 834 404 C 834 410, 840 411, 841 406 L 843 386
            L 848 413 C 850 419, 856 419, 856 414 L 854 386
            L 862 411 C 865 417, 871 415, 870 410 L 862 380
            L 871 392 C 876 398, 883 394, 880 388 L 864 364
            C 854 336, 842 302, 836 268
            C 830 232, 826 190, 818 174
            C 808 156, 778 152, 762 144 L 760 122
          " />
          <!-- Dettagli anatomici posteriori leggeri (colonna, scapole, glutei, cavi poplitei) -->
          <g fill="none" stroke="#94a3b8" stroke-width="1.3">
            <line x1="745" y1="148" x2="745" y2="342" stroke-dasharray="4 4" />
            <path d="M 716 190 C 722 214, 728 232, 734 242 M 774 190 C 768 214, 762 232, 756 242" />
            <path d="M 745 342 L 745 384 M 694 386 Q 718 398 745 384 Q 772 398 796 386" />
            <path d="M 704 504 Q 718 510 732 504 M 758 504 Q 772 510 786 504" />
          </g>
        </g>

        <!-- 5. DORSO PIEDI (in basso a sinistra) -->
        <g id="fig-feet-dorsal">
          <path d="M 52 528 L 52 586 C 46 606, 40 628, 44 646 C 48 656, 72 658, 76 644 C 79 628, 75 604, 72 586 L 72 528" />
          <path d="M 106 528 L 106 586 C 103 604, 99 628, 102 644 C 106 658, 130 656, 134 646 C 138 628, 132 606, 126 586 L 126 528" />
        </g>

        <!-- 6. PIANTA PIEDI (in basso a destra) -->
        <g id="fig-feet-plantar">
          <path d="M 874 654 C 860 654, 856 632, 860 606 C 862 590, 854 570, 856 552 C 858 536, 882 536, 890 554 C 896 570, 890 594, 888 614 C 888 636, 888 654, 874 654 Z" />
          <path d="M 944 654 C 958 654, 962 632, 958 606 C 956 590, 964 570, 962 552 C 960 536, 936 536, 928 554 C 922 570, 928 594, 930 614 C 930 636, 930 654, 944 654 Z" />
        </g>
      </g>

      <!-- Tratti disegnati a mano libera -->
      <g id="freehandStrokesLayer">${strokePaths}</g>
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
                <span class="slider-val num" id="valNprsAttuale">${Number(motivo.nprs_attuale || 0)}</span>
              </div>
              <input type="range" class="clean-slider" min="0" max="10" step="1" name="nprs_attuale" id="sliderNprsAttuale" value="${Number(motivo.nprs_attuale || 0)}" />
            </div>
            <div class="slider-row">
              <div class="slider-meta">
                <span class="slider-label">NPRS PEGGIORE</span>
                <span class="slider-val num" id="valNprsPeggiore">${Number(motivo.nprs_peggiore || 0)}</span>
              </div>
              <input type="range" class="clean-slider" min="0" max="10" step="1" name="nprs_peggiore" id="sliderNprsPeggiore" value="${Number(motivo.nprs_peggiore || 0)}" />
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
                    <span class="slider-val num" id="valDoloreNprs">${Number(dolore.nprs || 0)}</span>
                  </div>
                  <input type="range" class="clean-slider" min="0" max="10" step="1" name="dolore_nprs" id="sliderDoloreNprs" value="${Number(dolore.nprs || 0)}" />
                </div>
                <div class="slider-row">
                  <div class="slider-meta">
                    <span class="slider-label">Situazione insostenibile</span>
                    <span class="slider-val num" id="valInsostenibile">${Number(dolore.situazione_insostenibile || 0)}</span>
                  </div>
                  <input type="range" class="clean-slider" min="0" max="10" step="1" name="situazione_insostenibile" id="sliderInsostenibile" value="${Number(dolore.situazione_insostenibile || 0)}" />
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
          ${renderBodyChartSvg(strokes)}
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
          <div>
            <h3 class="card-title">Red Flags</h3>
            <div class="card-subtitle">Notato di recente</div>
          </div>
          <span class="tag ${redSet.size ? "tag-danger" : ""} num" id="redCountBadge">${redSet.size} presenti</span>
        </div>
        <div class="anam-3col">
          ${RED_FLAGS_COLS.map(
            (col) => `<div class="anam-toggle-col">${col.map((rf) => toggleSwitchHtml("red_flag", rf, rf, redSet.has(rf), "anam-toggle-danger")).join("")}</div>`
          ).join("")}
        </div>
        <div class="form-group" style="margin:12px 0 0;">
          <input class="form-control form-control-sm" name="red_flags_note" value="${esc(redFlags.note || "")}" placeholder="Note Red Flags / eventuale referral..." />
        </div>
      </section>

      <!-- 7. YELLOW FLAGS -->
      <section id="sec-yellowflags" class="card">
        <div class="card-header">
          <h3 class="card-title">Yellow Flags</h3>
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

  const bindSlider = (sliderId, valId) => {
    const sl = document.getElementById(sliderId);
    const vl = document.getElementById(valId);
    sl?.addEventListener("input", () => {
      if (vl) vl.textContent = sl.value;
    });
  };
  bindSlider("sliderNprsAttuale", "valNprsAttuale");
  bindSlider("sliderNprsPeggiore", "valNprsPeggiore");
  bindSlider("sliderDoloreNprs", "valDoloreNprs");
  bindSlider("sliderInsostenibile", "valInsostenibile");

  // --- Body Chart Freehand Drawing (Mouse / Touch / Apple Pencil) ---
  const svgEl = document.getElementById("freehandBodySvg");
  const strokesLayer = document.getElementById("freehandStrokesLayer");
  let activeStroke = null;
  let activePathEl = null;

  const clientToSvg = (evt) => {
    const rect = svgEl.getBoundingClientRect();
    const x = Math.round(((evt.clientX - rect.left) / rect.width) * 1000);
    const y = Math.round(((evt.clientY - rect.top) / rect.height) * 680);
    return [Math.max(0, Math.min(1000, x)), Math.max(0, Math.min(680, y))];
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
    if (distSq >= 16) {
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

  viewport.querySelectorAll("[data-ink-color]").forEach((dot) => {
    dot.addEventListener("click", () => {
      brushColor = dot.getAttribute("data-ink-color");
      viewport.querySelectorAll("[data-ink-color]").forEach((d) => d.classList.toggle("active", d === dot));
    });
  });

  const widthSlider = document.getElementById("bcWidthSlider");
  const widthVal = document.getElementById("bcWidthVal");
  widthSlider?.addEventListener("input", () => {
    brushWidth = Number(widthSlider.value || 10);
    if (widthVal) widthVal.textContent = String(brushWidth);
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
          nprs_attuale: Number(fd.get("nprs_attuale") || 0),
          nprs_peggiore: Number(fd.get("nprs_peggiore") || 0),
          fattori_provocativi: String(fd.get("fattori_provocativi") || "").trim(),
          fattori_allevianti: String(fd.get("fattori_allevianti") || "").trim()
        },
        dolore: {
          qualita: getAll("pain_quality"),
          nprs: Number(fd.get("dolore_nprs") || 0),
          situazione_insostenibile: Number(fd.get("situazione_insostenibile") || 0),
          note: String(fd.get("dolore_note") || "").trim()
        },
        info_aggiuntive,
        body_chart: { strokes },
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
