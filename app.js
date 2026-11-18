import { createStore, newId } from './store.js?v=2026.11.18-6';

const APP_VERSION = '2026.11.18-6';
const APP_NAME = 'Points';
// Username logins use a hidden, never-emailed address on a reserved domain.
const LOGIN_DOMAIN = 'users.example.com';
const ROOM_COLS = ['people', 'categories', 'entries', 'attendance'];
const GLOBAL_COLS = ['leaders', 'locations', 'rooms', 'settings'];
const FIRST_ROOM = 'higher-ground';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const bannerEl = document.getElementById('banner');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' });
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || byName(a, b);
const norm = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');
const normUser = (s) => String(s || '').trim().toLowerCase();
const slug = (s) => normUser(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'user';
const loginEmailFor = (username) => `${slug(username).slice(0, 30)}.${newId().slice(0, 6).toLowerCase()}@${LOGIN_DOMAIN}`;

/* ---------- weeks (start on Wednesday) ---------- */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7)); // 3 = Wednesday
  return ymd(d);
}
function shiftWeek(id, n) { const d = parseYmd(id); d.setDate(d.getDate() + 7 * n); return ymd(d); }
function weekLabel(id) {
  const s = parseYmd(id); const e = new Date(s); e.setDate(e.getDate() + 6);
  const f = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString(undefined, f)} – ${e.toLocaleDateString(undefined, f)}`;
}

/* ---------- state ---------- */
const state = {
  globalLoaded: new Set(),
  roomLoaded: new Set(),
  leaders: [], locations: [], rooms: [], settings: [],
  people: [], categories: [], entries: [], attendance: [], // current room only
  roomId: null,
  tab: 'attendance',
  showAllKids: false,
  week: weekStart(new Date()),
  personId: null,
  board: 'week',
  user: null,        // { email, name } from sign-in
  access: null,      // null | 'checking' | 'ok' | 'none'
  setupDone: true,
  authMsg: '',
  leaderEdit: null,
  migrating: false,
  ownerEmail: null,  // the one "master" account (whoever set the app up)
  locId: (() => { try { return localStorage.getItem('hgui_loc'); } catch { return null; } })(),
  log: null, logKey: '', logWeek: weekStart(new Date()), logRoom: '',
  someRooms: new Set(), // "leaderId|locId" where "Only some rooms" is picked but nothing checked yet
};
let store;

// One-tap import links: #import=<base64url text>. The part after # never leaves the phone.
let pendingImport = (() => {
  const m = location.hash.match(/^#import=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch { return null; }
})();

const me = () => state.leaders.find((l) => l.id === state.user?.email);
const locations = () => [...state.locations].sort(byOrder);
const roomsIn = (locId) => state.rooms.filter((r) => r.locationId === locId).sort(byOrder);

/* ---------- who can do what ----------
   Owner:  the account that set the app up. Everything, everywhere. Only one who manages locations and admins.
   Admin:  `admin: true` + `locations` = the locations they run. Full control there, nothing elsewhere.
   Leader: `rooms` (single rooms) and/or `locations` (every room in that location). Attendance + points only. */
const leaderLocs = (l) => l?.locations || [];
const isOwnerL = (l) => !!l && !!state.ownerEmail && l.id === state.ownerEmail;
const isOwner = () => isOwnerL(me());
const adminOfL = (l, locId) => isOwnerL(l) || (!!l?.admin && leaderLocs(l).includes(locId));
const adminOf = (locId) => adminOfL(me(), locId);
const isAdminAnywhere = () => isOwner() || (!!me()?.admin && leaderLocs(me()).length > 0);
const canUseRoom = (l, r) => !!l && (isOwnerL(l) || (l.rooms || []).includes(r.id) || leaderLocs(l).includes(r.locationId));
const roleOf = (l) => (isOwnerL(l) ? 'owner' : l.admin ? 'admin' : 'leader');
const myRooms = () => {
  const l = me();
  if (!l) return [];
  const list = state.rooms.filter((r) => canUseRoom(l, r));
  const locOrder = new Map(locations().map((x, i) => [x.id, i]));
  return [...list].sort((a, b) => (locOrder.get(a.locationId) ?? 99) - (locOrder.get(b.locationId) ?? 99) || byOrder(a, b));
};
const currentRoom = () => state.rooms.find((r) => r.id === state.roomId);
const locationOf = (room) => state.locations.find((l) => l.id === room?.locationId);
const attendancePoints = () => Number(currentRoom()?.attendancePoints ?? 10);
const people = () => [...state.people].sort(byName);
const categories = () => [...state.categories].sort(byOrder);
const usernameOf = (l) => l.username || l.id;
const roomLabel = (r) => `${locationOf(r)?.name ? locationOf(r).name + ' · ' : ''}${r.name}`;

function totals(weekId) {
  const t = new Map(state.people.map((p) => [p.id, { pts: 0, att: 0 }]));
  for (const e of state.entries) if ((!weekId || e.weekId === weekId) && t.has(e.personId)) t.get(e.personId).pts += Number(e.points) || 0;
  for (const a of state.attendance) if ((!weekId || a.weekId === weekId) && t.has(a.personId)) { const r = t.get(a.personId); r.pts += Number(a.points) || 0; r.att++; }
  return t;
}

/* ---------- toast & banner ---------- */
let toastTimer;
function toast(html, undo) {
  toastEl.innerHTML = `<span>${html}</span>${undo ? '<button data-act="undo">Undo</button>' : ''}`;
  toastEl._undo = undo;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4500);
}
toastEl.addEventListener('click', (e) => {
  if (e.target.dataset.act === 'undo' && toastEl._undo) { toastEl._undo(); toastEl._undo = null; toastEl.classList.remove('show'); }
});
function showError(msg) {
  bannerEl.textContent = typeof msg === 'string' ? msg : 'Could not save to the shared database. Check your connection.';
  bannerEl.hidden = false;
  setTimeout(() => { bannerEl.hidden = true; }, 6000);
}

/* ---------- rooms ---------- */
const ROOM_KEY = 'hgui_room';
let roomUnsubs = [];
function setRoom(id) {
  if (id === state.roomId && roomUnsubs.length) return;
  roomUnsubs.forEach((u) => u && u());
  roomUnsubs = [];
  state.roomId = id;
  state.personId = null; state.mergeFrom = null; state.importPreview = null;
  state.roomLoaded = new Set();
  for (const c of ROOM_COLS) state[c] = [];
  if (!id) return;
  try { localStorage.setItem(ROOM_KEY, id); } catch { /* ignore */ }
  for (const c of ROOM_COLS) {
    roomUnsubs.push(store.watchWhere(c, 'roomId', id, (docs) => {
      if (state.roomId !== id) return;
      state[c] = docs;
      state.roomLoaded.add(c);
      softRender();
    }));
  }
}
/* ---------- current location (picked in Settings; everything else follows it) ---------- */
// Locations this person can see: owner sees all; admins see the ones they run (even with no rooms yet);
// everyone sees locations where they have at least one room.
const myLocations = () => locations().filter((loc) => adminOf(loc.id) || myRooms().some((r) => r.locationId === loc.id));
const curLoc = () => {
  const mine = myLocations();
  return mine.find((l) => l.id === state.locId) || locationOf(currentRoom()) || mine[0] || null;
};
const roomsHere = () => { const loc = curLoc(); return loc ? myRooms().filter((r) => r.locationId === loc.id) : []; };
function setLoc(id) {
  state.locId = id;
  state.leaderEdit = null;
  try { localStorage.setItem('hgui_loc', id); } catch { /* ignore */ }
  chooseRoom();
}
// Keep the open room inside the current location (remembering the last room used).
function chooseRoom() {
  const here = roomsHere();
  if (!here.length) { if (state.roomId) setRoom(null); return; }
  if (here.some((r) => r.id === state.roomId)) return;
  let saved = null;
  try { saved = localStorage.getItem(ROOM_KEY); } catch { /* ignore */ }
  setRoom(here.find((r) => r.id === saved)?.id || here[0].id);
}

function roomSelect(extraClass = '') {
  const opts = roomsHere().map((r) => `<option value="${esc(r.id)}" ${r.id === state.roomId ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
  return `<label class="room-pick ${extraClass}"><span>Room</span><select data-role="room" aria-label="Room">${opts}</select></label>`;
}

