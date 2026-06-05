import https from 'node:https';
import { config } from './config.js';

const REQUEST_TIMEOUT_MS = 8000;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
const MAX_TEXT_LEN = 4000;

function resolveTarget(target) {
  if (typeof target === 'string') {
    const botToken = config.telegram.botToken;
    const chatId = target || config.telegram.chatId;
    return botToken && chatId ? { botToken, chatId } : null;
  }
  const botToken = target?.botToken || config.telegram.botToken;
  const chatId = target?.chatId || config.telegram.chatId;
  return botToken && chatId ? { botToken, chatId } : null;
}

function truncateText(payload) {
  if (typeof payload.text === 'string' && payload.text.length > MAX_TEXT_LEN) {
    payload.text = payload.text.slice(0, MAX_TEXT_LEN - 20) + '\n…(truncated)';
  }
  return payload;
}

function doRequest(botToken, path, payload) {
  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}${path}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      },
    );
    req.on('error', (error) => resolve({ status: 0, body: '', error: error.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, body: '', error: 'request timeout after ' + REQUEST_TIMEOUT_MS + 'ms' });
    });
    req.write(data);
    req.end();
  });
}

async function postTelegram(botToken, path, payloadIn, errorLabel) {
  let payload = truncateText({ ...payloadIn });

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await doRequest(botToken, path, payload);

    if (res.status === 200) {
      if (attempt > 0) console.log(`[TG OK] ${errorLabel} succeeded on retry #${attempt}`);
      return true;
    }

    if (
      res.status === 400 &&
      payload.parse_mode &&
      /can't parse entities|can't find end of/i.test(res.body)
    ) {
      console.warn(`[TG] Markdown failed, retrying as plain. Error: ${res.body.slice(0, 150)}`);
      payload = { ...payload };
      delete payload.parse_mode;
      continue;
    }

    if (res.status === 429) {
      try {
        const parsed = JSON.parse(res.body);
        const wait = (parsed?.parameters?.retry_after || 2) * 1000 + 500;
        console.warn(`[TG] rate limit (429), waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      } catch {
        // fall through
      }
    }

    const isRetriable = res.status === 0 || res.status >= 500;
    if (isRetriable && attempt < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[attempt];
      console.warn(
        `[TG] ${errorLabel} attempt ${attempt + 1} failed (${res.error || 'HTTP ' + res.status}), retrying in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (res.status === 0) {
      console.error(`[TG NET ERR] ${errorLabel}: ${res.error} (after ${attempt + 1} attempts)`);
    } else {
      console.error(`[TG ERR ${res.status}] ${errorLabel}: ${res.body.slice(0, 300)}`);
    }
    return false;
  }
  return false;
}

export function sendToTelegram(text, target) {
  const t = resolveTarget(target);
  if (!t) {
    console.warn('[TG] sendToTelegram skipped: no botToken or chatId configured');
    return;
  }
  void postTelegram(
    t.botToken,
    '/sendMessage',
    {
      chat_id: t.chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    },
    'Telegram sendMessage error',
  );
}

export function sendToTelegramWithButton(text, callbackData, buttonText = 'Дать доступ', target) {
  const t = resolveTarget(target);
  if (!t) {
    console.warn('[TG] sendToTelegramWithButton skipped: no botToken or chatId configured');
    return;
  }
  void postTelegram(
    t.botToken,
    '/sendMessage',
    {
      chat_id: t.chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: buttonText, callback_data: callbackData }]],
      },
    },
    'Telegram sendMessage(button) error',
  );
}

export function answerCallbackQuery(callbackQueryId, text) {
  if (!config.telegram.botToken) return;
  void postTelegram(
    config.telegram.botToken,
    '/answerCallbackQuery',
    {
      callback_query_id: callbackQueryId,
      text: text || 'OK',
      show_alert: false,
    },
    'Telegram answerCallbackQuery error',
  );
}
