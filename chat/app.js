'use strict';

// ─── Config ──────────────────────────────────────────────────────────────────
const API = window.location.origin;
const TOKEN_KEY = 'chatOpToken';
const NOTES_KEY = 'chatOpNotes';
const CHATS_PER_PAGE = 9;
const POLL_CLIENTS_MS = 5000;
const POLL_MESSAGES_MS = 3500;

// ─── State ───────────────────────────────────────────────────────────────────
let state = {
  token: localStorage.getItem(TOKEN_KEY) || '',
  clients: [],
  activeSessionId: null,
  activeMessages: [],
  activeClient: null,
  chatLastReadAt: null,
  filter: 'all',
  search: '',
  page: 1,

  editingNoteId: null,
  callPending: false,
  clientPollTimer: null,
  msgPollTimer: null,
  activePaymentStatus: 'none',
  activePaymentStatuses: { insurance: 'none', return: 'none' },
};
let notes = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]');
let idCounter = 0;
function uid() { return `n-${Date.now()}-${++idCounter}`; }
function saveNotes() { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const els = {
  loginWrap:    $('#loginWrap'),
  workspace:    $('#workspace'),
  loginForm:    $('#loginForm'),
  loginUser:    $('#loginUser'),
  loginPass:    $('#loginPass'),
  loginBtn:     $('#loginBtn'),
  loginErr:     $('#loginErr'),
  totalCount:   $('[data-total-count]'),
  filter:       $('[data-filter]'),
  search:       $('[data-search]'),
  searchClear:  $('[data-search-clear]'),
  conversations:$('[data-conversations]'),
  pagination:   $('[data-chat-pagination]'),
  profile:      $('[data-profile]'),
  callComment:  $('[data-call-comment]'),
  callButton:   $('[data-call-button]'),
  chatDate:     $('[data-chat-date]'),
  messages:     $('[data-messages]'),
  messageForm:  $('[data-message-form]'),
  messageInput: $('[data-message-input]'),
  mainInfo:     $('[data-main-info]'),
  clientData:   $('[data-client-data]'),
  events:       $('[data-events]'),

  noteForm:     $('[data-note-form]'),
  noteInput:    $('[data-note-input]'),
  notes:        $('[data-notes]'),
  imageInput:   $('[data-image-input]'),
  imageBtn:     $('[data-image-btn]'),
  balanceDisp:  $('#clientBalanceDisp'),
  chargeAmount: $('#chargeAmountInp'),
  chargeDesc:   $('#chargeDescInp'),
  chargeBtn:    $('#chargeBtnEl'),
  chargeResult: $('#chargeResultMsg'),
  debitoBtn:    $('#debitoBtn'),
  debitoModal:  $('#debitoModal'),
  debitoClose:  $('#debitoModalClose'),
  startChatBar: $('#startChatBar'),
  startChatBtn: $('#startChatBtn'),
};

const STATUS_NEW = 'ЗАПРОСИЛ ЗВОНОК (ЧЕРЕЗ ЧАТ)';

// ─── Utilities ───────────────────────────────────────────────────────────────
function isImg(s) { return typeof s === 'string' && s.startsWith('/uploads/'); }
function getPaymentScreenshot(s) {
  if (typeof s !== 'string') return null;
  if (s.startsWith('PAYMENT_SCREENSHOT_RETURN:')) {
    return {
      type: 'return',
      url: s.slice('PAYMENT_SCREENSHOT_RETURN:'.length),
      title: 'Пользователь отправил скриншот оплаты возвратного платежа',
    };
  }
  if (s.startsWith('PAYMENT_SCREENSHOT:')) {
    return {
      type: 'insurance',
      url: s.slice('PAYMENT_SCREENSHOT:'.length),
      title: 'Пользователь отправил скриншот оплаты',
    };
  }
  return null;
}
function isPaymentScreenshot(s) { return !!getPaymentScreenshot(s); }
function paymentStatusesFrom(data) {
  return {
    insurance: data?.paymentStatuses?.insurance || data?.paymentStatus || 'none',
    return: data?.paymentStatuses?.return || 'none',
  };
}
function hasPendingPaymentStatus(statuses) {
  return statuses.insurance === 'pending' || statuses.return === 'pending';
}

async function uploadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1200;
        let { width: w, height: h } = img;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(async (blob) => {
          const fd = new FormData();
          fd.append('image', blob, 'photo.jpg');
          try {
            const res = await fetch(API + '/api/upload-image', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + state.token },
              body: fd,
            });
            const data = await res.json();
            if (data && data.url) resolve(data.url);
            else reject(new Error(data?.error || 'Upload failed'));
          } catch (err) { reject(err); }
        }, 'image/jpeg', 0.85);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function nowDT() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2,'0');
  return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${String(d.getFullYear()).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : String(name||'?').slice(0,2).toUpperCase();
}

const AVATAR_COLORS = ['#f20b5d','#1166ff','#56c46f','#ff8200','#7360e8','#ff5b46'];
function avatarColor(name) { let h=0; for(const c of String(name)) h=(h*31+c.charCodeAt(0))&0xffff; return AVATAR_COLORS[h%AVATAR_COLORS.length]; }

// Туристам (clientType === 'olduser') показываем фото-аватарку (фон убран), остальным — инициалы.
const TOURIST_AVATAR_URL = 'data:image/png;base64,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';
function avatarHtml(c) {
  const name = (c && (c.nombre || c.email)) || 'Cliente';
  if (c && c.clientType === 'olduser') {
    return `<div class="avatar" style="overflow:hidden;background:#1a2a40"><img src="${TOURIST_AVATAR_URL}" alt="" style="width:86%;height:86%;object-fit:contain" /></div>`;
  }
  return `<div class="avatar" style="background:${avatarColor(name)}">${esc(initials(name))}</div>`;
}

