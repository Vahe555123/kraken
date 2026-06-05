import { config } from '../config.js';

const REQUEST_TIMEOUT_MS = 60000;

/**
 * DeepSeek chat completion (OpenAI-compatible endpoint).
 * @param {Array<{role:string, content:string}>} messages
 * @param {{model?:string, temperature?:number, maxTokens?:number}} [opts]
 * @returns {Promise<string>} assistant reply text
 */
export async function deepseekChat(messages, opts = {}) {
  const apiKey = config.deepseek.apiKey;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY не задан в .env');
  }

  const url = `${config.deepseek.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: opts.model || config.deepseek.model,
    messages,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.7,
    max_tokens: typeof opts.maxTokens === 'number' ? opts.maxTokens : 1024,
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`DeepSeek HTTP ${res.status}: ${raw.slice(0, 300)}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`DeepSeek: невалидный JSON: ${raw.slice(0, 200)}`);
    }

    const text = parsed?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error(`DeepSeek: пустой ответ: ${raw.slice(0, 200)}`);
    }
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}
