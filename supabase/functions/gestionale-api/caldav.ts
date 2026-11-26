// ============================================================================
// Apple iCloud CalDAV Client (Sola Lettura) + Parser ICS / RRULE + AES-256-GCM
// Zero dati calendario salvati su Postgres: specchio live del calendario Apple.
// ============================================================================

const ROME_TZ = "Europe/Rome";

export interface CalendarInfo {
  url: string;
  name: string;
  color: string;
}

export interface MirrorEvent {
  uid: string;
  summary: string;
  date: string; // YYYY-MM-DD (Europe/Rome)
  start_time: string; // HH:MM (vuoto se all_day)
  end_time: string; // HH:MM (vuoto se all_day)
  all_day: boolean;
  location: string;
  notes: string;
}

export interface StoredAppleCaldavConfig {
  apple_id: string;
  password_enc: string;
  calendar_url: string;
  calendar_name: string;
  calendar_color?: string;
  updated_at?: string;
}

export function sanitizeUserSettings(raw: string | Record<string, any> | null | undefined): Record<string, any> {
  let obj: Record<string, any> = {};
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw || "{}") || {};
    } catch {
      obj = {};
    }
  } else if (raw && typeof raw === "object") {
    obj = { ...raw };
  }
  if (obj.apple_caldav && typeof obj.apple_caldav === "object") {
    const c = obj.apple_caldav;
    obj.apple_caldav = {
      configured: Boolean(c.apple_id && c.password_enc && c.calendar_url),
      apple_id: c.apple_id || "",
      calendar_name: c.calendar_name || "",
      calendar_color: c.calendar_color || "#1e4976",
    };
  }
  return obj;
}

// ============================================================================
// AES-256-GCM per cifratura Password Specifica per App (chiave solo server)
// ============================================================================

async function deriveAesKey(seed: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gestionale_caldav_v1:${seed}`));
  return await crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSecret(plaintext: string, seed: string): Promise<string> {
  const key = await deriveAesKey(seed);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded));
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(cipher)}`;
}

export async function decryptSecret(encoded: string, seed: string): Promise<string> {
  const parts = String(encoded || "").split(":");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Formato credenziali cifrate non valido.");
  }
  const key = await deriveAesKey(seed);
  const iv = base64ToBytes(parts[1]);
  const cipher = base64ToBytes(parts[2]);
  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plainBuf);
}

// ============================================================================
// CalDAV HTTP Helper (protezione SSRF *.icloud.com + redirect con Basic Auth)
// ============================================================================

export function assertAllowedIcloudUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL calendario iCloud non valido.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Solo connessioni HTTPS verso iCloud sono consentite.");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "caldav.icloud.com" && !host.endsWith(".icloud.com")) {
    throw new Error(`Host non consentito per CalDAV Apple: ${host}`);
  }
  return parsed;
}

function makeBasicAuth(appleId: string, appPassword: string): string {
  const raw = `${appleId.trim()}:${appPassword.trim()}`;
  const bytes = new TextEncoder().encode(raw);
  return `Basic ${bytesToBase64(bytes)}`;
}

async function caldavFetch(
  url: string,
  method: "PROPFIND" | "REPORT",
  depth: "0" | "1",
  xmlBody: string,
  authHeader: string,
): Promise<{ status: number; text: string; finalUrl: string }> {
  let currentUrl = assertAllowedIcloudUrl(url).toString();
  for (let hop = 0; hop < 6; hop++) {
    const resp = await fetch(currentUrl, {
      method,
      headers: {
        Authorization: authHeader,
        Depth: depth,
        "Content-Type": "application/xml; charset=utf-8",
        Accept: "application/xml, text/xml, */*",
        "User-Agent": "GestionaleRCV/1.0",
      },
      body: xmlBody,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });

    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, currentUrl);
      currentUrl = assertAllowedIcloudUrl(next.toString()).toString();
      // Consuma il body per evitare leak di risorse in Deno
      try {
        await resp.text();
      } catch {
        // ignore
      }
      continue;
    }

    const text = await resp.text();
    return { status: resp.status, text, finalUrl: currentUrl };
  }
  throw new Error("Troppi redirect nella risposta di Apple iCloud.");
}