// ─── API ─────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + state.token, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function tryLogin(login, password) {
  els.loginBtn.disabled = true;
  els.loginErr.textContent = '';
  try {
    const data = await fetch(API + '/api/chat-op/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    }).then((r) => r.json());
    if (data.token) {
      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      showWorkspace();
    } else {
      els.loginErr.textContent = data.error || 'Ошибка входа';
    }
  } catch {
    els.loginErr.textContent = 'Сервер недоступен';
  }
  els.loginBtn.disabled = false;
}

function showLogin() {
  els.loginWrap.style.display = 'flex';
  els.workspace.style.display = 'none';
}

function showWorkspace() {
  els.loginWrap.style.display = 'none';
  els.workspace.style.display = '';
  loadClients();
  startClientPoll();
}

// ─── Clients ─────────────────────────────────────────────────────────────────
async function loadClients() {
  try {
    const data = await api('/api/chat-op/clients');
    if (data.error === 'unauthorized') { showLogin(); return; }
    state.clients = data.clients || [];
    renderConversations();
    // Обновляем активного клиента из свежего списка — чтобы кнопка звонка
    // разблокировалась, как только прозвонщик поставит галочку (operatorCalled=true)
    if (state.activeSessionId) {
      const fresh = state.clients.find((x) => x.flowSessionId === state.activeSessionId);
      if (fresh) {
        state.activeClient = { ...state.activeClient, ...fresh };
        renderCallControls();
      }
    }
  } catch {}
}

function startClientPoll() {
  clearInterval(state.clientPollTimer);
  state.clientPollTimer = setInterval(loadClients, POLL_CLIENTS_MS);
}

function startMsgPoll() {
  clearInterval(state.msgPollTimer);
  if (!state.activeSessionId) return;
  state.msgPollTimer = setInterval(async () => {
    try {
      const data = await api('/api/chat-op/messages/' + encodeURIComponent(state.activeSessionId));
      const newReadAt = data.chatLastReadAt || null;
      const readChanged = newReadAt !== state.chatLastReadAt;
      const nextPaymentStatuses = paymentStatusesFrom(data);
      const psChanged = nextPaymentStatuses.insurance !== state.activePaymentStatuses.insurance
        || nextPaymentStatuses.return !== state.activePaymentStatuses.return;
      if (data.messages && (data.messages.length > state.activeMessages.length || readChanged || psChanged)) {
        state.chatLastReadAt = newReadAt;
        state.activeMessages = data.messages;
        state.activePaymentStatus = nextPaymentStatuses.insurance;
        state.activePaymentStatuses = nextPaymentStatuses;
        renderMessages(state.activeMessages, state.activeClient?.callerNote);
        updateConversationIndicator(state.activeSessionId, state.activeMessages);
      }
    } catch {}
  }, POLL_MESSAGES_MS);
}

// ─── Indicator ───────────────────────────────────────────────────────────────
function getIndicator(lastMsg) {
  if (!lastMsg) return 'gray';
  if (lastMsg.role === 'user') return 'green';
  return 'yellow';
}

function updateConversationIndicator(sessionId, messages) {
  const c = state.clients.find((x) => x.flowSessionId === sessionId);
  const lastMsg = messages && messages.length ? messages[messages.length - 1] : null;
  const indicator = getIndicator(lastMsg);
  const row = document.querySelector(`[data-session-id="${CSS.escape(sessionId)}"]`);
  if (!row) return;
  const meta = row.querySelector('.conversation-meta');
  if (!meta) return;

  // Remove all existing indicators
  meta.querySelectorAll('.reply-needed, .coin-indicator').forEach((el) => el.remove());

  if (c?.paymentPending) {
    const coin = document.createElement('span');
    coin.className = 'coin-indicator';
    coin.textContent = '💰';
    meta.appendChild(coin);
  } else if (indicator === 'green') {
    const d = document.createElement('span');
    d.className = 'reply-needed';
    d.style.background = 'var(--green)';
    meta.appendChild(d);
  } else if (indicator === 'yellow') {
    const d = document.createElement('span');
    d.className = 'reply-needed';
    d.style.background = 'var(--yellow)';
    d.style.animation = 'none';
    meta.appendChild(d);
  }
}

// ─── Render conversations ─────────────────────────────────────────────────────
function getVisibleClients() {
  const q = state.search.trim().toLowerCase();
  return state.clients.filter((c) => {
    const matchFilter = state.filter === 'all'
      || (state.filter === 'unanswered' && getIndicator(c.lastMsg) === 'green')
      || (state.filter === 'payment' && c.paymentPending === true);
    const matchSearch = !q || `${c.nombre||''} ${c.email||''}`.toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });
}