/* ---------- views ---------- */
function render() {
  if (!state.user) return renderSignIn();
  if (state.access === 'none') return renderNoAccess();
  const leader = me();
  if (state.access !== 'ok' || !leader || state.globalLoaded.size < GLOBAL_COLS.length) return renderMsg('Loading…');
  if (!state.rooms.length) {
    return renderMsg(isOwner() ? 'Setting up rooms… one moment.'
      : 'The app is being updated. The owner needs to open it once to finish. Check back soon.', true);
  }
  if (!myLocations().length) return renderMsg("You don't have access to any rooms yet. Ask an admin to give you a room.", true);
  chooseRoom();
  if (state.roomId && state.roomLoaded.size < ROOM_COLS.length) return renderMsg('Loading…');

  const loc = curLoc();
  if (pendingImport) {
    if (state.roomId && adminOf(loc?.id)) { state.importPreview = parseImport(pendingImport); state.tab = 'settings'; }
    else toast('Only admins can import.');
    pendingImport = null;
    history.replaceState(null, '', location.pathname + location.search);
  }
  // No rooms here yet (an admin's new location): only Settings makes sense.
  if (!state.roomId) state.tab = 'settings';
  const showWeek = state.tab !== 'settings' && !(state.tab === 'board' && state.board === 'all');
  const isThisWeek = state.week === weekStart(new Date());
  const room = currentRoom();

  const body = { points: viewPoints, attendance: viewAttendance, board: viewBoard, settings: viewSettings }[state.tab]();
  const tabs = [['attendance', '✓', 'Attendance'], ['points', '★', 'Points'], ['board', '🏆', 'Board'], ['settings', '⚙', 'Settings']];

  app.innerHTML = `
    <header class="top">
      <div><h1>${esc(loc?.name || APP_NAME)}</h1><small class="room-name">${esc(room?.name || 'No rooms yet')}</small></div>
      <button class="link" data-act="logout">${esc(leader.name)} · Log out</button>
    </header>
    ${store.mode === 'local' ? '<div class="demo">Demo mode: no login, and data is saved on this device only.</div>' : ''}
    ${state.tab === 'attendance' && roomsHere().length > 1 ? roomSelect() : ''}
    ${showWeek ? `
      <nav class="week">
        <button data-act="week" data-n="-1" aria-label="Previous week">◀</button>
        <div><strong>Week of ${weekLabel(state.week)}</strong>
          ${isThisWeek ? '<small>This week</small>' : '<button class="link small" data-act="thisWeek">Jump to this week</button>'}</div>
        <button data-act="week" data-n="1" aria-label="Next week">▶</button>
      </nav>` : ''}
    <main>${body}</main>
    <nav class="tabs">
      ${tabs.map(([id, icon, label]) => `<button data-act="tab" data-tab="${id}" class="${state.tab === id ? 'on' : ''}"><span>${icon}</span>${label}</button>`).join('')}
    </nav>`;
}

function renderMsg(text, withLogout = false) {
  app.innerHTML = withLogout
    ? authCard(`<p>${esc(text)}</p><button class="link" data-act="logout">Log out</button>`)
    : `<p class="center muted">${esc(text)}</p>`;
}

const authCard = (inner) => `
  <div class="card narrow">
    <img src="icon.svg" alt="" class="logo">
    <h1>${APP_NAME}</h1>
    ${state.authMsg ? `<p class="msg">${esc(state.authMsg)}</p>` : ''}
    ${inner}
  </div>`;

function renderSignIn() {
  app.innerHTML = authCard(`
    <p class="muted">Leaders sign in to take attendance and give points.</p>
    <form data-form="signin">
      <input name="username" placeholder="Username" required autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="username">
      <input name="password" type="password" placeholder="Password" required autocomplete="current-password">
      <button class="primary wide">Sign in</button>
    </form>
    <p class="muted small">Forgot your password? Ask an admin to set a new one.</p>
    <button class="link small" data-act="google">Sign in with Google (older accounts)</button>`);
}

function renderNoAccess() {
  app.innerHTML = authCard(state.setupDone ? `
    <p>Your login worked, but it isn't on the leader list.</p>
    <p class="muted">Ask an admin to add you in Settings → Leaders.</p>
    <button class="link" data-act="logout">Log out</button>` : `
    <p><strong>Welcome!</strong> No one has set up this app yet. You'll be the admin.</p>
    <form data-form="setup">
      <input name="name" placeholder="Your name" required value="${esc(state.user.name)}">
      <button class="primary">Set up as admin</button>
    </form>
    <button class="link" data-act="logout">Log out</button>`);
}

function viewPoints() {
  const everyone = people();
  if (!everyone.length) return emptyState('No kids in this room yet.', adminOf(curLoc()?.id) ? 'Add kids in Settings.' : 'Ask an admin to add kids.');
  const t = totals(state.week);
  const here = new Set(state.attendance.filter((a) => a.weekId === state.week).map((a) => a.personId));
  const ppl = state.showAllKids ? everyone : everyone.filter((p) => here.has(p.id));
  const person = everyone.find((p) => p.id === state.personId);
  if (person) return viewPerson(person, ppl, t);

  const toggle = `
    <div class="seg">
      <button class="${state.showAllKids ? '' : 'on'}" data-act="setAllKids" data-v="0">Here this week (${here.size})</button>
      <button class="${state.showAllKids ? 'on' : ''}" data-act="setAllKids" data-v="1">All kids (${everyone.length})</button>
    </div>`;
  if (!ppl.length) {
    return `${toggle}
      <div class="center muted empty"><p><strong>No one is marked present this week.</strong></p>
      <p>Take attendance first, then come back to give points.</p></div>
      <button class="primary wide" data-act="tab" data-tab="attendance">Go to Attendance</button>`;
  }
  return `${toggle}
    <ul class="kid-rows">
      ${ppl.map((p) => `<li><button data-act="pickPerson" data-id="${p.id}">
        <span class="name">${esc(p.name)}${state.showAllKids && !here.has(p.id) ? '<small>not marked here</small>' : ''}</span>
        <b>${t.get(p.id).pts}</b><span class="chev">›</span></button></li>`).join('')}
    </ul>`;
}

function viewPerson(person, ppl, t) {
  const cats = categories();
  const list = state.entries.filter((e) => e.personId === person.id && e.weekId === state.week).sort((a, b) => b.ts - a.ts);
  const att = state.attendance.find((a) => a.personId === person.id && a.weekId === state.week);
  const i = ppl.findIndex((p) => p.id === person.id);
  const next = i >= 0 && i < ppl.length - 1 ? ppl[i + 1] : null;
  return `
    <div class="person-nav">
      <button class="link" data-act="backToList">‹ Back</button>
      ${next ? `<button class="link" data-act="pickPerson" data-id="${next.id}">${esc(next.name)} ›</button>` : ''}
    </div>
    <div class="person-head">
      <h2>${esc(person.name)}</h2>
      <div class="big">${t.get(person.id).pts} <small>pts this week</small></div>
    </div>
    ${cats.length ? `<div class="cat-grid">
      ${cats.map((c) => `<button class="cat" data-act="give" data-id="${c.id}"><span>${esc(c.name)}</span><b>+${Number(c.points) || 0}</b></button>`).join('')}
    </div>` : '<p class="muted center">No categories in this room yet.</p>'}
    <button class="ghost wide" data-act="custom">Custom amount…</button>
    <h3>This week</h3>
    <ul class="log">
      ${att ? `<li><span>Attendance</span><b>+${Number(att.points) || 0}</b><span></span></li>` : ''}
      ${list.map((e) => `<li><span>${esc(e.categoryName)}<small>${esc(e.leaderName || '')}</small></span><b>${e.points >= 0 ? '+' : ''}${e.points}</b><button class="x" data-act="delEntry" data-id="${e.id}" aria-label="Remove">✕</button></li>`).join('')}
      ${!list.length && !att ? '<li class="muted">Nothing yet.</li>' : ''}
    </ul>`;
}

function viewAttendance() {
  const ppl = people();
  if (!ppl.length) return emptyState('No kids in this room yet.', adminOf(curLoc()?.id) ? 'Add kids in Settings.' : 'Ask an admin to add kids.');
  const here = new Set(state.attendance.filter((a) => a.weekId === state.week).map((a) => a.personId));
  const count = ppl.filter((p) => here.has(p.id)).length;
  return `
    <p class="center"><strong>${count} of ${ppl.length}</strong> here · +${attendancePoints()} pts each</p>
    <ul class="att">
      ${ppl.map((p) => `<li><button class="${here.has(p.id) ? 'on' : ''}" data-act="toggleAtt" data-id="${p.id}"><span class="box">${here.has(p.id) ? '✓' : ''}</span>${esc(p.name)}</button></li>`).join('')}
    </ul>`;
}

