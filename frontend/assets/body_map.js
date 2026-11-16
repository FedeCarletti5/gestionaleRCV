/**
 * Mappa Interattiva del Corpo 2D (SVG) — Vista Anteriore e Posteriore
 * Coordinate normalizzate 0..1000 indipendenti dalla risoluzione dello schermo.
 * Supporta mouse e touch (Mac, iPad, iPhone), zoom, lateralità anatomica esplicita (DX/SX),
 * marcatori puntiformi e aree, confronto storico e alternativa testuale accessibile.
 */

export const SYMPTOM_TYPES = [
  { id: "Dolore acuto", symbol: "▲", color: "#dc2626", stroke: "#7f1d1d" },
  { id: "Dolore sordo/profondo", symbol: "●", color: "#ea580c", stroke: "#7c2d12" },
  { id: "Bruciore", symbol: "◆", color: "#d97706", stroke: "#78350f" },
  { id: "Formicolio/Parestesia", symbol: "✦", color: "#7c3aed", stroke: "#4c1d95" },
  { id: "Rigidità", symbol: "■", color: "#0284c7", stroke: "#0c4a6e" },
  { id: "Debolezza", symbol: "▼", color: "#4f46e5", stroke: "#312e81" },
  { id: "Instabilità", symbol: "◉", color: "#0d9488", stroke: "#134e4a" }
];

export function inferAnatomicalRegionAndSide(viewSide, x, y) {
  // Nella vista ANTERIORE: il lato sinistro del canvas (x < 480) è la DESTRA anatomica (DX) del paziente.
  // Nella vista POSTERIORE: il lato sinistro del canvas (x < 480) è la SINISTRA anatomica (SX) del paziente.
  let laterality = "Centrale";
  if (x < 475) {
    laterality = viewSide === "anterior" ? "DX" : "SX";
  } else if (x > 525) {
    laterality = viewSide === "anterior" ? "SX" : "DX";
  }

  let region = "Tronco";
  if (y < 145) {
    region = viewSide === "anterior" ? "Capo / Volto" : "Capo / Occipite";
  } else if (y < 205) {
    region = viewSide === "anterior" ? "Collo Anteriore" : "Rachide Cervicale / Trapezio Sup.";
  } else if (y < 340) {
    if (x < 395 || x > 605) {
      region = "Spalla / Cingolo Scapolare";
    } else {
      region = viewSide === "anterior" ? "Torace / Pettorale" : "Rachide Dorsale / Regione Scapolare";
    }
  } else if (y < 470) {
    if (x < 370 || x > 630) {
      region = "Braccio / Gomito";
    } else {
      region = viewSide === "anterior" ? "Addome" : "Rachide Lombare";
    }
  } else if (y < 565) {
    if (x < 350 || x > 650) {
      region = "Avambraccio / Polso / Mano";
    } else {
      region = viewSide === "anterior" ? "Bacino / Inguine / Anca Ant." : "Bacino / Sacro / Regione Glutea";
    }
  } else if (y < 640) {
    region = viewSide === "anterior" ? "Coscia Anteriore (Quadricipite)" : "Coscia Posteriore (Ischiocrurali)";
  } else if (y < 710) {
    region = viewSide === "anterior" ? "Ginocchio / Tendine Rotuleo" : "Cavo Popliteo / Ginocchio Post.";
  } else if (y < 860) {
    region = viewSide === "anterior" ? "Gamba Anteriore / Tibia" : "Polpaccio / Tendine d'Achille";
  } else {
    region = viewSide === "anterior" ? "Caviglia / Dorso Piede" : "Calcagno / Pianta Piede";
  }

  return { region, laterality };
}