function renderConversations() {
  const visible = getVisibleClients();
  const total = visible.length;
  const totalPages = Math.max(1, Math.ceil(total / CHATS_PER_PAGE));
  if (state.page > totalPages) state.page = totalPages;
  const start = (state.page - 1) * CHATS_PER_PAGE;
  const page = visible.slice(start, start + CHATS_PER_PAGE);

  els.totalCount.textContent = total;
  els.searchClear.hidden = !state.search;

  els.conversations.innerHTML = page.map((c) => {
    const name = c.nombre || c.email || 'Cliente';
    const ind = getIndicator(c.lastMsg);
    const isNew = c.status === STATUS_NEW;
    const dot = c.paymentPending
      ? '<span class="coin-indicator" aria-label="Ожидает оплаты">💰</span>'
      : isNew
        ? '<span class="new-badge">NEW</span>'
        : ind === 'green'
          ? '<span class="reply-needed" style="background:var(--green)" aria-label="Нужен ответ"></span>'
          : ind === 'yellow'
            ? '<span class="reply-needed" style="background:var(--yellow);animation:none" aria-label="Ответил"></span>'
            : '';
    const active = c.flowSessionId === state.activeSessionId ? ' active' : '';
    const preview = c.lastMsg
      ? (isPaymentScreenshot(c.lastMsg.content) ? '📎 Скриншот оплаты'
        : isImg(c.lastMsg.content) ? '📷 Изображение'
        : esc(c.lastMsg.content.slice(0, 40)))
      : '&nbsp;';
    const timeStr = c.lastMsg ? fmtTime(c.lastMsg.createdAt) : fmtTime(c.updatedAt);
    const statusClass = isNew ? '' : ind === 'green' ? 'online' : ind === 'yellow' ? 'hold' : 'pending';
    const statusText = isNew ? '' : ind === 'green' ? '● Нужен ответ' : ind === 'yellow' ? '⏱ Ответил' : '⌛ Ожидает';
    return `<article class="conversation${active}" data-session-id="${esc(c.flowSessionId)}" tabindex="0">
      ${avatarHtml(c)}
      <div style="min-width:0">
        <strong>${esc(name)}</strong>
        <p style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</p>
        <small class="${statusClass}">${statusText}</small>
      </div>
      <div class="conversation-meta"><time>${timeStr}</time>${dot}</div>
    </article>`;
  }).join('');

  renderPagination(totalPages);
  updatePaymentBell();
}

function updatePaymentBell() {
  const bell = document.getElementById('paymentBell');
  if (!bell) return;
  const hasPending = state.clients.some((c) => c.paymentPending);
  bell.classList.toggle('payment-bell--active', hasPending);
}

function renderPagination(totalPages) {
  if (totalPages <= 1) { els.pagination.innerHTML = ''; return; }
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1);
  const prevDis = state.page === 1 ? ' disabled' : '';
  const nextDis = state.page === totalPages ? ' disabled' : '';
  els.pagination.innerHTML =
    `<button type="button" class="page-arrow"${prevDis} data-page-shift="-1" aria-label="Назад">‹</button>` +
    pages.map((p) => `<button type="button" class="${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`).join('') +
    `<button type="button" class="page-arrow"${nextDis} data-page-shift="1" aria-label="Вперёд">›</button>`;
}

// ─── Start bar (NEW chats) ────────────────────────────────────────────────────
function renderStartBar() {
  const c = state.activeClient;
  const isNew = c && c.status === STATUS_NEW;
  const hasOperatorMsg = state.activeMessages.some((m) => m.role === 'operator' || m.role === 'system');
  const show = isNew && !hasOperatorMsg;
  if (els.startChatBar) els.startChatBar.style.display = show ? 'flex' : 'none';
  if (els.messageForm) els.messageForm.style.display = show ? 'none' : '';
}

// ─── Select client ────────────────────────────────────────────────────────────
async function selectClient(sessionId) {
  state.activeSessionId = sessionId;
  state.callPending = false;
  els.callComment.value = '';
  clearInterval(state.msgPollTimer);

  const c = state.clients.find((x) => x.flowSessionId === sessionId);
  state.activeClient = c || null;

  renderConversations();
  renderProfile(c);
  renderCallControls();
  renderDetails(c);

  renderStartBar();
  try {
    const data = await api('/api/chat-op/messages/' + encodeURIComponent(sessionId));
    state.activeMessages = data.messages || [];
    state.chatLastReadAt = data.chatLastReadAt || null;
    state.activePaymentStatuses = paymentStatusesFrom(data);
    state.activePaymentStatus = state.activePaymentStatuses.insurance;
    if (data.client) state.activeClient = { ...c, ...data.client, callerNote: data.callerNote };
    renderMessages(state.activeMessages, data.callerNote);
    renderDetails(state.activeClient);
    renderStartBar();
  } catch {}

  startMsgPoll();
  loadSmsHistory(sessionId);
}

// ─── Render profile ───────────────────────────────────────────────────────────
function renderProfile(c) {
  if (!c) { els.profile.innerHTML = '<span style="color:var(--muted);font-size:13px">Выберите клиента</span>'; return; }
  const name = c.nombre || c.email || 'Cliente';
  els.profile.innerHTML = `
    ${avatarHtml(c)}
    <div><strong>${esc(name)}</strong><p>${esc(c.bank || c.ip || '—')}</p></div>`;
}

// Звонок «в работе»: заказан (callRequested), но прозвонщик ещё не поставил галочку (operatorCalled=false)
function isCallOrdered(client) {
  return !!(client && client.callRequested && !client.operatorCalled);
}

function renderCallControls() {
  const comment = els.callComment.value;
  // Кнопка заблокирована пока: идёт запрос (callPending) ИЛИ звонок уже заказан и прозвонщик не закрыл его
  const waiting = state.callPending || isCallOrdered(state.activeClient);
  els.callComment.disabled = waiting;
  els.callButton.disabled = waiting || !comment.trim();
  els.callButton.classList.toggle('is-waiting', waiting);
  els.callButton.textContent = waiting ? '⌛ Ждем звонка' : 'Заказать звонок';
}