// ============================================================================
// XML Helpers (namespace-agnostic per risposte DAV / Apple CalDAV)
// ============================================================================

function unescapeXml(str: string): string {
  return String(str || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function matchTagInner(xml: string, localName: string): string | null {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localName}>`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function matchAllTagInners(xml: string, localName: string): string[] {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localName}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function normalizeAppleColor(raw: string | null): string {
  const cleaned = unescapeXml(raw || "").trim();
  if (/^#[0-9a-fA-F]{8}$/.test(cleaned)) return cleaned.slice(0, 7);
  if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) return cleaned;
  return "#1e4976";
}

// ============================================================================
// 1. Discovery Calendari iCloud (PROPFIND 3-step, eseguito solo in setup)
// ============================================================================

export async function discoverIcloudCalendars(appleId: string, appPassword: string): Promise<CalendarInfo[]> {
  if (!appleId.trim() || !appPassword.trim()) {
    throw new Error("Inserisci Apple ID e Password specifica per app.");
  }
  const auth = makeBasicAuth(appleId, appPassword);

  // Step 1: current-user-principal
  const principalXml = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>`;
  const r1 = await caldavFetch("https://caldav.icloud.com/", "PROPFIND", "0", principalXml, auth);
  if (r1.status === 401 || r1.status === 403) {
    throw new Error(
      "Credenziali Apple non valide. Verifica l'email Apple ID e usa una Password specifica per app generata su account.apple.com (non la password principale).",
    );
  }
  if (r1.status < 200 || r1.status >= 300) {
    throw new Error(`Risposta inattesa da Apple iCloud (HTTP ${r1.status}).`);
  }
  const principalBlock = matchTagInner(r1.text, "current-user-principal") || r1.text;
  const principalHref = unescapeXml(matchTagInner(principalBlock, "href") || "").trim();
  if (!principalHref) {
    throw new Error("Impossibile individuare il profilo CalDAV iCloud.");
  }
  const principalUrl = new URL(principalHref, r1.finalUrl).toString();

  // Step 2: calendar-home-set
  const homeXml = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><c:calendar-home-set/></d:prop>
</d:propfind>`;
  const r2 = await caldavFetch(principalUrl, "PROPFIND", "0", homeXml, auth);
  if (r2.status < 200 || r2.status >= 300) {
    throw new Error(`Errore lettura calendar-home-set iCloud (HTTP ${r2.status}).`);
  }
  const homeBlock = matchTagInner(r2.text, "calendar-home-set") || r2.text;
  const homeHref = unescapeXml(matchTagInner(homeBlock, "href") || "").trim();
  if (!homeHref) {
    throw new Error("Impossibile individuare la cartella calendari iCloud.");
  }
  const homeUrl = new URL(homeHref, r2.finalUrl).toString();

  // Step 3: lista calendari con Depth: 1
  const listXml = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <c:supported-calendar-component-set/>
    <a:calendar-color/>
  </d:prop>
</d:propfind>`;
  const r3 = await caldavFetch(homeUrl, "PROPFIND", "1", listXml, auth);
  if (r3.status < 200 || r3.status >= 300) {
    throw new Error(`Errore lettura elenco calendari iCloud (HTTP ${r3.status}).`);
  }

  const responses = matchAllTagInners(r3.text, "response");
  const calendars: CalendarInfo[] = [];
  const homeNorm = homeUrl.replace(/\/+$/, "");

  for (const respXml of responses) {
    const hrefRaw = unescapeXml(matchTagInner(respXml, "href") || "").trim();
    if (!hrefRaw) continue;
    const fullUrl = new URL(hrefRaw, r3.finalUrl).toString();
    if (fullUrl.replace(/\/+$/, "") === homeNorm) continue;

    const rt = matchTagInner(respXml, "resourcetype") || "";
    const isCalendar = /<(?:[a-zA-Z0-9_-]+:)?calendar(?:\s|\/|>)/i.test(rt);
    const isSpecial = /schedule-(?:inbox|outbox)|notifications/i.test(rt);
    if (!isCalendar || isSpecial) continue;

    // Esclude le liste Promemoria (solo VTODO senza VEVENT)
    const compSet = matchTagInner(respXml, "supported-calendar-component-set");
    if (compSet && !/name=["']VEVENT["']/i.test(compSet)) continue;

    const name = unescapeXml(matchTagInner(respXml, "displayname") || "").trim();
    if (!name) continue;

    const color = normalizeAppleColor(matchTagInner(respXml, "calendar-color"));
    calendars.push({ url: fullUrl, name, color });
  }

  calendars.sort((a, b) => a.name.localeCompare(b.name, "it"));
  return calendars;
}

// ============================================================================
// 2. Date / Timezone Europe/Rome & Parser ICS + RRULE (RFC 5545)
// ============================================================================

const romePartsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function getTzParts(utcMs: number, timeZone: string): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const fmt =
    timeZone === ROME_TZ
      ? romePartsFmt
      : new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        });
  const parts = fmt.formatToParts(new Date(utcMs));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return {
    y: map.year,
    m: map.month,
    d: map.day,
    hh: map.hour === 24 ? 0 : map.hour,
    mm: map.minute,
    ss: map.second,
  };
}

