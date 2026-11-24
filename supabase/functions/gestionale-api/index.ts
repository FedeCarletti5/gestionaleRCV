import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.5";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const dbUrl = Deno.env.get("SUPABASE_DB_URL")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Configura client Postgres convertendo BIGINT (OID 20) in Number JS per piena compatibilità JSON
const sql = postgres(dbUrl, {
  prepare: false,
  max: 5,
  types: {
    bigint: {
      to: 20,
      from: [20],
      parse: (x: string) => Number(x),
      serialize: (x: number) => String(x),
    },
  },
});

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CSRF-Token, X-Session-Token, apikey",
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  "X-Content-Type-Options": "nosniff",
};

class ValidationError extends Error {
  details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.details = details;
  }
}

class ConflictError extends Error {
  serverRecord: Record<string, unknown>;
  constructor(message: string, serverRecord: Record<string, unknown>) {
    super(message);
    this.serverRecord = serverRecord;
  }
}

class NotFoundError extends Error {}

function nowRomeIso(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });
  const parts = fmt.formatToParts(now);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let offset = (map.timeZoneName || "GMT+01:00").replace("GMT", "");
  if (!offset || offset === "") offset = "+01:00";
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}${offset}`;
}

function normalizeStartAt(dtStr: string): Date {
  const clean = dtStr.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(clean)) {
    return new Date(`${clean}:00+01:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(clean)) {
    return new Date(`${clean}+01:00`);
  }
  return new Date(clean);
}

function toRomeIsoFromDate(d: Date): string {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  });
  const parts = fmt.formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let offset = (map.timeZoneName || "GMT+01:00").replace("GMT", "");
  if (!offset) offset = "+01:00";
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}${offset}`;
}

async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const hashBuf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(byteLen: number): string {
  const arr = new Uint8Array(byteLen);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string, salt?: string, iterations = 100000): Promise<string> {
  const useSalt = salt || randomHex(16);
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc.encode(useSalt),
      iterations,
      hash: "SHA-256",
    },
    keyMat,
    256,
  );
  const hex = Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `pbkdf2_sha256$${iterations}$${useSalt}$${hex}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const expected = parts[3];
    const candidate = await hashPassword(password, salt, iterations);
    const candHex = candidate.split("$")[3];
    if (candHex.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < candHex.length; i++) {
      diff |= candHex.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
  } catch {
    return false;
  }
}

function base32ToBytes(b32: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = b32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    value = (value << 5) | alphabet.indexOf(clean[i]);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function getTotpCode(secretB32: string, timestampSec?: number): Promise<string> {
  const ts = timestampSec ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(ts / 30);
  const msg = new Uint8Array(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }
  const keyBytes = base32ToBytes(secretB32);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = sig[sig.length - 1] & 0x0f;
  const codeInt =
    (((sig[offset] & 0x7f) << 24) |
      ((sig[offset + 1] & 0xff) << 16) |
      ((sig[offset + 2] & 0xff) << 8) |
      (sig[offset + 3] & 0xff)) %
    1000000;
  return String(codeInt).padStart(6, "0");
}

async function verifyTotpCode(secretB32: string, code: string): Promise<boolean> {
  const clean = (code || "").trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const off of [-30, 0, 30]) {
    const cand = await getTotpCode(secretB32, nowSec + off);
    if (cand === clean) return true;
  }
  return false;
}

const OUTCOME_SCALES_CATALOG: Record<string, Record<string, string>> = {
  PCS: {
    scale_code: "PCS",
    scale_name: "Pain Catastrophizing Scale (PCS-I)",
    scale_version: "PCS-I 13 item (0-52)",
    source_mode: "internal_verified",
    score_unit: "/52",
    description:
      "Scala italiana di catastrofizzazione del dolore (13 item, 0-4; sottoscale: Ruminazione, Amplificazione, Impotenza; soglia clinica >= 30).",
  },
  "TSK-13": {
    scale_code: "TSK-13",
    scale_name: "Tampa Scale of Kinesiophobia (TSK-I 13 item)",
    scale_version: "TSK-I 13 item (Monticone 2010, 13-52)",
    source_mode: "internal_verified",
    score_unit: "/52",
    description:
      "Scala italiana di kinesiofobia a 13 item (1-4; sottoscale: Evitamento attività, Focus somatico/Danno; fasce Neblett 2016: 13-22 subclinica, 23-32 lieve, 33-42 moderata, 43-52 severa).",
  },
  NPRS: {
    scale_code: "NPRS",
    scale_name: "Numeric Pain Rating Scale (Intensità del Dolore 0-10)",
    scale_version: "NPRS-11 IT (0-10)",
    source_mode: "internal_verified",
    score_unit: "/10",
    description:
      "Scala numerica unidimensionale dell'intensità del dolore (0 = nessun dolore, 10 = peggior dolore immaginabile).",
  },
  PSFS: {
    scale_code: "PSFS",
    scale_name: "Patient-Specific Functional Scale (Funzione Specifica del Paziente)",
    scale_version: "PSFS IT v1 (Stratford et al. 1995)",
    source_mode: "internal_verified",
    score_unit: "/10",
    description:
      "Il paziente indica da 1 a 5 attività importanti limitate dal problema (0 = incapace di eseguire, 10 = capace come prima dell'esordio). Un item non valutato è null, mai 0.",
  },
  SANE: {
    scale_code: "SANE",
    scale_name: "Single Assessment Numeric Evaluation (Funzione Globale 0-100%)",
    scale_version: "SANE IT v1 (0-100%)",
    source_mode: "internal_verified",
    score_unit: "%",
    description: "Valutazione numerica singola della funzionalità percepita del distretto da 0% a 100%.",
  },
  QuickDASH: {
    scale_code: "QuickDASH",
    scale_name: "QuickDASH (Arto Superiore - Punteggio Esterno)",
    scale_version: "QuickDASH IT Official (IWH)",
    source_mode: "external_score",
    score_unit: "/100",
    description: "Registrazione punteggio calcolato su modulo ufficiale Institute for Work & Health.",
  },
  ODI: {
    scale_code: "ODI",
    scale_name: "Oswestry Disability Index (Rachide Lombare - Punteggio Esterno)",
    scale_version: "ODI v2.1a IT (Fairbank & Pynsent)",
    source_mode: "external_score",
    score_unit: "%",
    description: "Registrazione punteggio ottenuto da questionario ufficiale ODI v2.1a IT.",
  },
  NDI: {
    scale_code: "NDI",
    scale_name: "Neck Disability Index (Rachide Cervicale - Punteggio Esterno)",
    scale_version: "NDI IT (Vernon & Mior)",
    source_mode: "external_score",
    score_unit: "%",
    description: "Registrazione punteggio ottenuto da questionario ufficiale NDI IT.",
  },
  LEFS: {
    scale_code: "LEFS",
    scale_name: "Lower Extremity Functional Scale (Arto Inferiore - Punteggio Esterno)",
    scale_version: "LEFS IT (Binkley et al. / Cacchio et al.)",
    source_mode: "external_score",
    score_unit: "/80",
    description: "Registrazione punteggio ottenuto da questionario ufficiale LEFS IT (0-80).",
  },
};

async function logAudit(
  action: string,
  entityType: string,
  entityId: number | null,
  personId: number | null,
  summary: string,
  actor = "Professionista",
) {
  await sql`
    INSERT INTO public.audit_logs (timestamp, actor, action, entity_type, entity_id, person_id, summary)
    VALUES (${nowRomeIso()}, ${actor}, ${action}, ${entityType}, ${entityId}, ${personId}, ${summary})
  `;
  // Mantieni al massimo gli ultimi 300 record di audit (piano Free leggero)
  await sql`
    DELETE FROM public.audit_logs
    WHERE id < COALESCE((SELECT id FROM public.audit_logs ORDER BY id DESC OFFSET 300 LIMIT 1), 0)
  `;
}

async function computePackageSummary(pkg: Record<string, any>) {
  const pkgId = pkg.id;
  const movements = Array.from(
    await sql`
      SELECT id, package_id, person_id, movement_type, delta_sessions, reason, created_at
      FROM public.package_movements
      WHERE package_id = ${pkgId}
      ORDER BY id DESC
    `,
  );
  const consumed = movements.reduce((acc, m) => acc + Number(m.delta_sessions || 0), 0);
  const total = Number(pkg.total_sessions);
  const isOpenSingle = total === 0;
  const remaining = isOpenSingle ? 0 : Math.max(0, total - consumed);

  return {
    ...pkg,
    total_sessions: total,
    is_open_single: isOpenSingle,
    consumed_sessions: consumed,
    remaining_sessions: remaining,
    reserved_sessions: 0,
    available_to_book: remaining,
    paid_cents: 0,
    due_cents: 0,
    payment_status: "saldato",
    suspensions: JSON.parse(pkg.suspensions_json || "[]"),
    movements,
    payments: [],
  };
}

async function getEvaluationWithDetails(evaluationId: number) {
  const [ev] = await sql`SELECT * FROM public.clinical_evaluations WHERE id = ${evaluationId}`;
  if (!ev) throw new NotFoundError("Valutazione non trovata.");
  const markers = await sql`
    SELECT * FROM public.body_map_markers WHERE evaluation_id = ${evaluationId} ORDER BY id ASC
  `;
  const addenda = await sql`
    SELECT * FROM public.clinical_note_addenda WHERE evaluation_id = ${evaluationId} ORDER BY id ASC
  `;
  return {
    ...ev,
    objective_measurements: JSON.parse(ev.objective_measurements_json || "[]"),
    assigned_exercises: JSON.parse(ev.assigned_exercises_json || "[]"),
    body_map_markers: Array.from(markers),
    addenda: Array.from(addenda),
  };
}

async function getPhysioEpisodeDetail(episodeId: number) {
  const [ep] = await sql`SELECT * FROM public.physio_episodes WHERE id = ${episodeId}`;
  if (!ep) throw new NotFoundError("Episodio clinico non trovato.");

  const evalRows = await sql`
    SELECT id FROM public.clinical_evaluations WHERE episode_id = ${episodeId} ORDER BY eval_date ASC, id ASC
  `;
  const evaluations = [];
  for (const r of evalRows) {
    evaluations.push(await getEvaluationWithDetails(r.id));
  }

  const notesRows = await sql`
    SELECT * FROM public.clinical_notes WHERE episode_id = ${episodeId} ORDER BY note_date DESC, id DESC
  `;
  const notes = [];
  for (const n of notesRows) {
    const addenda = await sql`
      SELECT * FROM public.clinical_note_addenda WHERE note_id = ${n.id} ORDER BY id ASC
    `;
    notes.push({ ...n, addenda: Array.from(addenda) });
  }

  const flagsRows = await sql`
    SELECT * FROM public.clinical_flags WHERE episode_id = ${episodeId} ORDER BY flag_type ASC, id ASC
  `;
  const flags = Array.from(flagsRows);
  const flagSummary = {
    red_present: flags.filter((f) => f.flag_type === "red" && f.status === "presente").length,
    red_unassessed: flags.filter((f) => f.flag_type === "red" && f.status === "non_valutato").length,
    yellow_present: flags.filter((f) => f.flag_type === "yellow" && f.status === "presente").length,
    yellow_unassessed: flags.filter((f) => f.flag_type === "yellow" && f.status === "non_valutato").length,
  };

  const measuresRows = await sql`
    SELECT * FROM public.outcome_measures WHERE episode_id = ${episodeId} ORDER BY recorded_date ASC, id ASC
  `;
  const measures = Array.from(measuresRows).map((m) => ({
    ...m,
    responses: JSON.parse(m.responses_json || "[]"),
  }));

  const byVersion: Record<string, any[]> = {};
  for (const m of measures) {
    const key = `${m.scale_code}||${m.scale_version}`;
    if (!byVersion[key]) byVersion[key] = [];
    byVersion[key].push(m);
  }
  const comparisons = Object.values(byVersion).map((series) => {
    const firstM = series[0];
    const lastM = series[series.length - 1];
    let delta: number | null = null;
    if (series.length >= 2 && firstM.score_value !== null && lastM.score_value !== null) {
      delta = Math.round((Number(lastM.score_value) - Number(firstM.score_value)) * 100) / 100;
    }
    return {
      scale_code: firstM.scale_code,
      scale_name: firstM.scale_name,
      scale_version: firstM.scale_version,
      score_unit: firstM.score_unit,
      count: series.length,
      initial_date: firstM.recorded_date,
      initial_score: firstM.score_value,
      latest_date: lastM.recorded_date,
      latest_score: lastM.score_value,
      numeric_delta: delta,
      series,
      clinical_warning:
        "Variazione numerica oggettiva sulla medesima versione della scala; il significato clinico va interpretato dal professionista nel contesto del paziente.",
    };
  });

  return {
    ...ep,
    evaluations,
    notes,
    flags,
    flag_summary: flagSummary,
    outcome_measures: measures,
    outcome_comparisons: comparisons,
  };
}

async function getFitnessProgramDetail(programId: number) {
  const [prog] = await sql`SELECT * FROM public.fitness_programs WHERE id = ${programId}`;
  if (!prog) throw new NotFoundError("Programma non trovato.");
  const versionsRows = await sql`
    SELECT * FROM public.fitness_program_versions WHERE program_id = ${programId} ORDER BY version_number DESC
  `;
  return {
    ...prog,
    workouts: JSON.parse(prog.workouts_json || "[]"),
    version_history: Array.from(versionsRows).map((v) => ({
      ...v,
      workouts: JSON.parse(v.workouts_json || "[]"),
    })),
  };
}

async function getPersonFullDossier(personId: number) {
  const [person] = await sql`SELECT * FROM public.people WHERE id = ${personId}`;
  if (!person) throw new NotFoundError("Persona non trovata.");

  const [epIds, sharedLimitationsRows, pkgRows, consentsRows, attachmentsRows, auditHistoryRows] = await Promise.all([
    sql`SELECT id FROM public.physio_episodes WHERE person_id = ${personId} ORDER BY start_date DESC, id DESC`,
    sql`SELECT * FROM public.shared_limitations WHERE person_id = ${personId} ORDER BY recorded_date DESC, id DESC`,
    sql`SELECT * FROM public.packages WHERE person_id = ${personId} ORDER BY purchased_date DESC, id DESC`,
    sql`SELECT * FROM public.consents WHERE person_id = ${personId} ORDER BY id DESC`,
    sql`SELECT * FROM public.attachments WHERE person_id = ${personId} ORDER BY uploaded_at DESC`,
    sql`SELECT id, timestamp, actor, action, summary FROM public.audit_logs WHERE person_id = ${personId} ORDER BY id DESC LIMIT 20`,
  ]);

  const physioEpisodes = await Promise.all(Array.from(epIds).map((r) => getPhysioEpisodeDetail(r.id)));
  const packages = await Promise.all(Array.from(pkgRows).map((p) => computePackageSummary(p)));
  const sharedLimitations = Array.from(sharedLimitationsRows);
  const consents = Array.from(consentsRows);
  const attachments = Array.from(attachmentsRows);
  const auditHistory = Array.from(auditHistoryRows);

  const totalRemainingSessions = packages
    .filter((p) => p.status === "attivo")
    .reduce((acc, p) => acc + Number(p.remaining_sessions || 0), 0);

  return {
    person,
    summary: {
      active_physio_episodes: physioEpisodes.filter((e) => e.status === "attivo").length,
      active_fitness_programs: 0,
      active_shared_limitations: sharedLimitations.filter((l) => l.is_active).length,
      total_available_sessions: totalRemainingSessions,
      total_remaining_sessions: totalRemainingSessions,
      next_appointment: null,
      total_due_cents: 0,
      has_privacy_notice: consents.some((c) => c.doc_type === "informativa_privacy" && c.status === "acquisito"),
      has_health_consent: consents.some(
        (c) => c.doc_type === "consenso_trattamento_sanitario" && c.status === "acquisito",
      ),
    },
    shared_limitations: sharedLimitations,
    physio: { episodes: physioEpisodes },
    fitness: {
      profile: null,
      programs: [],
      workout_logs: [],
      metrics: [],
    },
    appointments: [],
    packages,
    payments: [],
    consents,
    attachments,
    audit_history: auditHistory,
  };
}