// ─── Render messages ──────────────────────────────────────────────────────────
function renderMessages(messages, callerNote) {
  let html = '';
  if (callerNote) {
    html += `<div style="align-self:center;background:#1a2a40;border-radius:8px;padding:8px 14px;font-size:12px;color:#fa6c12;text-align:center;max-width:80%;margin-bottom:8px">
      <strong style="color:#94a5bd;font-size:11px;display:block;margin-bottom:2px">📞 Комментарий прозвонщика</strong>
      ${esc(callerNote)}</div>`;
  }
  const readAt = state.chatLastReadAt ? new Date(state.chatLastReadAt) : null;
  html += messages.map((m) => {
    const isOut = m.role === 'operator';
    const isAi = m.role === 'assistant';
    const cls = isOut ? 'outgoing' : 'incoming';
    const imageContent = isImg(m.content);
    const prefix = isAi ? '<span style="font-size:10px;color:#94a5bd;display:block;margin-bottom:3px">🤖 ИИ-ассистент</span>' : '';
    let tick = '';
    if (isOut) {
      const msgAt = m.createdAt ? new Date(m.createdAt) : null;
      const isRead = readAt && msgAt && msgAt <= readAt;
      tick = isRead
        ? '<span class="msg-tick msg-tick--read">✓✓</span>'
        : '<span class="msg-tick">✓</span>';
    }
    const markerLabels = { CALLER_ACTION_BUTTONS: '📩 Отправлены кнопки действий', OFFER_BUTTONS: '🎁 Отправлены кнопки офферов' };
    if (markerLabels[m.content]) {
      return `<div class="bubble ${cls}"><em style="opacity:.8">${markerLabels[m.content]}</em><time>${fmtTime(m.createdAt)}${tick}</time></div>`;
    }
    const payment = getPaymentScreenshot(m.content);
    if (payment) {
      const imgUrl = esc(payment.url);
      const sid = esc(state.activeSessionId || '');
      const paymentType = esc(payment.type);
      const ps = state.activePaymentStatuses[payment.type] || 'none';
      let actionBtns;
      if (ps === 'confirmed') {
        actionBtns = `<button class="payment-card__btn payment-card__btn--view" data-img-preview="${imgUrl}">Посмотреть</button>
          <button class="payment-card__btn payment-card__btn--confirm" disabled style="opacity:.65;cursor:default">Подтверждено ✓</button>`;
      } else if (ps === 'rejected') {
        actionBtns = `<button class="payment-card__btn payment-card__btn--view" data-img-preview="${imgUrl}">Посмотреть</button>
          <button class="payment-card__btn payment-card__btn--reject" disabled style="opacity:.65;cursor:default">Отказано ✗</button>`;
      } else {
        actionBtns = `<button class="payment-card__btn payment-card__btn--view" data-img-preview="${imgUrl}">Посмотреть</button>
          <button class="payment-card__btn payment-card__btn--confirm" data-payment-confirm="${sid}" data-payment-type="${paymentType}">Подтвердить</button>
          <button class="payment-card__btn payment-card__btn--reject" data-payment-reject="${sid}" data-payment-type="${paymentType}">Отказать</button>`;
      }
      return `<div class="payment-card">
        <div class="payment-card__header">
          <span class="payment-card__icon">💰</span>
          <span class="payment-card__title">${esc(payment.title)}</span>
          <time class="payment-card__time">${fmtTime(m.createdAt)}</time>
        </div>
        <div class="payment-card__actions">${actionBtns}</div>
      </div>`;
    }
    if (imageContent) {
      const imgSrc = esc(m.content);
      return `<div class="bubble bubble--image ${cls}">${prefix}<img src="${imgSrc}" alt="" data-img-preview="${imgSrc}" /><time>${fmtTime(m.createdAt)}${tick}</time></div>`;
    }
    return `<div class="bubble ${cls}">${prefix}${esc(m.content)}<time>${fmtTime(m.createdAt)}${tick}</time></div>`;
  }).join('');
  els.messages.innerHTML = html;
  els.messages.scrollTop = els.messages.scrollHeight;
  if (els.chatDate) els.chatDate.textContent = messages.length ? fmt(messages[0].createdAt).split(' ')[0] : nowDT().split(' ')[0];
}

