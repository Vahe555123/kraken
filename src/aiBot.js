import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { prisma } from './db.js';
import { getBotConfig, ensureBotConfig } from './ai/botConfig.js';
import { deepseekChat } from './ai/deepseek.js';
import { buildSystemPrompt } from './ai/promptBuilder.js';

let bot = null;

// Защита от параллельной обработки двух сообщений одного лида.
const processing = new Set();

const TG_MAX = 4096;

function chunkText(text) {
  const chunks = [];
  let rest = String(text);
  while (rest.length > TG_MAX) {
    let cut = rest.lastIndexOf('\n', TG_MAX);
    if (cut < TG_MAX * 0.5) cut = TG_MAX;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function findOrCreateLead(ctx) {
  const from = ctx.from;
  const tgId = String(from.id);
  const chatId = String(ctx.chat.id);
  const data = {
    chatId,
    username: from.username || null,
    firstName: from.first_name || null,
    lastName: from.last_name || null,
  };
  return prisma.lead.upsert({
    where: { tgId },
    create: { tgId, ...data },
    update: data, // освежаем username/имя на случай изменения
  });
}

// Превращаем историю из БД в массив сообщений для LLM.
function toLlmMessages(systemPrompt, history) {
  const msgs = [{ role: 'system', content: systemPrompt }];
  for (const m of history) {
    if (m.role === 'USER') msgs.push({ role: 'user', content: m.content });
    else if (m.role === 'ASSISTANT') msgs.push({ role: 'assistant', content: m.content });
  }
  return msgs;
}

async function handleText(ctx) {
  try {
    if (ctx.chat?.type !== 'private') return; // отвечаем только в личке
    const text = ctx.message?.text;
    if (!text || !text.trim()) return;

    const lead = await findOrCreateLead(ctx);

    // Сохраняем входящее сообщение клиента всегда (живой лог переписки).
    await prisma.message.create({
      data: { leadId: lead.id, role: 'USER', content: text },
    });

    const cfg = await getBotConfig();

    // Глобальный или персональный выключатель ИИ (передача оператору).
    if (!cfg.aiEnabled || !lead.aiEnabled) {
      console.log(`[ai-bot] AI disabled for lead ${lead.id} — пропуск ответа`);
      return;
    }

    if (processing.has(lead.id)) return;
    processing.add(lead.id);
    try {
      const history = await prisma.message.findMany({
        where: { leadId: lead.id },
        orderBy: { createdAt: 'asc' },
        take: cfg.historyLimit,
      });

      const systemPrompt = buildSystemPrompt(cfg.systemPrompt, {
        name: lead.firstName || lead.username || '',
        bank: '',
      });
      const llmMessages = toLlmMessages(systemPrompt, history);

      await ctx.sendChatAction('typing').catch(() => undefined);

      const reply = await deepseekChat(llmMessages, {
        model: cfg.model,
        temperature: cfg.temperature,
        maxTokens: cfg.maxTokens,
      });

      await prisma.message.create({
        data: { leadId: lead.id, role: 'ASSISTANT', content: reply },
      });

      for (const chunk of chunkText(reply)) {
        await ctx.reply(chunk);
      }
    } finally {
      processing.delete(lead.id);
    }
  } catch (err) {
    console.error('[ai-bot] handleText error:', err?.message || err);
    await ctx.reply('Disculpa, ahora mismo no puedo responder. Inténtalo de nuevo en un momento.').catch(() => undefined);
  }
}

export async function startAiBot() {
  if (!config.aiBot.token) {
    console.warn('[ai-bot] TG_AI_BOT_TOKEN не задан — AI-бот не запущен');
    return;
  }
  if (!config.deepseek.apiKey) {
    console.warn('[ai-bot] DEEPSEEK_API_KEY не задан — AI-бот не запущен');
    return;
  }
  if (bot) return;

  // Засеваем конфиг (системный промпт из prompt.md) до старта.
  await ensureBotConfig().catch((e) => console.error('[ai-bot] ensureBotConfig:', e?.message || e));

  bot = new Telegraf(config.aiBot.token);

  bot.start(async (ctx) => {
    await findOrCreateLead(ctx).catch(() => undefined);
    await ctx.reply('¡Hola! Soy tu asistente. ¿En qué puedo ayudarte?').catch(() => undefined);
  });

  bot.on('text', handleText);

  bot.catch((error) => {
    console.error('[ai-bot] telegraf error:', error);
  });

  try {
    await bot.launch();
    console.log('[ai-bot] Long-polling запущен');
  } catch (err) {
    if (err?.response?.error_code === 409) {
      console.warn('[ai-bot] 409 Conflict: этот токен уже используется другим polling-инстансом. Дай отдельный TG_AI_BOT_TOKEN.');
      bot = null;
      return;
    }
    throw err;
  }
}

export async function stopAiBot() {
  if (!bot) return;
  await bot.stop('SIGTERM').catch(() => undefined);
  bot = null;
}
