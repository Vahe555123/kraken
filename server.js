import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './src/config.js';
import { registerApiRoutes } from './src/routes.js';
import { startTelegramBot, stopTelegramBot } from './src/telegramBot.js';
import { startAiBot, stopAiBot } from './src/aiBot.js';
import { disconnectDb } from './src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const loggerOptions =
  config.nodeEnv === 'development'
    ? { level: 'warn', transport: { target: 'pino-pretty', options: { colorize: true } } }
    : { level: 'warn' };

async function buildApp() {
  const app = Fastify({
    logger: loggerOptions,
    disableRequestLogging: true,
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });

  app.addHook('onResponse', async (req, reply) => {
    const status = reply.statusCode;
    if (status >= 400 && req.url.startsWith('/api/')) {
      console.warn(`[${status}] ${req.method} ${req.url}`);
    }
  });

  // ── Admin panels at clean URLs (before static so they take priority) ─────────
  async function serveHtml(file, reply) {
    try {
      const html = await readFile(join(__dirname, file), 'utf8');
      reply.type('text/html; charset=utf-8').send(html);
    } catch {
      reply.code(404).send('Not found');
    }
  }
  app.get('/admin',   async (req, reply) => serveHtml('admin.html', reply));
  app.get('/admin/',  async (req, reply) => serveHtml('admin.html', reply));
  app.get('/caller',  async (req, reply) => serveHtml('admin-callers.html', reply));
  app.get('/caller/', async (req, reply) => serveHtml('admin-callers.html', reply));
  app.get('/logs',    async (req, reply) => serveHtml('admin-logs.html', reply));
  app.get('/logs/',   async (req, reply) => serveHtml('admin-logs.html', reply));

  // ── API routes ────────────────────────────────────────────────────────────────
  await registerApiRoutes(app);

  // ── Static files ──────────────────────────────────────────────────────────────
  await app.register(fastifyStatic, {
    root: __dirname,
    prefix: '/',
    decorateReply: true,
    index: ['index.html'],
    constraints: {},
  });

  app.setNotFoundHandler(async (req, reply) => {
    return reply.code(404).send({
      message: `Route ${req.method}:${req.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
  });

  return app;
}

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[SERVER] Listening on port ${config.port}`);
    await startTelegramBot().catch((err) => {
      console.warn('[SERVER] Telegram grant bot failed to start (non-fatal):', err?.message || err);
    });
    await startAiBot().catch((err) => {
      console.warn('[SERVER] AI bot failed to start (non-fatal):', err?.message || err);
    });
  } catch (err) {
    console.error('[SERVER] Fatal error:', err);
    process.exit(1);
  }

  const shutdown = async () => {
    await stopTelegramBot();
    await stopAiBot();
    await disconnectDb();
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason, promise);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

main();