// ─── Render details ───────────────────────────────────────────────────────────
function renderDetails(c) {
  if (!c) { els.mainInfo.innerHTML = ''; els.clientData.innerHTML = ''; els.events.innerHTML = ''; return; }
  const name = c.nombre || '—';
  const sub = (c.submissionData && typeof c.submissionData === 'object') ? c.submissionData : {};

  els.mainInfo.innerHTML = [
    ['Имя', esc(name)],
    ['Email', esc(c.email || '—')],
    ['Банк', esc(c.bank || '—')],
    ['IP', esc(c.ip || '—')],
    ['Регистрация', esc(fmt(c.createdAt))],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  const clientRows = [
    sub.dni ? ['DNI/NIE', esc(sub.dni)] : null,
    sub.iban ? ['IBAN', esc(sub.iban)] : null,
    sub.calle ? ['Адрес', esc([sub.calle, sub.ciudad, sub.cp].filter(Boolean).join(', '))] : null,
    sub.phone ? ['Телефон', esc(sub.phone)] : null,
    sub.chatOpNote ? ['Заметка чат-оп.', esc(sub.chatOpNote)] : null,
  ].filter(Boolean);
  els.clientData.innerHTML = clientRows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') || '<dt style="color:var(--muted)">Нет данных</dt>';

  const events = c.events || [];
  els.events.innerHTML = events.length
    ? events.map((e) => `<li><span>${esc(e.event)}</span><time>${fmt(e.createdAt)}</time></li>`).join('')
    : '<li style="color:var(--muted);font-size:12px">Нет событий</li>';

  renderBalance(c);
  if (els.chargeAmount) els.chargeAmount.value = '';
  if (els.chargeDesc) els.chargeDesc.value = '';
  if (els.chargeResult) els.chargeResult.textContent = '';
  updateChargeBtn();
}

// ─── Balance display ─────────────────────────────────────────────────────────
function fmtEur(v) {
  return '€' + Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderBalance(c) {
  if (!els.balanceDisp) return;
  if (!c) { els.balanceDisp.textContent = '—'; return; }
  els.balanceDisp.textContent = c.balance != null ? fmtEur(c.balance) : '...';
}


// ─── Notes ───────────────────────────────────────────────────────────────────
function renderNotes() {
  els.notes.innerHTML = notes.map((n) => {
    if (n.id === state.editingNoteId) {
      return `<article class="note-editing" data-note-id="${n.id}">
        <input data-note-edit-input type="text" value="${esc(n.text)}" />
        <button data-note-action="save">✓</button>
        <button data-note-action="cancel">×</button>
      </article>`;
    }
    return `<article data-note-id="${n.id}">
      <p>${esc(n.text)}</p>
      <time>${esc(n.time)}</time>
      <button data-note-action="edit">✎</button>
      <button class="note-delete" data-note-action="delete">×</button>
    </article>`;
  }).join('');
}

// ─── Events ───────────────────────────────────────────────────────────────────
// Login
els.loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  tryLogin(els.loginUser.value.trim(), els.loginPass.value);
});

// Filter
els.filter.addEventListener('change', () => {
  state.filter = els.filter.value;
  state.page = 1;
  renderConversations();
});

// Search
els.search.addEventListener('input', () => {
  state.search = els.search.value;
  state.page = 1;
  renderConversations();
});

els.searchClear.addEventListener('click', () => {
  els.search.value = '';
  state.search = '';
  state.page = 1;
  renderConversations();
  els.search.focus();
});

// Conversations
els.conversations.addEventListener('click', (e) => {
  const item = e.target.closest('[data-session-id]');
  if (!item) return;
  selectClient(item.dataset.sessionId);
});

els.conversations.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const item = e.target.closest('[data-session-id]');
  if (!item) return;
  e.preventDefault();
  selectClient(item.dataset.sessionId);
});

// Pagination
els.pagination.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-page],[data-page-shift]');
  if (!btn || btn.disabled) return;
  if (btn.dataset.pageShift) {
    const vis = getVisibleClients();
    const total = Math.max(1, Math.ceil(vis.length / CHATS_PER_PAGE));
    state.page = Math.min(total, Math.max(1, state.page + Number(btn.dataset.pageShift)));
  } else {
    state.page = Number(btn.dataset.page);
  }
  renderConversations();
});

// Call comment + button
els.callComment.addEventListener('input', renderCallControls);

els.callButton.addEventListener('click', async () => {
  if (!state.activeSessionId || state.callPending || isCallOrdered(state.activeClient)) return;
  const comment = els.callComment.value.trim();
  if (!comment) return;
  state.callPending = true;
  renderCallControls();
  try {
    await api('/api/chat-op/request-call', { method: 'POST', body: { sessionId: state.activeSessionId, comment } });
    els.callComment.value = '';
    // Оптимистично помечаем звонок как заказанный — блокировка сохранится при переключении чатов
    // и снимется только когда прозвонщик поставит галочку (operatorCalled=true)
    const sid = state.activeSessionId;
    if (state.activeClient) { state.activeClient.callRequested = true; state.activeClient.operatorCalled = false; }
    const c = state.clients.find((x) => x.flowSessionId === sid);
    if (c) { c.callRequested = true; c.operatorCalled = false; }
  } catch {}
  state.callPending = false;
  renderCallControls();
});

// ─── Pending attachment ───────────────────────────────────────────────────────
let pendingAttachToken = null;
const pendingAttachEl    = document.getElementById('pendingAttach');
const pendingAttachLabel = document.getElementById('pendingAttachLabel');
const pendingAttachRemove = document.getElementById('pendingAttachRemove');

const ATTACH_LABELS = {
  '[[CONTRATO]]':      '📄 Договор',
  '[[NOTIF_PDF]]':     '📄 Письмо банка',
  '[[INSURANCE_PAY]]': '💳 Оплата страховки',
  '[[COMMISSION_PAY]]':'💳 Оплата возвратного платежа',
  '[[CREDITC]]':       '📄 Кредитная карта',
  '[[SEGURO]]':        '📄 Сертификат страховки',
};

function setPendingAttach(token) {
  pendingAttachToken = token;
  if (pendingAttachEl && pendingAttachLabel) {
    pendingAttachLabel.textContent = ATTACH_LABELS[token] || token;
    pendingAttachEl.style.display = 'flex';
  }
}
function clearPendingAttach() {
  pendingAttachToken = null;
  if (pendingAttachEl) pendingAttachEl.style.display = 'none';
}

if (pendingAttachRemove) pendingAttachRemove.addEventListener('click', clearPendingAttach);

// Send message
els.messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.messageInput.value.trim();
  const token = pendingAttachToken;
  if (!text && !token) return;
  if (!state.activeSessionId) return;
  els.messageInput.value = '';
  clearPendingAttach();
  if (text) await sendOperatorMsg(text);
  if (token) await sendOperatorMsg(token);
});

els.messageInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  els.messageForm.requestSubmit();
});