export function renderBodySvgMarkup(viewSide, markers, comparisonMarkers = [], zoomState = { scale: 1, focus: "full" }) {
  // Calcolo viewBox per lo zoom mantenendo le coordinate normalizzate 0..1000
  let vb = "0 0 1000 1000";
  if (zoomState.scale === 1.5) {
    vb = zoomState.focus === "lower" ? "150 320 700 680" : "150 20 700 680";
  } else if (zoomState.scale === 2.5) {
    vb = zoomState.focus === "lower" ? "240 460 520 500" : "240 60 520 500";
  }

  const leftCanvasLabel = viewSide === "anterior" ? "LATO DESTRO (DX)" : "LATO SINISTRO (SX)";
  const rightCanvasLabel = viewSide === "anterior" ? "LATO SINISTRO (SX)" : "LATO DESTRO (DX)";
  const viewTitle = viewSide === "anterior" ? "VISTA ANTERIORE" : "VISTA POSTERIORE";

  const filteredMarkers = (markers || []).filter((m) => m.view_side === viewSide);
  const filteredComp = (comparisonMarkers || []).filter((m) => m.view_side === viewSide);

  const compElements = filteredComp
    .map((m) => {
      const r = m.marker_kind === "area" ? Number(m.radius_norm || 48) : 18;
      return `
        <g class="comp-marker" opacity="0.45">
          <circle cx="${m.x_norm}" cy="${m.y_norm}" r="${r}" fill="none" stroke="#64748b" stroke-width="4" stroke-dasharray="8 6" />
          <text x="${m.x_norm}" y="${Number(m.y_norm) - r - 6}" text-anchor="middle" font-size="20" fill="#475569" font-weight="700">
            Prec: ${m.intensity}/10
          </text>
        </g>
      `;
    })
    .join("");

  const markerElements = filteredMarkers
    .map((m, idx) => {
      const sym = SYMPTOM_TYPES.find((s) => s.id === m.symptom_type) || SYMPTOM_TYPES[0];
      const isArea = m.marker_kind === "area";
      const radius = isArea ? Number(m.radius_norm || 48) : 22;
      return `
        <g class="active-marker" data-marker-idx="${m._globalIdx !== undefined ? m._globalIdx : idx}" style="cursor:pointer;">
          <circle
            cx="${m.x_norm}"
            cy="${m.y_norm}"
            r="${radius}"
            fill="${sym.color}"
            fill-opacity="${isArea ? "0.28" : "0.88"}"
            stroke="${sym.stroke}"
            stroke-width="4"
            ${isArea ? 'stroke-dasharray="10 5"' : ""}
          />
          <text
            x="${m.x_norm}"
            y="${Number(m.y_norm) + 7}"
            text-anchor="middle"
            font-size="21"
            font-weight="800"
            fill="${isArea ? sym.stroke : "#ffffff"}"
          >${sym.symbol}${m.intensity}</text>
        </g>
      `;
    })
    .join("");

  // Linee di riferimento anatomico distinte per Anteriore vs Posteriore
  const anatomicalDetails =
    viewSide === "anterior"
      ? `
        <!-- Clavicole, Sterno, Ginocchia Anteriori -->
        <path d="M405 210 Q450 225 500 220 Q550 225 595 210" fill="none" stroke="#64748b" stroke-width="3" />
        <line x1="500" y1="220" x2="500" y2="340" stroke="#94a3b8" stroke-width="2.5" stroke-dasharray="5 5" />
        <!-- Rotule -->
        <ellipse cx="445" cy="645" rx="18" ry="22" fill="none" stroke="#64748b" stroke-width="3" />
        <ellipse cx="555" cy="645" rx="18" ry="22" fill="none" stroke="#64748b" stroke-width="3" />
      `
      : `
        <!-- Colonna vertebrale e Scapole -->
        <line x1="500" y1="150" x2="500" y2="515" stroke="#475569" stroke-width="4" stroke-dasharray="7 5" />
        <path d="M420 230 L465 230 L455 320 Z" fill="none" stroke="#64748b" stroke-width="3" />
        <path d="M580 230 L535 230 L545 320 Z" fill="none" stroke="#64748b" stroke-width="3" />
        <!-- Pieghe poplitee -->
        <path d="M425 645 Q445 655 465 645" fill="none" stroke="#64748b" stroke-width="3" />
        <path d="M535 645 Q555 655 575 645" fill="none" stroke="#64748b" stroke-width="3" />
      `;

  return `
    <svg
      class="body-map-svg"
      data-view-side="${viewSide}"
      viewBox="${vb}"
      role="img"
      aria-label="Mappa anatomica 2D ${viewTitle} con lateralità esplicita"
    >
      <rect x="0" y="0" width="1000" height="1000" fill="#f8fafc" />
      <!-- Griglia di riferimento leggera -->
      <line x1="500" y1="30" x2="500" y2="970" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="8 8" />

      <!-- Etichette di Lateralità Anatomica Esplicita -->
      <rect x="30" y="24" width="250" height="44" rx="8" fill="#0f172a" />
      <text x="155" y="53" text-anchor="middle" font-size="22" font-weight="800" fill="#ffffff">${leftCanvasLabel}</text>

      <rect x="720" y="24" width="250" height="44" rx="8" fill="#0f172a" />
      <text x="845" y="53" text-anchor="middle" font-size="22" font-weight="800" fill="#ffffff">${rightCanvasLabel}</text>

      <text x="500" y="52" text-anchor="middle" font-size="22" font-weight="800" fill="#0f766e">${viewTitle}</text>

      <!-- Silhouette Anatomica 2D Normalizzata -->
      <g class="body-silhouette-group">
        <!-- Capo e Collo -->
        <ellipse class="body-silhouette" cx="500" cy="105" rx="46" ry="56" />
        <rect class="body-silhouette" x="476" y="155" width="48" height="42" rx="10" />

        <!-- Tronco e Bacino -->
        <path
          class="body-silhouette"
          d="M395 198
             C430 190, 570 190, 605 198
             L620 265
             L585 430
             L595 535
             C560 555, 440 555, 405 535
             L415 430
             L380 265 Z"
        />

        <!-- Arto Superiore Sinistro del Canvas -->
        <path
          class="body-silhouette"
          d="M395 202
             L345 230
             L315 375
             L290 505
             L265 565
             L310 580
             L335 515
             L362 385
             L392 275 Z"
        />

        <!-- Arto Superiore Destro del Canvas -->
        <path
          class="body-silhouette"
          d="M605 202
             L655 230
             L685 375
             L710 505
             L735 565
             L690 580
             L665 515
             L638 385
             L608 275 Z"
        />

        <!-- Arto Inferiore Sinistro del Canvas -->
        <path
          class="body-silhouette"
          d="M412 535
             L490 538
             L478 700
             L470 875
             L482 940
             L412 940
             L422 875
             L415 700 Z"
        />

        <!-- Arto Inferiore Destro del Canvas -->
        <path
          class="body-silhouette"
          d="M510 538
             L588 535
             L585 700
             L578 875
             L588 940
             L518 940
             L530 875
             L522 700 Z"
        />
      </g>

      ${anatomicalDetails}
      ${compElements}
      ${markerElements}
    </svg>
  `;
}

export function clientEventToNormalizedSvgCoords(svgElement, event) {
  const rect = svgElement.getBoundingClientRect();
  const clientX = event.touches && event.touches[0] ? event.touches[0].clientX : event.clientX;
  const clientY = event.touches && event.touches[0] ? event.touches[0].clientY : event.clientY;

  const vbAttr = (svgElement.getAttribute("viewBox") || "0 0 1000 1000").split(/\s+/).map(Number);
  const [vbX, vbY, vbW, vbH] = vbAttr;

  const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const relY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

  const xNorm = Math.round((vbX + relX * vbW) * 10) / 10;
  const yNorm = Math.round((vbY + relY * vbH) * 10) / 10;
  return { x_norm: xNorm, y_norm: yNorm };
}