function wallClockToUtcMs(y: number, m: number, d: number, hh: number, mm: number, ss: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let tz = ROME_TZ;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(guess));
    tz = timeZone;
  } catch {
    tz = ROME_TZ;
  }
  const actual = getTzParts(guess, tz);
  const actualAsUtc = Date.UTC(actual.y, actual.m - 1, actual.d, actual.hh, actual.mm, actual.ss);
  const diff1 = actualAsUtc - guess;
  const refined = guess - diff1;
  // Secondo passaggio per gestire i bordi esatti del cambio ora legale/solare
  const actual2 = getTzParts(refined, tz);
  const actual2AsUtc = Date.UTC(actual2.y, actual2.m - 1, actual2.d, actual2.hh, actual2.mm, actual2.ss);
  return refined - (actual2AsUtc - Date.UTC(y, m - 1, d, hh, mm, ss));
}

function formatYmd(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function dayOfWeekYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=SU..6=SA
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function unescapeIcsText(v: string): string {
  return String(v || "")
    .replace(/\\n|\\N/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

interface ParsedDt {
  allDay: boolean;
  ymd: string; // YYYY-MM-DD (nella timezone dell'evento se local, o Rome se UTC)
  hh: number;
  mm: number;
  ss: number;
  utcMs: number;
  tzid: string;
}

function parseIcsDateTime(rawVal: string, params: Record<string, string>): ParsedDt | null {
  const val = rawVal.trim();
  // All-day: YYYYMMDD
  const mDate = val.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (mDate || (params.VALUE || "").toUpperCase() === "DATE") {
    const mm = val.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!mm) return null;
    const y = Number(mm[1]), mo = Number(mm[2]), d = Number(mm[3]);
    return {
      allDay: true,
      ymd: formatYmd(y, mo, d),
      hh: 0,
      mm: 0,
      ss: 0,
      utcMs: Date.UTC(y, mo - 1, d, 0, 0, 0),
      tzid: ROME_TZ,
    };
  }
  // Timed: YYYYMMDDTHHMMSS(Z)?
  const mDt = val.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i);
  if (!mDt) return null;
  const y = Number(mDt[1]), mo = Number(mDt[2]), d = Number(mDt[3]);
  const hh = Number(mDt[4]), mi = Number(mDt[5]), ss = Number(mDt[6]);
  const isUtc = Boolean(mDt[7]);
  if (isUtc) {
    const utcMs = Date.UTC(y, mo - 1, d, hh, mi, ss);
    const rp = getTzParts(utcMs, ROME_TZ);
    return {
      allDay: false,
      ymd: formatYmd(rp.y, rp.m, rp.d),
      hh: rp.hh,
      mm: rp.mm,
      ss: rp.ss,
      utcMs,
      tzid: ROME_TZ,
    };
  }
  const rawTz = (params.TZID || ROME_TZ).replace(/^"|"$/g, "");
  const utcMs = wallClockToUtcMs(y, mo, d, hh, mi, ss, rawTz);
  const rp = getTzParts(utcMs, ROME_TZ);
  return {
    allDay: false,
    ymd: formatYmd(rp.y, rp.m, rp.d),
    hh: rp.hh,
    mm: rp.mm,
    ss: rp.ss,
    utcMs,
    tzid: rawTz,
  };
}

function parseIcsDurationMs(dur: string): number {
  const m = dur.trim().match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return 3600_000;
  const sign = m[1] === "-" ? -1 : 1;
  const weeks = Number(m[2] || 0);
  const days = Number(m[3] || 0);
  const hours = Number(m[4] || 0);
  const mins = Number(m[5] || 0);
  const secs = Number(m[6] || 0);
  return sign * (((weeks * 7 + days) * 86400) + hours * 3600 + mins * 60 + secs) * 1000;
}

interface RawVEvent {
  uid: string;
  summary: string;
  location: string;
  description: string;
  status: string;
  dtstart: ParsedDt | null;
  dtend: ParsedDt | null;
  durationMs: number | null;
  rrule: string;
  exdates: string[]; // YYYY-MM-DD in Europe/Rome
  recurrenceIdYmd: string | null;
}

function parseVEventsFromIcs(icsText: string): RawVEvent[] {
  // Unfold RFC 5545 folded lines
  const unfolded = icsText.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r\n|\n|\r/);

  const events: RawVEvent[] = [];
  let inEvent = false;
  let inAlarm = false;
  let cur: RawVEvent | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      inEvent = true;
      inAlarm = false;
      cur = {
        uid: "",
        summary: "",
        location: "",
        description: "",
        status: "",
        dtstart: null,
        dtend: null,
        durationMs: null,
        rrule: "",
        exdates: [],
        recurrenceIdYmd: null,
      };
      continue;
    }
    if (upper === "END:VEVENT") {
      if (inEvent && cur && cur.dtstart) {
        events.push(cur);
      }
      inEvent = false;
      inAlarm = false;
      cur = null;
      continue;
    }
    if (!inEvent || !cur) continue;
    if (upper === "BEGIN:VALARM") {
      inAlarm = true;
      continue;
    }
    if (upper === "END:VALARM") {
      inAlarm = false;
      continue;
    }
    if (inAlarm) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const left = line.slice(0, colonIdx);
    const val = line.slice(colonIdx + 1);
    const segs = left.split(";");
    const propName = segs[0].toUpperCase();
    const params: Record<string, string> = {};
    for (let i = 1; i < segs.length; i++) {
      const eq = segs[i].indexOf("=");
      if (eq !== -1) {
        params[segs[i].slice(0, eq).toUpperCase()] = segs[i].slice(eq + 1);
      }
    }

    switch (propName) {
      case "UID":
        cur.uid = val.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeIcsText(val).trim();
        break;
      case "LOCATION":
        cur.location = unescapeIcsText(val).trim();
        break;
      case "DESCRIPTION":
        cur.description = unescapeIcsText(val).trim();
        break;
      case "STATUS":
        cur.status = val.trim().toUpperCase();
        break;
      case "DTSTART":
        cur.dtstart = parseIcsDateTime(val, params);
        break;
      case "DTEND":
        cur.dtend = parseIcsDateTime(val, params);
        break;
      case "DURATION":
        cur.durationMs = parseIcsDurationMs(val);
        break;
      case "RRULE":
        cur.rrule = val.trim();
        break;
      case "RECURRENCE-ID": {
        const parsed = parseIcsDateTime(val, params);
        if (parsed) cur.recurrenceIdYmd = parsed.ymd;
        break;
      }
      case "EXDATE": {
        for (const piece of val.split(",")) {
          const parsed = parseIcsDateTime(piece, params);
          if (parsed) cur.exdates.push(parsed.ymd);
        }
        break;
      }
    }
  }
  return events;
}

