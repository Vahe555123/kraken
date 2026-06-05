import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prisma } from '../db.js';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = join(__dirname, '..', '..', 'prompt.md');

const CONFIG_ID = 1;
let cached = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5000; // короткий кэш, чтобы правки подхватывались быстро

async function readPromptFile() {
  try {
    const raw = await readFile(PROMPT_FILE, 'utf8');
    return raw.trim();
  } catch {
    return '';
  }
}

// Создаёт строку конфига при первом запуске, засевая системный промпт из prompt.md.
export async function ensureBotConfig() {
  const existing = await prisma.botConfig.findUnique({ where: { id: CONFIG_ID } });
  if (existing) return existing;

  const systemPrompt = (await readPromptFile()) || 'Eres un asistente virtual. Responde de forma breve y amable.';
  return prisma.botConfig.create({
    data: {
      id: CONFIG_ID,
      systemPrompt,
      model: config.deepseek.model,
      historyLimit: config.aiBot.historyLimit,
    },
  });
}

// Возвращает актуальный конфиг. Системный промпт всегда берём из prompt.md
// (источник правды для удобного редактирования), остальное — из БД.
export async function getBotConfig() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;

  const [row, filePrompt] = await Promise.all([ensureBotConfig(), readPromptFile()]);
  cached = {
    ...row,
    systemPrompt: filePrompt || row.systemPrompt,
  };
  cachedAt = now;
  return cached;
}

export function invalidateBotConfigCache() {
  cached = null;
  cachedAt = 0;
}

// Обновляет настройки бота из админки.
// systemPrompt пишем в prompt.md (источник правды) + зеркалим в БД;
// остальные поля — в БД. После сохранения сбрасываем кэш.
export async function updateBotConfig(patch = {}) {
  await ensureBotConfig();

  const data = {};
  if (typeof patch.model === 'string' && patch.model.trim()) data.model = patch.model.trim();
  if (typeof patch.temperature === 'number' && Number.isFinite(patch.temperature)) {
    data.temperature = Math.min(2, Math.max(0, patch.temperature));
  }
  if (typeof patch.maxTokens === 'number' && Number.isFinite(patch.maxTokens)) {
    data.maxTokens = Math.min(8192, Math.max(64, Math.round(patch.maxTokens)));
  }
  if (typeof patch.historyLimit === 'number' && Number.isFinite(patch.historyLimit)) {
    data.historyLimit = Math.min(100, Math.max(1, Math.round(patch.historyLimit)));
  }
  if (typeof patch.aiEnabled === 'boolean') data.aiEnabled = patch.aiEnabled;

  if (typeof patch.systemPrompt === 'string') {
    const prompt = patch.systemPrompt.replace(/\r\n/g, '\n');
    await writeFile(PROMPT_FILE, prompt.endsWith('\n') ? prompt : prompt + '\n', 'utf8');
    data.systemPrompt = prompt;
  }

  await prisma.botConfig.update({ where: { id: CONFIG_ID }, data });
  invalidateBotConfigCache();
  return getBotConfig();
}
