/**
 * Definizioni cliniche scale PCS-I (13 item, 0-4) e TSK-I 13 item (Monticone 2010, 1-4)
 * + parser CSV Tally robusto (RFC 4180) con rilevamento automatico delle scale.
 */

export const PCS_ITEMS = [
  { item: 1, subscale: "Impotenza", text: "Mi preoccupo continuamente di sapere se il dolore finirà", keywords: ["preoccupo continuamente", "dolore finira"] },
  { item: 2, subscale: "Impotenza", text: "Sento di non poter continuare così", keywords: ["non poter continuare"] },
  { item: 3, subscale: "Impotenza", text: "È terribile e credo che non migliorerà mai", keywords: ["non migliorera mai", "terribile e credo"] },
  { item: 4, subscale: "Impotenza", text: "È terribile e sento che mi opprime", keywords: ["mi opprime", "mi sopraffa"] },
  { item: 5, subscale: "Impotenza", text: "Sento di non poterlo più sopportare", keywords: ["piu sopportare", "non poterlo piu"] },
  { item: 6, subscale: "Amplificazione", text: "Ho paura che il dolore peggiori", keywords: ["paura che il dolore peggiori"] },
  { item: 7, subscale: "Amplificazione", text: "Continuo a pensare ad altri episodi dolorosi", keywords: ["altri episodi dolorosi", "altre esperienze dolorose"] },
  { item: 8, subscale: "Ruminazione", text: "Desidero ardentemente che il dolore scompaia", keywords: ["desidero ardentemente", "dolore scompaia"] },
  { item: 9, subscale: "Ruminazione", text: "Non riesco a togliermelo dalla testa", keywords: ["togliermelo dalla testa", "togliere dalla mente"] },
  { item: 10, subscale: "Ruminazione", text: "Continuo a pensare a quanto fa male", keywords: ["quanto fa male"] },
  { item: 11, subscale: "Ruminazione", text: "Continuo a pensare a quanto vorrei che il dolore cessasse", keywords: ["dolore cessasse", "dolore smettesse"] },
  { item: 12, subscale: "Impotenza", text: "Non posso fare nulla per ridurre l'intensità del dolore", keywords: ["ridurre l intensita", "nulla per ridurre"] },
  { item: 13, subscale: "Amplificazione", text: "Mi chiedo se possa accadere qualcosa di grave", keywords: ["accadere qualcosa di grave", "succedere qualcosa di grave"] }
];

export const TSK13_ITEMS = [
  { item: 1, subscale: "Evitamento attività", text: "Ho paura di farmi male se faccio esercizio fisico", keywords: ["paura di farmi male", "farmi male se faccio esercizio"] },
  { item: 2, subscale: "Evitamento attività", text: "Se cercassi di superare questo dolore, il dolore aumenterebbe", keywords: ["superare questo dolore", "dolore aumenterebbe"] },
  { item: 3, subscale: "Focus somatico / Danno", text: "Il mio corpo mi sta dicendo che ho qualcosa di pericolosamente sbagliato", keywords: ["pericolosamente sbagliato", "seriamente compromesso"] },
  { item: 4, subscale: "Focus somatico / Danno", text: "Le persone non prendono abbastanza sul serio la mia condizione fisica", keywords: ["abbastanza sul serio", "non prendono"] },
  { item: 5, subscale: "Focus somatico / Danno", text: "Il mio problema ha messo a rischio il mio corpo per il resto della mia vita", keywords: ["messo a rischio il mio corpo", "resto della mia vita"] },
  { item: 6, subscale: "Focus somatico / Danno", text: "Il dolore significa sempre che ho subito una lesione al corpo", keywords: ["subito una lesione", "danneggiato il mio corpo"] },
  { item: 7, subscale: "Evitamento attività", text: "Temo di potermi ferire accidentalmente", keywords: ["ferire accidentalmente", "farmi del male accidentalmente"] },
  { item: 8, subscale: "Evitamento attività", text: "Stare attento a non fare movimenti inutili è la cosa più sicura per evitare che il dolore peggiori", keywords: ["movimenti inutili", "cosa piu sicura"] },
  { item: 9, subscale: "Focus somatico / Danno", text: "Non avrei tutto questo dolore se non ci fosse qualcosa di potenzialmente pericoloso nel mio corpo", keywords: ["potenzialmente pericoloso", "non avrei tutto questo dolore"] },
  { item: 10, subscale: "Evitamento attività", text: "Il dolore mi fa capire quando è il momento di smettere di fare esercizio per non farmi male", keywords: ["momento di smettere di fare esercizio", "capire quando e il momento"] },
  { item: 11, subscale: "Focus somatico / Danno", text: "Non è davvero sicuro per una persona nelle mie condizioni essere fisicamente attiva", keywords: ["nelle mie condizioni essere fisicamente attiva", "davvero sicuro per una persona"] },
  { item: 12, subscale: "Focus somatico / Danno", text: "Non posso fare tutte le cose che fanno le persone normali perché è troppo facile infortunarmi", keywords: ["persone normali", "troppo facile infortunarmi"] },
  { item: 13, subscale: "Evitamento attività", text: "Nessuno dovrebbe fare esercizio fisico quando ha dolore", keywords: ["nessuno dovrebbe fare esercizio"] }
];