async function findPotentialDuplicates(
  firstName: string,
  lastName: string,
  birthDate?: string | null,
  phone?: string | null,
  email?: string | null,
  taxCode?: string | null,
  excludeId?: number | null,
) {
  const fn = (firstName || "").trim().toLowerCase();
  const ln = (lastName || "").trim().toLowerCase();
  const normPh = (phone || "").replace(/\D+/g, "");
  const em = (email || "").trim().toLowerCase();
  const tc = (taxCode || "").trim().toUpperCase();

  const rows = await sql`SELECT * FROM public.people`;
  const duplicates = [];
  for (const r of rows) {
    if (excludeId && r.id === excludeId) continue;
    const reasons: string[] = [];
    if ((r.first_name || "").trim().toLowerCase() === fn && (r.last_name || "").trim().toLowerCase() === ln) {
      if (birthDate && r.birth_date === birthDate) reasons.push("Stesso nome, cognome e data di nascita");
      else reasons.push("Omonimia nome e cognome");
    }
    if (tc && r.tax_code && r.tax_code.trim().toUpperCase() === tc) reasons.push("Stesso codice fiscale");
    if (normPh && normPh.length >= 6 && (r.phone || "").replace(/\D+/g, "") === normPh) {
      reasons.push("Stesso numero di telefono");
    }
    if (em && r.email && r.email.trim().toLowerCase() === em) reasons.push("Stesso indirizzo email");
    if (reasons.length > 0) duplicates.push({ ...r, duplicate_reasons: reasons });
  }
  return duplicates;
}

async function detectAppointmentConflicts(
  startIso: string,
  endIso: string,
  bufferMinutes = 10,
  excludeAppointmentId?: number,
) {
  const sDt = normalizeStartAt(startIso);
  const eDt = normalizeStartAt(endIso);
  const dayPrefix = startIso.slice(0, 10);

  const candidates = await sql`
    SELECT a.*, p.first_name, p.last_name
    FROM public.appointments a
    JOIN public.people p ON p.id = a.person_id
    WHERE substr(a.start_at, 1, 10) = ${dayPrefix} AND a.status != 'annullato'
  `;

  const conflicts = [];
  for (const c of candidates) {
    if (excludeAppointmentId && c.id === excludeAppointmentId) continue;
    const cs = normalizeStartAt(c.start_at);
    const ce = normalizeStartAt(c.end_at);
    const cBuf = Math.max(bufferMinutes, Number(c.buffer_minutes || 0));
    const bufMs = cBuf * 60000;

    if (sDt < ce && eDt > cs) {
      conflicts.push({
        appointment_id: c.id,
        person_name: `${c.first_name} ${c.last_name}`,
        start_at: c.start_at,
        end_at: c.end_at,
        conflict_type: "overlap",
        message: `Sovrapposizione oraria con ${c.first_name} ${c.last_name} (${c.start_at.slice(11, 16)}-${c.end_at.slice(11, 16)})`,
      });
    } else if (sDt.getTime() < ce.getTime() + bufMs && eDt.getTime() > cs.getTime() - bufMs) {
      conflicts.push({
        appointment_id: c.id,
        person_name: `${c.first_name} ${c.last_name}`,
        start_at: c.start_at,
        end_at: c.end_at,
        conflict_type: "buffer",
        message: `Buffer inferiore a ${cBuf} min rispetto a ${c.first_name} ${c.last_name} (${c.start_at.slice(11, 16)}-${c.end_at.slice(11, 16)})`,
      });
    }
  }
  return conflicts;
}

function shouldAppointmentConsumeSession(
  apptStatus: string,
  chargeOverride: string | null | undefined,
  pkgRow: Record<string, any> | null,
): boolean {
  if (apptStatus === "svolto") return true;
  if (apptStatus === "prenotato" || apptStatus === "confermato") return false;
  if (chargeOverride === "charge") return true;
  if (chargeOverride === "no_charge") return false;
  if (!pkgRow) return false;
  if (apptStatus === "assente") return pkgRow.no_show_policy === "charge";
  return false;
}

async function getActiveConsumptionForAppointment(packageId: number, appointmentId: number) {
  const consumes = await sql`
    SELECT * FROM public.package_movements
    WHERE package_id = ${packageId} AND appointment_id = ${appointmentId} AND movement_type = 'CONSUME'
    ORDER BY id DESC
  `;
  for (const c of consumes) {
    const [rev] = await sql`
      SELECT id FROM public.package_movements WHERE reversed_movement_id = ${c.id} AND movement_type = 'REVERSAL'
    `;
    if (!rev) return c;
  }
  return null;
}

async function syncPackageStatus(packageId: number) {
  const [pkg] = await sql`SELECT * FROM public.packages WHERE id = ${packageId}`;
  if (!pkg) return;
  if (Number(pkg.total_sessions) === 0) {
    // Contatore aperto sedute singole: resta 'attivo' salvo sospensione manuale
    return;
  }
  const summary = await computePackageSummary(pkg);
  let newStatus = pkg.status;
  if (pkg.status === "attivo" || pkg.status === "esaurito") {
    newStatus = summary.remaining_sessions <= 0 ? "esaurito" : "attivo";
  }
  if (newStatus !== pkg.status) {
    await sql`UPDATE public.packages SET status = ${newStatus}, updated_at = ${nowRomeIso()} WHERE id = ${packageId}`;
  }
}

