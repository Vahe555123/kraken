import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let geoIpModule;
function getGeoIpModule() {
  if (geoIpModule !== undefined) return geoIpModule;
  try {
    geoIpModule = require('geoip-lite');
  } catch {
    geoIpModule = null;
  }
  return geoIpModule;
}

const DEFAULT_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();

function asRecord(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}
function getString(v) {
  return typeof v === 'string' ? v.trim() : '';
}
function normalizePostal(v) {
  const s = getString(v).replace(/\s/g, '');
  if (!s) return '';
  const digits = s.replace(/\D/g, '');
  if (digits.length === 5) return digits;
  if (s.length >= 3 && s.length <= 10) return s;
  return '';
}
function getCountryCode(p) {
  const c = getString(p.country_code) || getString(p.countryCode) || getString(p.country);
  return c.length === 2 ? c.toUpperCase() : '';
}

function parseIpApi(payload) {
  const r = asRecord(payload);
  if (!r) return null;
  if (getString(r.status) === 'fail') return null;
  const country = getCountryCode(r);
  if (!country) return null;
  return {
    country,
    city: getString(r.city),
    region: getString(r.regionName) || getString(r.region),
    postal: normalizePostal(r.zip) || normalizePostal(r.postal),
  };
}

function parseIpwho(payload) {
  const r = asRecord(payload);
  if (!r) return null;
  if (r.success === false) return null;
  const country = getCountryCode(r);
  if (!country) return null;
  return {
    country,
    city: getString(r.city),
    region: getString(r.region),
    postal: normalizePostal(r.postal),
  };
}

export function normalizeIp(ip) {
  let n = String(ip || '').trim();
  if (!n) return '';
  if (n.startsWith('::ffff:')) n = n.slice(7);
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(n)) n = n.replace(/:\d+$/, '');
  return n;
}

async function tryFetchGeo(url, parser, timeoutMs, name) {
  const start = Date.now();
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) return { geo: null, error: `HTTP ${res.status}`, ms: Date.now() - start };
    const payload = await res.json();
    return { geo: parser(payload), ms: Date.now() - start, raw: payload };
  } catch (err) {
    return { geo: null, error: err instanceof Error ? err.message : String(err), ms: Date.now() - start };
  } finally {
    clearTimeout(t);
  }
}

function parseIpApiCo(payload) {
  const r = asRecord(payload);
  if (!r || r.error) return null;
  const country = getCountryCode(r);
  if (!country) return null;
  return {
    country,
    city: getString(r.city),
    region: getString(r.region_name) || getString(r.region),
    postal: normalizePostal(r.postal),
  };
}

function parseFreeIpApi(payload) {
  const r = asRecord(payload);
  if (!r) return null;
  const country = getCountryCode({ country_code: r.countryCode });
  if (!country) return null;
  return {
    country,
    city: getString(r.cityName),
    region: getString(r.regionName),
    postal: normalizePostal(r.zipCode),
  };
}

function parseIpInfo(payload) {
  const r = asRecord(payload);
  if (!r || r.bogon) return null;
  const country = getCountryCode({ country: r.country });
  if (!country) return null;
  return {
    country,
    city: getString(r.city),
    region: getString(r.region),
    postal: normalizePostal(r.postal),
  };
}

export async function lookupGeoByIp(ip, opts = {}) {
  const normalized = normalizeIp(ip);
  if (!normalized) return { available: false, geo: null, source: 'none' };

  const now = Date.now();
  const cached = cache.get(normalized);
  if (cached && cached.expiresAt > now && cached.geo?.postal) {
    return { available: true, geo: cached.geo, source: 'cache' };
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let best = null;
  let bestSource = '';

  const sources = [
    {
      url: `http://ip-api.com/json/${encodeURIComponent(normalized)}?fields=status,message,country,countryCode,region,regionName,city,zip`,
      parser: parseIpApi,
      name: 'ip-api.com',
    },
    {
      url: `https://freeipapi.com/api/json/${encodeURIComponent(normalized)}`,
      parser: parseFreeIpApi,
      name: 'freeipapi.com',
    },
    {
      url: `https://ipinfo.io/${encodeURIComponent(normalized)}/json`,
      parser: parseIpInfo,
      name: 'ipinfo.io',
    },
    {
      url: `https://ipwho.is/${encodeURIComponent(normalized)}`,
      parser: parseIpwho,
      name: 'ipwho.is',
    },
  ];

  for (const src of sources) {
    const result = await tryFetchGeo(src.url, src.parser, timeoutMs, src.name);
    if (result.geo) {
      if (!best) { best = result.geo; bestSource = src.name; }
      if (!best.postal && result.geo.postal) {
        best = { ...best, postal: result.geo.postal };
        bestSource = src.name + '(postal)';
      }
      if (best.postal) break;
    }
  }

  if (best) {
    if (best.postal) {
      cache.set(normalized, { expiresAt: now + CACHE_TTL_MS, geo: best });
    }
    return { available: true, geo: best, source: bestSource };
  }

  const mod = getGeoIpModule();
  if (mod) {
    try {
      const geo = mod.lookup(normalized);
      if (geo) return { available: true, geo, source: 'geoip-lite' };
    } catch {
      // ignore
    }
  }

  return { available: false, geo: null, source: 'none' };
}