export const PCS_LABELS = ["0 · Mai", "1 · Poco", "2 · Moderatamente", "3 · Molto", "4 · Sempre"];
export const TSK_LABELS = ["1 · Per nulla d'accordo", "2 · Poco d'accordo", "3 · Abbastanza d'accordo", "4 · Molto d'accordo"];

export function computeScaleBreakdown(scaleCode, responses, totalScore) {
  const list = Array.isArray(responses) ? responses : [];
  if (scaleCode === "PCS") {
    const rum = list.filter((r) => (r.subscale || "").toLowerCase().includes("rumin") || [8, 9, 10, 11].includes(Number(r.item)));
    const amp = list.filter((r) => (r.subscale || "").toLowerCase().includes("amplif") || [6, 7, 13].includes(Number(r.item)));
    const imp = list.filter((r) => (r.subscale || "").toLowerCase().includes("impot") || [1, 2, 3, 4, 5, 12].includes(Number(r.item)));
    const sumOf = (arr) => arr.reduce((a, r) => a + (r.score !== null && r.score !== undefined ? Number(r.score) : 0), 0);
    const chips = list.length
      ? [
          { label: "Ruminazione", value: `${sumOf(rum)}/16` },
          { label: "Amplificazione", value: `${sumOf(amp)}/12` },
          { label: "Impotenza", value: `${sumOf(imp)}/24` }
        ]
      : [];
    const score = Number(totalScore);
    let badge = null;
    if (Number.isFinite(score)) {
      if (score >= 30) badge = { text: "Soglia clinica (≥ 30)", cls: "tag-warning" };
      else if (score >= 20) badge = { text: "Moderato", cls: "tag" };
      else badge = { text: "Basso", cls: "tag-success" };
    }
    return { chips, badge };
  }

  if (scaleCode === "TSK-13") {
    const aa = list.filter((r) => (r.subscale || "").toLowerCase().includes("evit") || [1, 2, 7, 8, 10, 13].includes(Number(r.item)));
    const harm = list.filter((r) => (r.subscale || "").toLowerCase().includes("danno") || (r.subscale || "").toLowerCase().includes("somatic") || [3, 4, 5, 6, 9, 11, 12].includes(Number(r.item)));
    const sumOf = (arr) => arr.reduce((a, r) => a + (r.score !== null && r.score !== undefined ? Number(r.score) : 0), 0);
    const chips = list.length
      ? [
          { label: "Evitamento attività", value: `${sumOf(aa)}/24` },
          { label: "Focus somatico / Danno", value: `${sumOf(harm)}/28` }
        ]
      : [];
    const score = Number(totalScore);
    let badge = null;
    if (Number.isFinite(score)) {
      if (score <= 22) badge = { text: "Subclinica (13–22)", cls: "tag-success" };
      else if (score <= 32) badge = { text: "Lieve (23–32)", cls: "tag" };
      else if (score <= 42) badge = { text: "Moderata (33–42)", cls: "tag-warning" };
      else badge = { text: "Severa (43–52)", cls: "tag-danger" };
    }
    return { chips, badge };
  }

  return { chips: [], badge: null };
}

export function buildClinicalNoteFromBreakdown(scaleCode, responses, totalScore, extraMeta = "") {
  const { chips, badge } = computeScaleBreakdown(scaleCode, responses, totalScore);
  const parts = [];
  if (badge) parts.push(badge.text);
  if (chips.length) parts.push(chips.map((c) => `${c.label}: ${c.value}`).join(" · "));
  if (extraMeta) parts.push(extraMeta);
  return parts.join(" · ");
}