const BYDAY_MAP: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function expandRruleDates(
  startYmd: string,
  rruleRaw: string,
  fromYmd: string,
  toYmd: string,
): string[] {
  const parts: Record<string, string> = {};
  for (const kv of rruleRaw.split(";")) {
    const eq = kv.indexOf("=");
    if (eq !== -1) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).toUpperCase();
  }
  const freq = parts.FREQ;
  if (!freq) return [startYmd];
  const interval = Math.max(1, Number(parts.INTERVAL || 1));
  const maxCount = parts.COUNT ? Math.max(1, Number(parts.COUNT)) : Infinity;
  let untilYmd = toYmd;
  if (parts.UNTIL) {
    const m = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) {
      const u = `${m[1]}-${m[2]}-${m[3]}`;
      if (u < untilYmd) untilYmd = u;
    }
  }
  if (untilYmd < startYmd) return [];

  const matched: string[] = [];
  let emittedTotal = 0;
  const pushCandidate = (ymd: string): boolean => {
    if (ymd < startYmd) return true;
    if (ymd > untilYmd) return false;
    emittedTotal += 1;
    if (emittedTotal > maxCount) return false;
    if (ymd >= fromYmd && ymd <= toYmd) {
      matched.push(ymd);
    }
    return emittedTotal < maxCount;
  };

  if (freq === "DAILY") {
    let cur = startYmd;
    for (let i = 0; i < 4000; i++) {
      if (!pushCandidate(cur)) break;
      cur = addDaysYmd(cur, interval);
    }
    return matched;
  }

  if (freq === "WEEKLY") {
    const byDays = parts.BYDAY
      ? parts.BYDAY.split(",")
          .map((s) => BYDAY_MAP[s.replace(/^[+-]?\d+/, "")])
          .filter((n) => n !== undefined)
      : [dayOfWeekYmd(startYmd)];
    const uniqueDays = Array.from(new Set(byDays));
    // Calcola il lunedì della settimana di startYmd
    const startDow = dayOfWeekYmd(startYmd);
    const offsetToMon = startDow === 0 ? -6 : 1 - startDow;
    let weekMon = addDaysYmd(startYmd, offsetToMon);
    // Ordine giorni Lun(1)..Sab(6), Dom(0)
    const orderedOffsets = uniqueDays
      .map((d) => (d === 0 ? 6 : d - 1))
      .sort((a, b) => a - b);

    for (let w = 0; w < 600; w++) {
      if (weekMon > untilYmd) break;
      let keepGoing = true;
      for (const off of orderedOffsets) {
        const cand = addDaysYmd(weekMon, off);
        if (!pushCandidate(cand)) {
          keepGoing = false;
          break;
        }
      }
      if (!keepGoing) break;
      weekMon = addDaysYmd(weekMon, 7 * interval);
    }
    return matched;
  }

  if (freq === "MONTHLY") {
    const [sy, sm, sd] = startYmd.split("-").map(Number);
    let totalMonths = sy * 12 + (sm - 1);
    const byDaySpec = parts.BYDAY ? parts.BYDAY.split(",")[0] : "";
    const byMonthDay = parts.BYMONTHDAY ? Number(parts.BYMONTHDAY.split(",")[0]) : sd;

    for (let i = 0; i < 360; i++) {
      const y = Math.floor(totalMonths / 12);
      const m = (totalMonths % 12) + 1;
      const dim = daysInMonth(y, m);
      let cand: string | null = null;

      if (byDaySpec) {
        const md = byDaySpec.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
        if (md) {
          const nth = md[1] ? Number(md[1]) : 1;
          const targetDow = BYDAY_MAP[md[2]];
          const hits: number[] = [];
          for (let day = 1; day <= dim; day++) {
            if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() === targetDow) hits.push(day);
          }
          const chosen = nth > 0 ? hits[nth - 1] : hits[hits.length + nth];
          if (chosen) cand = formatYmd(y, m, chosen);
        }
      } else {
        const day = byMonthDay > 0 ? byMonthDay : dim + 1 + byMonthDay;
        if (day >= 1 && day <= dim) cand = formatYmd(y, m, day);
      }

      if (cand) {
        if (!pushCandidate(cand)) break;
      }
      if (formatYmd(y, m, 1) > untilYmd) break;
      totalMonths += interval;
    }
    return matched;
  }

  if (freq === "YEARLY") {
    const [sy, sm, sd] = startYmd.split("-").map(Number);
    for (let i = 0; i < 80; i++) {
      const y = sy + i * interval;
      const dim = daysInMonth(y, sm);
      if (sd <= dim) {
        if (!pushCandidate(formatYmd(y, sm, sd))) break;
      }
      if (formatYmd(y, 1, 1) > untilYmd) break;
    }
    return matched;
  }

  return startYmd >= fromYmd && startYmd <= toYmd ? [startYmd] : [];
}

