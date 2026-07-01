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