function viewBoard() {
  const t = totals(state.board === 'week' ? state.week : null);
  const rows = people().map((p) => ({ p, ...t.get(p.id) })).sort((a, b) => b.pts - a.pts || byName(a.p, b.p));
  let rank = 0, prev = null;
  return `
    <div class="seg">
      <button class="${state.board === 'week' ? 'on' : ''}" data-act="board" data-v="week">This week</button>
      <button class="${state.board === 'all' ? 'on' : ''}" data-act="board" data-v="all">All time</button>
    </div>
    ${!rows.length ? emptyState('No kids in this room yet.', '') : `<ol class="board">
      ${rows.map((r, i) => { if (r.pts !== prev) { rank = i + 1; prev = r.pts; } return `
        <li data-act="pickPerson" data-id="${r.p.id}" data-go="points">
          <span class="rank r${rank}">${rank}</span>
          <span class="name">${esc(r.p.name)}<small>${r.att} attended</small></span>
          <b>${r.pts}</b>
        </li>`; }).join('')}
    </ol>`}`;
}

/* ---------- settings (admins) ---------- */
const UI_KEY = 'hgui_open';
const openSections = (() => { try { return new Set(JSON.parse(localStorage.getItem(UI_KEY)) || []); } catch { return new Set(); } })();
function isOpen(k) {
  if (k === 'people' && state.mergeFrom) return true;
  if (k === 'import' && state.importPreview) return true;
  if (k === 'leaders' && state.leaderEdit) return true;
  return openSections.has(k);
}
const fold = (key, title, count, inner) => `
  <section class="card fold ${isOpen(key) ? 'open' : ''}">
    <button class="fold-head" data-act="fold" data-k="${key}" aria-expanded="${isOpen(key)}">
      <h2>${title}</h2>${count !== '' ? `<span class="count">${count}</span>` : ''}<span class="caret">›</span>
    </button>
    <div class="fold-body">${inner}</div>
  </section>`;

// Access in one location: a dropdown (No access / All rooms / Only some rooms),
// plus room checkboxes when "Only some rooms" is picked. l = leader being edited, or null for the Add form.
function accessMode(l, loc) {
  if (leaderLocs(l).includes(loc.id)) return 'all';
  if (roomsIn(loc.id).some((r) => (l?.rooms || []).includes(r.id)) || state.someRooms.has(`${l?.id}|${loc.id}`)) return 'some';
  return 'none';
}
function accessPicker(loc, l) {
  const mode = l ? accessMode(l, loc) : 'all';
  const who = l ? `data-leader="${esc(l.id)}"` : '';
  const rooms = roomsIn(loc.id);
  return `<div class="room-checks access">
    <label>Access in ${esc(loc.name)}
      <select name="access" ${who} data-lf="access" data-loc="${esc(loc.id)}">
        ${l ? `<option value="none" ${mode === 'none' ? 'selected' : ''}>No access</option>` : ''}
        <option value="all" ${mode === 'all' ? 'selected' : ''}>All rooms (includes rooms added later)</option>
        <option value="some" ${mode === 'some' ? 'selected' : ''} ${rooms.length ? '' : 'disabled'}>Only some rooms</option>
      </select>
    </label>
    ${l ? '' : `<input type="hidden" name="accessLoc" value="${esc(loc.id)}">`}
    <div class="some-rooms" ${mode === 'some' ? '' : 'hidden'}>
      ${rooms.map((r) => `<label class="check sub"><input type="checkbox" name="rooms" value="${esc(r.id)}" ${(l?.rooms || []).includes(r.id) ? 'checked' : ''} ${l ? `${who} data-lf="room"` : ''}> ${esc(r.name)}</label>`).join('')}
    </div>
  </div>`;
}

// What someone can do inside one location, in words.
function accessIn(l, loc) {
  if (isOwnerL(l)) return 'Owner · every location';
  if (adminOfL(l, loc.id)) return `Admin of ${loc.name}`;
  if (leaderLocs(l).includes(loc.id)) return `All of ${loc.name}`;
  const rs = roomsIn(loc.id).filter((r) => (l.rooms || []).includes(r.id)).map((r) => r.name);
  return rs.length ? rs.join(', ') : `No access to ${loc.name}`;
}
const hasAccessIn = (l, loc) => isOwnerL(l) || leaderLocs(l).includes(loc.id) || roomsIn(loc.id).some((r) => (l.rooms || []).includes(r.id))
  || state.someRooms.has(`${l.id}|${loc.id}`);
// Location admins can only fully manage (reset password, remove) leaders whose access is all inside their locations.
const leaderInsideMine = (l) => {
  const mine = leaderLocs(me());
  const roomLocs = (l.rooms || []).map((id) => state.rooms.find((r) => r.id === id)?.locationId).filter(Boolean);
  return [...leaderLocs(l), ...roomLocs].every((id) => mine.includes(id));
};
const canEditLeader = (l) => l.id !== state.user.email && !isOwnerL(l) && (isOwner() || !l.admin);
const canFullyManage = (l) => canEditLeader(l) && (isOwner() || leaderInsideMine(l));

