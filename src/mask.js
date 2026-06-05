function maskEmail(email) {
  if (!email.includes('@')) return '***';
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1) || '*'}***@${domain}`;
}

export function maskPhone(phone) {
  if (!phone) return '***';
  const cleaned = phone.replace(/\s/g, '');
  if (cleaned.length <= 4) return '***';
  return `${cleaned.slice(0, 3)}${'*'.repeat(Math.max(0, cleaned.length - 5))}${cleaned.slice(-2)}`;
}

export function maskName(name) {
  if (!name) return '***';
  const trimmed = name.trim();
  if (trimmed.length <= 1) return '***';
  return `${trimmed[0]}${'*'.repeat(trimmed.length - 1)}`;
}

export function sanitizeString(value, maxLen = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, maxLen);
}
