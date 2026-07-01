// financiar24.js — определяет, кто пришёл: НОВИЧОК или ТУРИСТ.
//
// Логика: клиентский email+телефон отправляются в step1-форму financiar24
// (тот же offer, через который проходит наш TDS-трафик). Ответ ядра содержит
// поле `new`:
//   "New" → financiar24 не видел этот email/телефон  → НОВИЧОК (newuser)
//   "Old" → email/телефон уже есть в их базе          → ТУРИСТ  (olduser)
//
// Это тот же самый сигнал, который вручную проверяли через
// https://tds.pdl-profit.com/h/1ub5690bf21c30c59 (новичку открывалась форма,
// туристу — /core-process/). Здесь мы бьём напрямую в admin-ajax, минуя
// цепочку редиректов TDS → draivimedia.

const ENDPOINT = 'https://www.financiar24.es/wp-admin/admin-ajax.php';
const TIMEOUT_MS = 8000;

// financiar24 ждёт испанский телефон в локальной 9-значной форме.
function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0034')) d = d.slice(4);
  else if (d.startsWith('34') && d.length > 9) d = d.slice(2);
  return d.slice(-9);
}

// Достаём поле `new` из вложенного core-tracking ответа.
function extractNewFlag(json) {
  const events = json?.data?.data?.tracking?.gtm?.events;
  if (Array.isArray(events)) {
    for (const ev of events) {
      const v = ev?.data?.new;
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

/**
 * Спрашивает у financiar24, знаком ли им этот email/телефон.
 * @returns {Promise<{clientType: 'newuser'|'olduser'|null, isTourist: boolean|null, label: string, raw: string|null, reason?: string}>}
 * clientType === null означает, что определить не удалось (сеть/пустые данные) —
 * вызывающий код должен оставить дефолтный статус.
 */
export async function classifyClient({ email, phone }) {
  const cleanEmail = String(email || '').trim();
  const cleanPhone = normalizePhone(phone);
  if (!cleanEmail || !cleanPhone) {
    return { clientType: null, isTourist: null, label: 'unknown', raw: null, reason: 'missing email/phone' };
  }

  const form = new URLSearchParams();
  form.set('action', 'default_step1_form');
  form.set('data[email]', cleanEmail);
  form.set('data[phone]', cleanPhone);
  form.set('data[loan_sum]', '300');
  form.set('data[loan_time]', '30');
  form.set('data[vertical]', '');
  form.set('data[verifyfield]', '');
  form.set('data[page_location]', '/');
  form.set('data[page_url]', 'https://www.financiar24.es/');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.financiar24.es/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      body: form.toString(),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    const flag = extractNewFlag(json);
    if (flag === 'New') return { clientType: 'newuser', isTourist: false, label: 'НОВИЧОК', raw: flag };
    if (flag === 'Old') return { clientType: 'olduser', isTourist: true, label: 'ТУРИСТ', raw: flag };
    return { clientType: null, isTourist: null, label: 'unknown', raw: flag, reason: 'no `new` flag in response' };
  } catch (err) {
    return { clientType: null, isTourist: null, label: 'unknown', raw: null, reason: err?.name === 'AbortError' ? 'timeout' : err?.message || 'request failed' };
  } finally {
    clearTimeout(timer);
  }
}