// ─── Attach menu ──────────────────────────────────────────────────────────────
const attachMenu = document.getElementById('attachMenu');

const ATTACH_MESSAGES = {
  'contract':       '[[CONTRATO]]',
  'insurance-req':  '[[NOTIF_PDF]]',
  'insurance-pay':  '[[INSURANCE_PAY]]',
  'insurance-done': '[[SEGURO]]',
  'commission-pay': '[[COMMISSION_PAY]]',
  'credit-card-contract': '[[CREDITC]]',
};

function openAttachMenu() {
  if (!attachMenu) return;
  attachMenu.classList.add('is-open');
  els.imageBtn.classList.add('is-open');
  els.imageBtn.setAttribute('aria-expanded', 'true');
}
function closeAttachMenu() {
  if (!attachMenu) return;
  attachMenu.classList.remove('is-open');
  els.imageBtn.classList.remove('is-open');
  els.imageBtn.setAttribute('aria-expanded', 'false');
}

async function sendOperatorMsg(text) {
  if (!state.activeSessionId) return;
  const tmpMsg = { role: 'operator', content: text, createdAt: new Date().toISOString() };
  state.activeMessages = [...state.activeMessages, tmpMsg];
  renderMessages(state.activeMessages, state.activeClient?.callerNote);
  try {
    await api('/api/chat-op/send', { method: 'POST', body: { sessionId: state.activeSessionId, message: text } });
    const c = state.clients.find((x) => x.flowSessionId === state.activeSessionId);
    if (c) c.lastMsg = tmpMsg;
    renderConversations();
  } catch {}
}

// Start button for new chats
if (els.startChatBtn) {
  els.startChatBtn.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    await sendOperatorMsg('CALLER_ACTION_BUTTONS');
    const c = state.clients.find((x) => x.flowSessionId === state.activeSessionId);
    if (c) c.status = 'ЧАТ: АКТИВЕН';
    if (state.activeClient) state.activeClient.status = 'ЧАТ: АКТИВЕН';
    renderStartBar();
    renderConversations();
  });
}

// Toggle menu on paperclip click
els.imageBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!state.activeSessionId) return;
  attachMenu?.classList.contains('is-open') ? closeAttachMenu() : openAttachMenu();
});

// Menu item clicks
if (attachMenu) {
  attachMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-attach]');
    if (!btn) return;
    const action = btn.dataset.attach;
    closeAttachMenu();
    if (action === 'photo') {
      els.imageInput.click();
    } else if (ATTACH_MESSAGES[action]) {
      setPendingAttach(ATTACH_MESSAGES[action]);
      els.messageInput.focus();
    }
  });
}

// Close menu on outside click
document.addEventListener('click', (e) => {
  if (attachMenu?.classList.contains('is-open') && !e.target.closest('.attach-wrap')) {
    closeAttachMenu();
  }
});

// Image upload via file input
els.imageInput.addEventListener('change', async () => {
  const file = els.imageInput.files[0];
  if (!file || !state.activeSessionId) return;
  els.imageInput.value = '';
  els.imageBtn.disabled = true;
  try {
    const url = await uploadImage(file);
    await sendOperatorMsg(url);
  } catch {
    // upload failed silently
  } finally {
    els.imageBtn.disabled = false;
  }
});

// Notes
els.noteForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = els.noteInput.value.trim();
  if (!text) return;
  notes.unshift({ id: uid(), text, time: nowDT() });
  els.noteInput.value = '';
  saveNotes();
  renderNotes();
});

els.noteInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  els.noteForm.requestSubmit();
});

els.notes.addEventListener('click', (e) => {
  const action = e.target.dataset.noteAction;
  const article = e.target.closest('[data-note-id]');
  if (!action || !article) return;
  const idx = notes.findIndex((n) => n.id === article.dataset.noteId);
  if (idx < 0) return;
  if (action === 'delete') { notes.splice(idx, 1); state.editingNoteId = null; }
  else if (action === 'edit') { state.editingNoteId = article.dataset.noteId; }
  else if (action === 'cancel') { state.editingNoteId = null; }
  else if (action === 'save') {
    const inp = article.querySelector('[data-note-edit-input]');
    const trimmed = inp?.value.trim();
    if (!trimmed) return;
    notes[idx].text = trimmed;
    notes[idx].time = nowDT();
    state.editingNoteId = null;
  }
  saveNotes();
  renderNotes();
});

els.notes.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const article = e.target.closest('[data-note-id]');
  const btn = article?.querySelector('[data-note-action="save"]');
  if (!btn) return;
  e.preventDefault();
  btn.click();
});

// ─── Charge (debit client balance) ───────────────────────────────────────────
function updateChargeBtn() {
  if (!els.chargeBtn) return;
  const hasSession = !!state.activeSessionId;
  const hasAmount = parseFloat(els.chargeAmount?.value) > 0;
  els.chargeBtn.disabled = !hasSession || !hasAmount;
}

if (els.chargeAmount) els.chargeAmount.addEventListener('input', updateChargeBtn);

