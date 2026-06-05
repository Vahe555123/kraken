import { Telegraf } from 'telegraf';
import { config } from './config.js';
import { grantByShortId } from './grantStore.js';
import { sendToTelegram } from './telegram.js';

let bot = null;

export async function startTelegramBot() {
  if (!config.telegram.botToken) {
    console.warn('[TG-BOT] TELEGRAM_BOT_TOKEN не задан — long-polling не запущен');
    return;
  }
  if (bot) return;

  bot = new Telegraf(config.telegram.botToken);

  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery?.data || '';
    if (!data.startsWith('grant_')) {
      await ctx.answerCbQuery().catch(() => undefined);
      return;
    }

    const shortId = data.slice('grant_'.length);
    const token = grantByShortId(shortId);

    await ctx.answerCbQuery('Access granted').catch(() => undefined);

    const from = ctx.from?.username || ctx.from?.first_name || 'operator';
    sendToTelegram(
      [
        '*Grant button pressed*',
        `Operator: ${from}`,
        `shortId: \`${shortId}\``,
        `token: \`${token ? `${token.slice(0, 12)}...` : '?'}\``,
        'Client will be redirected on the next poll.',
      ].join('\n'),
    );
  });

  bot.catch((error) => {
    console.error('[TG-BOT] error:', error);
  });

  try {
    await bot.launch();
    console.log('[TG-BOT] Long-polling запущен');
  } catch (err) {
    if (err?.response?.error_code === 409) {
      console.warn('[TG-BOT] 409 Conflict: другой экземпляр бота уже запущен (bot-credit). TG polling отключён.');
      bot = null;
      return;
    }
    throw err;
  }
}

export async function stopTelegramBot() {
  if (!bot) return;
  await bot.stop('SIGTERM').catch(() => undefined);
  bot = null;
}
