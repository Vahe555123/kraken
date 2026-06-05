import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.js';

const storeDir = join(tmpdir(), config.logDirName);
const storeFile = join(storeDir, 'scratch-grants.json');

const shortToToken = new Map();
const tokenState = new Map();
let flushTimer = null;

async function loadStore() {
  try {
    const raw = await readFile(storeFile, 'utf8');
    const parsed = JSON.parse(raw);
    for (const [token, state] of Object.entries(parsed.tokens ?? {})) {
      tokenState.set(token, state);
    }
    for (const [shortId, token] of Object.entries(parsed.shortMap ?? {})) {
      shortToToken.set(shortId, token);
    }
  } catch {
    // no persisted grants yet
  }
}

async function saveStore() {
  try {
    await mkdir(storeDir, { recursive: true });
    await writeFile(
      storeFile,
      JSON.stringify({
        tokens: Object.fromEntries(tokenState),
        shortMap: Object.fromEntries(shortToToken),
      }),
      'utf8',
    );
  } catch (error) {
    console.error('grantStore save error:', error);
  }
}

function scheduleSave() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void saveStore();
  }, 500);
}

export function createAccessToken() {
  const token = randomBytes(24).toString('hex');
  const shortId = randomBytes(5).toString('hex');
  tokenState.set(token, { granted: false, createdAt: Date.now() });
  shortToToken.set(shortId, token);
  scheduleSave();
  return { token, shortId };
}

export function grantByShortId(shortId) {
  const token = shortToToken.get(shortId);
  if (!token) return null;
  const state = tokenState.get(token);
  if (!state) return null;
  state.granted = true;
  state.grantedAt = Date.now();
  tokenState.set(token, state);
  scheduleSave();
  return token;
}

export function isGranted(token) {
  if (!token) return false;
  return Boolean(tokenState.get(token)?.granted);
}

void loadStore();