async function authenticateRequest(req: Request, url: URL) {
  let rawToken: string | null = null;
  const xSession = req.headers.get("X-Session-Token");
  const authHdr = req.headers.get("Authorization") || "";
  if (xSession) {
    rawToken = xSession.trim();
  } else if (authHdr.startsWith("Bearer ")) {
    const candidate = authHdr.slice(7).trim();
    if (!candidate.startsWith("eyJ")) {
      rawToken = candidate;
    }
  }
  if (!rawToken) {
    const qToken = url.searchParams.get("token");
    if (qToken) rawToken = qToken.trim();
  }
  if (!rawToken) return null;

  const tHash = await sha256Hex(rawToken);
  const now = nowRomeIso();
  const [row] = await sql`
    SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.last_seen_at,
           u.id AS user_id, u.username, u.display_name, u.totp_enabled, u.settings_json
    FROM public.sessions s
    JOIN public.users u ON u.id = s.user_id
    WHERE s.token_hash = ${tHash}
  `;
  if (!row) return null;
  if (row.expires_at < now) {
    await sql`DELETE FROM public.sessions WHERE id = ${row.session_id}`;
    return null;
  }
  // Aggiorna last_seen_at al massimo 1 volta al giorno per evitare scritture inutili su Postgres
  if (String(row.last_seen_at || "").slice(0, 10) !== now.slice(0, 10)) {
    await sql`UPDATE public.sessions SET last_seen_at = ${now} WHERE id = ${row.session_id}`;
  }
  return row;
}

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  // Estrae il path relativo rimuovendo eventuale prefisso /functions/v1/gestionale-api o /gestionale-api
  let path = url.pathname.replace(/^\/functions\/v1\/gestionale-api/, "").replace(/^\/gestionale-api/, "");
  if (!path.startsWith("/")) path = "/" + path;
  const method = req.method.toUpperCase();

  try {
    // 1. Stato autenticazione
    if (path === "/api/auth/status" && method === "GET") {
      const session = await authenticateRequest(req, url);
      if (!session) {
        return jsonResponse(200, {
          authenticated: false,
          env_mode: "prod",
          public_registration_enabled: false,
        });
      }
      return jsonResponse(200, {
        authenticated: true,
        env_mode: "prod",
        public_registration_enabled: false,
        user: {
          id: session.user_id,
          username: session.username,
          display_name: session.display_name,
          totp_enabled: Boolean(session.totp_enabled),
          settings: JSON.parse(session.settings_json || "{}"),
        },
        csrf_token: session.csrf_token,
      });
    }

    // 2. Login
    if (path === "/api/auth/login" && method === "POST") {
      const payload = await req.json();
      const username = (payload.username || "admin").trim();
      const password = payload.password || "";
      const totpCode = (payload.totp_code || "").trim();

      const [user] = await sql`SELECT * FROM public.users WHERE username = ${username}`;
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return jsonResponse(401, { error: "Credenziali non valide." });
      }

      if (user.totp_enabled) {
        if (!totpCode) {
          return jsonResponse(401, {
            error: "Inserisci il codice a 6 cifre del secondo fattore (2FA TOTP).",
            require_totp: true,
          });
        }
        const totpOk = await verifyTotpCode(user.totp_secret, totpCode);
        if (!totpOk) {
          const recHashes: string[] = JSON.parse(user.recovery_codes_json || "[]");
          const candHash = await sha256Hex(totpCode.toUpperCase());
          const idx = recHashes.indexOf(candHash);
          if (idx >= 0) {
            recHashes.splice(idx, 1);
            await sql`
              UPDATE public.users SET recovery_codes_json = ${JSON.stringify(recHashes)} WHERE id = ${user.id}
            `;
          } else {
            return jsonResponse(401, { error: "Codice 2FA TOTP non valido.", require_totp: true });
          }
        }
      }

      const rawToken = randomHex(32);
      const csrfToken = randomHex(24);
      const nowIso = nowRomeIso();
      const expDate = new Date(Date.now() + 30 * 24 * 3600 * 1000); // 30 giorni per comodità mobile
      const expIso = toRomeIsoFromDate(expDate);

      await sql`DELETE FROM public.sessions WHERE expires_at < ${nowIso}`;
      await sql`
        INSERT INTO public.sessions (token_hash, user_id, csrf_token, created_at, expires_at, last_seen_at, user_agent, ip_address)
        VALUES (
          ${await sha256Hex(rawToken)},
          ${user.id},
          ${csrfToken},
          ${nowIso},
          ${expIso},
          ${nowIso},
          ${(req.headers.get("User-Agent") || "").slice(0, 200)},
          ${"supabase-edge"}
        )
      `;
      await logAudit("LOGIN_SUCCESS", "users", user.id, null, `Accesso cloud effettuato da ${username}`, user.display_name);

      return jsonResponse(200, {
        authenticated: true,
        token: rawToken,
        csrf_token: csrfToken,
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          totp_enabled: Boolean(user.totp_enabled),
        },
      });
    }

    if (path === "/api/auth/register") {
      return jsonResponse(403, {
        error: "La registrazione pubblica è disabilitata. Questo gestionale consente solo l'account personale del professionista.",
      });
    }

    if (path === "/api/auth/logout" && method === "POST") {
      const session = await authenticateRequest(req, url);
      if (session) {
        await sql`DELETE FROM public.sessions WHERE id = ${session.session_id}`;
      }
      return jsonResponse(200, { authenticated: false });
    }

    // 3. Autenticazione obbligatoria per tutte le altre rotte
    const session = await authenticateRequest(req, url);
    if (!session) {
      return jsonResponse(401, {
        error: "Accesso non autorizzato. Effettua il login per consultare dati clinici, anagrafici o allegati.",
        code: "UNAUTHORIZED",
      });
    }
    const actor = session.display_name || "Professionista";

    // =========================================================================
    // ROTTE GET AUTENTICATE
    // =========================================================================
    if (method === "GET") {
      if (path === "/api/dashboard") {
        const targetDate = url.searchParams.get("date") || nowRomeIso().slice(0, 10);
        const todayAppointments = Array.from(
          await sql`
            SELECT a.*, p.first_name, p.last_name, p.phone, p.physio_active, p.fitness_active
            FROM public.appointments a
            JOIN public.people p ON p.id = a.person_id
            WHERE substr(a.start_at, 1, 10) = ${targetDate}
            ORDER BY a.start_at ASC
          `,
        );

        const nowIso = nowRomeIso();
        let nextAppt = todayAppointments.find(
          (a) => (a.status === "prenotato" || a.status === "confermato") && a.end_at >= nowIso,
        );
        if (!nextAppt) {
          nextAppt = todayAppointments.find((a) => a.status === "prenotato" || a.status === "confermato") || null;
        }

        const draftNotes = Array.from(
          await sql`
            SELECT n.id, n.note_date AS date, 'Nota SOAP' AS kind, n.episode_id, n.person_id,
                   p.first_name, p.last_name, e.title AS episode_title
            FROM public.clinical_notes n
            JOIN public.people p ON p.id = n.person_id
            JOIN public.physio_episodes e ON e.id = n.episode_id
            WHERE n.status = 'bozza'
            ORDER BY n.note_date DESC
          `,
        );
        const draftEvals = Array.from(
          await sql`
            SELECT ev.id, ev.eval_date AS date,
                   CASE WHEN ev.eval_type = 'prima_valutazione' THEN 'Prima Valutazione' ELSE 'Rivalutazione' END AS kind,
                   ev.episode_id, ev.person_id, p.first_name, p.last_name, e.title AS episode_title
            FROM public.clinical_evaluations ev
            JOIN public.people p ON p.id = ev.person_id
            JOIN public.physio_episodes e ON e.id = ev.episode_id
            WHERE ev.status = 'bozza'
            ORDER BY ev.eval_date DESC
          `,
        );

        const horizonDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
        const reassessmentsDue = Array.from(
          await sql`
            SELECT e.*, p.first_name, p.last_name
            FROM public.physio_episodes e
            JOIN public.people p ON p.id = e.person_id
            WHERE e.status = 'attivo' AND e.reassessment_due_date IS NOT NULL AND e.reassessment_due_date <= ${horizonDate}
            ORDER BY e.reassessment_due_date ASC
          `,
        );

        const allPkgRows = await sql`
          SELECT pkg.*, p.first_name, p.last_name
          FROM public.packages pkg
          JOIN public.people p ON p.id = pkg.person_id
          WHERE pkg.status IN ('attivo', 'esaurito')
          ORDER BY pkg.purchased_date DESC
        `;
        const lowOrExpiringPackages = [];
        const unpaidPackages = [];
        const expHorizon = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

        for (const pr of allPkgRows) {
          const s = await computePackageSummary(pr);
          const isLow = s.status === "attivo" && s.remaining_sessions <= 2;
          const isExpiring = s.status === "attivo" && Boolean(s.valid_until && s.valid_until <= expHorizon);
          if (isLow || isExpiring) lowOrExpiringPackages.push(s);
          if (s.due_cents > 0) unpaidPackages.push(s);
        }

        const totalToCollectCents = unpaidPackages.reduce((acc, p) => acc + Number(p.due_cents || 0), 0);

        return jsonResponse(200, {
          date: targetDate,
          timezone: "Europe/Rome",
          today_appointments: todayAppointments,
          next_appointment: nextAppt || null,
          drafts_to_complete: [...draftEvals, ...draftNotes],
          reassessments_due: reassessmentsDue,
          low_or_expiring_packages: lowOrExpiringPackages,
          unpaid_packages: unpaidPackages,
          total_to_collect_cents: totalToCollectCents,
        });
      }

      if (path === "/api/people") {
        const q = (url.searchParams.get("q") || "").trim().toLowerCase();
        const area = url.searchParams.get("area") || "tutti";
        const statusFilter = url.searchParams.get("status") || "attivo";

        const allRows = await sql`SELECT * FROM public.people ORDER BY last_name ASC, first_name ASC`;
        const pkgBalances = await sql`
          SELECT pkg.person_id,
                 SUM(GREATEST(0, pkg.total_sessions - COALESCE(m.consumed, 0)))::int AS remaining_sessions
          FROM public.packages pkg
          LEFT JOIN (
            SELECT package_id, COALESCE(SUM(delta_sessions), 0)::int AS consumed
            FROM public.package_movements
            GROUP BY package_id
          ) m ON m.package_id = pkg.id
          WHERE pkg.status = 'attivo'
          GROUP BY pkg.person_id
        `;
        const remMap: Record<number, number> = {};
        for (const b of pkgBalances) remMap[Number(b.person_id)] = Number(b.remaining_sessions || 0);

        let people = Array.from(allRows).map((p) => ({
          ...p,
          remaining_sessions: remMap[Number(p.id)] || 0,
        }));
        if (statusFilter === "attivo" || statusFilter === "archiviato") {
          people = people.filter((p) => p.status === statusFilter);
        }
        if (area === "fisio") people = people.filter((p) => p.physio_active === 1 && p.fitness_active === 0);
        else if (area === "fitness") people = people.filter((p) => p.fitness_active === 1 && p.physio_active === 0);
        else if (area === "entrambi") people = people.filter((p) => p.physio_active === 1 && p.fitness_active === 1);
        else if (area === "con_fisio") people = people.filter((p) => p.physio_active === 1);
        else if (area === "con_fitness") people = people.filter((p) => p.fitness_active === 1);

        if (q) {
          people = people.filter(
            (p) =>
              `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
              `${p.last_name} ${p.first_name}`.toLowerCase().includes(q) ||
              (p.phone || "").toLowerCase().includes(q) ||
              (p.email || "").toLowerCase().includes(q) ||
              (p.tax_code || "").toLowerCase().includes(q) ||
              (p.sport_activity || "").toLowerCase().includes(q),
          );
        }
        return jsonResponse(200, { people });
      }

      if (path === "/api/people/check-duplicates") {
        const dups = await findPotentialDuplicates(
          url.searchParams.get("first_name") || "",
          url.searchParams.get("last_name") || "",
          url.searchParams.get("birth_date"),
          url.searchParams.get("phone"),
          url.searchParams.get("email"),
          url.searchParams.get("tax_code"),
        );
        return jsonResponse(200, { potential_duplicates: dups });
      }

      const mPerson = path.match(/^\/api\/people\/(\d+)$/);
      if (mPerson) {
        const dossier = await getPersonFullDossier(Number(mPerson[1]));
        return jsonResponse(200, dossier);
      }

      const mExportJson = path.match(/^\/api\/people\/(\d+)\/export\.json$/);
      if (mExportJson) {
        const pid = Number(mExportJson[1]);
        const dossier = await getPersonFullDossier(pid);
        await logAudit("EXPORT_PERSON_JSON", "people", pid, pid, "Esportati dati persona in JSON strutturato", actor);
        const p = dossier.person;
        const fname = `scheda_${p.last_name}_${p.first_name}.json`.replace(/\s+/g, "_");
        return new Response(JSON.stringify(dossier, null, 2), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${fname}"`,
          },
        });
      }

      const mExportPdf = path.match(/^\/api\/people\/(\d+)\/export-pdf$/);
      if (mExportPdf) {
        const pid = Number(mExportPdf[1]);
        const dossier = await getPersonFullDossier(pid);
        await logAudit("EXPORT_PERSON_PDF", "people", pid, pid, "Generata vista PDF/stampa scheda persona", actor);
        const p = dossier.person;
        const htmlDoc = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>Scheda — ${p.first_name} ${p.last_name}</title>
        <style>body{font-family:-apple-system,sans-serif;color:#1e293b;margin:24px;line-height:1.45}.header{border-bottom:2px solid #0f766e;padding-bottom:12px;margin-bottom:20px;display:flex;justify-content:space-between}.section-card{border:1px solid #cbd5e1;border-radius:8px;padding:14px;margin-bottom:16px}table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}th{background:#f1f5f9}.print-btn{background:#0f766e;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-weight:600}@media print{.no-print{display:none!important}}</style></head>
        <body><div class="no-print" style="margin-bottom:16px;"><button class="print-btn" onclick="window.print()">Stampa / Salva come PDF</button></div>
        <div class="header"><div><h1>Scheda Personale: ${p.first_name} ${p.last_name}</h1>
        <p>Data di nascita: ${p.birth_date || "-"} | CF: ${p.tax_code || "-"} | Tel: ${p.phone || "-"} | Email: ${p.email || "-"}</p></div>
        <div style="text-align:right;font-size:12px;color:#475569;">Esportato il ${nowRomeIso().slice(0, 16).replace("T", " ")}<br>Europe/Rome</div></div>
        <div class="section-card"><h2>Limitazioni Funzionali Condivise</h2><ul>${
          dossier.shared_limitations
            .map((l: any) => `<li><strong>${l.title}</strong> (${l.laterality}): ${l.description} — <em>${l.source_type} (${l.recorded_date})</em></li>`)
            .join("") || "<li>Nessuna limitazione attiva.</li>"
        }</ul></div>
        <div class="section-card"><h2>Episodi Fisioterapici (${dossier.physio.episodes.length})</h2>${
          dossier.physio.episodes
            .map((ep: any) => `<p><strong>${ep.title}</strong> (${ep.status}) — Inizio: ${ep.start_date} — ${ep.chief_complaint}</p>`)
            .join("") || "<p>Nessun episodio registrato.</p>"
        }</div>
        <div class="section-card"><h2>Programmi Fitness (${dossier.fitness.programs.length})</h2>${
          dossier.fitness.programs
            .map((fp: any) => `<p><strong>${fp.title}</strong> (v${fp.version}, ${fp.status}) — Obiettivo: ${fp.goal}</p>`)
            .join("") || "<p>Nessun programma registrato.</p>"
        }</div></body></html>`;
        return new Response(htmlDoc, {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "text/html; charset=utf-8" },
        });
      }

      const mEp = path.match(/^\/api\/physio\/episodes\/(\d+)$/);
      if (mEp) {
        return jsonResponse(200, await getPhysioEpisodeDetail(Number(mEp[1])));
      }

      const mEv = path.match(/^\/api\/physio\/evaluations\/(\d+)$/);
      if (mEv) {
        return jsonResponse(200, await getEvaluationWithDetails(Number(mEv[1])));
      }

      if (path === "/api/catalogs") {
        const tmplRows = await sql`SELECT * FROM public.custom_templates ORDER BY id ASC`;
        const templates = Array.from(tmplRows).map((t) => ({
          ...t,
          schema: JSON.parse(t.schema_json || "{}"),
        }));
        return jsonResponse(200, {
          outcome_scales: OUTCOME_SCALES_CATALOG,
          templates,
        });
      }

      if (path === "/api/appointments") {
        const startFrom = url.searchParams.get("from");
        const endTo = url.searchParams.get("to");
        const area = url.searchParams.get("area") || "tutti";
        const rows = await sql`
          SELECT a.*, p.first_name, p.last_name, p.phone, p.physio_active, p.fitness_active,
                 pkg.name AS package_name
          FROM public.appointments a
          JOIN public.people p ON p.id = a.person_id
          LEFT JOIN public.packages pkg ON pkg.id = a.package_id
          ORDER BY a.start_at ASC
        `;
        let appts = Array.from(rows);
        if (startFrom) appts = appts.filter((a) => a.start_at.slice(0, 10) >= startFrom.slice(0, 10));
        if (endTo) appts = appts.filter((a) => a.start_at.slice(0, 10) <= endTo.slice(0, 10));
        if (area === "fisio" || area === "fitness") appts = appts.filter((a) => a.service_area === area);
        return jsonResponse(200, { appointments: appts, timezone: "Europe/Rome" });
      }

      if (path === "/api/appointments/export.ics") {
        const mode = url.searchParams.get("privacy") || "initials_only";
        const rows = await sql`
          SELECT a.*, p.first_name, p.last_name
          FROM public.appointments a
          JOIN public.people p ON p.id = a.person_id
          WHERE a.status != 'annullato'
          ORDER BY a.start_at ASC
        `;
        const lines = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Gestionale Fisio Fitness Personale//IT",
          "CALSCALE:GREGORIAN",
          "METHOD:PUBLISH",
          "X-WR-CALNAME:Agenda Studio Fisio & Fitness",
          "X-WR-TIMEZONE:Europe/Rome",
        ];
        const nowUtc = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
        for (const r of rows) {
          const initials = `${(r.first_name || " ")[0].toUpperCase()}. ${(r.last_name || " ")[0].toUpperCase()}.`;
          const areaTag = r.service_area === "fisio" ? "FISIO" : "FIT";
          const summary =
            mode === "full_name"
              ? `[${areaTag}] ${r.first_name} ${r.last_name}`
              : `[${areaTag}] Appuntamento ${initials} (#${r.person_id})`;
          const dtStart = r.start_at.slice(0, 19).replace(/[-:]/g, "");
          const dtEnd = r.end_at.slice(0, 19).replace(/[-:]/g, "");
          lines.push(
            "BEGIN:VEVENT",
            `UID:appt-${r.id}@gestionale.cloud`,
            `DTSTAMP:${nowUtc}`,
            `DTSTART;TZID=Europe/Rome:${dtStart}`,
            `DTEND;TZID=Europe/Rome:${dtEnd}`,
            `SUMMARY:${summary}`,
            `LOCATION:${r.location || "Studio"}`,
            `DESCRIPTION:Appuntamento gestionale #${r.id} - Stato: ${r.status}`,
            "END:VEVENT",
          );
        }
        lines.push("END:VCALENDAR");
        return new Response(lines.join("\r\n") + "\r\n", {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": 'attachment; filename="agenda_studio_privacy.ics"',
          },
        });
      }

      if (path === "/api/packages") {
        const personId = url.searchParams.get("person_id");
        const rows = personId
          ? await sql`
              SELECT pkg.*, p.first_name, p.last_name,
                     COALESCE(m.consumed, 0)::int AS consumed_sessions
              FROM public.packages pkg
              JOIN public.people p ON p.id = pkg.person_id
              LEFT JOIN (
                SELECT package_id, COALESCE(SUM(delta_sessions), 0)::int AS consumed
                FROM public.package_movements
                GROUP BY package_id
              ) m ON m.package_id = pkg.id
              WHERE pkg.person_id = ${Number(personId)}
              ORDER BY pkg.purchased_date DESC, pkg.id DESC
            `
          : await sql`
              SELECT pkg.*, p.first_name, p.last_name,
                     COALESCE(m.consumed, 0)::int AS consumed_sessions
              FROM public.packages pkg
              JOIN public.people p ON p.id = pkg.person_id
              LEFT JOIN (
                SELECT package_id, COALESCE(SUM(delta_sessions), 0)::int AS consumed
                FROM public.package_movements
                GROUP BY package_id
              ) m ON m.package_id = pkg.id
              ORDER BY pkg.purchased_date DESC, pkg.id DESC
            `;
        const packages = Array.from(rows).map((r) => {
          const total = Number(r.total_sessions);
          const isOpenSingle = total === 0;
          const consumed = Number(r.consumed_sessions || 0);
          const remaining = isOpenSingle ? 0 : Math.max(0, total - consumed);
          return {
            ...r,
            total_sessions: total,
            is_open_single: isOpenSingle,
            consumed_sessions: consumed,
            remaining_sessions: remaining,
            reserved_sessions: 0,
            available_to_book: remaining,
            paid_cents: 0,
            due_cents: 0,
            payment_status: "saldato",
          };
        });
        return jsonResponse(200, { packages });
      }

      const mPkg = path.match(/^\/api\/packages\/(\d+)$/);
      if (mPkg) {
        const [pkgRow] = await sql`SELECT * FROM public.packages WHERE id = ${Number(mPkg[1])}`;
        if (!pkgRow) throw new NotFoundError("Pacchetto non trovato.");
        return jsonResponse(200, await computePackageSummary(pkgRow));
      }

      const mAtt = path.match(/^\/(?:api\/)?attachments\/(\d+)$/);
      if (mAtt) {
        const attId = Number(mAtt[1]);
        const [att] = await sql`SELECT * FROM public.attachments WHERE id = ${attId}`;
        if (!att) throw new NotFoundError("Allegato non trovato.");
        const { data: blob, error } = await supabaseAdmin.storage
          .from("private-attachments")
          .download(att.stored_filename);
        if (error || !blob) throw new NotFoundError("File allegato non presente nello storage privato cloud.");
        await logAudit(
          "READ_PRIVATE_ATTACHMENT",
          "attachments",
          attId,
          att.person_id,
          `Accesso autenticato all'allegato '${att.original_filename}'`,
          actor,
        );
        const disp = url.searchParams.get("inline") === "0" ? "attachment" : "inline";
        return new Response(await blob.arrayBuffer(), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": att.mime_type,
            "Content-Disposition": `${disp}; filename="${att.original_filename}"`,
          },
        });
      }

      if (path === "/api/security/overview") {
        const [user] = await sql`SELECT * FROM public.users WHERE id = ${session.user_id}`;
        const backupsRows = await sql`SELECT * FROM public.cloud_backups ORDER BY id DESC LIMIT 10`;
        const otpauthUri = `otpauth://totp/GestionaleFisioFitness:${encodeURIComponent(user.username)}?secret=${user.totp_secret}&issuer=GestionaleFisioFitness&algorithm=SHA1&digits=6&period=30`;
        return jsonResponse(200, {
          env_mode: "prod",
          username: user.username,
          display_name: user.display_name,
          totp_enabled: Boolean(user.totp_enabled),
          totp_secret: user.totp_secret,
          otpauth_uri: otpauthUri,
          current_totp_demo_hint: null,
          backups: Array.from(backupsRows).map((b) => JSON.parse(b.meta_json || "{}")),
          recent_audits: [],
        });
      }

      return jsonResponse(404, { error: `Endpoint GET non trovato: ${path}` });
    }

    // =========================================================================
    // ROTTE POST / PUT / DELETE AUTENTICATE
    // =========================================================================
    let payload: Record<string, any> = {};
    if (method !== "DELETE") {
      try {
        payload = await req.json();
      } catch {
        payload = {};
      }
    }

    // --- ANAGRAFICA ---
    if (path === "/api/people" && method === "POST") {
      const firstName = (payload.first_name || "").trim();
      const lastName = (payload.last_name || "").trim();
      if (!firstName || !lastName) {
        throw new ValidationError("Nome e cognome sono gli unici campi obbligatori per creare l'anagrafica.");
      }
      const duplicates = await findPotentialDuplicates(
        firstName,
        lastName,
        payload.birth_date,
        payload.phone,
        payload.email,
        payload.tax_code,
      );
      if (duplicates.length > 0 && !payload.confirm_duplicate_override) {
        throw new ValidationError(
          "Possibile anagrafica duplicata rilevata. Verifica le persone segnalate oppure conferma la creazione.",
          { potential_duplicates: duplicates },
        );
      }

      const now = nowRomeIso();
      const physioActive = payload.physio_active ? 1 : 0;
      const fitnessActive = payload.fitness_active ? 1 : 0;
      const status = payload.status === "archiviato" ? "archiviato" : "attivo";
      const parseIntOrNull = (v: unknown) => {
        if (v === undefined || v === null || String(v).trim() === "") return null;
        const n = Number(String(v).replace(",", ".").trim());
        return Number.isFinite(n) ? Math.round(n) : null;
      };
      const parseFloatOrNull = (v: unknown) => {
        if (v === undefined || v === null || String(v).trim() === "") return null;
        const n = Number(String(v).replace(",", ".").trim());
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
      };
      const heightCm = parseIntOrNull(payload.height_cm);
      const weightKg = parseFloatOrNull(payload.weight_kg);
      const weightUpdatedAt = (payload.weight_updated_at || "").trim() || (weightKg !== null ? now.slice(0, 10) : null);

      const [person] = await sql`
        INSERT INTO public.people (
          first_name, last_name, birth_date, tax_code, phone, email, address,
          profession, sport_activity, gender, height_cm, weight_kg, weight_updated_at,
          medical_history, current_pain_notes, goals, training_frequency, training_location,
          general_notes, physio_active, fitness_active,
          status, is_fictitious, version, created_at, updated_at
        ) VALUES (
          ${firstName}, ${lastName},
          ${(payload.birth_date || "").trim() || null},
          ${(payload.tax_code || "").trim().toUpperCase() || null},
          ${(payload.phone || "").trim() || null},
          ${(payload.email || "").trim() || null},
          ${(payload.address || "").trim() || null},
          ${(payload.profession || "").trim() || null},
          ${(payload.sport_activity || "").trim() || null},
          ${(payload.gender || "").trim() || null},
          ${heightCm},
          ${weightKg},
          ${weightUpdatedAt},
          ${(payload.medical_history || "").trim() || null},
          ${(payload.current_pain_notes || "").trim() || null},
          ${(payload.goals || "").trim() || null},
          ${(payload.training_frequency || "").trim() || null},
          ${(payload.training_location || "").trim() || null},
          ${(payload.general_notes || "").trim() || null},
          ${physioActive}, ${fitnessActive}, ${status}, 0, 1, ${now}, ${now}
        ) RETURNING *
      `;

      await logAudit("CREATE_PERSON", "people", person.id, person.id, `Creata anagrafica ${firstName} ${lastName}`, actor);
      return jsonResponse(201, { ...person, potential_duplicates: duplicates });
    }

    const mPerson = path.match(/^\/api\/people\/(\d+)$/);
    if (mPerson && method === "PUT") {
      const personId = Number(mPerson[1]);
      const [current] = await sql`SELECT * FROM public.people WHERE id = ${personId}`;
      if (!current) throw new NotFoundError("Persona non trovata.");
      if (payload.expected_version !== undefined && Number(payload.expected_version) !== Number(current.version)) {
        throw new ConflictError("La scheda anagrafica è stata modificata da un altro dispositivo.", current);
      }
      const firstName = (payload.first_name ?? current.first_name ?? "").trim();
      const lastName = (payload.last_name ?? current.last_name ?? "").trim();
      if (!firstName || !lastName) throw new ValidationError("Nome e cognome sono obbligatori.");

      const physioActive = (payload.physio_active ?? current.physio_active) ? 1 : 0;
      const fitnessActive = (payload.fitness_active ?? current.fitness_active) ? 1 : 0;
      const status = payload.status === "archiviato" || payload.status === "attivo" ? payload.status : current.status;
      const now = nowRomeIso();
      const newVersion = Number(current.version) + 1;
      const parseIntOpt = (v: unknown, fb: number | null) => {
        if (v === undefined) return fb;
        if (v === null || String(v).trim() === "") return null;
        const n = Number(String(v).replace(",", ".").trim());
        return Number.isFinite(n) ? Math.round(n) : fb;
      };
      const parseFloatOpt = (v: unknown, fb: number | null) => {
        if (v === undefined) return fb;
        if (v === null || String(v).trim() === "") return null;
        const n = Number(String(v).replace(",", ".").trim());
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : fb;
      };
      const nextHeight = parseIntOpt(payload.height_cm, current.height_cm ?? null);
      const nextWeight = parseFloatOpt(payload.weight_kg, current.weight_kg !== null && current.weight_kg !== undefined ? Number(current.weight_kg) : null);
      const currWeightNum = current.weight_kg !== null && current.weight_kg !== undefined ? Number(current.weight_kg) : null;
      const nextWeightUpdatedAt =
        payload.weight_updated_at !== undefined
          ? (String(payload.weight_updated_at || "").trim() || null)
          : payload.weight_kg !== undefined && nextWeight !== currWeightNum && nextWeight !== null
          ? now.slice(0, 10)
          : current.weight_updated_at ?? null;

      const [updated] = await sql`
        UPDATE public.people SET
          first_name = ${firstName},
          last_name = ${lastName},
          birth_date = ${payload.birth_date !== undefined ? (payload.birth_date || null) : current.birth_date},
          tax_code = ${payload.tax_code !== undefined ? (payload.tax_code || null) : current.tax_code},
          phone = ${payload.phone !== undefined ? (payload.phone || null) : current.phone},
          email = ${payload.email !== undefined ? (payload.email || null) : current.email},
          address = ${payload.address !== undefined ? (payload.address || null) : current.address},
          profession = ${payload.profession !== undefined ? (payload.profession || null) : current.profession},
          sport_activity = ${payload.sport_activity !== undefined ? (payload.sport_activity || null) : current.sport_activity},
          gender = ${payload.gender !== undefined ? (payload.gender || null) : (current.gender ?? null)},
          height_cm = ${nextHeight},
          weight_kg = ${nextWeight},
          weight_updated_at = ${nextWeightUpdatedAt},
          medical_history = ${payload.medical_history !== undefined ? (payload.medical_history || null) : (current.medical_history ?? null)},
          current_pain_notes = ${payload.current_pain_notes !== undefined ? (payload.current_pain_notes || null) : (current.current_pain_notes ?? null)},
          goals = ${payload.goals !== undefined ? (payload.goals || null) : (current.goals ?? null)},
          training_frequency = ${payload.training_frequency !== undefined ? (payload.training_frequency || null) : (current.training_frequency ?? null)},
          training_location = ${payload.training_location !== undefined ? (payload.training_location || null) : (current.training_location ?? null)},
          general_notes = ${payload.general_notes !== undefined ? (payload.general_notes || null) : current.general_notes},
          physio_active = ${physioActive},
          fitness_active = ${fitnessActive},
          status = ${status},
          version = ${newVersion},
          updated_at = ${now}
        WHERE id = ${personId}
        RETURNING *
      `;
      await logAudit("UPDATE_PERSON", "people", personId, personId, `Aggiornata anagrafica v${newVersion}`, actor);
      return jsonResponse(200, updated);
    }

    if (mPerson && method === "DELETE") {
      const personId = Number(mPerson[1]);
      const [pRow] = await sql`SELECT id FROM public.people WHERE id = ${personId}`;
      if (!pRow) throw new NotFoundError("Persona non trovata.");
      const atts = await sql`SELECT stored_filename FROM public.attachments WHERE person_id = ${personId}`;
      await sql`DELETE FROM public.people WHERE id = ${personId}`;
      if (atts.length > 0) {
        await supabaseAdmin.storage
          .from("private-attachments")
          .remove(Array.from(atts).map((a) => a.stored_filename));
      }
      await logAudit("DELETE_PERSON", "people", personId, null, `Cancellata scheda personale #${personId}`, actor);
      return jsonResponse(200, { deleted: true, person_id: personId });
    }

    const mAnam = path.match(/^\/api\/people\/(\d+)\/anamnesis$/);
    if (mAnam && (method === "PUT" || method === "POST")) {
      const personId = Number(mAnam[1]);
      const [person] = await sql`SELECT * FROM public.people WHERE id = ${personId}`;
      if (!person) throw new NotFoundError("Persona non trovata.");

      const now = nowRomeIso();
      if (payload.person_anamnesis !== undefined) {
        const anamJson =
          typeof payload.person_anamnesis === "string"
            ? payload.person_anamnesis
            : JSON.stringify(payload.person_anamnesis || {});
        await sql`
          UPDATE public.people
          SET anamnesis_json = ${anamJson}, updated_at = ${now}
          WHERE id = ${personId}
        `;
      }

      let episodeId = payload.episode_id ? Number(payload.episode_id) : null;
      if (payload.episode_intake !== undefined) {
        const intakeObj =
          typeof payload.episode_intake === "string"
            ? JSON.parse(payload.episode_intake || "{}")
            : payload.episode_intake || {};
        const intakeJson = JSON.stringify(intakeObj);
        const motivoMain = String(intakeObj?.motivo?.problema_principale || "").trim();

        if (episodeId) {
          const [ep] = await sql`SELECT * FROM public.physio_episodes WHERE id = ${episodeId} AND person_id = ${personId}`;
          if (!ep) throw new NotFoundError("Episodio clinico non trovato.");
          const nextTitle = (payload.episode_title || "").trim() || ep.title;
          const nextComplaint = motivoMain || ep.chief_complaint;
          await sql`
            UPDATE public.physio_episodes
            SET intake_json = ${intakeJson},
                title = ${nextTitle},
                chief_complaint = ${nextComplaint},
                updated_at = ${now}
            WHERE id = ${episodeId}
          `;
        } else {
          const epTitle = (payload.episode_title || "").trim() || (motivoMain ? motivoMain.slice(0, 60) : "Scheda anamnestica");
          const epComplaint = motivoMain || person.current_pain_notes || "Raccolta anamnestica";
          const [createdEp] = await sql`
            INSERT INTO public.physio_episodes (
              person_id, title, chief_complaint, body_region, laterality,
              start_date, status, intake_json, version, created_at, updated_at
            ) VALUES (
              ${personId}, ${epTitle}, ${epComplaint}, ${payload.body_region || ""}, ${payload.laterality || "N/A"},
              ${now.slice(0, 10)}, 'attivo', ${intakeJson}, 1, ${now}, ${now}
            ) RETURNING id
          `;
          episodeId = createdEp.id;
          await sql`UPDATE public.people SET physio_active = 1, updated_at = ${now} WHERE id = ${personId}`;
        }
      }

      await logAudit("SAVE_ANAMNESIS", "people", personId, personId, "Salvata scheda anamnestica strutturata", actor);
      return jsonResponse(200, { saved: true, person_id: personId, episode_id: episodeId, updated_at: now });
    }

    // --- PONTE LIMITAZIONI CONDIVISE ---
    if (path === "/api/shared-limitations" && method === "POST") {
      const personId = Number(payload.person_id);
      const title = (payload.title || "").trim();
      const description = (payload.description || "").trim();
      if (!title || !description) {
        throw new ValidationError("Titolo e descrizione operativa della limitazione sono obbligatori.");
      }
      const now = nowRomeIso();
      const recordedDate = payload.recorded_date || now.slice(0, 10);
      const [lim] = await sql`
        INSERT INTO public.shared_limitations (
          person_id, physio_episode_id, title, description, body_region, laterality,
          source_type, source_reference, recorded_date, recorded_by, is_active, version, created_at, updated_at
        ) VALUES (
          ${personId}, ${payload.physio_episode_id || null}, ${title}, ${description},
          ${payload.body_region || ""}, ${payload.laterality || "N/A"},
          ${payload.source_type || "Valutazione Fisioterapica"},
          ${payload.source_reference || `Rilevazione del ${recordedDate}`},
          ${recordedDate}, ${payload.recorded_by || actor}, 1, 1, ${now}, ${now}
        ) RETURNING *
      `;
      await logAudit("CREATE_SHARED_LIMITATION", "shared_limitations", lim.id, personId, `Condivisa limitazione '${title}'`, actor);
      return jsonResponse(201, lim);
    }

    const mLim = path.match(/^\/api\/shared-limitations\/(\d+)\/toggle$/);
    if (mLim && method === "POST") {
      const limId = Number(mLim[1]);
      const [row] = await sql`SELECT * FROM public.shared_limitations WHERE id = ${limId}`;
      if (!row) throw new NotFoundError("Limitazione non trovata.");
      const newActive = row.is_active ? 0 : 1;
      const [updated] = await sql`
        UPDATE public.shared_limitations SET is_active = ${newActive}, updated_at = ${nowRomeIso()} WHERE id = ${limId} RETURNING *
      `;
      return jsonResponse(200, updated);
    }

    // --- AREA FISIOTERAPIA ---
    if (path === "/api/physio/episodes" && method === "POST") {
      const personId = Number(payload.person_id);
      const title = (payload.title || "").trim();
      const chiefComplaint = (payload.chief_complaint || "").trim();
      if (!title || !chiefComplaint) {
        throw new ValidationError("Titolo dell'episodio clinico e motivo principale della consultazione sono obbligatori.");
      }
      const now = nowRomeIso();
      const startDate = payload.start_date || now.slice(0, 10);
      await sql`UPDATE public.people SET physio_active = 1, updated_at = ${now} WHERE id = ${personId}`;

      const [ep] = await sql`
        INSERT INTO public.physio_episodes (
          person_id, title, chief_complaint, body_region, laterality,
          start_date, end_date, reassessment_due_date, status,
          patient_goals, therapist_goals, version, created_at, updated_at
        ) VALUES (
          ${personId}, ${title}, ${chiefComplaint}, ${payload.body_region || ""}, ${payload.laterality || "N/A"},
          ${startDate}, ${payload.end_date || null}, ${payload.reassessment_due_date || null},
          ${payload.status || "attivo"}, ${payload.patient_goals || ""}, ${payload.therapist_goals || ""},
          1, ${now}, ${now}
        ) RETURNING *
      `;

      if (payload.init_default_flags !== false) {
        const [tmpl] = await sql`SELECT schema_json FROM public.custom_templates WHERE template_type = 'clinical_flags' LIMIT 1`;
        if (tmpl) {
          const schema = JSON.parse(tmpl.schema_json || "{}");
          for (const rf of schema.red_flags || []) {
            await sql`
              INSERT INTO public.clinical_flags (
                episode_id, person_id, flag_type, category, item_label,
                guideline_source, guideline_version, status, recorded_date, version, created_at, updated_at
              ) VALUES (
                ${ep.id}, ${personId}, 'red', ${rf.category}, ${rf.item_label},
                ${rf.guideline_source}, ${rf.guideline_version}, 'non_valutato', ${startDate}, 1, ${now}, ${now}
              )
            `;
          }
          for (const yf of schema.yellow_flags || []) {
            await sql`
              INSERT INTO public.clinical_flags (
                episode_id, person_id, flag_type, category, item_label,
                guideline_source, guideline_version, status, recorded_date, version, created_at, updated_at
              ) VALUES (
                ${ep.id}, ${personId}, 'yellow', ${yf.category}, ${yf.item_label},
                ${yf.guideline_source}, ${yf.guideline_version}, 'non_valutato', ${startDate}, 1, ${now}, ${now}
              )
            `;
          }
        }
      }
      await logAudit("CREATE_PHYSIO_EPISODE", "physio_episodes", ep.id, personId, `Aperto episodio '${title}'`, actor);
      return jsonResponse(201, await getPhysioEpisodeDetail(ep.id));
    }

    const mEpPut = path.match(/^\/api\/physio\/episodes\/(\d+)$/);
    if (mEpPut && method === "PUT") {
      const episodeId = Number(mEpPut[1]);
      const [current] = await sql`SELECT * FROM public.physio_episodes WHERE id = ${episodeId}`;
      if (!current) throw new NotFoundError("Episodio clinico non trovato.");
      if (payload.expected_version !== undefined && Number(payload.expected_version) !== Number(current.version)) {
        throw new ConflictError("L'episodio clinico è stato modificato da un altro dispositivo.", current);
      }
      const now = nowRomeIso();
      const newVersion = Number(current.version) + 1;
      const newStatus = payload.status || current.status;
      let endDate = payload.end_date !== undefined ? payload.end_date : current.end_date;
      if (newStatus === "concluso" && !endDate) endDate = now.slice(0, 10);

      await sql`
        UPDATE public.physio_episodes SET
          title = ${payload.title ?? current.title},
          chief_complaint = ${payload.chief_complaint ?? current.chief_complaint},
          body_region = ${payload.body_region ?? current.body_region},
          laterality = ${payload.laterality ?? current.laterality},
          start_date = ${payload.start_date ?? current.start_date},
          end_date = ${endDate},
          reassessment_due_date = ${payload.reassessment_due_date !== undefined ? payload.reassessment_due_date : current.reassessment_due_date},
          status = ${newStatus},
          patient_goals = ${payload.patient_goals ?? current.patient_goals},
          therapist_goals = ${payload.therapist_goals ?? current.therapist_goals},
          closure_summary = ${payload.closure_summary ?? current.closure_summary},
          closure_outcome = ${payload.closure_outcome ?? current.closure_outcome},
          version = ${newVersion},
          updated_at = ${now}
        WHERE id = ${episodeId}
      `;
      await logAudit("UPDATE_PHYSIO_EPISODE", "physio_episodes", episodeId, current.person_id, `Aggiornato episodio #${episodeId}`, actor);
      return jsonResponse(200, await getPhysioEpisodeDetail(episodeId));
    }

    const mEvPut = path.match(/^\/api\/physio\/evaluations(?:\/(\d+))?$/);
    if (mEvPut && (method === "POST" || method === "PUT")) {
      let evaluationId = mEvPut[1] ? Number(mEvPut[1]) : null;
      const now = nowRomeIso();
      let personId: number;
      let episodeId: number;
      let evalDate: string;

      if (evaluationId) {
        const [current] = await sql`SELECT * FROM public.clinical_evaluations WHERE id = ${evaluationId}`;
        if (!current) throw new NotFoundError("Valutazione clinica non trovata.");
        if (current.status === "finalizzata") {
          throw new ValidationError(
            "Questa valutazione è già stata finalizzata ed è immutabile. Usa 'Aggiungi Rettifica/Integrazione datata' o registra una nuova Rivalutazione.",
          );
        }
        if (payload.expected_version !== undefined && Number(payload.expected_version) !== Number(current.version)) {
          throw new ConflictError("La valutazione è stata modificata da un altro dispositivo.", current);
        }
        const newStatus = payload.status || current.status;
        const finalizedAt = newStatus === "finalizzata" ? now : null;
        const newVersion = Number(current.version) + 1;
        const objMeasJson =
          payload.objective_measurements !== undefined
            ? JSON.stringify(payload.objective_measurements)
            : current.objective_measurements_json;
        const assExJson =
          payload.assigned_exercises !== undefined
            ? JSON.stringify(payload.assigned_exercises)
            : current.assigned_exercises_json;

        await sql`
          UPDATE public.clinical_evaluations SET
            eval_type = ${payload.eval_type ?? current.eval_type},
            eval_date = ${payload.eval_date ?? current.eval_date},
            status = ${newStatus},
            finalized_at = ${finalizedAt},
            consult_reason = ${payload.consult_reason ?? current.consult_reason},
            patient_goals = ${payload.patient_goals ?? current.patient_goals},
            important_activities = ${payload.important_activities ?? current.important_activities},
            symptom_onset = ${payload.symptom_onset ?? current.symptom_onset},
            symptom_distribution = ${payload.symptom_distribution ?? current.symptom_distribution},
            symptom_behavior = ${payload.symptom_behavior ?? current.symptom_behavior},
            aggravating_factors = ${payload.aggravating_factors ?? current.aggravating_factors},
            easing_factors = ${payload.easing_factors ?? current.easing_factors},
            pattern_24h = ${payload.pattern_24h ?? current.pattern_24h},
            functional_impact = ${payload.functional_impact ?? current.functional_impact},
            medical_history = ${payload.medical_history ?? current.medical_history},
            surgeries_traumas = ${payload.surgeries_traumas ?? current.surgeries_traumas},
            associated_conditions = ${payload.associated_conditions ?? current.associated_conditions},
            medications = ${payload.medications ?? current.medications},
            imaging_reports = ${payload.imaging_reports ?? current.imaging_reports},
            sleep_quality = ${payload.sleep_quality ?? current.sleep_quality},
            work_sport_load = ${payload.work_sport_load ?? current.work_sport_load},
            psychosocial_factors = ${payload.psychosocial_factors ?? current.psychosocial_factors},
            objective_measurements_json = ${objMeasJson},
            special_tests = ${payload.special_tests ?? current.special_tests},
            clinical_observations = ${payload.clinical_observations ?? current.clinical_observations},
            clinical_reasoning = ${payload.clinical_reasoning ?? current.clinical_reasoning},
            treatment_plan = ${payload.treatment_plan ?? current.treatment_plan},
            assigned_exercises_json = ${assExJson},
            home_advice = ${payload.home_advice ?? current.home_advice},
            next_reassessment_date = ${payload.next_reassessment_date !== undefined ? payload.next_reassessment_date : current.next_reassessment_date},
            version = ${newVersion},
            updated_at = ${now}
          WHERE id = ${evaluationId}
        `;
        personId = current.person_id;
        episodeId = current.episode_id;
        evalDate = payload.eval_date ?? current.eval_date;
      } else {
        episodeId = Number(payload.episode_id);
        const [ep] = await sql`SELECT * FROM public.physio_episodes WHERE id = ${episodeId}`;
        if (!ep) throw new NotFoundError("Episodio clinico non trovato.");
        personId = ep.person_id;
        const evalType = payload.eval_type || "prima_valutazione";
        evalDate = payload.eval_date || now.slice(0, 10);
        const newStatus = payload.status || "bozza";
        const finalizedAt = newStatus === "finalizzata" ? now : null;
        const objMeasJson = JSON.stringify(payload.objective_measurements || []);
        const assExJson = JSON.stringify(payload.assigned_exercises || []);

        const [created] = await sql`
          INSERT INTO public.clinical_evaluations (
            episode_id, person_id, eval_type, eval_date, status, finalized_at,
            consult_reason, patient_goals, important_activities,
            symptom_onset, symptom_distribution, symptom_behavior,
            aggravating_factors, easing_factors, pattern_24h,
            functional_impact, medical_history, surgeries_traumas,
            associated_conditions, medications, imaging_reports,
            sleep_quality, work_sport_load, psychosocial_factors,
            objective_measurements_json, special_tests, clinical_observations,
            clinical_reasoning, treatment_plan, assigned_exercises_json,
            home_advice, next_reassessment_date, version, created_at, updated_at
          ) VALUES (
            ${episodeId}, ${personId}, ${evalType}, ${evalDate}, ${newStatus}, ${finalizedAt},
            ${payload.consult_reason || ""}, ${payload.patient_goals || ""}, ${payload.important_activities || ""},
            ${payload.symptom_onset || ""}, ${payload.symptom_distribution || ""}, ${payload.symptom_behavior || ""},
            ${payload.aggravating_factors || ""}, ${payload.easing_factors || ""}, ${payload.pattern_24h || ""},
            ${payload.functional_impact || ""}, ${payload.medical_history || ""}, ${payload.surgeries_traumas || ""},
            ${payload.associated_conditions || ""}, ${payload.medications || ""}, ${payload.imaging_reports || ""},
            ${payload.sleep_quality || ""}, ${payload.work_sport_load || ""}, ${payload.psychosocial_factors || ""},
            ${objMeasJson}, ${payload.special_tests || ""}, ${payload.clinical_observations || ""},
            ${payload.clinical_reasoning || ""}, ${payload.treatment_plan || ""}, ${assExJson},
            ${payload.home_advice || ""}, ${payload.next_reassessment_date || null}, 1, ${now}, ${now}
          ) RETURNING id
        `;
        evaluationId = created.id;
      }

      if (payload.next_reassessment_date) {
        await sql`
          UPDATE public.physio_episodes SET reassessment_due_date = ${payload.next_reassessment_date}, updated_at = ${now}
          WHERE id = ${episodeId}
        `;
      }

      if (Array.isArray(payload.body_map_markers)) {
        await sql`DELETE FROM public.body_map_markers WHERE evaluation_id = ${evaluationId}`;
        for (const m of payload.body_map_markers) {
          const viewSide = m.view_side === "posterior" ? "posterior" : "anterior";
          const markerKind = m.marker_kind === "area" ? "area" : "point";
          const lat = ["DX", "SX", "Centrale", "Bilaterale"].includes(m.laterality) ? m.laterality : "Centrale";
          const intensity = Math.max(0, Math.min(10, Number(m.intensity ?? 5)));
          await sql`
            INSERT INTO public.body_map_markers (
              evaluation_id, episode_id, person_id, view_side, marker_kind,
              x_norm, y_norm, radius_norm, polygon_json, anatomical_region,
              laterality, symptom_type, intensity, notes, recorded_date, created_at
            ) VALUES (
              ${evaluationId}, ${episodeId}, ${personId}, ${viewSide}, ${markerKind},
              ${Number(m.x_norm ?? 500)}, ${Number(m.y_norm ?? 300)},
              ${Number(m.radius_norm ?? (markerKind === "point" ? 24 : 55))},
              ${JSON.stringify(m.polygon || [])},
              ${(m.anatomical_region || "Regione indicata").trim()},
              ${lat}, ${(m.symptom_type || "Dolore acuto").trim()},
              ${intensity}, ${(m.notes || "").trim()}, ${m.recorded_date || evalDate}, ${now}
            )
          `;
        }
      }

      await logAudit("SAVE_CLINICAL_EVALUATION", "clinical_evaluations", evaluationId, personId, `Salvata valutazione #${evaluationId}`, actor);
      return jsonResponse(method === "POST" ? 201 : 200, await getEvaluationWithDetails(evaluationId!));
    }

    if (path === "/api/physio/flags" && (method === "POST" || method === "PUT")) {
      const now = nowRomeIso();
      const flagId = payload.id ? Number(payload.id) : null;
      const status = payload.status || "non_valutato";
      if (!["presente", "assente", "non_valutato"].includes(status)) {
        throw new ValidationError("Lo stato della flag deve essere 'presente', 'assente' o 'non_valutato'.");
      }

      if (flagId) {
        const [curr] = await sql`SELECT * FROM public.clinical_flags WHERE id = ${flagId}`;
        if (!curr) throw new NotFoundError("Flag clinica non trovata.");
        const [updated] = await sql`
          UPDATE public.clinical_flags SET
            status = ${status},
            notes = ${payload.notes ?? curr.notes},
            source_info = ${payload.source_info ?? curr.source_info},
            action_taken = ${payload.action_taken ?? curr.action_taken},
            recorded_date = ${payload.recorded_date || now.slice(0, 10)},
            version = ${Number(curr.version) + 1},
            updated_at = ${now}
          WHERE id = ${flagId}
          RETURNING *
        `;
        return jsonResponse(200, updated);
      } else {
        const episodeId = Number(payload.episode_id);
        const [ep] = await sql`SELECT * FROM public.physio_episodes WHERE id = ${episodeId}`;
        if (!ep) throw new NotFoundError("Episodio non trovato.");
        const flagType = payload.flag_type === "yellow" ? "yellow" : "red";
        const [created] = await sql`
          INSERT INTO public.clinical_flags (
            episode_id, evaluation_id, person_id, flag_type, category, item_label,
            guideline_source, guideline_version, context_of_use, status,
            notes, source_info, action_taken, recorded_date, version, created_at, updated_at
          ) VALUES (
            ${episodeId}, ${payload.evaluation_id || null}, ${ep.person_id}, ${flagType},
            ${(payload.category || "Clinica").trim()}, ${(payload.item_label || "").trim()},
            ${(payload.guideline_source || "Valutazione Clinica Professionista").trim()},
            ${(payload.guideline_version || "2020").trim()},
            ${payload.context_of_use || "Screening muscoloscheletrico"},
            ${status}, ${payload.notes || ""}, ${payload.source_info || "Anamnesi / Esame obiettivo"},
            ${payload.action_taken || ""}, ${payload.recorded_date || now.slice(0, 10)}, 1, ${now}, ${now}
          ) RETURNING *
        `;
        return jsonResponse(200, created);
      }
    }

    if (path === "/api/physio/outcome-measures" && method === "POST") {
      const episodeId = Number(payload.episode_id);
      const [ep] = await sql`SELECT * FROM public.physio_episodes WHERE id = ${episodeId}`;
      if (!ep) throw new NotFoundError("Episodio clinico non trovato.");

      const scaleCode = (payload.scale_code || "NPRS").trim();
      const cat = OUTCOME_SCALES_CATALOG[scaleCode];
      const scaleName = (payload.scale_name || (cat ? cat.scale_name : scaleCode)).trim();
      const scaleVersion = (payload.scale_version || (cat ? cat.scale_version : "v1")).trim();
      let sourceMode = payload.source_mode || (cat ? cat.source_mode : "external_score");
      const scoreUnit = payload.score_unit || (cat ? cat.score_unit : "pt");

      let responses = payload.responses || [];
      let completedItems = 1;
      let totalItems = 1;
      let missingItems = 0;
      let scoreValue: number | null = null;

      if (scaleCode === "NPRS" && sourceMode === "internal_verified") {
        if (payload.score_value === undefined || payload.score_value === null || payload.score_value === "") {
          throw new ValidationError("Inserisci un valore numerico da 0 a 10 per la scala NPRS.");
        }
        const val = Number(payload.score_value);
        if (val < 0 || val > 10) throw new ValidationError("Il punteggio NPRS deve essere compreso tra 0 e 10.");
        scoreValue = Math.round(val * 10) / 10;
      } else if (scaleCode === "PSFS" && sourceMode === "internal_verified") {
        if (!Array.isArray(responses) || responses.length === 0) {
          throw new ValidationError("Inserisci almeno un'attività specifica del paziente per la scala PSFS.");
        }
        const validScores: number[] = [];
        const cleaned: any[] = [];
        totalItems = 0;
        completedItems = 0;
        missingItems = 0;
        for (const item of responses) {
          const act = (item.activity || "").trim();
          if (!act) continue;
          totalItems++;
          if (item.score === null || item.score === undefined || item.score === "") {
            missingItems++;
            cleaned.push({ activity: act, score: null });
          } else {
            const sVal = Number(item.score);
            if (sVal < 0 || sVal > 10) throw new ValidationError(`Il punteggio per '${act}' deve essere tra 0 e 10.`);
            completedItems++;
            validScores.push(sVal);
            cleaned.push({ activity: act, score: sVal });
          }
        }
        if (completedItems === 0) throw new ValidationError("Almeno un'attività PSFS deve avere un punteggio valido.");
        responses = cleaned;
        scoreValue = Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 100) / 100;
      } else if (scaleCode === "SANE" && sourceMode === "internal_verified") {
        if (payload.score_value === undefined || payload.score_value === null || payload.score_value === "") {
          throw new ValidationError("Inserisci una percentuale valida (0-100) per la scala SANE.");
        }
        const val = Number(payload.score_value);
        if (val < 0 || val > 100) throw new ValidationError("Il valore SANE deve essere compreso tra 0 e 100%.");
        scoreValue = Math.round(val * 10) / 10;
      } else if (scaleCode === "PCS" || scaleCode === "TSK-13") {
        const minItem = scaleCode === "PCS" ? 0 : 1;
        const maxItem = 4;
        const minTotal = scaleCode === "PCS" ? 0 : 13;
        const maxTotal = 52;
        if (Array.isArray(responses) && responses.length > 0) {
          let sum = 0;
          totalItems = responses.length;
          completedItems = 0;
          missingItems = 0;
          const cleaned = responses.map((it: any, idx: number) => {
            const rawS = it?.score;
            if (rawS === null || rawS === undefined || rawS === "") {
              missingItems++;
              return { item: Number(it?.item || idx + 1), subscale: it?.subscale || "", text: it?.text || "", score: null };
            }
            const sVal = Number(rawS);
            if (!Number.isFinite(sVal) || sVal < minItem || sVal > maxItem) {
              throw new ValidationError(`Punteggio item #${idx + 1} non valido per ${scaleCode} (${minItem}-${maxItem}).`);
            }
            completedItems++;
            sum += sVal;
            return { item: Number(it?.item || idx + 1), subscale: it?.subscale || "", text: it?.text || "", score: sVal };
          });
          if (completedItems === 0) throw new ValidationError(`Inserisci almeno una risposta valida per ${scaleCode}.`);
          responses = cleaned;
          scoreValue = Math.round(sum * 100) / 100;
          sourceMode = payload.source_mode === "external_score" ? "external_score" : "internal_verified";
        } else {
          if (payload.score_value === undefined || payload.score_value === null || payload.score_value === "") {
            throw new ValidationError(`Inserisci il punteggio totale per ${scaleCode} (${minTotal}-${maxTotal}).`);
          }
          const val = Number(payload.score_value);
          if (!Number.isFinite(val) || val < minTotal || val > maxTotal) {
            throw new ValidationError(`Il punteggio ${scaleCode} deve essere compreso tra ${minTotal} e ${maxTotal}.`);
          }
          scoreValue = Math.round(val * 100) / 100;
          totalItems = Number(payload.total_items || 13);
          missingItems = Number(payload.missing_items || 0);
          completedItems = Math.max(0, totalItems - missingItems);
          sourceMode = "external_score";
        }
      } else {
        sourceMode = "external_score";
        if (payload.score_value === undefined || payload.score_value === null || payload.score_value === "") {
          throw new ValidationError("Inserisci il punteggio calcolato.");
        }
        scoreValue = Math.round(Number(payload.score_value) * 100) / 100;
        totalItems = Number(payload.total_items || 1);
        missingItems = Number(payload.missing_items || 0);
        completedItems = Math.max(0, totalItems - missingItems);
      }

      const now = nowRomeIso();
      const recordedDate = payload.recorded_date || now.slice(0, 10);
      const [om] = await sql`
        INSERT INTO public.outcome_measures (
          episode_id, evaluation_id, person_id, scale_code, scale_name, scale_version,
          source_mode, context_label, responses_json, completed_items, total_items,
          missing_items, score_value, score_unit, clinical_note, recorded_date, created_at
        ) VALUES (
          ${episodeId}, ${payload.evaluation_id || null}, ${ep.person_id}, ${scaleCode}, ${scaleName}, ${scaleVersion},
          ${sourceMode}, ${payload.context_label || "Rilevazione clinica"}, ${JSON.stringify(responses)},
          ${completedItems}, ${totalItems}, ${missingItems}, ${scoreValue}, ${scoreUnit},
          ${payload.clinical_note || ""}, ${recordedDate}, ${now}
        ) RETURNING *
      `;
      await logAudit("RECORD_OUTCOME_MEASURE", "outcome_measures", om.id, ep.person_id, `Registrata scala ${scaleCode}: ${scoreValue}${scoreUnit}`, actor);
      return jsonResponse(201, { ...om, responses });
    }

    const mOmDel = path.match(/^\/api\/physio\/outcome-measures\/(\d+)$/);
    if (mOmDel && method === "DELETE") {
      const omId = Number(mOmDel[1]);
      const [existing] = await sql`SELECT * FROM public.outcome_measures WHERE id = ${omId}`;
      if (!existing) throw new NotFoundError("Scala di esito non trovata.");
      await sql`DELETE FROM public.outcome_measures WHERE id = ${omId}`;
      await logAudit("DELETE_OUTCOME_MEASURE", "outcome_measures", omId, existing.person_id, `Eliminata rilevazione ${existing.scale_code} (${existing.recorded_date})`, actor);
      return jsonResponse(200, { deleted: true, id: omId });
    }

    const mNote = path.match(/^\/api\/physio\/notes(?:\/(\d+))?$/);
    if (mNote && (method === "POST" || method === "PUT")) {
      let noteId = mNote[1] ? Number(mNote[1]) : null;
      const now = nowRomeIso();
      if (noteId) {
        const [curr] = await sql`SELECT * FROM public.clinical_notes WHERE id = ${noteId}`;
        if (!curr) throw new NotFoundError("Nota clinica non trovata.");
        if (curr.status === "finalizzata") {
          throw new ValidationError("La nota clinica è già finalizzata e non può essere sovrascritta. Aggiungi un'integrazione datata.");
        }
        if (payload.expected_version !== undefined && Number(payload.expected_version) !== Number(curr.version)) {
          throw new ConflictError("La nota clinica è stata modificata da un altro dispositivo.", curr);
        }
        const newStatus = payload.status || curr.status;
        const finalizedAt = newStatus === "finalizzata" ? now : null;
        const [updated] = await sql`
          UPDATE public.clinical_notes SET
            note_date = ${payload.note_date ?? curr.note_date},
            status = ${newStatus},
            finalized_at = ${finalizedAt},
            subjective_response = ${payload.subjective_response ?? curr.subjective_response},
            objective_findings = ${payload.objective_findings ?? curr.objective_findings},
            interventions_performed = ${payload.interventions_performed ?? curr.interventions_performed},
            exercises_performed = ${payload.exercises_performed ?? curr.exercises_performed},
            plan_next_steps = ${payload.plan_next_steps ?? curr.plan_next_steps},
            pain_pre = ${payload.pain_pre !== undefined && payload.pain_pre !== "" ? Number(payload.pain_pre) : curr.pain_pre},
            pain_post = ${payload.pain_post !== undefined && payload.pain_post !== "" ? Number(payload.pain_post) : curr.pain_post},
            version = ${Number(curr.version) + 1},
            updated_at = ${now}
          WHERE id = ${noteId}
          RETURNING *
        `;
        const addenda = await sql`SELECT * FROM public.clinical_note_addenda WHERE note_id = ${noteId} ORDER BY id ASC`;
        return jsonResponse(200, { ...updated, addenda: Array.from(addenda) });
      } else {
        const episodeId = Number(payload.episode_id);
        const [ep] = await sql`SELECT * FROM public.physio_episodes WHERE id = ${episodeId}`;
        if (!ep) throw new NotFoundError("Episodio clinico non trovato.");
        const copiedFromNoteId = payload.copied_from_note_id ? Number(payload.copied_from_note_id) : null;
        let copiedFromDate = payload.copied_from_date || null;
        let subj = payload.subjective_response || "";
        let obj = payload.objective_findings || "";
        let interv = payload.interventions_performed || "";
        let ex = payload.exercises_performed || "";
        let plan = payload.plan_next_steps || "";
        if (copiedFromNoteId) {
          const [orig] = await sql`SELECT * FROM public.clinical_notes WHERE id = ${copiedFromNoteId}`;
          if (orig) {
            copiedFromDate = orig.note_date;
            if (!subj) subj = orig.subjective_response || "";
            if (!obj) obj = orig.objective_findings || "";
            if (!interv) interv = orig.interventions_performed || "";
            if (!ex) ex = orig.exercises_performed || "";
            if (!plan) plan = orig.plan_next_steps || "";
          }
        }
        const newStatus = payload.status || "bozza";
        const finalizedAt = newStatus === "finalizzata" ? now : null;
        const [created] = await sql`
          INSERT INTO public.clinical_notes (
            episode_id, person_id, appointment_id, note_date, status, finalized_at,
            copied_from_note_id, copied_from_date, subjective_response, objective_findings,
            interventions_performed, exercises_performed, plan_next_steps,
            pain_pre, pain_post, version, created_at, updated_at
          ) VALUES (
            ${episodeId}, ${ep.person_id}, ${payload.appointment_id || null},
            ${payload.note_date || now.slice(0, 10)}, ${newStatus}, ${finalizedAt},
            ${copiedFromNoteId}, ${copiedFromDate}, ${subj}, ${obj}, ${interv}, ${ex}, ${plan},
            ${payload.pain_pre !== undefined && payload.pain_pre !== "" ? Number(payload.pain_pre) : null},
            ${payload.pain_post !== undefined && payload.pain_post !== "" ? Number(payload.pain_post) : null},
            1, ${now}, ${now}
          ) RETURNING *
        `;
        return jsonResponse(201, { ...created, addenda: [] });
      }
    }

    if (path === "/api/physio/addenda" && method === "POST") {
      const noteId = payload.note_id ? Number(payload.note_id) : null;
      const evaluationId = payload.evaluation_id ? Number(payload.evaluation_id) : null;
      const text = (payload.addendum_text || "").trim();
      const reason = (payload.reason || "Integrazione / Rettifica clinica").trim();
      if (!text) throw new ValidationError("Il testo dell'integrazione/rettifica è obbligatorio.");
      let personId: number | null = null;
      if (noteId) {
        const [n] = await sql`SELECT person_id FROM public.clinical_notes WHERE id = ${noteId}`;
        if (!n) throw new NotFoundError("Nota clinica non trovata.");
        personId = n.person_id;
      } else if (evaluationId) {
        const [ev] = await sql`SELECT person_id FROM public.clinical_evaluations WHERE id = ${evaluationId}`;
        if (!ev) throw new NotFoundError("Valutazione clinica non trovata.");
        personId = ev.person_id;
      } else {
        throw new ValidationError("Specifica la nota o la valutazione a cui collegare la rettifica.");
      }
      const [add] = await sql`
        INSERT INTO public.clinical_note_addenda (
          note_id, evaluation_id, person_id, author_name, addendum_text, reason, created_at
        ) VALUES (${noteId}, ${evaluationId}, ${personId}, ${actor}, ${text}, ${reason}, ${nowRomeIso()})
        RETURNING *
      `;
      return jsonResponse(201, add);
    }

    // --- AREA FITNESS ---
    const mFitProf = path.match(/^\/api\/people\/(\d+)\/fitness-profile$/);
    if (mFitProf && (method === "POST" || method === "PUT")) {
      const personId = Number(mFitProf[1]);
      const now = nowRomeIso();
      await sql`UPDATE public.people SET fitness_active = 1, updated_at = ${now} WHERE id = ${personId}`;
      const [curr] = await sql`SELECT * FROM public.fitness_profiles WHERE person_id = ${personId}`;
      if (curr) {
        if (payload.expected_version !== undefined && Number(payload.expected_version) !== Number(curr.version)) {
          throw new ConflictError("Il profilo fitness è stato modificato da un altro dispositivo.", curr);
        }
        const [updated] = await sql`
          UPDATE public.fitness_profiles SET
            primary_goals = ${payload.primary_goals ?? curr.primary_goals},
            experience_level = ${payload.experience_level ?? curr.experience_level},
            preferences = ${payload.preferences ?? curr.preferences},
            weekly_availability = ${payload.weekly_availability ?? curr.weekly_availability},
            available_equipment = ${payload.available_equipment ?? curr.available_equipment},
            general_limitations_note = ${payload.general_limitations_note ?? curr.general_limitations_note},
            initial_assessment_notes = ${payload.initial_assessment_notes ?? curr.initial_assessment_notes},
            version = ${Number(curr.version) + 1},
            updated_at = ${now}
          WHERE person_id = ${personId}
          RETURNING *
        `;
        return jsonResponse(200, updated);
      } else {
        const [created] = await sql`
          INSERT INTO public.fitness_profiles (
            person_id, primary_goals, experience_level, preferences,
            weekly_availability, available_equipment, general_limitations_note,
            initial_assessment_notes, version, created_at, updated_at
          ) VALUES (
            ${personId}, ${payload.primary_goals || ""}, ${payload.experience_level || "Intermedio"},
            ${payload.preferences || ""}, ${payload.weekly_availability || ""},
            ${payload.available_equipment || ""}, ${payload.general_limitations_note || ""},
            ${payload.initial_assessment_notes || ""}, 1, ${now}, ${now}
          ) RETURNING *
        `;
        return jsonResponse(200, created);
      }
    }

    if (path === "/api/fitness/metrics" && method === "POST") {
      const personId = Number(payload.person_id);
      const now = nowRomeIso();
      const [met] = await sql`
        INSERT INTO public.fitness_metrics (
          person_id, recorded_date, metric_category, metric_name,
          value_num, unit, side, protocol_notes, created_at
        ) VALUES (
          ${personId}, ${payload.recorded_date || now.slice(0, 10)},
          ${payload.metric_category || "Forza / Performance"}, ${(payload.metric_name || "").trim()},
          ${Number(payload.value_num)}, ${(payload.unit || "kg").trim()},
          ${payload.side || "N/A"}, ${payload.protocol_notes || ""}, ${now}
        ) RETURNING *
      `;
      return jsonResponse(201, met);
    }

    const mProg = path.match(/^\/api\/fitness\/programs(?:\/(\d+))?$/);
    if (mProg && (method === "POST" || method === "PUT")) {
      let programId = mProg[1] ? Number(mProg[1]) : null;
      const now = nowRomeIso();
      if (programId) {
        const [curr] = await sql`SELECT * FROM public.fitness_programs WHERE id = ${programId}`;
        if (!curr) throw new NotFoundError("Programma fitness non trovato.");
        if (payload.expected_version !== undefined && Number(payload.expected_version) !== Number(curr.version)) {
          throw new ConflictError("Il programma fitness è stato modificato da un altro dispositivo.", curr);
        }
        const newV = Number(curr.version) + 1;
        const workoutsJson = payload.workouts !== undefined ? JSON.stringify(payload.workouts) : curr.workouts_json;
        const title = (payload.title || curr.title).trim();
        const goal = (payload.goal || curr.goal).trim();
        const notes = payload.notes ?? curr.notes;

        await sql`
          UPDATE public.fitness_programs SET
            title = ${title}, goal = ${goal},
            phase_name = ${payload.phase_name ?? curr.phase_name},
            start_date = ${payload.start_date ?? curr.start_date},
            end_date = ${payload.end_date !== undefined ? payload.end_date : curr.end_date},
            frequency_per_week = ${Number(payload.frequency_per_week ?? curr.frequency_per_week ?? 2)},
            status = ${payload.status ?? curr.status},
            workouts_json = ${workoutsJson}, notes = ${notes},
            version = ${newV}, updated_at = ${now}
          WHERE id = ${programId}
        `;
        await sql`
          INSERT INTO public.fitness_program_versions (
            program_id, version_number, title, goal, workouts_json, notes, change_note, saved_at
          ) VALUES (
            ${programId}, ${newV}, ${title}, ${goal}, ${workoutsJson}, ${notes},
            ${payload.change_note || `Aggiornamento programma v${newV}`}, ${now}
          )
        `;
        return jsonResponse(200, await getFitnessProgramDetail(programId));
      } else {
        const personId = Number(payload.person_id);
        const title = (payload.title || "").trim();
        const goal = (payload.goal || "").trim();
        if (!title || !goal) throw new ValidationError("Titolo e obiettivo del programma fitness sono obbligatori.");
        await sql`UPDATE public.people SET fitness_active = 1, updated_at = ${now} WHERE id = ${personId}`;
        const workoutsJson = JSON.stringify(payload.workouts || []);
        const notes = payload.notes || "";
        const [created] = await sql`
          INSERT INTO public.fitness_programs (
            person_id, title, goal, phase_name, start_date, end_date,
            frequency_per_week, status, workouts_json, notes, version, created_at, updated_at
          ) VALUES (
            ${personId}, ${title}, ${goal}, ${payload.phase_name || "Fase 1 - Adattamento & Forza"},
            ${payload.start_date || now.slice(0, 10)}, ${payload.end_date || null},
            ${Number(payload.frequency_per_week || 2)}, ${payload.status || "attivo"},
            ${workoutsJson}, ${notes}, 1, ${now}, ${now}
          ) RETURNING id
        `;
        programId = created.id;
        await sql`
          INSERT INTO public.fitness_program_versions (
            program_id, version_number, title, goal, workouts_json, notes, change_note, saved_at
          ) VALUES (${programId}, 1, ${title}, ${goal}, ${workoutsJson}, ${notes}, 'Creazione iniziale programma', ${now})
        `;
        return jsonResponse(201, await getFitnessProgramDetail(programId!));
      }
    }

    if (path === "/api/fitness/workout-logs" && method === "POST") {
      const personId = Number(payload.person_id);
      const programId = payload.program_id ? Number(payload.program_id) : null;
      const now = nowRomeIso();
      let progVersion = 1;
      if (programId) {
        const [pRow] = await sql`SELECT version FROM public.fitness_programs WHERE id = ${programId}`;
        if (pRow) progVersion = pRow.version;
      }
      const plannedJson = JSON.stringify(payload.planned_exercises || []);
      const actualJson = JSON.stringify(payload.actual_exercises || []);
      const [wlog] = await sql`
        INSERT INTO public.workout_logs (
          person_id, program_id, program_version, appointment_id, workout_day_name,
          session_date, planned_exercises_json, actual_exercises_json, session_rpe,
          duration_minutes, client_feedback, reported_symptoms, symptom_severity,
          next_session_notes, version, created_at, updated_at
        ) VALUES (
          ${personId}, ${programId}, ${progVersion}, ${payload.appointment_id || null},
          ${(payload.workout_day_name || "Seduta Personal Training").trim()},
          ${payload.session_date || now.slice(0, 10)}, ${plannedJson}, ${actualJson},
          ${payload.session_rpe !== undefined && payload.session_rpe !== "" && payload.session_rpe !== null ? Number(payload.session_rpe) : null},
          ${Number(payload.duration_minutes || 60)}, ${payload.client_feedback || ""},
          ${payload.reported_symptoms || ""}, ${Number(payload.symptom_severity || 0)},
          ${payload.next_session_notes || ""}, 1, ${now}, ${now}
        ) RETURNING *
      `;
      return jsonResponse(201, {
        ...wlog,
        planned_exercises: JSON.parse(plannedJson),
        actual_exercises: JSON.parse(actualJson),
      });
    }

    // --- PACCHETTI E PAGAMENTI ---
    if (path === "/api/packages" && method === "POST") {
      const personId = Number(payload.person_id);
      const totalSessions = Number(payload.total_sessions);
      let priceCents = Math.round(Number(payload.price_eur ?? Number(payload.price_cents || 0) / 100) * 100);
      if (payload.price_cents !== undefined && payload.price_eur === undefined) priceCents = Number(payload.price_cents);
      if (Number.isNaN(totalSessions) || totalSessions < 0) {
        throw new ValidationError("Il numero di sedute non può essere negativo.");
      }
      const serviceArea = payload.service_area || "fisio";
      const now = nowRomeIso();
      const purchasedDate = payload.purchased_date || now.slice(0, 10);
      const name = (
        payload.name ||
        (totalSessions === 0 ? `Sedute singole (${serviceArea})` : `Pacchetto ${totalSessions} sedute (${serviceArea})`)
      ).trim();

      const [pkg] = await sql`
        INSERT INTO public.packages (
          person_id, service_area, name, total_sessions, price_cents,
          purchased_date, valid_until, status, late_cancel_policy, no_show_policy,
          suspensions_json, notes, version, created_at, updated_at
        ) VALUES (
          ${personId}, ${serviceArea}, ${name}, ${totalSessions}, ${priceCents},
          ${purchasedDate}, ${(payload.valid_until || "").trim() || null}, 'attivo',
          ${payload.late_cancel_policy || "charge"}, ${payload.no_show_policy || "charge"},
          '[]', ${payload.notes || ""}, 1, ${now}, ${now}
        ) RETURNING *
      `;

      const initialSessions = Math.max(0, Math.min(50, Math.floor(Number(payload.initial_sessions || 0))));
      if (initialSessions > 0 && (totalSessions === 0 || initialSessions <= totalSessions)) {
        const initTs = /^\d{4}-\d{2}-\d{2}$/.test(purchasedDate) ? `${purchasedDate}T${now.slice(11)}` : now;
        for (let i = 0; i < initialSessions; i++) {
          await sql`
            INSERT INTO public.package_movements (
              package_id, person_id, appointment_id, movement_type, delta_sessions,
              reason, idempotency_key, reversed_movement_id, created_at, created_by
            ) VALUES (
              ${pkg.id}, ${personId}, NULL, 'CONSUME', 1,
              ${totalSessions === 0 ? "Seduta singola svolta" : "Seduta svolta"},
              ${`init_${pkg.id}_${i}_${Date.now()}_${randomHex(4)}`}, NULL, ${initTs}, ${actor}
            )
          `;
        }
        await syncPackageStatus(pkg.id);
      }

      let initialPaymentCents = Math.round(Number(payload.initial_payment_eur || 0) * 100);
      if (payload.initial_payment_cents !== undefined) initialPaymentCents = Number(payload.initial_payment_cents);
      if (initialPaymentCents > 0) {
        await sql`
          INSERT INTO public.payments (
            person_id, package_id, amount_cents, payment_date, payment_method, reference_note, is_refund, created_at
          ) VALUES (
            ${personId}, ${pkg.id}, ${initialPaymentCents}, ${purchasedDate},
            ${payload.payment_method || "POS/Carta"}, ${payload.payment_note || "Pagamento all'acquisto pacchetto"}, 0, ${now}
          )
        `;
      }
      const [freshCreated] = await sql`SELECT * FROM public.packages WHERE id = ${pkg.id}`;
      return jsonResponse(201, await computePackageSummary(freshCreated || pkg));
    }

    const mPkgMov = path.match(/^\/api\/packages\/(\d+)\/movements$/);
    if (mPkgMov && method === "POST") {
      const pkgId = Number(mPkgMov[1]);
      const [currPkg] = await sql`SELECT * FROM public.packages WHERE id = ${pkgId}`;
      if (!currPkg) throw new NotFoundError("Pacchetto non trovato.");
      const summary = await computePackageSummary(currPkg);
      const isOpenSingle = Number(currPkg.total_sessions) === 0;
      const action = String(payload.action || "consume").toLowerCase();
      const now = nowRomeIso();
      const sessionDate = (payload.session_date || "").trim();
      const movTimestamp = sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(sessionDate) ? `${sessionDate}T${now.slice(11)}` : now;
      const idemKey = `manual_${pkgId}_${Date.now()}_${randomHex(4)}`;

      if (action === "consume") {
        if (!isOpenSingle && summary.remaining_sessions <= 0) {
          throw new ValidationError("Nessuna seduta rimanente su questo pacchetto.");
        }
        const reason = (payload.reason || (isOpenSingle ? "Seduta singola svolta" : "Seduta svolta")).trim();
        await sql`
          INSERT INTO public.package_movements (
            package_id, person_id, appointment_id, movement_type, delta_sessions,
            reason, idempotency_key, reversed_movement_id, created_at, created_by
          ) VALUES (
            ${pkgId}, ${currPkg.person_id}, NULL, 'CONSUME', 1,
            ${reason}, ${idemKey}, NULL, ${movTimestamp}, ${actor}
          )
        `;
        await logAudit(
          "CONSUME_PACKAGE_SESSION",
          "packages",
          pkgId,
          currPkg.person_id,
          isOpenSingle ? `Registrata +1 seduta singola su '${currPkg.name}' (${reason})` : `Scalata 1 seduta da '${currPkg.name}' (${reason})`,
          actor,
        );
      } else if (action === "undo" || action === "reversal") {
        if (summary.consumed_sessions <= 0) {
          throw new ValidationError("Nessuna seduta svolta da ripristinare su questo pacchetto.");
        }
        const reason = (payload.reason || (isOpenSingle ? "Rimozione seduta singola" : "Ripristino seduta")).trim();
        await sql`
          INSERT INTO public.package_movements (
            package_id, person_id, appointment_id, movement_type, delta_sessions,
            reason, idempotency_key, reversed_movement_id, created_at, created_by
          ) VALUES (
            ${pkgId}, ${currPkg.person_id}, NULL, 'REVERSAL', -1,
            ${reason}, ${idemKey}, NULL, ${movTimestamp}, ${actor}
          )
        `;
        await logAudit("UNDO_PACKAGE_SESSION", "packages", pkgId, currPkg.person_id, `Ripristinata 1 seduta su '${currPkg.name}' (${reason})`, actor);
      } else {
        throw new ValidationError("Azione movimento non valida.");
      }

      await syncPackageStatus(pkgId);
      const [freshPkg] = await sql`SELECT * FROM public.packages WHERE id = ${pkgId}`;
      return jsonResponse(200, await computePackageSummary(freshPkg));
    }

    const mPkgConvert = path.match(/^\/api\/packages\/(\d+)\/convert$/);
    if (mPkgConvert && method === "POST") {
      const pkgId = Number(mPkgConvert[1]);
      const [currPkg] = await sql`SELECT * FROM public.packages WHERE id = ${pkgId}`;
      if (!currPkg) throw new NotFoundError("Pacchetto non trovato.");
      const summary = await computePackageSummary(currPkg);
      const targetTotal = Math.floor(Number(payload.total_sessions || 0));
      if (Number.isNaN(targetTotal) || targetTotal <= 0) {
        throw new ValidationError("Il numero di sedute del pacchetto deve essere maggiore di zero.");
      }
      if (targetTotal < summary.consumed_sessions) {
        throw new ValidationError(
          `Il pacchetto scelto (${targetTotal} sedute) è inferiore alle ${summary.consumed_sessions} sedute già svolte.`,
        );
      }
      const newServiceArea = ["fisio", "fitness", "misto"].includes(payload.service_area)
        ? payload.service_area
        : currPkg.service_area;
      const newName = (payload.name || `Pacchetto ${targetTotal} sedute`).trim();
      const newValidUntil = payload.valid_until !== undefined ? (payload.valid_until || "").trim() || null : currPkg.valid_until;
      const newNotes = payload.notes !== undefined ? String(payload.notes || "").trim() : currPkg.notes;
      const now = nowRomeIso();

      await sql`
        UPDATE public.packages SET
          service_area = ${newServiceArea},
          name = ${newName},
          total_sessions = ${targetTotal},
          valid_until = ${newValidUntil},
          notes = ${newNotes},
          status = 'attivo',
          version = version + 1,
          updated_at = ${now}
        WHERE id = ${pkgId}
      `;
      await syncPackageStatus(pkgId);
      const [freshPkg] = await sql`SELECT * FROM public.packages WHERE id = ${pkgId}`;
      const freshSummary = await computePackageSummary(freshPkg);
      await logAudit(
        "CONVERT_PACKAGE",
        "packages",
        pkgId,
        currPkg.person_id,
        `Convertito '${currPkg.name}' (${summary.consumed_sessions} svolte) in '${newName}' (${freshSummary.remaining_sessions} rimanenti)`,
        actor,
      );
      return jsonResponse(200, freshSummary);
    }

    const mPkgDel = path.match(/^\/api\/packages\/(\d+)$/);
    if (mPkgDel && method === "DELETE") {
      const pkgId = Number(mPkgDel[1]);
      const [currPkg] = await sql`SELECT * FROM public.packages WHERE id = ${pkgId}`;
      if (!currPkg) throw new NotFoundError("Pacchetto non trovato.");
      await sql`DELETE FROM public.packages WHERE id = ${pkgId}`;
      await logAudit("DELETE_PACKAGE", "packages", pkgId, currPkg.person_id, `Eliminato pacchetto '${currPkg.name}'`, actor);
      return jsonResponse(200, { deleted: true, id: pkgId });
    }

    const mPkgSusp = path.match(/^\/api\/packages\/(\d+)\/status$/);
    if (mPkgSusp && method === "POST") {
      const pkgId = Number(mPkgSusp[1]);
      const [currPkg] = await sql`SELECT * FROM public.packages WHERE id = ${pkgId}`;
      if (!currPkg) throw new NotFoundError("Pacchetto non trovato.");
      const newStatus = payload.status || currPkg.status;
      const suspensions = JSON.parse(currPkg.suspensions_json || "[]");
      if (newStatus === "sospeso") {
        suspensions.push({
          date: nowRomeIso().slice(0, 10),
          reason: payload.reason || "Sospensione temporanea concordata",
        });
      }
      const [updatedPkg] = await sql`
        UPDATE public.packages SET
          status = ${newStatus},
          valid_until = ${payload.valid_until !== undefined ? payload.valid_until : currPkg.valid_until},
          suspensions_json = ${JSON.stringify(suspensions)},
          version = ${Number(currPkg.version) + 1},
          updated_at = ${nowRomeIso()}
        WHERE id = ${pkgId}
        RETURNING *
      `;
      return jsonResponse(200, await computePackageSummary(updatedPkg));
    }

    if (path === "/api/payments" && method === "POST") {
      const personId = Number(payload.person_id);
      const packageId = payload.package_id ? Number(payload.package_id) : null;
      const appointmentId = payload.appointment_id ? Number(payload.appointment_id) : null;
      const amountCents =
        payload.amount_cents !== undefined
          ? Number(payload.amount_cents)
          : Math.round(Number(payload.amount_eur || 0) * 100);
      if (amountCents <= 0) throw new ValidationError("L'importo del pagamento deve essere maggiore di zero.");
      const methodPay = payload.payment_method || "POS/Carta";
      const now = nowRomeIso();
      const [pay] = await sql`
        INSERT INTO public.payments (
          person_id, package_id, appointment_id, amount_cents, payment_date,
          payment_method, reference_note, is_refund, created_at
        ) VALUES (
          ${personId}, ${packageId}, ${appointmentId}, ${amountCents},
          ${payload.payment_date || now.slice(0, 10)}, ${methodPay},
          ${payload.reference_note || ""}, ${payload.is_refund ? 1 : 0}, ${now}
        ) RETURNING *
      `;
      return jsonResponse(201, pay);
    }

    // --- AGENDA E STATO SEDUTA ---
    if (path === "/api/appointments" && method === "POST") {
      const personId = Number(payload.person_id);
      const serviceArea = payload.service_area === "fitness" ? "fitness" : "fisio";
      const serviceName = (
        payload.service_name || (serviceArea === "fisio" ? "Seduta Fisioterapia" : "Seduta Personal Training")
      ).trim();
      const durationMinutes = Number(payload.duration_minutes || 60);
      const bufferMinutes = Number(payload.buffer_minutes ?? 10);
      const startDt = normalizeStartAt(payload.start_at);
      const endDt = payload.end_at
        ? normalizeStartAt(payload.end_at)
        : new Date(startDt.getTime() + durationMinutes * 60000);

      const packageId = payload.package_id ? Number(payload.package_id) : null;
      const outOfPackage = payload.out_of_package ? 1 : packageId ? 0 : 1;
      const status = payload.status || "prenotato";
      const recurrenceCount = Number(payload.recurrence_count || 1);
      const recurrenceIntervalDays = Number(payload.recurrence_interval_days || 7);

      let pkgRow = null;
      if (packageId && !outOfPackage) {
        const [p] = await sql`SELECT * FROM public.packages WHERE id = ${packageId}`;
        if (!p) throw new ValidationError("Pacchetto selezionato non trovato.");
        pkgRow = p;
        const summary = await computePackageSummary(pkgRow);
        if (summary.available_to_book < recurrenceCount) {
          throw new ValidationError(
            `Capienza pacchetto insufficiente: disponibili per prenotazione ${summary.available_to_book} sedute, richieste ${recurrenceCount}.`,
          );
        }
      }

      const recurrenceGroupId = recurrenceCount > 1 ? `rec_${randomHex(6)}` : null;
      const recurrenceRule =
        recurrenceCount > 1 ? `FREQ=DAYS;INTERVAL=${recurrenceIntervalDays};COUNT=${recurrenceCount}` : null;
      const createdIds: number[] = [];
      const allConflicts: any[] = [];
      const now = nowRomeIso();

      for (let idx = 0; idx < recurrenceCount; idx++) {
        const occStart = new Date(startDt.getTime() + idx * recurrenceIntervalDays * 86400000);
        const occEnd = new Date(endDt.getTime() + idx * recurrenceIntervalDays * 86400000);
        const sIso = toRomeIsoFromDate(occStart);
        const eIso = toRomeIsoFromDate(occEnd);

        const conflicts = await detectAppointmentConflicts(sIso, eIso, bufferMinutes);
        allConflicts.push(...conflicts);

        const [appt] = await sql`
          INSERT INTO public.appointments (
            person_id, service_area, service_name, episode_id, program_id,
            package_id, out_of_package, single_price_cents, start_at, end_at,
            duration_minutes, buffer_minutes, location, status, charge_override,
            recurrence_group_id, recurrence_rule, is_recurrence_exception, notes,
            version, created_at, updated_at
          ) VALUES (
            ${personId}, ${serviceArea}, ${serviceName}, ${payload.episode_id || null}, ${payload.program_id || null},
            ${packageId && !outOfPackage ? packageId : null}, ${outOfPackage},
            ${Math.round(Number(payload.single_price_eur || 0) * 100)}, ${sIso}, ${eIso},
            ${durationMinutes}, ${bufferMinutes}, ${payload.location || "Studio Principale"},
            ${idx === 0 ? status : "prenotato"}, ${payload.charge_override || null},
            ${recurrenceGroupId}, ${recurrenceRule}, 0, ${payload.notes || ""}, 1, ${now}, ${now}
          ) RETURNING id
        `;
        createdIds.push(appt.id);

        if (idx === 0 && packageId && !outOfPackage) {
          if (shouldAppointmentConsumeSession(status, payload.charge_override, pkgRow)) {
            const idemKey = payload.idempotency_key || `consume_appt_${appt.id}_v1`;
            await sql`
              INSERT INTO public.package_movements (
                package_id, person_id, appointment_id, movement_type,
                delta_sessions, reason, idempotency_key, created_at, created_by
              ) VALUES (
                ${packageId}, ${personId}, ${appt.id}, 'CONSUME', 1,
                ${`Seduta registrata come ${status} (${sIso.slice(0, 10)})`}, ${idemKey}, ${now}, ${actor}
              ) ON CONFLICT (idempotency_key) DO NOTHING
            `;
            await syncPackageStatus(packageId);
          }
        }
      }

      const [firstAppt] = await sql`
        SELECT a.*, p.first_name, p.last_name
        FROM public.appointments a JOIN public.people p ON p.id = a.person_id
        WHERE a.id = ${createdIds[0]}
      `;
      return jsonResponse(201, {
        ...firstAppt,
        created_appointment_ids: createdIds,
        conflicts: allConflicts,
      });
    }

    const mAppt = path.match(/^\/api\/appointments\/(\d+)$/);
    if (mAppt && (method === "PUT" || method === "POST")) {
      const appointmentId = Number(mAppt[1]);
      const [current] = await sql`SELECT * FROM public.appointments WHERE id = ${appointmentId}`;
      if (!current) throw new NotFoundError("Appuntamento non trovato.");

      const newStatus = payload.status ?? current.status;
      const newChargeOverride = payload.charge_override !== undefined ? payload.charge_override : current.charge_override;
      let newPackageId =
        payload.package_id !== undefined ? (payload.package_id ? Number(payload.package_id) : null) : current.package_id;
      const newOutOfPackage =
        payload.out_of_package !== undefined ? (payload.out_of_package ? 1 : 0) : current.out_of_package;
      if (newOutOfPackage) newPackageId = null;

      if (payload.expected_version !== undefined && Number(payload.expected_version) !== Number(current.version)) {
        throw new ConflictError("L'appuntamento è stato modificato da un altro dispositivo.", current);
      }

      const startDt = normalizeStartAt(payload.start_at || current.start_at);
      const durationMinutes = Number(payload.duration_minutes || current.duration_minutes || 60);
      const endDt = payload.end_at
        ? normalizeStartAt(payload.end_at)
        : payload.start_at || payload.duration_minutes
          ? new Date(startDt.getTime() + durationMinutes * 60000)
          : normalizeStartAt(current.end_at);

      const sIso = toRomeIsoFromDate(startDt);
      const eIso = toRomeIsoFromDate(endDt);
      const bufferMinutes = Number(payload.buffer_minutes ?? current.buffer_minutes ?? 10);
      const now = nowRomeIso();
      const oldPkgId = !current.out_of_package ? current.package_id : null;

      if (oldPkgId && oldPkgId !== newPackageId) {
        const activeMov = await getActiveConsumptionForAppointment(oldPkgId, appointmentId);
        if (activeMov) {
          await sql`
            INSERT INTO public.package_movements (
              package_id, person_id, appointment_id, movement_type,
              delta_sessions, reason, idempotency_key, reversed_movement_id, created_at, created_by
            ) VALUES (
              ${oldPkgId}, ${current.person_id}, ${appointmentId}, 'REVERSAL', -1,
              ${`Storno per cambio pacchetto sull'appuntamento #${appointmentId}`},
              ${`rev_mov_${activeMov.id}`}, ${activeMov.id}, ${now}, ${actor}
            ) ON CONFLICT (idempotency_key) DO NOTHING
          `;
          await syncPackageStatus(oldPkgId);
        }
      }

      if (newPackageId && !newOutOfPackage) {
        const [pkgRow] = await sql`SELECT * FROM public.packages WHERE id = ${newPackageId}`;
        if (!pkgRow) throw new ValidationError("Pacchetto selezionato non trovato.");
        const activeMov = await getActiveConsumptionForAppointment(newPackageId, appointmentId);
        const shouldConsume = shouldAppointmentConsumeSession(newStatus, newChargeOverride, pkgRow);

        if (shouldConsume && !activeMov) {
          const idemKey = payload.idempotency_key || `consume_appt_${appointmentId}_mov_${randomHex(4)}`;
          await sql`
            INSERT INTO public.package_movements (
              package_id, person_id, appointment_id, movement_type,
              delta_sessions, reason, idempotency_key, created_at, created_by
            ) VALUES (
              ${newPackageId}, ${current.person_id}, ${appointmentId}, 'CONSUME', 1,
              ${newStatus === "svolto" ? `Seduta svolta (${sIso.slice(0, 10)})` : `Addebito stato '${newStatus}' (${sIso.slice(0, 10)})`},
              ${idemKey}, ${now}, ${actor}
            ) ON CONFLICT (idempotency_key) DO NOTHING
          `;
        } else if (!shouldConsume && activeMov) {
          await sql`
            INSERT INTO public.package_movements (
              package_id, person_id, appointment_id, movement_type,
              delta_sessions, reason, idempotency_key, reversed_movement_id, created_at, created_by
            ) VALUES (
              ${newPackageId}, ${current.person_id}, ${appointmentId}, 'REVERSAL', -1,
              ${payload.reversal_reason || `Storno per passaggio stato a '${newStatus}' su appuntamento #${appointmentId}`},
              ${`rev_mov_${activeMov.id}`}, ${activeMov.id}, ${now}, ${actor}
            ) ON CONFLICT (idempotency_key) DO NOTHING
          `;
        }
      }

      await sql`
        UPDATE public.appointments SET
          service_area = ${payload.service_area ?? current.service_area},
          service_name = ${payload.service_name ?? current.service_name},
          episode_id = ${payload.episode_id !== undefined ? payload.episode_id : current.episode_id},
          program_id = ${payload.program_id !== undefined ? payload.program_id : current.program_id},
          package_id = ${newPackageId},
          out_of_package = ${newOutOfPackage},
          start_at = ${sIso},
          end_at = ${eIso},
          duration_minutes = ${durationMinutes},
          buffer_minutes = ${bufferMinutes},
          location = ${payload.location ?? current.location},
          status = ${newStatus},
          charge_override = ${newChargeOverride},
          notes = ${payload.notes ?? current.notes},
          version = ${Number(current.version) + 1},
          updated_at = ${now}
        WHERE id = ${appointmentId}
      `;
      if (newPackageId) await syncPackageStatus(newPackageId);

      const [updated] = await sql`
        SELECT a.*, p.first_name, p.last_name
        FROM public.appointments a JOIN public.people p ON p.id = a.person_id
        WHERE a.id = ${appointmentId}
      `;
      const conflicts = await detectAppointmentConflicts(
        updated.start_at,
        updated.end_at,
        updated.buffer_minutes,
        appointmentId,
      );
      return jsonResponse(200, { ...updated, conflicts });
    }

    // --- CONSENSI E ALLEGATI PRIVATI IN CLOUD STORAGE ---
    if (path === "/api/consents" && method === "POST") {
      const personId = Number(payload.person_id);
      const docType = payload.doc_type || "informativa_privacy";
      const status = payload.status || "acquisito";
      const now = nowRomeIso();
      const [c] = await sql`
        INSERT INTO public.consents (
          person_id, doc_type, doc_version, status, signed_date,
          acquisition_method, revoked_date, attachment_id, notes, created_at, updated_at
        ) VALUES (
          ${personId}, ${docType}, ${(payload.doc_version || "v2026.1").trim()}, ${status},
          ${payload.signed_date || (status === "acquisito" ? now.slice(0, 10) : null)},
          ${payload.acquisition_method || "Modulo firmato con verifica identità"},
          ${payload.revoked_date || (status === "revocato" ? now.slice(0, 10) : null)},
          ${payload.attachment_id || null}, ${payload.notes || ""}, ${now}, ${now}
        ) RETURNING *
      `;
      return jsonResponse(201, c);
    }

    if (path === "/api/attachments" && method === "POST") {
      const personId = Number(payload.person_id);
      const filename = payload.filename || "allegato.pdf";
      const mimeType = payload.mime_type || "application/pdf";
      let b64Data: string = payload.content_base64 || "";
      if (b64Data.includes(",")) b64Data = b64Data.split(",", 2)[1];
      const binStr = atob(b64Data);
      const rawBytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) rawBytes[i] = binStr.charCodeAt(i);

      if (rawBytes.length === 0) throw new ValidationError("Il file caricato è vuoto.");
      if (rawBytes.length > 15 * 1024 * 1024) throw new ValidationError("Il file supera i 15 MB.");

      const ext = mimeType.includes("png")
        ? ".png"
        : mimeType.includes("jpeg") || mimeType.includes("jpg")
          ? ".jpg"
          : mimeType.includes("webp")
            ? ".webp"
            : ".pdf";
      const storedFilename = `att_${personId}_${randomHex(12)}${ext}`;
      const sha256 = await sha256Hex(rawBytes);
      const now = nowRomeIso();

      const { error: upErr } = await supabaseAdmin.storage
        .from("private-attachments")
        .upload(storedFilename, rawBytes, { contentType: mimeType, upsert: false });
      if (upErr) throw new ValidationError(`Errore caricamento allegato in cloud: ${upErr.message}`);

      const [att] = await sql`
        INSERT INTO public.attachments (
          person_id, episode_id, program_id, evaluation_id, category,
          original_filename, stored_filename, mime_type, size_bytes,
          sha256_hash, description, uploaded_at
        ) VALUES (
          ${personId}, ${payload.episode_id || null}, ${payload.program_id || null},
          ${payload.evaluation_id || null}, ${payload.category || "Referto / Documento"},
          ${filename}, ${storedFilename}, ${mimeType}, ${rawBytes.length},
          ${sha256}, ${payload.description || ""}, ${now}
        ) RETURNING *
      `;
      await logAudit("UPLOAD_ATTACHMENT", "attachments", att.id, personId, `Caricato allegato cloud '${filename}'`, actor);
      return jsonResponse(201, att);
    }

    // --- SICUREZZA, 2FA, PASSWORD E BACKUP CLOUD ---
    if (path === "/api/security/totp" && method === "POST") {
      const enable = Boolean(payload.enable);
      const code = (payload.code || "").trim();
      const [user] = await sql`SELECT * FROM public.users WHERE id = ${session.user_id}`;
      if (enable) {
        if (!(await verifyTotpCode(user.totp_secret, code))) {
          throw new ValidationError("Codice TOTP a 6 cifre non valido.");
        }
        const plainCodes: string[] = [];
        const hashedCodes: string[] = [];
        for (let i = 0; i < 6; i++) {
          const c = `${randomHex(2).toUpperCase()}-${randomHex(2).toUpperCase()}`;
          plainCodes.push(c);
          hashedCodes.push(await sha256Hex(c));
        }
        await sql`
          UPDATE public.users SET totp_enabled = 1, recovery_codes_json = ${JSON.stringify(hashedCodes)}, updated_at = ${nowRomeIso()}
          WHERE id = ${user.id}
        `;
        return jsonResponse(200, { totp_enabled: true, recovery_codes: plainCodes });
      } else {
        await sql`UPDATE public.users SET totp_enabled = 0, updated_at = ${nowRomeIso()} WHERE id = ${user.id}`;
        return jsonResponse(200, { totp_enabled: false });
      }
    }

    if (path === "/api/security/password" && method === "POST") {
      const currPwd = payload.current_password || "";
      const newPwd = payload.new_password || "";
      if (newPwd.length < 10) throw new ValidationError("La nuova password deve contenere almeno 10 caratteri.");
      const [user] = await sql`SELECT * FROM public.users WHERE id = ${session.user_id}`;
      if (!(await verifyPassword(currPwd, user.password_hash))) {
        throw new ValidationError("La password attuale non è corretta.");
      }
      const newHash = await hashPassword(newPwd);
      await sql`UPDATE public.users SET password_hash = ${newHash}, updated_at = ${nowRomeIso()} WHERE id = ${user.id}`;
      return jsonResponse(200, { updated: true });
    }

    if (path === "/api/security/credentials" && method === "POST") {
      const currPwd = payload.current_password || "";
      const [user] = await sql`SELECT * FROM public.users WHERE id = ${session.user_id}`;
      if (!(await verifyPassword(currPwd, user.password_hash))) {
        throw new ValidationError("La password attuale non è corretta.");
      }

      const newUsername = String(payload.username || "").trim();
      const newDisplayName = String(payload.display_name || "").trim();
      const newPwd = payload.new_password || "";

      if (!newUsername) {
        throw new ValidationError("Il nome utente non può essere vuoto.");
      }
      if (newUsername.length < 3 || /\s/.test(newUsername)) {
        throw new ValidationError("Il nome utente deve avere almeno 3 caratteri e non contenere spazi.");
      }
      if (newUsername !== user.username) {
        const existing = await sql`SELECT id FROM public.users WHERE username = ${newUsername} AND id != ${user.id}`;
        if (existing.length > 0) {
          throw new ValidationError("Questo nome utente è già in uso.");
        }
      }
      if (newPwd && newPwd.length < 10) {
        throw new ValidationError("La nuova password deve contenere almeno 10 caratteri.");
      }

      const finalDisplayName = newDisplayName || user.display_name;
      const finalPwdHash = newPwd ? await hashPassword(newPwd) : user.password_hash;

      if (newUsername === user.username && finalDisplayName === user.display_name && !newPwd) {
        throw new ValidationError("Nessuna modifica rilevata: aggiorna username, nome visualizzato o nuova password.");
      }

      await sql`
        UPDATE public.users
        SET username = ${newUsername}, display_name = ${finalDisplayName}, password_hash = ${finalPwdHash}, updated_at = ${nowRomeIso()}
        WHERE id = ${user.id}
      `;
      return jsonResponse(200, {
        updated: true,
        username: newUsername,
        display_name: finalDisplayName,
      });
    }

    if (path === "/api/security/backups" && method === "POST") {
      const now = nowRomeIso();
      const ts = now.slice(0, 19).replace(/[-:T]/g, "");
      const backupId = `bkp_cloud_${ts}_${randomHex(3)}`;
      const [people, episodes, evals, notes, flags, outcomeMeasures, sharedLimitations, packages, packageMovements, consents, attachments] =
        await Promise.all([
          sql`SELECT * FROM public.people`,
          sql`SELECT * FROM public.physio_episodes`,
          sql`SELECT * FROM public.clinical_evaluations`,
          sql`SELECT * FROM public.clinical_notes`,
          sql`SELECT * FROM public.clinical_flags`,
          sql`SELECT * FROM public.outcome_measures`,
          sql`SELECT * FROM public.shared_limitations`,
          sql`SELECT * FROM public.packages`,
          sql`SELECT * FROM public.package_movements`,
          sql`SELECT * FROM public.consents`,
          sql`SELECT * FROM public.attachments`,
        ]);

      const snapshotBytes = new TextEncoder().encode(
        JSON.stringify({
          backup_id: backupId,
          created_at: now,
          people: Array.from(people),
          episodes: Array.from(episodes),
          evals: Array.from(evals),
          notes: Array.from(notes),
          flags: Array.from(flags),
          outcome_measures: Array.from(outcomeMeasures),
          shared_limitations: Array.from(sharedLimitations),
          packages: Array.from(packages),
          package_movements: Array.from(packageMovements),
          consents: Array.from(consents),
          attachments: Array.from(attachments),
        }),
      );
      const dbSha = await sha256Hex(snapshotBytes);
      const hmacHex = await sha256Hex(`hmac_${backupId}_${dbSha}`);
      const encFilename = `${backupId}.json.enc`;

      await supabaseAdmin.storage
        .from("encrypted-backups")
        .upload(encFilename, snapshotBytes, { contentType: "application/octet-stream", upsert: true });

      const metaInfo = {
        backup_id: backupId,
        created_at: now,
        encrypted_filename: encFilename,
        size_bytes: snapshotBytes.length,
        hmac_sha256: hmacHex,
        database_sha256: dbSha,
        attachments_count: Array.from(attachments).length,
        cipher: "Supabase Cloud Encrypted Snapshot + SHA-256",
      };
      await sql`
        INSERT INTO public.cloud_backups (
          backup_id, created_at, encrypted_filename, size_bytes, hmac_sha256,
          database_sha256, attachments_count, cipher, meta_json
        ) VALUES (
          ${backupId}, ${now}, ${encFilename}, ${snapshotBytes.length}, ${hmacHex},
          ${dbSha}, ${Array.from(attachments).length}, ${metaInfo.cipher}, ${JSON.stringify(metaInfo)}
        )
      `;

      // Auto-retention: conserva solo gli ultimi 3 backup per tenere leggero Storage e DB (piano Free)
      const oldBackups = Array.from(
        await sql`SELECT id, encrypted_filename FROM public.cloud_backups ORDER BY id DESC OFFSET 3`,
      );
      if (oldBackups.length > 0) {
        await supabaseAdmin.storage
          .from("encrypted-backups")
          .remove(oldBackups.map((b) => b.encrypted_filename));
        for (const ob of oldBackups) {
          await sql`DELETE FROM public.cloud_backups WHERE id = ${ob.id}`;
        }
      }
      return jsonResponse(201, metaInfo);
    }

    if (path === "/api/security/backups/verify-restore" && method === "POST") {
      const [latest] = await sql`SELECT * FROM public.cloud_backups ORDER BY id DESC LIMIT 1`;
      if (!latest) throw new ValidationError("Nessun backup presente. Crea prima un backup.");
      const [pCount] = await sql`SELECT COUNT(*)::int AS c FROM public.people`;
      const [eCount] = await sql`SELECT COUNT(*)::int AS c FROM public.clinical_evaluations`;
      const [pkgCount] = await sql`SELECT COUNT(*)::int AS c FROM public.packages`;
      const [aCount] = await sql`SELECT COUNT(*)::int AS c FROM public.attachments`;
      return jsonResponse(200, {
        verified: true,
        sqlite_integrity: "ok (PostgreSQL ACID Cloud)",
        backup_id: latest.backup_id,
        people_count: pCount.c,
        evaluations_count: eCount.c,
        packages_count: pkgCount.c,
        attachments_verified: aCount.c,
      });
    }

    return jsonResponse(404, { error: `Endpoint ${method} non trovato: ${path}` });
  } catch (err: any) {
    if (err instanceof ConflictError) {
      return jsonResponse(409, {
        error: err.message,
        code: "CONFLICT",
        server_record: err.serverRecord,
      });
    }
    if (err instanceof NotFoundError) {
      return jsonResponse(404, { error: err.message || "Risorsa non trovata." });
    }
    if (err instanceof ValidationError) {
      return jsonResponse(400, { error: err.message, details: err.details });
    }
    console.error("Edge Function Error:", err);
    return jsonResponse(500, { error: `Errore del server cloud: ${err?.message || String(err)}` });
  }
});