/* ---------- activity log (admins, one location + one week at a time) ---------- */
let logUnsub = null;
function watchLog(loc) {
  const key = `${loc.id}|${state.logWeek}`;
  if (state.logKey === key) return;
  logUnsub?.();
  state.logKey = key;
  state.log = null;
  logUnsub = store.watchWhere2('log', [['locationId', loc.id], ['weekId', state.logWeek]], (docs) => {
    if (state.logKey !== key) return;
    state.log = docs.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    softRender();
  });
}
function logHtml(loc) {
  if (isOpen('log')) watchLog(loc);
  const rooms = roomsIn(loc.id);
  const rows = (state.log || []).filter((x) => !state.logRoom || x.roomId === state.logRoom);
  const when = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `
    <p class="muted small">Everything entered in ${esc(loc.name)} for the week of points it counts toward.</p>
    <nav class="week">
      <button data-act="logWeek" data-n="-1" aria-label="Previous week">◀</button>
      <div><strong>Week of ${weekLabel(state.logWeek)}</strong>
        ${state.logWeek === weekStart(new Date()) ? '<small>This week</small>' : '<button class="link small" data-act="logThisWeek">Jump to this week</button>'}</div>
      <button data-act="logWeek" data-n="1" aria-label="Next week">▶</button>
    </nav>
    ${rooms.length > 1 ? `<div class="log-filter"><select data-role="logRoom" aria-label="Room">
      <option value="">All rooms</option>${rooms.map((r) => `<option value="${esc(r.id)}" ${r.id === state.logRoom ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
    </select></div>` : ''}
    ${state.log === null ? '<p class="muted small center">Loading…</p>' : !rows.length ? '<p class="muted small center">Nothing entered this week.</p>' : `
    <ul class="log-list">
      ${rows.map((x) => `<li><span class="${x.kind === 'del' ? 'del' : x.kind === 'add' ? 'add' : ''}">${esc(x.detail)}</span>
        <small>${esc(x.leaderName || 'Someone')}${x.roomName ? ` · ${esc(x.roomName)}` : ''} · ${esc(when(x.ts))}</small></li>`).join('')}
    </ul>`}`;
}

/* ---------- settings: everyone gets this page; what's on it depends on who you are ---------- */
function themeNow() { try { return localStorage.getItem('hgui_theme') || 'auto'; } catch { return 'auto'; } }

function accountHtml() {
  const l = me();
  return `
    <p class="small"><b>Name:</b> ${esc(l.name)} <span class="muted">· ${roleOf(l)}</span></p>
    <form data-form="changeUsername" class="stack" autocomplete="off">
      <label>Username
        <input name="username" value="${esc(usernameOf(l))}" required autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off">
      </label>
      <button class="primary wide">Save username</button>
    </form>
    <button class="ghost wide" data-act="setPassword" data-id="${esc(l.id)}">Change my password</button>
    <h3>Appearance</h3>
    <div class="seg three">
      ${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) =>
        `<button class="${themeNow() === v ? 'on' : ''}" data-act="theme" data-v="${v}">${label}</button>`).join('')}
    </div>`;
}

function viewSettings() {
  const loc = curLoc();
  const admin = !!loc && adminOf(loc.id);
  const locRooms = loc ? roomsIn(loc.id) : [];
  const room = currentRoom();

  const locPicker = myLocations().length > 1 ? `
    <label class="room-pick wide-pick loc-pick"><span>Location</span>
      <select data-role="loc" aria-label="Location">
        ${myLocations().map((l) => `<option value="${esc(l.id)}" ${l.id === loc?.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
      </select>
    </label>` : '';
  const footer = `
    ${fold('account', 'My account', '', accountHtml())}
    <p class="muted small center">App version ${APP_VERSION}</p>`;

  if (!admin) return `${locPicker}${footer}`;

  const roomsHtml = `
    <div class="loc-block">
      ${isOwner() ? `<div class="row">
        <input value="${esc(loc.name)}" data-col="locations" data-id="${esc(loc.id)}" data-field="name" aria-label="Location name" class="loc-name">
        <button class="x" data-act="delLocation" data-id="${esc(loc.id)}" aria-label="Delete location">✕</button>
      </div>` : ''}
      <ul class="edit rooms-list">
        ${locRooms.map((r) => `<li>
          <input value="${esc(r.name)}" data-col="rooms" data-id="${esc(r.id)}" data-field="name" aria-label="Room name">
          <button class="x" data-act="delRoom" data-id="${esc(r.id)}" aria-label="Delete room">✕</button>
        </li>`).join('') || '<li class="muted small">No rooms yet.</li>'}
      </ul>
    </div>
    <h3>Add a room to ${esc(loc.name)}</h3>
    <form data-form="addRoom" class="stack">
      <input type="hidden" name="locationId" value="${esc(loc.id)}">
      <input name="name" placeholder="Room name (e.g. Sparks)" required>
      <select name="copyFrom"><option value="">Start with no point categories</option>${state.rooms.filter((r) => adminOf(r.locationId)).map((r) => `<option value="${esc(r.id)}">Copy categories from ${esc(roomLabel(r))}</option>`).join('')}</select>
      <button class="primary wide">Add room</button>
    </form>
    ${isOwner() ? `
    <h3>Add a location</h3>
    <form data-form="addLocation" class="row">
      <input name="name" placeholder="e.g. Awana" required><button class="primary">Add</button>
    </form>` : ''}`;

  // Each location lists only its own people (the owner isn't listed; they're everywhere).
  const leaders = [...state.leaders].sort(byName)
    .filter((l) => !isOwnerL(l) && (hasAccessIn(l, loc) || adminOfL(l, loc.id) || state.leaderEdit === l.id));
  const leadersHtml = `
    <p class="muted small">People with access to <b>${esc(loc.name)}</b>.${myLocations().length > 1 ? ' Switch locations at the top for the others.' : ''}
      ${isOwner() ? '' : ' Only the owner can add or change admins.'}</p>
    <ul class="leaders">
      ${leaders.map((l) => {
        const editing = state.leaderEdit === l.id && canEditLeader(l);
        const self = l.id === state.user.email;
        return `<li>
          <div class="row">
            <span class="grow"><b>${esc(l.name)}</b> <em class="badge">${roleOf(l)}</em>${self ? ' <small class="muted">you</small>' : ''}
              <small class="email">Username: ${esc(usernameOf(l))}</small><small class="email">${esc(accessIn(l, loc))}</small></span>
            ${canEditLeader(l) ? `<button class="ghost small" data-act="editLeader" data-id="${esc(l.id)}">${editing ? 'Done' : 'Edit'}</button>` : ''}
          </div>
          ${editing ? `<div class="leader-edit">
            ${isOwner() ? `<label>Role<select data-leader="${esc(l.id)}" data-lf="role"><option value="leader" ${l.admin ? '' : 'selected'}>Leader</option><option value="admin" ${l.admin ? 'selected' : ''}>Admin</option></select></label>` : ''}
            ${l.admin
              ? `<div class="room-checks"><small>Admin of</small>${locations().map((x) => `
                  <label class="check"><input type="checkbox" ${leaderLocs(l).includes(x.id) ? 'checked' : ''} value="${esc(x.id)}" data-leader="${esc(l.id)}" data-lf="loc"> ${esc(x.name)}</label>`).join('')}</div>`
              : `${accessPicker(loc, l)}${isOwner() && locations().length > 1 ? `
                <div class="room-checks"><small>Other locations</small>${locations().filter((x) => x.id !== loc.id).map((x) => `
                  <label class="check"><input type="checkbox" ${hasAccessIn(l, x) ? 'checked' : ''} value="${esc(x.id)}" data-leader="${esc(l.id)}" data-lf="otherLoc"> ${esc(x.name)}</label>`).join('')}
                  <p class="muted small">Checking a location gives all its rooms. Switch to that location to narrow it.</p>
                </div>` : ''}`}
            ${canFullyManage(l) ? `
              <button class="ghost wide" data-act="setPassword" data-id="${esc(l.id)}">Set a new password</button>
              <button class="ghost wide danger" data-act="delLeader" data-id="${esc(l.id)}">Remove leader</button>`
              : '<p class="muted small">This leader also works in another location, so only the owner can reset their password or remove them.</p>'}
          </div>` : ''}
        </li>`;
      }).join('') || `<li class="muted small">No one has access to ${esc(loc.name)} yet.</li>`}
    </ul>
    <h3>Add a new leader</h3>
    <form data-form="addLeader" class="stack" autocomplete="off">
      <input name="name" placeholder="Name" required>
      <input name="username" placeholder="Username" required autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off">
      <input name="password" placeholder="Password (6+ characters)" required minlength="6" autocomplete="new-password">
      ${isOwner() ? `<select name="role"><option value="leader">Leader</option><option value="admin">Admin of ${esc(loc.name)}</option></select>` : '<input type="hidden" name="role" value="leader">'}
      ${accessPicker(loc, null)}
      <button class="primary wide">Add leader</button>
    </form>`;

  const head = `
    ${locPicker}
    ${fold('rooms', `${esc(loc.name)} rooms`, locRooms.length, roomsHtml)}
    ${fold('leaders', 'Leaders', leaders.filter((l) => hasAccessIn(l, loc)).length, leadersHtml)}
    ${fold('log', 'Activity log', '', logHtml(loc))}`;

  if (!room) {
    return `${head}
      <p class="muted small center">No rooms in ${esc(loc.name)} yet. Add one above to set up kids and point categories.</p>
      ${footer}`;
  }

  return `
    ${head}

    <div class="room-settings-head">
      <p class="small muted">The settings below are for one room:</p>
      ${roomSelect('wide-pick')}
    </div>

    ${fold('people', 'Kids', state.people.length, `
      ${mergePanelHtml()}
      <form data-form="addPerson" class="row">
        <input name="name" placeholder="Name" required><button class="primary">Add</button>
      </form>
      <ul class="edit">
        ${people().map((p) => `<li>
          <input value="${esc(p.name)}" data-col="people" data-id="${p.id}" data-field="name" aria-label="Name">
          <button class="ghost small" data-act="mergeStart" data-id="${p.id}">Merge</button>
          <button class="x" data-act="del" data-col="people" data-id="${p.id}" data-name="${esc(p.name)}" aria-label="Delete">✕</button>
        </li>`).join('')}
      </ul>`)}

    ${fold('categories', 'Point categories', state.categories.length, `
      <p class="muted small">Each category becomes a button. Changing points only affects new taps.</p>
      <form data-form="addCategory" class="row">
        <input name="name" placeholder="Category" required>
        <input name="points" type="number" inputmode="numeric" placeholder="Pts" required class="pts">
        <button class="primary">Add</button>
      </form>
      <ul class="edit">
        ${categories().map((c, i, all) => `<li>
          <input value="${esc(c.name)}" data-col="categories" data-id="${c.id}" data-field="name" aria-label="Category name">
          <input type="number" inputmode="numeric" class="pts" value="${Number(c.points) || 0}" data-col="categories" data-id="${c.id}" data-field="points" aria-label="Points">
          <button class="x" data-act="move" data-id="${c.id}" data-n="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
          <button class="x" data-act="move" data-id="${c.id}" data-n="1" ${i === all.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button>
          <button class="x" data-act="del" data-col="categories" data-id="${c.id}" data-name="${esc(c.name)}" aria-label="Delete">✕</button>
        </li>`).join('')}
      </ul>`)}

    ${fold('attendance', 'Attendance', `${attendancePoints()} pts`, `
      <label class="row">Points for being here
        <input type="number" inputmode="numeric" class="pts" value="${attendancePoints()}" data-col="rooms" data-id="${esc(room.id)}" data-field="attendancePoints">
      </label>`)}

    ${fold('import', 'Import', '', `
      <p class="muted small">Imports into <b>${esc(roomLabel(room))}</b>. Put <b>CATEGORIES</b> on its own line, then "name, points" per line. Then <b>KIDS</b>, then "name, current total" per line (added as a one-time "Starting total"). Optional: <b>ATTENDANCE</b>, then "name: 2026-09-16, 2026-09-23" for past weeks attended (no extra points).</p>
      ${state.importPreview ? `<div id="import-preview">${importPreviewHtml()}</div>` : `
      <form data-form="importPreview">
        <textarea name="text" rows="8" placeholder="CATEGORIES&#10;Memory Verse, 10&#10;KIDS&#10;Sam, 120" required></textarea>
        <button class="primary wide">Preview import</button>
      </form>`}`)}

    ${fold('backup', 'Backup', '', `
      <button class="ghost wide" data-act="export">Download this room's points (CSV)</button>
      <button class="ghost wide" data-act="exportAll">${isOwner() ? 'Download everything: all locations &amp; rooms (CSV)'
        : `Download everything in ${esc(locations().filter((x) => adminOf(x.id)).map((x) => x.name).join(' & '))} (CSV)`}</button>
      <p class="muted small">One file with every kid, point category, point, and attendance mark${isOwner() ? '' : ' in the locations you run'}. Opens in Excel or Google Sheets.</p>`)}
    ${footer}`;
}

const emptyState = (title, sub) => `<div class="center muted empty"><p><strong>${title}</strong></p><p>${sub}</p></div>`;

/* ---------- actions ---------- */
// Record who entered what, for the location's activity log.
// weekId = the week the points/attendance count toward (setup changes use the current week).
function logIt(detail, kind = '', weekId = state.week, room = currentRoom()) {
  if (!room) return;
  store.add('log', { locationId: room.locationId || '', roomId: room.id || '', roomName: room.name || '', weekId,
    leaderEmail: state.user.email, leaderName: me()?.name || '', detail, kind, ts: Date.now() });
}
const nowWeek = () => weekStart(new Date());
const signed = (n) => `${n >= 0 ? '+' : ''}${n}`;

function addEntry(person, name, points, categoryId = null) {
  const id = store.add('entries', {
    roomId: state.roomId, weekId: state.week, personId: person.id, personName: person.name,
    categoryId, categoryName: name, points,
    leaderEmail: state.user.email, leaderName: me()?.name || '', ts: Date.now(),
  });
  logIt(`${signed(points)} ${name} → ${person.name}`, 'add');
  navigator.vibrate?.(15);
  toast(`${signed(points)} ${esc(name)} → ${esc(person.name)}`, () => {
    store.remove('entries', id);
    logIt(`Undid ${signed(points)} ${name} → ${person.name}`, 'del');
  });
}

async function setLeaderPassword(l, pw) {
  if (l.id === state.user.email) {
    await store.changeMyPassword(pw);
    return;
  }
  // Firebase doesn't let one person change another's password from the app, so we give them
  // a fresh login behind the same username and retire the old one.
  const username = usernameOf(l);
  const authEmail = loginEmailFor(username);
  await store.createLogin(authEmail, pw);
  const { id, ...data } = l;
  await store.batch([
    { op: 'set', col: 'leaders', id: authEmail, data: { ...data, username } },
    { op: 'set', col: 'usernames', id: username, data: { authEmail } },
    { op: 'delete', col: 'leaders', id: l.id },
  ]);
  if (state.leaderEdit === l.id) state.leaderEdit = authEmail;
}

const actions = {
  tab: (d) => { state.tab = d.tab; state.personId = null; requestAnimationFrame(() => window.scrollTo(0, 0)); },
  week: (d) => { state.week = shiftWeek(state.week, Number(d.n)); },
  thisWeek: () => { state.week = weekStart(new Date()); },
  board: (d) => { state.board = d.v; },
  logout: async () => { await store.signOut(); location.reload(); },
  google: async () => {
    try { await store.signInGoogle(); } catch (e) { authError(e); }
  },
  pickPerson: (d) => {
    if (!state.personId) state.listScroll = window.scrollY;
    state.personId = d.id;
    if (d.go) state.tab = d.go;
    requestAnimationFrame(() => window.scrollTo(0, 0));
  },
  backToList: () => {
    state.personId = null;
    const y = state.listScroll || 0;
    requestAnimationFrame(() => window.scrollTo(0, y));
  },
  give: (d) => {
    const person = state.people.find((p) => p.id === state.personId);
    const cat = state.categories.find((c) => c.id === d.id);
    if (person && cat) addEntry(person, cat.name, Number(cat.points) || 0, cat.id);
  },
  custom: () => {
    const person = state.people.find((p) => p.id === state.personId);
    if (!person) return;
    const raw = prompt(`Points for ${person.name} (use a minus sign to take away):`);
    if (raw === null) return;
    const points = Number(raw);
    if (!Number.isFinite(points) || raw.trim() === '') return alert('Please enter a number.');
    const note = prompt('What for? (optional)') || 'Custom';
    addEntry(person, note, points);
  },
  delEntry: (d) => {
    const e = state.entries.find((x) => x.id === d.id);
    if (!e || !confirm(`Remove ${e.points} pts for "${e.categoryName}"?`)) return;
    store.remove('entries', d.id);
    const who = state.people.find((p) => p.id === e.personId)?.name || e.personName || '';
    logIt(`Removed ${signed(Number(e.points) || 0)} ${e.categoryName} from ${who}`, 'del', e.weekId);
  },
  undo: () => {},
  toggleAtt: (d) => {
    const id = `${state.week}_${d.id}`;
    const person = state.people.find((p) => p.id === d.id);
    if (state.attendance.some((a) => a.id === id)) {
      store.remove('attendance', id);
      logIt(`Unmarked ${person?.name || ''} as here`, 'del');
    } else {
      store.set('attendance', id, { roomId: state.roomId, weekId: state.week, personId: d.id, personName: person?.name || '',
        points: attendancePoints(), leaderName: me()?.name || '', ts: Date.now() });
      logIt(`Marked ${person?.name || ''} here (${signed(attendancePoints())})`, 'add');
      navigator.vibrate?.(15);
    }
  },
  del: (d) => {
    const extra = d.col === 'people' ? ' Their points will no longer appear on the board.' : '';
    if (!confirm(`Delete "${d.name}"?${extra}`)) return;
    store.remove(d.col, d.id);
    logIt(`Deleted ${d.col === 'people' ? 'kid' : 'category'} "${d.name}"`, 'del', nowWeek());
  },
  move: (d) => {
    const cats = categories();
    const i = cats.findIndex((c) => c.id === d.id);
    const j = i + Number(d.n);
    if (j < 0 || j >= cats.length) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    cats.forEach((c, k) => { if (c.order !== k) store.update('categories', c.id, { order: k }); });
  },
  fold: (d) => {
    if (isOpen(d.k)) {
      openSections.delete(d.k);
      if (d.k === 'people') state.mergeFrom = null;
      if (d.k === 'import') state.importPreview = null;
      if (d.k === 'leaders') state.leaderEdit = null;
    } else openSections.add(d.k);
    try { localStorage.setItem(UI_KEY, JSON.stringify([...openSections])); } catch { /* ignore */ }
  },
  setAllKids: (d) => { state.showAllKids = d.v === '1'; },
  theme: (d) => {
    try { if (d.v === 'auto') localStorage.removeItem('hgui_theme'); else localStorage.setItem('hgui_theme', d.v); } catch { /* ignore */ }
    if (d.v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = d.v;
  },
  logWeek: (d) => { state.logWeek = shiftWeek(state.logWeek, Number(d.n)); },
  logThisWeek: () => { state.logWeek = weekStart(new Date()); },

  // rooms & locations
  delLocation: (d) => {
    const loc = state.locations.find((l) => l.id === d.id);
    if (!loc || !isOwner()) return;
    if (roomsIn(loc.id).length) return alert(`Remove the rooms in ${loc.name} first.`);
    if (confirm(`Delete location "${loc.name}"?`)) store.remove('locations', loc.id);
  },
  delRoom: (d) => {
    const r = state.rooms.find((x) => x.id === d.id);
    if (!r) return;
    if (state.rooms.length === 1) return alert("You can't delete the last room.");
    if (!adminOf(r.locationId)) return;
    if (!confirm(`Delete room "${roomLabel(r)}"? Its kids and points will be hidden for good.`)) return;
    logIt(`Deleted room "${r.name}"`, 'del', nowWeek(), r);
    store.remove('rooms', r.id);
  },

  // leaders
  editLeader: (d) => { state.leaderEdit = state.leaderEdit === d.id ? null : d.id; },
  setPassword: async (d) => {
    const l = state.leaders.find((x) => x.id === d.id);
    if (!l) return;
    const self = l.id === state.user.email;
    const pw = prompt(self ? 'Your new password (6+ characters):' : `New password for ${l.name} (6+ characters):`);
    if (pw === null) return;
    if (pw.length < 6) return alert('Passwords need at least 6 characters.');
    try {
      await setLeaderPassword(l, pw);
      toast(self ? 'Your password was changed.' : `New password set. ${esc(l.name)} signs in with username <b>${esc(usernameOf(l))}</b>.`);
    } catch (e) {
      console.error(e);
      alert(e?.code === 'auth/requires-recent-login' ? 'For security, log out and back in, then try again.'
        : (AUTH_ERRORS[e?.code] || 'Could not set the password. Please try again.'));
    }
  },
  delLeader: (d) => {
    const l = state.leaders.find((x) => x.id === d.id);
    if (!l || !confirm(`Remove ${l.name}? They won't be able to sign in anymore.`)) return;
    const ops = [{ op: 'delete', col: 'leaders', id: l.id }];
    ops.push({ op: 'delete', col: 'usernames', id: usernameOf(l) });
    store.batch(ops).catch(() => showError());
    state.leaderEdit = null;
  },

  // kids
  mergeStart: (d) => { state.mergeFrom = d.id; window.scrollTo({ top: 0, behavior: 'smooth' }); },
  mergeCancel: () => { state.mergeFrom = null; },
  mergeInto: (d) => {
    const from = state.people.find((p) => p.id === state.mergeFrom);
    const to = state.people.find((p) => p.id === d.id);
    if (!from || !to) return;
    if (!confirm(`Move all of ${from.name}'s points and attendance to ${to.name}, then remove ${from.name}?`)) return;
    mergeKids(from.id, to.id);
    logIt(`Merged kid "${from.name}" into "${to.name}"`, '', nowWeek());
    state.mergeFrom = null;
    toast(`Merged ${esc(from.name)} into ${esc(to.name)}`);
  },

  // import / export
  importCancel: () => { state.importPreview = null; },
  importRun: () => {
    const p = state.importPreview;
    if (!p) return;
    const roomId = state.roomId;
    const cats = new Map(state.categories.map((c) => [norm(c.name), c]));
    let order = Math.max(-1, ...state.categories.map((c) => c.order ?? 0));
    for (const c of p.categories) {
      const ex = cats.get(norm(c.name));
      if (ex) store.update('categories', ex.id, { points: c.points });
      else store.add('categories', { roomId, name: c.name, points: c.points, order: ++order });
    }
    const ppl = new Map(state.people.map((x) => [norm(x.name), x]));
    const personId = (name) => {
      let id = ppl.get(norm(name))?.id;
      if (!id) { id = store.add('people', { roomId, name }); ppl.set(norm(name), { id, name }); }
      return id;
    };
    for (const k of p.kids) {
      const id = personId(k.name);
      const entryId = 'carryover_' + id; // one per kid; re-importing replaces it
      if (k.total) {
        store.set('entries', entryId, {
          roomId, weekId: CARRYOVER, personId: id, personName: k.name,
          categoryId: null, categoryName: 'Starting total', points: k.total,
          leaderEmail: state.user.email, leaderName: me()?.name || '', ts: Date.now(),
        });
      } else if (state.entries.some((e) => e.id === entryId)) {
        store.remove('entries', entryId);
      }
    }
    let marks = 0;
    for (const a of p.attendance) {
      const id = personId(a.name);
      for (const w of a.weeks) {
        const docId = `${w}_${id}`;
        if (state.attendance.some((x) => x.id === docId)) continue;
        store.set('attendance', docId, { roomId, weekId: w, personId: id, personName: a.name, points: 0, imported: true,
          leaderName: me()?.name || '', ts: Date.now() });
        marks++;
      }
    }
    toast(`Imported ${p.categories.length} categories, ${p.kids.length} kids, ${marks} attendance marks`);
    logIt(`Imported ${p.categories.length} categories, ${p.kids.length} kids, ${marks} attendance marks`, 'add', nowWeek());
    state.importPreview = null;
  },
  // One CSV for every location and room this person runs (the owner gets everything).
  exportAll: async () => {
    toast('Building the file…');
    const head = ['Location', 'Room', 'Record', 'Week starting', 'Kid', 'Category', 'Points', 'Times attended', 'Entered by', 'Time'];
    const rows = [];
    const locName = (id) => state.locations.find((l) => l.id === id)?.name || '';
    const rooms = [...state.rooms].filter((r) => adminOf(r.locationId))
      .sort((a, b) => locName(a.locationId).localeCompare(locName(b.locationId)) || byOrder(a, b));
    try {
      for (const r of rooms) {
        const [ppl, cats, ents, atts] = await Promise.all(ROOM_COLS.map((c) => store.getWhere(c, 'roomId', r.id)));
        const L = locName(r.locationId);
        const kid = (id, fallback) => ppl.find((p) => p.id === id)?.name || fallback || '';
        const total = new Map(ppl.map((p) => [p.id, { pts: 0, att: 0 }]));
        for (const e of ents) if (total.has(e.personId)) total.get(e.personId).pts += Number(e.points) || 0;
        for (const a of atts) if (total.has(a.personId)) { const t = total.get(a.personId); t.pts += Number(a.points) || 0; t.att++; }
        for (const p of [...ppl].sort(byName)) rows.push([L, r.name, 'Kid (all-time total)', '', p.name, '', total.get(p.id).pts, total.get(p.id).att, '', '']);
        for (const c of [...cats].sort(byOrder)) rows.push([L, r.name, 'Point category', '', '', c.name, Number(c.points) || 0, '', '', '']);
        rows.push([L, r.name, 'Attendance points', '', '', '', Number(r.attendancePoints ?? 10), '', '', '']);
        const dated = [
          ...ents.map((e) => [L, r.name, e.weekId === CARRYOVER ? 'Starting total' : 'Points', e.weekId === CARRYOVER ? '' : e.weekId,
            kid(e.personId, e.personName), e.categoryName || '', Number(e.points) || 0, '', e.leaderName || '', e.ts ? new Date(e.ts).toLocaleString() : '']),
          ...atts.map((a) => [L, r.name, 'Attendance', a.weekId, kid(a.personId, a.personName), '', Number(a.points) || 0, '', a.leaderName || '', a.ts ? new Date(a.ts).toLocaleString() : '']),
        ].sort((x, y) => String(x[3]).localeCompare(String(y[3])) || String(x[4]).localeCompare(String(y[4])));
        rows.push(...dated);
      }
    } catch (e) {
      console.error(e);
      return alert('Could not build the file. Check your connection and try again.');
    }
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = `${isOwner() ? 'all-locations' : 'my-locations'}-${ymd(new Date())}.csv`;
    a.click();
    toast(`Downloaded ${rooms.length} room${rooms.length === 1 ? '' : 's'}.`);
  },
  export: () => {
    const rows = [['Week starting', 'Person', 'Category', 'Points', 'Entered by', 'Time']];
    const name = (id, fallback) => state.people.find((p) => p.id === id)?.name || fallback || '';
    for (const e of state.entries) rows.push([e.weekId, name(e.personId, e.personName), e.categoryName, e.points, e.leaderName, new Date(e.ts).toLocaleString()]);
    for (const a of state.attendance) rows.push([a.weekId, name(a.personId, a.personName), 'Attendance', a.points, a.leaderName, new Date(a.ts).toLocaleString()]);
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${slug(roomLabel(currentRoom()))}-points-${ymd(new Date())}.csv`;
    a.click();
  },
};

/* ---------- import ---------- */
const CARRYOVER = 'carryover';

function parseImport(text) {
  const out = { categories: [], kids: [], attendance: [], skipped: [] };
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = norm(line).replace(/[:\t,]+$/, '');
    if (/^(categories|category)$/.test(head)) { section = 'categories'; continue; }
    if (/^(kids|people|students|names)$/.test(head)) { section = 'kids'; continue; }
    if (/^(attendance|attended)$/.test(head)) { section = 'attendance'; continue; }
    if (section === 'attendance') {
      const dates = line.match(/\d{4}-\d{2}-\d{2}/g) || [];
      const name = line.split(/\d{4}-\d{2}-\d{2}/)[0].replace(/[\s,:\t-]+$/, '').trim();
      if (!name || !dates.length) { out.skipped.push(line); continue; }
      out.attendance.push({ name, weeks: [...new Set(dates.map((d) => weekStart(parseYmd(d))))] });
      continue;
    }
    const m = line.match(/^(.*?)[\s,\t:=-]+(-?\d+(?:\.\d+)?)\s*(?:pts?|points?)?$/i);
    const name = (m ? m[1] : line).replace(/[\t,]+$/, '').trim();
    const num = m ? Number(m[2]) : null;
    if (!name || !section) { out.skipped.push(line); continue; }
    if (section === 'categories') {
      if (num === null) { out.skipped.push(line); continue; }
      out.categories.push({ name, points: num });
    } else {
      out.kids.push({ name, total: num ?? 0 });
    }
  }
  return out;
}

function mergePanelHtml() {
  const from = state.people.find((p) => p.id === state.mergeFrom);
  if (!from) return '';
  const t = totals(null);
  return `
    <div class="merge">
      <p><strong>Merge ${esc(from.name)}</strong> (${t.get(from.id)?.pts ?? 0} pts) into which kid?</p>
      <p class="muted small">All of ${esc(from.name)}'s points and attendance move to the kid you pick, then ${esc(from.name)} is removed.</p>
      <div class="chips">${people().filter((p) => p.id !== from.id).map((p) =>
        `<button class="chip" data-act="mergeInto" data-id="${p.id}">${esc(p.name)} <b>${t.get(p.id)?.pts ?? 0}</b></button>`).join('')}</div>
      <button class="ghost wide" data-act="mergeCancel">Cancel</button>
    </div>`;
}

function mergeKids(fromId, toId) {
  const to = state.people.find((p) => p.id === toId);
  for (const e of state.entries.filter((x) => x.personId === fromId)) {
    if (e.weekId === CARRYOVER) {
      const targetId = 'carryover_' + toId;
      const existing = state.entries.find((x) => x.id === targetId);
      const { id, ...rest } = e;
      store.set('entries', targetId, { ...rest, roomId: state.roomId, personId: toId, personName: to.name,
        points: (Number(existing?.points) || 0) + (Number(e.points) || 0) });
      if (e.id !== targetId) store.remove('entries', e.id);
    } else {
      store.update('entries', e.id, { personId: toId, personName: to.name });
    }
  }
  for (const a of state.attendance.filter((x) => x.personId === fromId)) {
    const newId = `${a.weekId}_${toId}`;
    if (!state.attendance.some((x) => x.id === newId)) {
      const { id, ...rest } = a;
      store.set('attendance', newId, { ...rest, roomId: state.roomId, personId: toId, personName: to.name });
    }
    store.remove('attendance', a.id);
  }
  store.remove('people', fromId);
  if (state.personId === fromId) state.personId = toId;
}

function importPreviewHtml() {
  const p = state.importPreview;
  const existingP = new Set(state.people.map((x) => norm(x.name)));
  const existingC = new Set(state.categories.map((x) => norm(x.name)));
  return `
    <p><strong>${p.categories.length}</strong> categories · <strong>${p.kids.length}</strong> kids${p.attendance.length ? ` · <strong>${p.attendance.reduce((n, a) => n + a.weeks.length, 0)}</strong> attendance marks` : ''}</p>
    ${p.categories.length ? `<h3>Categories</h3><ul class="preview">${p.categories.map((c) =>
      `<li><span>${esc(c.name)}${existingC.has(norm(c.name)) ? ' <em class="badge">update</em>' : ''}</span><b>${c.points}</b></li>`).join('')}</ul>` : ''}
    ${p.kids.length ? `<h3>Kids & starting totals</h3><ul class="preview">${p.kids.map((k) =>
      `<li><span>${esc(k.name)}${existingP.has(norm(k.name)) ? ' <em class="badge">exists</em>' : ''}</span><b>${k.total}</b></li>`).join('')}</ul>` : ''}
    ${p.attendance.length ? `<h3>Times attended (no extra points)</h3><ul class="preview">${p.attendance.map((a) =>
      `<li><span>${esc(a.name)}${existingP.has(norm(a.name)) ? ' <em class="badge">exists</em>' : ''}</span><b>${a.weeks.length}</b></li>`).join('')}</ul>` : ''}
    ${p.skipped.length ? `<p class="msg">Couldn't read ${p.skipped.length} line(s): ${p.skipped.map(esc).join(' · ')}</p>` : ''}
    <div class="row">
      <button class="ghost grow" data-act="importCancel">Cancel</button>
      <button class="primary grow" data-act="importRun">Import</button>
    </div>`;
}

const AUTH_ERRORS = {
  'app/no-user': 'No leader with that username.',
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/invalid-email': 'Wrong username or password.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/email-already-in-use': 'That login already exists. Try a different username.',
  'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
  'auth/unauthorized-domain': 'This website address is not allowed yet in Firebase.',
  'auth/popup-blocked': 'Pop-up was blocked. Allow pop-ups and try again.',
};
function authError(e) {
  console.error(e);
  if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
  state.authMsg = AUTH_ERRORS[e?.code] || 'Something went wrong. Please try again.';
  render();
}

const forms = {
  signin: async (f) => {
    state.authMsg = '';
    const username = normUser(f.get('username'));
    const pw = f.get('password');
    try {
      let authEmail = null;
      try { authEmail = (await store.getDoc('usernames', username))?.authEmail; } catch { /* fall through */ }
      if (!authEmail && username.includes('@')) authEmail = username; // older email-based logins
      if (!authEmail) throw { code: 'app/no-user' };
      await store.signIn(authEmail, pw);
    } catch (e) { authError(e); }
  },
  setup: async (f) => {
    try {
      await store.claimSetup(state.user.email, f.get('name').trim());
      state.tab = 'settings';
    } catch (e) {
      console.error(e);
      state.setupDone = true;
      state.authMsg = 'Someone already set up this app. Ask them to add you.';
    }
  },
  addPerson: (f) => {
    const name = f.get('name').trim();
    store.add('people', { roomId: state.roomId, name });
    logIt(`Added kid "${name}"`, 'add', nowWeek());
  },
  addCategory: (f) => {
    const max = Math.max(-1, ...state.categories.map((c) => c.order ?? 0));
    const name = f.get('name').trim();
    const points = Number(f.get('points')) || 0;
    store.add('categories', { roomId: state.roomId, name, points, order: max + 1 });
    logIt(`Added category "${name}" (${signed(points)})`, 'add', nowWeek());
  },
  changeUsername: async (f) => {
    const l = me();
    const username = normUser(f.get('username'));
    if (!l || username === usernameOf(l)) return false;
    if (!/^[a-z0-9][a-z0-9._@+-]{1,59}$/.test(username)) {
      alert('Usernames can use letters, numbers, dots, dashes, and underscores (no spaces).');
      return false;
    }
    const taken = state.leaders.some((x) => usernameOf(x) === username) || await store.getDoc('usernames', username).catch(() => null);
    if (taken) { alert(`The username "${username}" is already taken.`); return false; }
    try {
      await store.batch([
        { op: 'set', col: 'usernames', id: username, data: { authEmail: l.id } },
        { op: 'update', col: 'leaders', id: l.id, data: { username } },
        { op: 'delete', col: 'usernames', id: usernameOf(l) },
      ]);
      toast(`Username changed to <b>${esc(username)}</b>. Use it next time you sign in.`);
    } catch (e) {
      console.error(e);
      alert('Could not change your username. Please try again.');
      return false;
    }
  },
  addLocation: (f) => {
    const max = Math.max(-1, ...state.locations.map((l) => l.order ?? 0));
    if (!isOwner()) return false;
    const id = store.add('locations', { name: f.get('name').trim(), order: max + 1 });
    setLoc(id); // jump to the new location so its rooms can be added next
  },
  addRoom: async (f) => {
    const locationId = f.get('locationId');
    const max = Math.max(-1, ...roomsIn(locationId).map((r) => r.order ?? 0));
    if (!adminOf(locationId)) return false;
    const name = f.get('name').trim();
    const roomId = store.add('rooms', { name, locationId, attendancePoints: 10, order: max + 1 });
    logIt(`Added room "${name}"`, 'add', nowWeek(), { id: roomId, name, locationId });
    const copyFrom = f.get('copyFrom');
    if (copyFrom) {
      const src = (await store.getAll('categories')).filter((c) => c.roomId === copyFrom);
      await store.batch(src.map((c) => ({ op: 'set', col: 'categories', id: newId(),
        data: { roomId, name: c.name, points: c.points, order: c.order ?? 0 } })));
      const srcRoom = state.rooms.find((r) => r.id === copyFrom);
      if (srcRoom?.attendancePoints != null) store.update('rooms', roomId, { attendancePoints: srcRoom.attendancePoints });
    }
    toast('Room added. Give leaders access in Settings → Leaders.');
  },
  addLeader: async (f, _submitter, form) => {
    const name = f.get('name').trim();
    const username = normUser(f.get('username'));
    const pw = f.get('password');
    const admin = isOwner() && f.get('role') === 'admin';
    const accessLoc = f.get('accessLoc');
    const some = f.get('access') === 'some';
    const rooms = admin || !some ? [] : f.getAll('rooms');
    const locs = admin || !some ? [accessLoc] : [];
    if (!admin && some && !rooms.length) { alert('Check at least one room, or pick "All rooms".'); return false; }
    if (!/^[a-z0-9][a-z0-9._@+-]{1,59}$/.test(username)) {
      alert('Usernames can use letters, numbers, dots, dashes, and underscores (no spaces).');
      return false;
    }
    if (pw.length < 6) { alert('Passwords need at least 6 characters.'); return false; }
    const taken = state.leaders.some((l) => usernameOf(l) === username) || await store.getDoc('usernames', username).catch(() => null);
    if (taken) { alert(`The username "${username}" is already taken.`); return false; }
    try {
      const authEmail = loginEmailFor(username);
      await store.createLogin(authEmail, pw);
      await store.batch([
        { op: 'set', col: 'usernames', id: username, data: { authEmail } },
        { op: 'set', col: 'leaders', id: authEmail, data: { name, username, admin, rooms, locations: locs } },
      ]);
      toast(`Added ${esc(name)}. Username: <b>${esc(username)}</b>`);
    } catch (e) {
      console.error(e);
      alert(AUTH_ERRORS[e?.code] || 'Could not add that leader. Please try again.');
      return false;
    }
  },
};

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  await actions[el.dataset.act](el.dataset);
  render();
});
app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const btn = form.querySelector('button.primary');
  if (btn) btn.disabled = true;
  const ok = await forms[form.dataset.form]?.(new FormData(form), e.submitter, form);
  if (btn) btn.disabled = false;
  if (form.isConnected && ok !== false && form.dataset.form !== 'signin') form.reset();
  render();
});
app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.role === 'room') { setRoom(el.value); render(); return; }
  if (el.dataset.role === 'loc') { setLoc(el.value); render(); return; }
  if (el.dataset.role === 'logRoom') { state.logRoom = el.value; render(); return; }
  if (el.dataset.leader) {
    const l = state.leaders.find((x) => x.id === el.dataset.leader);
    if (!l) return;
    const toggle = (list) => { const set = new Set(list || []); if (el.checked) set.add(el.value); else set.delete(el.value); return [...set]; };
    if (el.dataset.lf === 'role' && isOwner()) store.update('leaders', l.id, { admin: el.value === 'admin', rooms: l.rooms || [], locations: leaderLocs(l) });
    if (el.dataset.lf === 'room') store.update('leaders', l.id, { rooms: toggle(l.rooms) });
    if (el.dataset.lf === 'loc' && (isOwner() || !l.admin)) store.update('leaders', l.id, { locations: toggle(l.locations) });
    if (el.dataset.lf === 'otherLoc' && isOwner()) {
      const locsWithout = leaderLocs(l).filter((x) => x !== el.value);
      const there = new Set(roomsIn(el.value).map((r) => r.id));
      store.update('leaders', l.id, el.checked
        ? { locations: [...locsWithout, el.value] }
        : { locations: locsWithout, rooms: (l.rooms || []).filter((id) => !there.has(id)) });
      state.someRooms.delete(`${l.id}|${el.value}`);
    }
    if (el.dataset.lf === 'access') {
      const locId = el.dataset.loc;
      const key = `${l.id}|${locId}`;
      const here = new Set(roomsIn(locId).map((r) => r.id));
      const locsWithout = leaderLocs(l).filter((x) => x !== locId);
      state.someRooms.delete(key);
      if (el.value === 'all') store.update('leaders', l.id, { locations: [...locsWithout, locId] });
      if (el.value === 'none') {
        store.update('leaders', l.id, { locations: locsWithout, rooms: (l.rooms || []).filter((id) => !here.has(id)) });
        state.leaderEdit = null;
        toast(`${esc(l.name)} no longer has access to ${esc(state.locations.find((x) => x.id === locId)?.name || 'this location')}.`);
      }
      if (el.value === 'some') { state.someRooms.add(key); store.update('leaders', l.id, { locations: locsWithout }); }
    }
    el.blur(); // let the list refresh right away
    render();
    return;
  }
  // Add leader form: show the room checkboxes only for "Only some rooms".
  if (el.dataset.lf === 'access' && el.form) {
    const box = el.closest('.room-checks')?.querySelector('.some-rooms');
    if (box) box.hidden = el.value !== 'some';
    return;
  }
  if (!el.dataset.col) return;
  let v = el.value;
  if (el.type === 'number') v = Number(v) || 0;
  else { v = v.trim(); if (!v) return render(); }
  const col = el.dataset.col, field = el.dataset.field;
  const before = (state[col] || []).find((x) => x.id === el.dataset.id);
  store.update(col, el.dataset.id, { [field]: v });
  // Log setup changes so admins can see who changed what.
  if (!before || before[field] === v) return;
  const what = { people: 'kid', categories: 'category', rooms: 'room' }[col];
  if (!what) return;
  if (field === 'name') logIt(`Renamed ${what} "${before.name}" → "${v}"`, '', nowWeek(), col === 'rooms' ? before : currentRoom());
  else if (col === 'categories') logIt(`Changed "${before.name}" from ${signed(Number(before.points) || 0)} to ${signed(v)}`, '', nowWeek());
  else if (field === 'attendancePoints') logIt(`Changed attendance points from ${before.attendancePoints ?? 10} to ${v}`, '', nowWeek(), before);
});

let pendingRender = false;
function softRender() {
  // Don't clobber an input someone is typing in.
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && app.contains(a)) { pendingRender = true; return; }
  render();
}
app.addEventListener('focusout', () => {
  if (!pendingRender) return;
  setTimeout(() => {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && app.contains(a)) return;
    pendingRender = false;
    render();
  }, 400);
});

// If the app sat open in the background past Tuesday night, jump to the new week when it's reopened.
let lastSeenWeek = state.week;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const now = weekStart(new Date());
  if (now !== lastSeenWeek) {
    if (state.week === lastSeenWeek) state.week = now;
    lastSeenWeek = now;
    render();
  }
});

/* ---------- one-time move to locations & rooms ---------- */
async function migrateToRooms() {
  if (state.migrating) return;
  state.migrating = true;
  try {
    const ops = [];
    for (const c of ROOM_COLS) {
      for (const d of await store.getAll(c)) if (!d.roomId) ops.push({ op: 'update', col: c, id: d.id, data: { roomId: FIRST_ROOM } });
    }
    for (const l of await store.getAll('leaders')) {
      const data = {};
      if (!l.username) {
        data.username = l.id; // existing logins keep their email as their username
        ops.push({ op: 'set', col: 'usernames', id: l.id, data: { authEmail: l.id } });
      }
      if (!l.admin && !Array.isArray(l.rooms)) data.rooms = [FIRST_ROOM];
      if (Object.keys(data).length) ops.push({ op: 'update', col: 'leaders', id: l.id, data: l.admin ? { ...data, admin: true } : data });
    }
    const legacy = state.settings.find((s) => s.id === 'main') || {};
    ops.push({ op: 'set', col: 'locations', id: FIRST_ROOM, data: { name: 'Higher Ground', order: 0 } });
    ops.push({ op: 'set', col: 'rooms', id: FIRST_ROOM, data: { name: 'Higher Ground', locationId: FIRST_ROOM, attendancePoints: Number(legacy.attendancePoints ?? 10), order: 0 } });
    await store.batch(ops);
  } catch (e) {
    console.error(e);
    showError('Could not finish the rooms update. Reload to try again.');
  }
  state.migrating = false;
}

/* ---------- start ---------- */
let watching = false;
function afterGlobalChange() {
  if (state.globalLoaded.size < GLOBAL_COLS.length || !me()) return;
  if (!state.rooms.length) { if (isOwner()) migrateToRooms(); return; }
  chooseRoom();
}
function startWatching() {
  if (watching) return;
  watching = true;
  for (const name of GLOBAL_COLS) {
    store.watch(name, (docs) => {
      state[name] = docs;
      state.globalLoaded.add(name);
      afterGlobalChange();
      softRender();
    });
  }
}

function onUser(user) {
  state.user = user;
  state.authMsg = '';
  if (!user) { state.access = null; return render(); }
  state.access = 'checking';
  render();
  store.watchDoc('leaders', user.email, async (doc) => {
    if (doc) {
      if (!state.ownerEmail) {
        try { state.ownerEmail = (await store.getDoc('meta', 'setup'))?.owner?.toLowerCase() || null; } catch { /* ignore */ }
      }
      state.access = 'ok';
      startWatching();
      afterGlobalChange();
    } else if (state.access !== 'ok') {
      try { state.setupDone = !!(await store.getDoc('meta', 'setup')); } catch { state.setupDone = true; }
      state.access = 'none';
    } else {
      location.reload(); // removed from the leader list (or given a new login) while signed in
    }
    render();
  }, (err) => { console.error(err); state.access = 'none'; state.setupDone = true; render(); });
}

(async () => {
  try {
    store = await createStore(showError);
  } catch (err) {
    console.error(err);
    app.innerHTML = '<p class="center">Could not connect to the database. Check firebase-config.js.</p>';
    return;
  }
  store.onAuth(onUser);
  render();
})();