export function extractEventsFromIcsDocuments(icsDocs: string[], fromYmd: string, toYmd: string): MirrorEvent[] {
  const results: MirrorEvent[] = [];

  for (const doc of icsDocs) {
    const vevents = parseVEventsFromIcs(doc);
    // Raggruppa per UID per gestire eccezioni RECURRENCE-ID e EXDATE
    const byUid = new Map<string, RawVEvent[]>();
    for (const ev of vevents) {
      const key = ev.uid || `${ev.summary}_${ev.dtstart?.ymd}_${ev.dtstart?.hh}`;
      if (!byUid.has(key)) byUid.set(key, []);
      byUid.get(key)!.push(ev);
    }

    for (const group of byUid.values()) {
      const overrides = group.filter((e) => e.recurrenceIdYmd !== null);
      const masters = group.filter((e) => e.recurrenceIdYmd === null);
      const excludedDates = new Set<string>();
      for (const ov of overrides) {
        if (ov.recurrenceIdYmd) excludedDates.add(ov.recurrenceIdYmd);
      }

      const emitEvent = (ev: RawVEvent, occurrenceYmd: string) => {
        if (ev.status === "CANCELLED" || !ev.dtstart) return;
        const summary = ev.summary || "(Senza titolo)";

        if (ev.dtstart.allDay) {
          // Evento giornata intera (può estendersi su più giorni: DTEND è esclusivo in RFC 5545)
          const origStart = ev.dtstart.ymd;
          let spanDays = 1;
          if (ev.dtend && ev.dtend.ymd > origStart) {
            const [y1, m1, d1] = origStart.split("-").map(Number);
            const [y2, m2, d2] = ev.dtend.ymd.split("-").map(Number);
            spanDays = Math.max(1, Math.min(31, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400_000)));
          }
          for (let offset = 0; offset < spanDays; offset++) {
            const day = addDaysYmd(occurrenceYmd, offset);
            if (day >= fromYmd && day <= toYmd) {
              results.push({
                uid: `${ev.uid || "ev"}_${day}`,
                summary,
                date: day,
                start_time: "",
                end_time: "",
                all_day: true,
                location: ev.location,
                notes: ev.description.slice(0, 240),
              });
            }
          }
          return;
        }

        // Evento con orario
        const durMs =
          ev.dtend && ev.dtend.utcMs >= ev.dtstart.utcMs
            ? ev.dtend.utcMs - ev.dtstart.utcMs
            : ev.durationMs !== null
              ? Math.max(0, ev.durationMs)
              : 3600_000;
        const [oy, om, od] = occurrenceYmd.split("-").map(Number);
        const startUtcMs = wallClockToUtcMs(oy, om, od, ev.dtstart.hh, ev.dtstart.mm, ev.dtstart.ss, ROME_TZ);
        const endUtcMs = startUtcMs + durMs;
        const startRome = getTzParts(startUtcMs, ROME_TZ);
        const endRome = getTzParts(endUtcMs, ROME_TZ);
        const evDate = formatYmd(startRome.y, startRome.m, startRome.d);
        if (evDate < fromYmd || evDate > toYmd) return;

        results.push({
          uid: `${ev.uid || "ev"}_${evDate}_${pad2(startRome.hh)}${pad2(startRome.mm)}`,
          summary,
          date: evDate,
          start_time: `${pad2(startRome.hh)}:${pad2(startRome.mm)}`,
          end_time: `${pad2(endRome.hh)}:${pad2(endRome.mm)}`,
          all_day: false,
          location: ev.location,
          notes: ev.description.slice(0, 240),
        });
      };

      for (const master of masters) {
        if (!master.dtstart) continue;
        const localEx = new Set<string>([...excludedDates, ...master.exdates]);
        if (master.rrule) {
          // Per eventi multi-giorno cerchiamo leggermente prima di fromYmd
          const lookbackFrom = master.dtstart.allDay ? addDaysYmd(fromYmd, -7) : fromYmd;
          const occDates = expandRruleDates(master.dtstart.ymd, master.rrule, lookbackFrom, toYmd);
          for (const d of occDates) {
            if (!localEx.has(d)) emitEvent(master, d);
          }
        } else {
          if (!localEx.has(master.dtstart.ymd)) {
            emitEvent(master, master.dtstart.ymd);
          }
        }
      }

      for (const ov of overrides) {
        if (!ov.dtstart) continue;
        emitEvent(ov, ov.dtstart.ymd);
      }
    }
  }

  // Deduplica e ordina cronologicamente (giornata intera prima, poi per orario)
  const seen = new Set<string>();
  const unique: MirrorEvent[] = [];
  for (const ev of results) {
    const k = `${ev.uid}|${ev.date}|${ev.start_time}|${ev.summary}`;
    if (!seen.has(k)) {
      seen.add(k);
      unique.push(ev);
    }
  }
  unique.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
    if (a.start_time !== b.start_time) return a.start_time.localeCompare(b.start_time);
    return a.summary.localeCompare(b.summary, "it");
  });
  return unique;
}

