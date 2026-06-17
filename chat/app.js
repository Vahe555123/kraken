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
  editingComment: false,
  editingNoteId: null,
  callPending: false,
  clientPollTimer: null,
  msgPollTimer: null,
  activePaymentStatus: 'none',
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
  commentForm:  $('[data-comment-form]'),
  commentInput: $('[data-comment-input]'),
  commentEdit:  $('[data-comment-edit]'),
  noteForm:     $('[data-note-form]'),
  noteInput:    $('[data-note-input]'),
  notes:        $('[data-notes]'),
  imageInput:   $('[data-image-input]'),
  imageBtn:     $('[data-image-btn]'),
};

// ─── Utilities ───────────────────────────────────────────────────────────────
function isImg(s) { return typeof s === 'string' && s.startsWith('/uploads/'); }
function isPaymentScreenshot(s) { return typeof s === 'string' && s.startsWith('PAYMENT_SCREENSHOT:'); }

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
      const psChanged = (data.paymentStatus || 'none') !== state.activePaymentStatus;
      if (data.messages && (data.messages.length > state.activeMessages.length || readChanged || psChanged)) {
        state.chatLastReadAt = newReadAt;
        state.activeMessages = data.messages;
        state.activePaymentStatus = data.paymentStatus || 'none';
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
    const matchFilter = state.filter === 'all' || getIndicator(c.lastMsg) === 'green';
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
    const dot = c.paymentPending
      ? '<span class="coin-indicator" aria-label="Ожидает оплаты">💰</span>'
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
    return `<article class="conversation${active}" data-session-id="${esc(c.flowSessionId)}" tabindex="0">
      <div class="avatar" style="background:${avatarColor(name)}">${esc(initials(name))}</div>
      <div style="min-width:0">
        <strong>${esc(name)}</strong>
        <p style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</p>
        <small class="${ind === 'green' ? 'online' : ind === 'yellow' ? 'hold' : 'pending'}">
          ${ind === 'green' ? '● Нужен ответ' : ind === 'yellow' ? '⏱ Ответил' : '⌛ Ожидает'}
        </small>
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

// ─── Select client ────────────────────────────────────────────────────────────
async function selectClient(sessionId) {
  state.activeSessionId = sessionId;
  state.callPending = false;
  state.editingComment = false;
  clearInterval(state.msgPollTimer);

  const c = state.clients.find((x) => x.flowSessionId === sessionId);
  state.activeClient = c || null;

  renderConversations();
  renderProfile(c);
  renderCallControls();
  renderDetails(c);

  try {
    const data = await api('/api/chat-op/messages/' + encodeURIComponent(sessionId));
    state.activeMessages = data.messages || [];
    state.chatLastReadAt = data.chatLastReadAt || null;
    state.activePaymentStatus = data.paymentStatus || 'none';
    if (data.client) state.activeClient = { ...c, ...data.client, callerNote: data.callerNote };
    renderMessages(state.activeMessages, data.callerNote);
    renderDetails(state.activeClient);
    renderCommentEditor(data.callerNote || '');
  } catch {}

  startMsgPoll();
}

// ─── Render profile ───────────────────────────────────────────────────────────
function renderProfile(c) {
  if (!c) { els.profile.innerHTML = '<span style="color:var(--muted);font-size:13px">Выберите клиента</span>'; return; }
  const name = c.nombre || c.email || 'Cliente';
  els.profile.innerHTML = `
    <div class="avatar" style="background:${avatarColor(name)}">${esc(initials(name))}</div>
    <div><strong>${esc(name)}</strong><p>${esc(c.bank || c.ip || '—')}</p></div>`;
}

function renderCallControls() {
  const comment = els.callComment.value;
  els.callComment.disabled = state.callPending;
  els.callButton.disabled = state.callPending || !comment.trim();
  els.callButton.classList.toggle('is-waiting', state.callPending);
  els.callButton.textContent = state.callPending ? '⌛ Ждем звонка' : 'Заказать звонок';
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
    if (isPaymentScreenshot(m.content)) {
      const imgUrl = esc(m.content.slice('PAYMENT_SCREENSHOT:'.length));
      const sid = esc(state.activeSessionId || '');
      const ps = state.activePaymentStatus || 'none';
      let actionBtns;
      if (ps === 'confirmed') {
        actionBtns = `<button class="payment-card__btn payment-card__btn--view" data-img-preview="${imgUrl}">Посмотреть</button>
          <button class="payment-card__btn payment-card__btn--confirm" disabled style="opacity:.65;cursor:default">Подтверждено ✓</button>`;
      } else if (ps === 'rejected') {
        actionBtns = `<button class="payment-card__btn payment-card__btn--view" data-img-preview="${imgUrl}">Посмотреть</button>
          <button class="payment-card__btn payment-card__btn--reject" disabled style="opacity:.65;cursor:default">Отказано ✗</button>`;
      } else {
        actionBtns = `<button class="payment-card__btn payment-card__btn--view" data-img-preview="${imgUrl}">Посмотреть</button>
          <button class="payment-card__btn payment-card__btn--confirm" data-payment-confirm="${sid}">Подтвердить</button>
          <button class="payment-card__btn payment-card__btn--reject" data-payment-reject="${sid}">Отказать</button>`;
      }
      return `<div class="payment-card">
        <div class="payment-card__header">
          <span class="payment-card__icon">💰</span>
          <span class="payment-card__title">Пользователь отправил скриншот оплаты</span>
          <time class="payment-card__time">${fmtTime(m.createdAt)}</time>
        </div>
        <div class="payment-card__actions">${actionBtns}</div>
      </div>`;
    }
    if (imageContent) {
      return `<div class="bubble bubble--image ${cls}">${prefix}<img src="${esc(m.content)}" alt="" /><time>${fmtTime(m.createdAt)}${tick}</time></div>`;
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
}

// ─── Comment editor ───────────────────────────────────────────────────────────
function renderCommentEditor(note) {
  els.commentInput.value = note || '';
  els.commentInput.readOnly = !state.editingComment;
  els.commentInput.classList.toggle('is-editing', state.editingComment);
  els.commentEdit.classList.toggle('save-mode', state.editingComment);
  els.commentEdit.textContent = state.editingComment ? '✓ Сохранить' : '✎ Изменить';
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
  if (!state.activeSessionId || state.callPending) return;
  const comment = els.callComment.value.trim();
  if (!comment) return;
  state.callPending = true;
  renderCallControls();
  try {
    await api('/api/chat-op/request-call', { method: 'POST', body: { sessionId: state.activeSessionId, comment } });
  } catch {}
});

// Send message
els.messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = els.messageInput.value.trim();
  if (!text || !state.activeSessionId) return;
  els.messageInput.value = '';
  const tmpMsg = { role: 'operator', content: text, createdAt: new Date().toISOString() };
  state.activeMessages = [...state.activeMessages, tmpMsg];
  renderMessages(state.activeMessages, state.activeClient?.callerNote);
  try {
    await api('/api/chat-op/send', { method: 'POST', body: { sessionId: state.activeSessionId, message: text } });
    // Update client list indicator (last message is now 'operator' → yellow)
    const c = state.clients.find((x) => x.flowSessionId === state.activeSessionId);
    if (c) c.lastMsg = tmpMsg;
    renderConversations();
  } catch {}
});

els.messageInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  els.messageForm.requestSubmit();
});

// Image send
els.imageBtn.addEventListener('click', () => {
  if (!state.activeSessionId) return;
  els.imageInput.click();
});

els.imageInput.addEventListener('change', async () => {
  const file = els.imageInput.files[0];
  if (!file || !state.activeSessionId) return;
  els.imageInput.value = '';
  els.imageBtn.disabled = true;
  try {
    const url = await uploadImage(file);
    const tmpMsg = { role: 'operator', content: url, createdAt: new Date().toISOString() };
    state.activeMessages = [...state.activeMessages, tmpMsg];
    renderMessages(state.activeMessages, state.activeClient?.callerNote);
    try {
      await api('/api/chat-op/send', { method: 'POST', body: { sessionId: state.activeSessionId, message: url } });
      const c = state.clients.find((x) => x.flowSessionId === state.activeSessionId);
      if (c) c.lastMsg = tmpMsg;
      renderConversations();
    } catch {}
  } catch {
    // upload failed silently
  } finally {
    els.imageBtn.disabled = false;
  }
});

// Comment edit
els.commentEdit.addEventListener('click', async () => {
  if (state.editingComment) {
    const note = els.commentInput.value.trim();
    state.editingComment = false;
    renderCommentEditor(note);
    if (state.activeSessionId) {
      try { await api('/api/chat-op/note', { method: 'PUT', body: { sessionId: state.activeSessionId, note } }); } catch {}
    }
    return;
  }
  state.editingComment = true;
  renderCommentEditor(state.activeClient?.callerNote || '');
  els.commentInput.focus();
});

els.commentForm.addEventListener('submit', (e) => {
  e.preventDefault();
  els.commentEdit.click();
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
    state.activePaymentStatus = 'confirmed';
    const ci = state.clients.findIndex((c) => c.flowSessionId === sid);
    if (ci >= 0) state.clients[ci] = { ...state.clients[ci], paymentPending: false };
    renderMessages(state.activeMessages, state.activeClient?.callerNote);
    renderConversations();
    try {
      await api('/api/chat-op/payment/confirm', { method: 'POST', body: { sessionId: sid } });
    } catch {
      state.activePaymentStatus = 'none';
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
    state.activePaymentStatus = 'rejected';
    const ci = state.clients.findIndex((c) => c.flowSessionId === sid);
    if (ci >= 0) state.clients[ci] = { ...state.clients[ci], paymentPending: false };
    renderMessages(state.activeMessages, state.activeClient?.callerNote);
    renderConversations();
    try {
      await api('/api/chat-op/payment/reject', { method: 'POST', body: { sessionId: sid } });
    } catch {
      state.activePaymentStatus = 'none';
      if (ci >= 0) state.clients[ci] = { ...state.clients[ci], paymentPending: true };
      renderMessages(state.activeMessages, state.activeClient?.callerNote);
      renderConversations();
    }
    return;
  }
});