if (els.chargeBtn) {
  els.chargeBtn.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    const amount = parseFloat(els.chargeAmount.value);
    if (!isFinite(amount) || amount <= 0) return;
    const desc = els.chargeDesc.value.trim();
    els.chargeBtn.disabled = true;
    els.chargeResult.textContent = '';
    try {
      const data = await api('/api/chat-op/charge', {
        method: 'POST',
        body: { sessionId: state.activeSessionId, amount, description: desc },
      });
      if (data.ok) {
        const newBal = data.balance;
        if (state.activeClient) state.activeClient.balance = newBal;
        const c = state.clients.find((x) => x.flowSessionId === state.activeSessionId);
        if (c) c.balance = newBal;
        renderBalance(state.activeClient);
        els.chargeAmount.value = '';
        els.chargeDesc.value = '';
        showToast(`✓ Списано ${fmtEur(amount)}`, 'success');
        setTimeout(closeDebitoModal, 1200);
      } else {
        showToast('✗ Ошибка списания', 'error');
        els.chargeResult.style.color = '#f20b5d';
        els.chargeResult.textContent = '✗ Ошибка';
      }
    } catch {
      showToast('✗ Ошибка сети', 'error');
      els.chargeResult.style.color = '#f20b5d';
      els.chargeResult.textContent = '✗ Ошибка сети';
    }
    updateChargeBtn();
    setTimeout(() => { if (els.chargeResult) els.chargeResult.textContent = ''; }, 3000);
  });
}

// ─── Toast notifications ──────────────────────────────────────────────────────
function showToast(msg, type) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = document.createElement('div');
  const bg = type === 'success' ? '#16a34a' : '#dc2626';
  t.style.cssText = `background:${bg};color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:auto;opacity:0;transition:opacity .2s;max-width:280px;`;
  t.textContent = msg;
  container.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; });
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 250);
  }, 3000);
}

// ─── Débito modal ─────────────────────────────────────────────────────────────
function openDebitoModal() {
  if (!els.debitoModal) return;
  els.debitoModal.style.display = 'flex';
  renderBalance(state.activeClient);
}
function closeDebitoModal() {
  if (!els.debitoModal) return;
  els.debitoModal.style.display = 'none';
}
if (els.debitoBtn) {
  els.debitoBtn.addEventListener('click', openDebitoModal);
}
if (els.debitoClose) {
  els.debitoClose.addEventListener('click', closeDebitoModal);
}
if (els.debitoModal) {
  els.debitoModal.addEventListener('click', (e) => {
    if (e.target === els.debitoModal) closeDebitoModal();
  });
}

// ─── Manual push ──────────────────────────────────────────────────────────────
const pushBtn = $('[data-send-push]');
if (pushBtn) {
  pushBtn.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    pushBtn.disabled = true;
    const orig = pushBtn.textContent;
    pushBtn.textContent = '⌛';
    try {
      const data = await api('/api/chat-op/send-push', { method: 'POST', body: { sessionId: state.activeSessionId } });
      pushBtn.textContent = data.ok ? '✓ Отправлен' : '✗ Нет токена';
    } catch {
      pushBtn.textContent = '✗ Ошибка';
    }
    setTimeout(() => { pushBtn.textContent = orig; pushBtn.disabled = false; }, 2000);
  });
}

// ─── Offer buttons ──────────────────────────────────────────────────────────────
// Отправляет клиенту маркер OFFER_BUTTONS — клиентский чат сам подтянет
// актуальный список офферов и отрисует по кнопке на каждый.
const offersBtn = $('[data-send-offers]');
if (offersBtn) {
  offersBtn.addEventListener('click', async () => {
    if (!state.activeSessionId) return;
    offersBtn.disabled = true;
    const orig = offersBtn.textContent;
    try {
      const data = await api('/api/offers');
      const offers = (data && data.offers) || [];
      if (!offers.length) {
        offersBtn.textContent = '✗ Нет офферов';
      } else {
        await sendOperatorMsg('OFFER_BUTTONS');
        offersBtn.textContent = '✓ Отправлено';
      }
    } catch {
      offersBtn.textContent = '✗ Ошибка';
    }
    setTimeout(() => { offersBtn.textContent = orig; offersBtn.disabled = false; }, 2000);
  });
}

// ─── SMS history ──────────────────────────────────────────────────────────────
function renderSmsHistory(entries) {
  const box = document.getElementById('smsHistoryList');
  if (!box) return;
  if (!entries || !entries.length) {
    box.innerHTML = '<div style="color:var(--muted,#7a90aa);font-size:12px;padding:6px 0">Нет отправленных SMS</div>';
    return;
  }
  box.innerHTML = entries.map(e => {
    const d = new Date(e.sentAt);
    const dateStr = d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit' })
      + ' ' + d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
    const statusColor = e.ok ? '#2DB97B' : '#f20b5d';
    const statusText  = e.ok ? '✓' : '✗';
    return `<div style="border:1px solid #1e2e45;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <span style="font-size:12px;color:#7a90aa">${e.phone}</span>
        <span style="font-size:11px;color:${statusColor};font-weight:700">${statusText}</span>
      </div>
      <div style="font-size:12px;color:#c8d6e8;word-break:break-word">${esc(e.text)}</div>
      <div style="font-size:11px;color:#4a6080">${dateStr}</div>
    </div>`;
  }).join('');
}

async function loadSmsHistory(sessionId) {
  if (!sessionId) return;
  try {
    const data = await api('/api/chat-op/sms-history/' + encodeURIComponent(sessionId));
    renderSmsHistory(data.entries || []);
  } catch { renderSmsHistory([]); }
}

// ─── SMS modal ────────────────────────────────────────────────────────────────
const smsModal    = document.getElementById('smsModal');
const smsPhone    = document.getElementById('smsPhone');
const smsText     = document.getElementById('smsText');
const smsCharCount = document.getElementById('smsCharCount');
const smsSendBtn  = document.getElementById('smsSendBtn');
const smsResult   = document.getElementById('smsResultMsg');
const smsClose    = document.getElementById('smsModalClose');
const smsBtn      = document.getElementById('sendSmsBtn');