// ============================================================================
// 3. Lettura Live Eventi dal Calendario iCloud Selezionato (REPORT solo lettura)
// ============================================================================

export async function fetchIcloudCalendarEvents(params: {
  appleId: string;
  appPassword: string;
  calendarUrl: string;
  fromDate: string;
  toDate: string;
}): Promise<MirrorEvent[]> {
  const { appleId, appPassword, calendarUrl, fromDate, toDate } = params;
  const auth = makeBasicAuth(appleId, appPassword);

  const paddedStart = addDaysYmd(fromDate, -1).replace(/-/g, "") + "T000000Z";
  const paddedEnd = addDaysYmd(toDate, 2).replace(/-/g, "") + "T235959Z";

  const reportXml = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${paddedStart}" end="${paddedEnd}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const resp = await caldavFetch(calendarUrl, "REPORT", "1", reportXml, auth);
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Sessione Apple CalDAV scaduta o password per app revocata. Riconfigura nelle Impostazioni.");
  }
  if (resp.status === 404) {
    throw new Error("Calendario Apple non trovato (potrebbe essere stato rinominato o rimosso). Ricollegalo in Impostazioni.");
  }
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`Errore sincronizzazione Apple Calendar (HTTP ${resp.status}).`);
  }

  const calDatas = matchAllTagInners(resp.text, "calendar-data").map(unescapeXml);
  return extractEventsFromIcsDocuments(calDatas, fromDate, toDate);
}