function normalizeStr(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCsvMatrix(text) {
  const clean = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field);
        field = "";
      } else if (ch === "\r") {
        if (clean[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (ch === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

function matchHeaderToItems(headers, itemDefs) {
  const mapping = [];
  const usedCols = new Set();
  for (const def of itemDefs) {
    let matchedIdx = -1;
    for (let c = 0; c < headers.length; c++) {
      if (usedCols.has(c)) continue;
      const nh = normalizeStr(headers[c]);
      if (def.keywords.some((kw) => nh.includes(kw))) {
        matchedIdx = c;
        break;
      }
    }
    if (matchedIdx >= 0) {
      usedCols.add(matchedIdx);
      mapping.push({ colIdx: matchedIdx, def, rawHeader: headers[matchedIdx] });
    }
  }
  return mapping;
}

export function parseTallyScalesCsv(csvText, filename = "") {
  const matrix = parseCsvMatrix(csvText);
  if (matrix.length < 2) {
    throw new Error("Il file CSV non contiene intestazioni e righe di risposta valide.");
  }
  const headers = matrix[0];
  const dataRows = matrix.slice(1);

  const subIdIdx = headers.findIndex((h) => normalizeStr(h).includes("submission id"));
  const subAtIdx = headers.findIndex((h) => normalizeStr(h).includes("submitted at"));
  const nameIdx = headers.findIndex((h) => {
    const n = normalizeStr(h);
    return n === "nome" || n === "nome e cognome" || n.includes("cognome");
  });

  const pcsMap = matchHeaderToItems(headers, PCS_ITEMS);
  const tskMap = matchHeaderToItems(headers, TSK13_ITEMS);

  if (pcsMap.length === 0 && tskMap.length === 0) {
    throw new Error("Nessuna scala PCS o TSK-13 riconosciuta nelle intestazioni del CSV.");
  }

  const contextFromFile = filename
    ? `Questionario Tally — ${filename.replace(/_Submissions.*$/i, "").replace(/\.csv$/i, "")}`
    : "Questionario Tally";

  return dataRows.map((vals, rowIdx) => {
    const submissionId = subIdIdx >= 0 ? String(vals[subIdIdx] || "").trim() : "";
    const submittedAt = subAtIdx >= 0 ? String(vals[subAtIdx] || "").trim() : "";
    const respondentName = nameIdx >= 0 ? String(vals[nameIdx] || "").trim() : "";
    const dateMatch = submittedAt.match(/(\d{4}-\d{2}-\d{2})/);
    const recordedDate = dateMatch ? dateMatch[1] : new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });
    const metaSuffix = submissionId
      ? `Compilazione Tally ${submissionId}${submittedAt ? ` (${submittedAt.slice(0, 16)})` : ""}`
      : "";

    const scales = [];

    if (pcsMap.length >= 10) {
      const responses = pcsMap.map(({ colIdx, def }) => {
        const raw = String(vals[colIdx] ?? "").trim();
        const num = raw === "" ? null : Number(raw.replace(",", "."));
        return {
          item: def.item,
          subscale: def.subscale,
          text: def.text,
          score: Number.isFinite(num) ? num : null
        };
      });
      const valid = responses.filter((r) => r.score !== null);
      if (valid.length > 0) {
        const score = valid.reduce((a, r) => a + r.score, 0);
        scales.push({
          scale_code: "PCS",
          scale_name: "Pain Catastrophizing Scale (PCS-I)",
          scale_version: "PCS-I 13 item (0-52)",
          source_mode: "internal_verified",
          score_unit: "/52",
          score_value: score,
          completed_items: valid.length,
          total_items: responses.length,
          missing_items: responses.length - valid.length,
          recorded_date: recordedDate,
          context_label: contextFromFile,
          clinical_note: buildClinicalNoteFromBreakdown("PCS", responses, score, metaSuffix),
          responses
        });
      }
    }

    if (tskMap.length >= 10) {
      const responses = tskMap.map(({ colIdx, def }) => {
        const raw = String(vals[colIdx] ?? "").trim();
        const num = raw === "" ? null : Number(raw.replace(",", "."));
        return {
          item: def.item,
          subscale: def.subscale,
          text: def.text,
          score: Number.isFinite(num) ? num : null
        };
      });
      const valid = responses.filter((r) => r.score !== null);
      if (valid.length > 0) {
        const score = valid.reduce((a, r) => a + r.score, 0);
        scales.push({
          scale_code: "TSK-13",
          scale_name: "Tampa Scale of Kinesiophobia (TSK-I 13 item)",
          scale_version: "TSK-I 13 item (Monticone 2010, 13-52)",
          source_mode: "internal_verified",
          score_unit: "/52",
          score_value: score,
          completed_items: valid.length,
          total_items: responses.length,
          missing_items: responses.length - valid.length,
          recorded_date: recordedDate,
          context_label: contextFromFile,
          clinical_note: buildClinicalNoteFromBreakdown("TSK-13", responses, score, metaSuffix),
          responses
        });
      }
    }

    return {
      rowIndex: rowIdx,
      submissionId,
      submittedAt,
      respondentName,
      recordedDate,
      scales
    };
  });
}