function openSmsModal() {
  if (!smsModal) return;
  const sub = (state.activeClient?.submissionData && typeof state.activeClient.submissionData === 'object')
    ? state.activeClient.submissionData : {};
  smsPhone.value = sub.phone || '';
  smsText.value  = '';
  smsCharCount.textContent = '0 / 640';
  smsResult.textContent = '';
  smsSendBtn.disabled = false;
  smsModal.style.display = 'flex';
  (smsPhone.value ? smsText : smsPhone).focus();
}

function closeSmsModal() {
  if (smsModal) smsModal.style.display = 'none';
}

if (smsBtn) smsBtn.addEventListener('click', () => { if (state.activeSessionId) openSmsModal(); });
if (smsClose) smsClose.addEventListener('click', closeSmsModal);
if (smsModal) smsModal.addEventListener('click', (e) => { if (e.target === smsModal) closeSmsModal(); });

if (smsText) {
  smsText.addEventListener('input', () => {
    smsCharCount.textContent = smsText.value.length + ' / 640';
  });
}

if (smsSendBtn) {
  smsSendBtn.addEventListener('click', async () => {
    const phone = smsPhone.value.trim();
    const text  = smsText.value.trim();
    if (!phone) { smsPhone.focus(); return; }
    if (!text)  { smsText.focus();  return; }
    smsSendBtn.disabled = true;
    smsSendBtn.textContent = '⌛ Отправка...';
    smsResult.textContent = '';
    try {
      const data = await api('/api/chat-op/send-sms', { method: 'POST', body: { phone, text, sessionId: state.activeSessionId } });
      if (data.ok) {
        smsResult.style.color = '#2DB97B';
        smsResult.textContent = '✓ SMS отправлен';
        setTimeout(() => { closeSmsModal(); loadSmsHistory(state.activeSessionId); }, 1200);
      } else {
        smsResult.style.color = '#f20b5d';
        smsResult.textContent = '✗ ' + (data.error || 'Ошибка');
        smsSendBtn.disabled = false;
        smsSendBtn.textContent = 'Отправить';
      }
    } catch {
      smsResult.style.color = '#f20b5d';
      smsResult.textContent = '✗ Ошибка сети';
      smsSendBtn.disabled = false;
      smsSendBtn.textContent = 'Отправить';
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  renderNotes();
  if (state.token) {
    showWorkspace();
  } else {
    showLogin();
  }
}

init();

// ─── Image preview modal ───────────────────────────────────────────────────────
const imgModal     = document.getElementById('imgModal');
const imgModalImg  = document.getElementById('imgModalImg');
const imgModalClose = document.getElementById('imgModalClose');

function openImgModal(url) {
  imgModalImg.src = url;
  imgModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeImgModal() {
  imgModal.style.display = 'none';
  imgModalImg.src = '';
  document.body.style.overflow = '';
}

imgModalClose.addEventListener('click', closeImgModal);
imgModal.addEventListener('click', (e) => { if (e.target === imgModal) closeImgModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeImgModal(); });

els.messages.addEventListener('click', async (e) => {
  const imgBtn = e.target.closest('[data-img-preview]');
  if (imgBtn) { openImgModal(imgBtn.dataset.imgPreview); return; }

  const confirmBtn = e.target.closest('[data-payment-confirm]');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    const sid = confirmBtn.dataset.paymentConfirm;
    const type = confirmBtn.dataset.paymentType || 'insurance';
    state.activePaymentStatuses[type] = 'confirmed';
    state.activePaymentStatus = state.activePaymentStatuses.insurance;
    const ci = state.clients.findIndex((c) => c.flowSessionId === sid);
    if (ci >= 0) state.clients[ci] = { ...state.clients[ci], paymentPending: hasPendingPaymentStatus(state.activePaymentStatuses) };
    renderMessages(state.activeMessages, state.activeClient?.callerNote);
    renderConversations();
    try {
      await api('/api/chat-op/payment/confirm', { method: 'POST', body: { sessionId: sid, type } });
    } catch {
      state.activePaymentStatuses[type] = 'none';
      state.activePaymentStatus = state.activePaymentStatuses.insurance;
      if (ci >= 0) state.clients[ci] = { ...state.clients[ci], paymentPending: true };
      renderMessages(state.activeMessages, state.activeClient?.callerNote);
      renderConversations();
    }
    return;
  }

  const rejectBtn = e.target.closest('[data-payment-reject]');
  if (rejectBtn) {
    rejectBtn.disabled = true;
    const sid = rejectBtn.dataset.paymentReject;
    const type = rejectBtn.dataset.paymentType || 'insurance';
    state.activePaymentStatuses[type] = 'rejected';
    state.activePaymentStatus = state.activePaymentStatuses.insurance;
    const ci = state.clients.findIndex((c) => c.flowSessionId === sid);
    if (ci >= 0) state.clients[ci] = { ...state.clients[ci], paymentPending: hasPendingPaymentStatus(state.activePaymentStatuses) };
    renderMessages(state.activeMessages, state.activeClient?.callerNote);
    renderConversations();
    try {
      await api('/api/chat-op/payment/reject', { method: 'POST', body: { sessionId: sid, type } });
    } catch {
      state.activePaymentStatuses[type] = 'none';
      state.activePaymentStatus = state.activePaymentStatuses.insurance;
      if (ci >= 0) state.clients[ci] = { ...state.clients[ci], paymentPending: true };
      renderMessages(state.activeMessages, state.activeClient?.callerNote);
      renderConversations();
    }
    return;
  }
});
