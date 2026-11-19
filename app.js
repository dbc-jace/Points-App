import { createStore, newId } from './store.js?v=2026.11.20-2';

const APP_VERSION = '2026.11.20-2';
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
// Names sort by first or last name. Each person's choice is saved on their account (and on this device).
const cmp = (x, y) => String(x).localeCompare(String(y), undefined, { sensitivity: 'base' });
// Last name = the last word, keeping particles like "De Angelo" or "Van Heerden" together, skipping Jr./Sr./II.
const lastNameOf = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter((x) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(x));
  if (w.length < 2) return w[0] || '';
  let i = w.length - 1;
  while (i > 1 && /^(de|del|della|der|den|di|da|du|van|von|la|le|st\.?|mc|mac)$/i.test(w[i - 1])) i--;
  return w.slice(i).join(' ');
};
// "Sam Akmakjian" → "Akmakjian, Sam" when sorting by last name (keeps Jr./Sr. with the last name).
const listName = (name) => {
  const full = String(name || '').trim();
  if (sortMode() !== 'last') return full;
  const w = full.split(/\s+/);
  const suffix = w.filter((x) => /^(jr|sr|ii|iii|iv)\.?$/i.test(x));
  const words = w.filter((x) => !suffix.includes(x));
  const last = lastNameOf(full);
  const n = last.split(' ').length;
  if (words.length <= n) return full;
  return `${[last, ...suffix].join(' ')}, ${words.slice(0, words.length - n).join(' ')}`;
};
const sortMode = () => {
  if (state.sortPick) return state.sortPick; // just tapped on this device: use it right away
  const mine = state.user ? me()?.sort : null;
  if (mine === 'first' || mine === 'last') return mine;
  try { return localStorage.getItem('hgui_sort') === 'last' ? 'last' : 'first'; } catch { return 'first'; }
};
const byName = (a, b) => (sortMode() === 'last' ? cmp(lastNameOf(a.name), lastNameOf(b.name)) : 0) || cmp(a.name, b.name);
const sortToggle = () => `
  <div class="sortbar"><span>Sort by</span>
    <div class="seg mini">${[['first', 'First name'], ['last', 'Last name']].map(([v, label]) =>
      `<button class="${sortMode() === v ? 'on' : ''}" data-act="sortNames" data-v="${v}">${label}</button>`).join('')}</div>
  </div>`;
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || cmp(a.name, b.name); // rooms, categories: never by last name
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
  people: [], categories: [], entries: [], attendance: [], // the room being set up in Settings (state.roomId) only
  v: { people: [], categories: [], entries: [], attendance: [] }, // every room checked in the Rooms picker
  roomId: null,     // one room: what Settings sets up, and the main room when only one is checked
  viewIds: [],      // rooms checked in the Rooms picker (Attendance, Points, Board)
  roomPickOpen: false,
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
  attWeek: weekStart(new Date()), locAtt: null, locAttKey: '',
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
const roomById = (id) => state.rooms.find((r) => r.id === id);
const attendancePoints = (room = currentRoom()) => Number(room?.attendancePoints ?? 10);
const viewRooms = () => roomsHere().filter((r) => state.viewIds.includes(r.id));
const multiView = () => viewRooms().length > 1;
// Kids in the checked rooms (Attendance, Points, Board).
const people = () => [...state.v.people].sort(byName);
// Kids in the one room being set up (Settings).
const roomPeople = () => [...state.people].sort(byName);
const categories = () => [...state.categories].sort(byOrder);
const usernameOf = (l) => l.username || l.id;
const roomLabel = (r) => `${locationOf(r)?.name ? locationOf(r).name + ' · ' : ''}${r.name}`;

// School years: each location keeps a list of { id, name, start (week id), end (date, last day) }.
// A year runs through the week of its end date (or until the next year starts, whichever comes first).
// Nothing is deleted when a new year starts; the Board just counts from the new start.
const effWeek = (x) => (x.weekId === CARRYOVER ? weekStart(new Date(x.ts || 0)) : x.weekId); // starting totals count in the week they were imported
const yearsOf = (loc) => [...(loc?.years || [])].sort((a, b) => String(a.start).localeCompare(String(b.start)));
function yearRange(loc, id) {
  const ys = yearsOf(loc);
  const i = ys.findIndex((y) => y.id === id);
  return i < 0 ? null : { ...ys[i], lastWeek: ys[i].end ? weekStart(parseYmd(ys[i].end)) : null, next: ys[i + 1]?.start || null };
}
const inYear = (y, w) => w >= y.start && (!y.end || w <= weekStart(parseYmd(y.end)));
const currentYear = (loc) => {
  const now = weekStart(new Date());
  const started = [...yearsOf(loc)].reverse();
  return started.find((y) => inYear(y, now)) || started.find((y) => y.start <= now) || yearsOf(loc)[0] || null;
};
const endLabel = (end) => parseYmd(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// weekId = one week; range = { start, end } (a school year); neither = all time.
function totals(weekId, range = null) {
  const t = new Map(state.v.people.map((p) => [p.id, { pts: 0, att: 0 }]));
  const ok = (x) => {
    if (weekId) return x.weekId === weekId;
    if (!range) return true;
    const w = effWeek(x);
    return w >= range.start && (!range.lastWeek || w <= range.lastWeek) && (!range.next || w < range.next);
  };
  for (const e of state.v.entries) if (ok(e) && t.has(e.personId)) t.get(e.personId).pts += Number(e.points) || 0;
  for (const a of state.v.attendance) if (ok(a) && t.has(a.personId)) { const r = t.get(a.personId); r.pts += Number(a.points) || 0; r.att++; }
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
const VIEW_KEY = 'hgui_view_';
// Watch every room that is checked, plus the room being set up in Settings. One watcher per room + collection.
const roomWatch = new Map(); // roomId -> [unsub...]
const roomData = new Map();  // roomId -> { people, categories, entries, attendance }
function syncRooms() {
  const want = new Set([...state.viewIds, state.roomId].filter(Boolean));
  for (const [id, unsubs] of roomWatch) {
    if (want.has(id)) continue;
    unsubs.forEach((u) => u && u());
    roomWatch.delete(id); roomData.delete(id);
    for (const c of ROOM_COLS) state.roomLoaded.delete(`${id}|${c}`);
  }
  for (const id of want) {
    if (roomWatch.has(id)) continue;
    roomData.set(id, Object.fromEntries(ROOM_COLS.map((c) => [c, []])));
    roomWatch.set(id, ROOM_COLS.map((c) => store.watchWhere(c, 'roomId', id, (docs) => {
      if (!roomWatch.has(id)) return;
      roomData.get(id)[c] = docs;
      state.roomLoaded.add(`${id}|${c}`);
      mergeRooms();
      softRender();
    })));
  }
  mergeRooms();
}
function mergeRooms() {
  for (const c of ROOM_COLS) {
    state[c] = roomData.get(state.roomId)?.[c] || [];
    state.v[c] = state.viewIds.flatMap((id) => roomData.get(id)?.[c] || []);
  }
}
const roomReady = (id) => ROOM_COLS.every((c) => state.roomLoaded.has(`${id}|${c}`));
const roomsLoaded = () => [...new Set([...state.viewIds, state.roomId].filter(Boolean))].every(roomReady);
// The one room Settings works on.
function setRoom(id) {
  if (id === state.roomId) return;
  state.roomId = id;
  state.mergeFrom = null; state.importPreview = null;
  if (id) { try { localStorage.setItem(ROOM_KEY, id); } catch { /* ignore */ } }
  // With only one room checked, picking a room anywhere switches the view to it too.
  if (id && state.viewIds.length <= 1) setView([id]);
  else syncRooms();
}
// The rooms checked in the Rooms picker.
function setView(ids) {
  const here = roomsHere().map((r) => r.id);
  const list = here.filter((id) => ids.includes(id));
  state.viewIds = list;
  if (state.personId && !state.v.people.some((p) => p.id === state.personId && list.includes(p.roomId))) state.personId = null;
  const loc = curLoc();
  if (loc) { try { localStorage.setItem(VIEW_KEY + loc.id, JSON.stringify(list)); } catch { /* ignore */ } }
  if (list.length && !list.includes(state.roomId)) { state.roomId = list[0]; try { localStorage.setItem(ROOM_KEY, list[0]); } catch { /* ignore */ } }
  syncRooms();
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
// Keep the checked rooms (and the Settings room) inside the current location, remembering the last ones used.
function chooseRoom() {
  const here = roomsHere();
  if (!here.length) {
    if (state.roomId || state.viewIds.length) { state.roomId = null; state.viewIds = []; syncRooms(); }
    return;
  }
  const ids = here.map((r) => r.id);
  const okView = state.viewIds.length && state.viewIds.every((id) => ids.includes(id));
  const okRoom = ids.includes(state.roomId);
  if (okView && okRoom) return;
  let view = okView ? state.viewIds : null;
  if (!view) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(VIEW_KEY + curLoc().id)); } catch { /* ignore */ }
    view = Array.isArray(saved) ? saved.filter((id) => ids.includes(id)) : [];
  }
  let one = okRoom ? state.roomId : null;
  if (!one) { try { one = localStorage.getItem(ROOM_KEY); } catch { /* ignore */ } }
  if (!ids.includes(one)) one = view[0] || ids[0];
  if (!view.length) view = [one];
  state.roomId = one;
  state.viewIds = view;
  if (!view.includes(one)) state.roomId = view[0];
  syncRooms();
}

// Rooms picker: a checkbox for each room in this location. Shown on every tab when there's more than one room.
function roomsLabel() {
  const vr = viewRooms(), all = roomsHere();
  if (!vr.length) return 'No rooms yet';
  if (vr.length === all.length && all.length > 1) return `All rooms (${all.length})`;
  return vr.map((r) => r.name).join(', ');
}
function roomMulti() {
  const all = roomsHere();
  if (all.length < 2) return '';
  const on = new Set(state.viewIds);
  return `<details class="room-multi" ${state.roomPickOpen ? 'open' : ''}>
    <summary><span>Rooms</span><b>${esc(roomsLabel())}</b><i aria-hidden="true">▾</i></summary>
    <div class="room-multi-list">
      <label class="check all"><input type="checkbox" data-role="viewAll" ${on.size === all.length ? 'checked' : ''}> <b>All rooms</b></label>
      ${all.map((r) => `<label class="check"><input type="checkbox" data-role="viewRoom" value="${esc(r.id)}" ${on.has(r.id) ? 'checked' : ''}> ${esc(r.name)}</label>`).join('')}
      <button class="primary wide small" data-act="roomPickDone">Done</button>
    </div>
  </details>`;
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
  // Full-page "Loading…" only the first time. After that, a newly checked room fills in when its data arrives
  // instead of blanking the whole screen.
  if (state.roomId && !roomsLoaded() && !state.shownRooms) return renderMsg('Loading…');
  if (state.roomId && roomReady(state.roomId)) state.shownRooms = true;

  const loc = curLoc();
  if (pendingImport) {
    if (state.roomId && adminOf(loc?.id)) { state.importPreview = parseImport(pendingImport); state.tab = 'settings'; }
    else toast('Only admins can import.');
    pendingImport = null;
    history.replaceState(null, '', location.pathname + location.search);
  }
  // No rooms here yet (an admin's new location): only Settings makes sense.
  if (!state.roomId) state.tab = 'settings';
  const showWeek = state.tab !== 'settings' && !(state.tab === 'board' && state.board !== 'week');
  const isThisWeek = state.week === weekStart(new Date());
  const room = currentRoom();

  const body = { points: viewPoints, attendance: viewAttendance, board: viewBoard, settings: viewSettings }[state.tab]();
  const tabs = [['attendance', '✓', 'Attendance'], ['points', '★', 'Points'], ['board', '🏆', 'Board'], ['settings', '⚙', 'Settings']];

  app.innerHTML = `
    <header class="top">
      <div><h1>${esc(loc?.name || APP_NAME)}</h1><small class="room-name">${esc(state.tab === 'settings' ? (room?.name || 'No rooms yet') : roomsLabel())}</small></div>
      <button class="link" data-act="logout">${esc(leader.name)} · Log out</button>
    </header>
    ${store.mode === 'local' ? '<div class="demo">Demo mode: no login, and data is saved on this device only.</div>' : ''}
    ${roomMulti()}
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

// Group a list by room (in room order) when more than one room is checked.
function byRoomGroups(list, roomOfItem = (x) => x.roomId) {
  return viewRooms().map((r) => ({ room: r, items: list.filter((x) => roomOfItem(x) === r.id) }));
}
const groupHead = (room, extra = '') => `<h3 class="group-head">${esc(room.name)}${extra ? ` <small>${extra}</small>` : ''}</h3>`;

function viewPoints() {
  const everyone = people();
  if (!everyone.length) return (!roomsLoaded() ? '<p class="center muted">Loading…</p>' : '') || emptyState(multiView() ? 'No kids in these rooms yet.' : 'No kids in this room yet.', adminOf(curLoc()?.id) ? 'Add kids in Settings.' : 'Ask an admin to add kids.');
  const t = totals(state.week);
  const here = new Set(state.v.attendance.filter((a) => a.weekId === state.week).map((a) => a.personId));
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
  const rowsHtml = (list) => `<ul class="kid-rows">
      ${list.map((p) => `<li><button data-act="pickPerson" data-id="${p.id}">
        <span class="name">${esc(listName(p.name))}${state.showAllKids && !here.has(p.id) ? '<small>not marked here</small>' : ''}</span>
        <b>${t.get(p.id).pts}</b><span class="chev">›</span></button></li>`).join('')}
    </ul>`;
  return `${toggle}
    ${sortToggle()}
    ${multiView() ? byRoomGroups(ppl).filter((g) => g.items.length).map((g) => groupHead(g.room) + rowsHtml(g.items)).join('') : rowsHtml(ppl)}`;
}

function viewPerson(person, ppl, t) {
  const cats = state.v.categories.filter((c) => c.roomId === person.roomId).sort(byOrder);
  const list = state.v.entries.filter((e) => e.personId === person.id && e.weekId === state.week).sort((a, b) => b.ts - a.ts);
  const att = state.v.attendance.find((a) => a.personId === person.id && a.weekId === state.week);
  const i = ppl.findIndex((p) => p.id === person.id);
  const next = i >= 0 && i < ppl.length - 1 ? ppl[i + 1] : null;
  return `
    <div class="person-nav">
      <button class="link" data-act="backToList">‹ Back</button>
      ${next ? `<button class="link" data-act="pickPerson" data-id="${next.id}">${esc(listName(next.name))} ›</button>` : ''}
    </div>
    <div class="person-head">
      <h2>${esc(person.name)}</h2>${multiView() ? `<small class="muted">${esc(roomById(person.roomId)?.name || '')}</small>` : ''}
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
  if (!ppl.length) return (!roomsLoaded() ? '<p class="center muted">Loading…</p>' : '') || emptyState(multiView() ? 'No kids in these rooms yet.' : 'No kids in this room yet.', adminOf(curLoc()?.id) ? 'Add kids in Settings.' : 'Ask an admin to add kids.');
  const here = new Set(state.v.attendance.filter((a) => a.weekId === state.week).map((a) => a.personId));
  const count = ppl.filter((p) => here.has(p.id)).length;
  const listHtml = (list) => `<ul class="att">
      ${list.map((p) => `<li><button class="${here.has(p.id) ? 'on' : ''}" data-act="toggleAtt" data-id="${p.id}"><span class="box">${here.has(p.id) ? '✓' : ''}</span>${esc(listName(p.name))}</button></li>`).join('')}
    </ul>`;
  if (!multiView()) {
    return `
    <p class="center"><strong>${count} of ${ppl.length}</strong> here · +${attendancePoints()} pts each</p>
    ${sortToggle()}
    ${listHtml(ppl)}`;
  }
  return `
    <p class="center"><strong>${count} of ${ppl.length}</strong> here in ${viewRooms().length} rooms</p>
    ${sortToggle()}
    ${byRoomGroups(ppl).map((g) => groupHead(g.room, `${g.items.filter((p) => here.has(p.id)).length} of ${g.items.length} here · +${attendancePoints(g.room)} pts`)
      + (g.items.length ? listHtml(g.items) : `<p class="muted small">${roomReady(g.room.id) ? 'No kids yet.' : 'Loading…'}</p>`)).join('')}`;
}

function viewBoard() {
  const loc = curLoc();
  const ys = yearsOf(loc);
  // Toggle is This week / this year. All time only shows up when the location has no years yet.
  const mode = state.board === 'week' ? 'week' : ys.length ? 'year' : 'all';
  let range = null;
  if (mode === 'year') {
    const yid = ys.some((y) => y.id === state.boardYear) ? state.boardYear : currentYear(loc).id;
    range = yearRange(loc, yid);
  }
  const t = totals(mode === 'week' ? state.week : null, range);
  const rows = people().map((p) => ({ p, ...t.get(p.id) })).sort((a, b) => b.pts - a.pts || byName(a.p, b.p));
  const boardList = (list) => {
    let rank = 0, prev = null;
    return `<ol class="board">
      ${list.map((r, i) => { if (r.pts !== prev) { rank = i + 1; prev = r.pts; } return `
        <li data-act="pickPerson" data-id="${r.p.id}" data-go="points">
          <span class="rank r${rank}">${rank}</span>
          <span class="name">${esc(r.p.name)}<small>${r.att} attended</small></span>
          <b>${r.pts}</b>
        </li>`; }).join('')}
    </ol>`;
  };
  return `
    <div class="seg">
      <button class="${mode === 'week' ? 'on' : ''}" data-act="board" data-v="week">This week</button>
      ${ys.length ? `<button class="${mode === 'year' ? 'on' : ''}" data-act="board" data-v="year">${esc(range && mode === 'year' ? range.name : currentYear(loc).name)}</button>`
        : `<button class="${mode === 'all' ? 'on' : ''}" data-act="board" data-v="all">All time</button>`}
    </div>
    ${mode === 'year' && ys.length > 1 ? `<label class="room-pick wide-pick"><span>Year</span><select data-role="boardYear" aria-label="Year">
      ${[...ys].reverse().map((y) => `<option value="${esc(y.id)}" ${y.id === range.id ? 'selected' : ''}>${esc(y.name)}</option>`).join('')}
    </select></label>` : ''}
    ${!rows.length ? (!roomsLoaded() ? '<p class="center muted">Loading…</p>' : '') || emptyState(multiView() ? 'No kids in these rooms yet.' : 'No kids in this room yet.', '')
      : multiView() ? byRoomGroups(rows, (r) => r.p.roomId).filter((g) => g.items.length).map((g) => groupHead(g.room) + boardList(g.items)).join('')
      : boardList(rows)}`;
}

/* ---------- settings (admins) ---------- */
const UI_KEY = 'hgui_open';
const openSections = (() => { try { return new Set(JSON.parse(localStorage.getItem(UI_KEY)) || []); } catch { return new Set(); } })();
function isOpen(k) {
  if (k === 'people' && state.mergeFrom) return true;
  if (k === 'import' && state.importPreview) return true;
  if (k === 'leaders' && state.leaderEdit) return true;
  if (k === 'bulk' && (state.bulk || state.bulkResult || state.bulkBusy)) return true;
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
// Not in any location (e.g. added with no access yet). Only the owner sees these, in every location's list.
const unassigned = (l) => !isOwnerL(l) && !leaderLocs(l).length && !(l.rooms || []).some((id) => state.rooms.some((r) => r.id === id));
const canEditLeader = (l) => l.id !== state.user.email && !isOwnerL(l) && (isOwner() || !l.admin);
const canFullyManage = (l) => canEditLeader(l) && (isOwner() || leaderInsideMine(l));

/* ---------- school years ---------- */
function yearsHtml(loc) {
  const ys = yearsOf(loc);
  const cur = currentYear(loc);
  return `
    <p class="muted small">Starting a new year sets everyone's year total on the Board back to zero. Nothing is deleted: past years stay on the Board (pick the year there), and "All time" still adds up everything.</p>
    ${ys.length ? `<ul class="edit">${[...ys].reverse().map((y) => `<li>
        <span class="grow"><b>${esc(y.name)}</b>${cur && y.id === cur.id && inYear(y, weekStart(new Date())) ? ' <em class="badge">current</em>' : ''}
          <small class="email">Starts week of ${esc(weekLabel(y.start))}</small>
          <label class="small">Ends on <input type="date" data-role="yearEnd" data-id="${esc(y.id)}" value="${esc(y.end || '')}" aria-label="End date for ${esc(y.name)}"></label>
          ${y.end ? '' : '<small class="muted block">No end date yet</small>'}</span>
        <button class="x" data-act="delYear" data-id="${esc(y.id)}" data-name="${esc(y.name)}" aria-label="Delete year">✕</button>
      </li>`).join('')}</ul>` : '<p class="small">No years yet, so the Board counts all time. Tip: add this year first, starting the week it began, so this year\'s points count toward it.</p>'}
    <h3>${ys.length ? 'Start a new year' : 'Add a year'}</h3>
    <form data-form="addYear" class="stack">
      <input type="hidden" name="locationId" value="${esc(loc.id)}">
      <input name="name" placeholder="Name (e.g. 2027–28)" required>
      <label>Starts on<input name="start" type="date" required value="${ymd(new Date())}"></label>
      <label>Ends on<input name="end" type="date" required></label>
      <button class="primary wide">${ys.length ? 'Start new year' : 'Add year'}</button>
    </form>`;
}

/* ---------- add many leaders at once ---------- */
// "Ruth Herriman" -> rherriman / initials "rh". Words in (parentheses) are nicknames and skipped.
const nameWords = (name) => String(name).replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
const lettersOnly = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
function autoUsername(name) {
  const w = nameWords(name);
  return w.length ? (lettersOnly(w[0])[0] || '') + lettersOnly(w.slice(1).join('')) : '';
}
function initialsOf(name) {
  const w = nameWords(name).map(lettersOnly).filter(Boolean);
  return w.length ? w[0][0] + (w.length > 1 ? w.slice(1).join('')[0] : '') : '';
}

function bulkHtml(loc) {
  if (state.bulkBusy) return `<p class="center"><strong>Working… ${esc(state.bulkBusy)}</strong></p><p class="muted small center">Keep this page open until it finishes.</p>`;
  if (state.bulkResult) {
    const r = state.bulkResult;
    return `
      <p><strong>${r.filter((x) => x.ok).length} done</strong>${r.some((x) => !x.ok) ? ` · <strong class="danger">${r.filter((x) => !x.ok).length} not done</strong>` : ''}</p>
      <ul class="preview">${r.map((x) => `<li><span>${esc(x.name)} <small class="muted">${esc(x.username)}</small>${x.ok ? '' : `<small class="danger block">${esc(x.msg)}</small>`}</span><b>${x.ok ? esc(x.msg) : '✕'}</b></li>`).join('')}</ul>
      <button class="ghost wide" data-act="bulkClose">Done</button>`;
  }
  if (state.bulk) {
    const rows = state.bulk.rows;
    const bad = rows.filter((x) => x.error).length;
    return `
      <p><strong>${rows.length - bad}</strong> ready${bad ? ` · <strong class="danger">${bad} with problems (they'll be skipped)</strong>` : ''}</p>
      <ul class="preview">${rows.map((x) => `<li><span><b>${esc(x.name)}</b> <em class="badge">${x.self ? 'you: username only' : x.existing ? 'update' : 'new'}</em>
          <small class="block">${esc(x.username)}${x.self ? '' : ` · password ${esc(x.pw)}`} · ${esc(x.locName)}: ${esc(x.accessText)}</small>
          ${x.error ? `<small class="danger block">${esc(x.error)}</small>` : ''}</span></li>`).join('')}</ul>
      <p class="muted small">"Update" means they're already on the list: they get this username and password, and keep their current access plus anything new here.</p>
      <div class="row">
        <button class="ghost grow" data-act="bulkCancel">Back</button>
        <button class="primary grow" data-act="bulkRun" ${rows.length - bad ? '' : 'disabled'}>Add / update ${rows.length - bad}</button>
      </div>`;
  }
  return `
    <p class="muted small">One person per line: <b>Name, username, access</b>. Access is <b>admin</b>${isOwner() ? '' : ' (owner only)'}, <b>all</b> (every room), one room name, or several separated by <b>;</b>. Leave access blank for no access yet. Leave the username blank to use first initial + last name.
      ${isOwner() ? 'Lines go to this location; put a line like <b># Higher Ground</b> to switch locations partway.' : ''}</p>
    <form data-form="bulkPreview" class="stack" autocomplete="off">
      <textarea name="text" rows="10" required placeholder="Ruth Herriman, rherriman, Jr. High&#10;Kim Rende, krende, admin&#10;Jenna Christensen, , Sparks Blue; Sparks Green">${esc(state.bulkText || '')}</textarea>
      <label>Password ending
        <input name="suffix" required autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="e.g. awana">
      </label>
      <p class="muted small">Each password is the person's first + last initial, then this ending. Ruth Herriman + "awana" = rhawana.</p>
      <button class="primary wide">Preview</button>
    </form>`;
}

function parseBulk(text, suffix) {
  const rows = [];
  let loc = curLoc();
  const seen = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const want = norm(line.slice(1));
      const found = locations().find((x) => norm(x.name) === want);
      if (found) loc = found; else rows.push({ name: line, username: '', error: `No location called "${line.slice(1).trim()}".` });
      continue;
    }
    const [name = '', user = '', access = ''] = line.split(',').map((x) => x.trim());
    const row = { name, username: normUser(user) || autoUsername(name), locId: loc.id, locName: loc.name, admin: false, all: false, rooms: [] };
    row.pw = initialsOf(name) + suffix;
    const err = (m) => { row.error = row.error || m; };
    if (!name) err('No name.');
    if (!/^[a-z0-9][a-z0-9._@+-]{1,59}$/.test(row.username)) err('Usernames can use letters, numbers, dots, dashes, and underscores.');
    if (row.pw.length < 6) err('Password would be shorter than 6 characters. Use a longer ending.');
    if (!adminOf(loc.id)) err(`You don't run ${loc.name}.`);
    const parts = access.split(';').map((x) => x.trim()).filter(Boolean);
    const names = [];
    for (const a of parts) {
      if (/^admin$/i.test(a)) { if (isOwner()) row.admin = true; else err('Only the owner can make admins.'); names.push('admin'); continue; }
      if (/^all$/i.test(a)) { row.all = true; names.push('all rooms'); continue; }
      const r = roomsIn(loc.id).find((x) => norm(x.name) === norm(a));
      if (r) { row.rooms.push(r.id); names.push(r.name); } else err(`No room called "${a}" in ${loc.name}.`);
    }
    row.accessText = names.join(', ') || 'no access yet';
    const matches = state.leaders.filter((l) => norm(l.name) === norm(name));
    if (matches.length > 1) err(`More than one ${name} is already on the list.`);
    row.existing = matches.length === 1 ? matches[0] : null;
    row.self = row.existing?.id === state.user.email;
    if (row.existing && !row.self && !canFullyManage(row.existing)) err("Only the owner can change this person's login.");
    if (seen.has(row.username)) err(`Username "${row.username}" is used twice in this list.`);
    seen.set(row.username, row);
    rows.push(row);
  }
  // Usernames held by people who aren't in this list (or who are giving theirs up) are taken.
  const leaving = new Set(rows.filter((r) => r.existing).map((r) => r.existing.id));
  for (const r of rows) {
    if (r.error) continue;
    const holder = state.leaders.find((l) => usernameOf(l) === r.username);
    if (holder && holder.id !== r.existing?.id && !leaving.has(holder.id)) r.error = `Username "${r.username}" is taken by ${holder.name}.`;
  }
  return rows;
}

// Give a leader a new login (username + password) and merge in the access from the list.
async function bulkOne(r) {
  const prev = r.existing;
  const locs = new Set(leaderLocs(prev));
  if (r.admin || r.all) locs.add(r.locId);
  const rooms = new Set(prev?.rooms || []);
  r.rooms.forEach((id) => rooms.add(id));
  const admin = !!prev?.admin || r.admin;
  const holder = await store.getDoc('usernames', r.username).catch(() => null);
  if (holder && holder.authEmail !== prev?.id && state.leaders.some((l) => l.id === holder.authEmail)) throw new Error('That username is taken.');
  if (r.self) {
    if (usernameOf(prev) === r.username) return 'no change';
    await store.batch([
      { op: 'set', col: 'usernames', id: r.username, data: { authEmail: prev.id } },
      { op: 'update', col: 'leaders', id: prev.id, data: { username: r.username } },
      { op: 'delete', col: 'usernames', id: usernameOf(prev) },
    ]);
    return 'username changed';
  }
  const authEmail = loginEmailFor(r.username);
  await store.createLogin(authEmail, r.pw);
  const { id: _old, ...data } = prev || {};
  const ops = [
    { op: 'set', col: 'leaders', id: authEmail, data: { ...data, name: prev?.name || r.name, username: r.username, admin, locations: [...locs], rooms: [...rooms] } },
    { op: 'set', col: 'usernames', id: r.username, data: { authEmail } },
  ];
  if (prev) {
    ops.push({ op: 'delete', col: 'leaders', id: prev.id });
    if (usernameOf(prev) !== r.username) ops.push({ op: 'delete', col: 'usernames', id: usernameOf(prev) });
  }
  await store.batch(ops);
  return prev ? 'updated' : 'added';
}

/* ---------- erase everything of one kind in a location ---------- */
const ERASE = {
  points: ['Points', 'every point given (including starting totals) in every room. Kids and attendance stay'],
  attendance: ['Attendance', 'every attendance mark in every room. Kids and points stay'],
  kids: ['Kids', 'every kid, with their points and attendance, in every room'],
  categories: ['Point categories', 'every point category in every room. Points already given stay'],
  rooms: ['Rooms', 'every room, with all its kids, categories, points, and attendance'],
  leaders: ['Leaders', 'everyone who only works here. People who also work in another location just lose access here'],
  log: ['Activity log', 'the whole activity log'],
};
function eraseHtml(loc) {
  const kinds = Object.keys(ERASE).filter((k) => k !== 'log' || isOwner());
  return `
    <p class="muted small">Deletes things in <b>${esc(loc.name)}</b> only. You'll be asked to type ERASE first. This can't be undone, so download a backup first if you might want it.</p>
    ${kinds.map((k) => `<button class="ghost wide danger" data-act="erase" data-what="${k}">${k === 'log' ? 'Erase the activity log' : `Erase all ${ERASE[k][0].toLowerCase()}`} in ${esc(loc.name)}</button>`).join('')}`;
}
async function roomDocs(col, roomIds) {
  const out = [];
  for (const id of roomIds) out.push(...await store.getWhere(col, 'roomId', id));
  return out;
}
const delOps = (col, docs) => docs.map((x) => ({ op: 'delete', col, id: x.id }));
// Delete a room and everything in it (contents first, while the room still exists for the security rules).
async function deleteRoomAll(r) {
  const ops = [];
  for (const c of ROOM_COLS) ops.push(...delOps(c, await roomDocs(c, [r.id])));
  await store.batch(ops);
  await store.batch([{ op: 'delete', col: 'rooms', id: r.id }]);
  if (state.viewIds.includes(r.id) || state.roomId === r.id) {
    state.viewIds = state.viewIds.filter((id) => id !== r.id);
    if (state.roomId === r.id) state.roomId = null;
    syncRooms();
  }
}
async function eraseIn(loc, what) {
  const rooms = roomsIn(loc.id);
  const ids = rooms.map((r) => r.id);
  if (what === 'points') { const d = await roomDocs('entries', ids); await store.batch(delOps('entries', d)); return d.length; }
  if (what === 'attendance') { const d = await roomDocs('attendance', ids); await store.batch(delOps('attendance', d)); return d.length; }
  if (what === 'categories') { const d = await roomDocs('categories', ids); await store.batch(delOps('categories', d)); return d.length; }
  if (what === 'kids') {
    const ops = [...delOps('entries', await roomDocs('entries', ids)), ...delOps('attendance', await roomDocs('attendance', ids))];
    const kids = await roomDocs('people', ids);
    await store.batch([...ops, ...delOps('people', kids)]);
    return kids.length;
  }
  if (what === 'rooms') {
    for (const r of rooms) await deleteRoomAll(r);
    return rooms.length;
  }
  if (what === 'log') { const d = await store.getWhere('log', 'locationId', loc.id); await store.batch(delOps('log', d)); return d.length; }
  if (what === 'leaders') {
    const ops = [];
    let n = 0;
    for (const l of state.leaders) {
      if (isOwnerL(l) || l.id === state.user.email || (!hasAccessIn(l, loc) && !adminOfL(l, loc.id))) continue;
      if (l.admin && !isOwner()) continue;
      const otherLocs = leaderLocs(l).filter((x) => x !== loc.id);
      const otherRooms = (l.rooms || []).filter((id) => state.rooms.some((r) => r.id === id && r.locationId !== loc.id));
      if (otherLocs.length || otherRooms.length) ops.push({ op: 'update', col: 'leaders', id: l.id, data: { locations: otherLocs, rooms: otherRooms } });
      else ops.push({ op: 'delete', col: 'leaders', id: l.id }, { op: 'delete', col: 'usernames', id: usernameOf(l) });
      n++;
    }
    await store.batch(ops);
    state.leaderEdit = null;
    return n;
  }
  return 0;
}

/* ---------- activity log (admins, one location + one week at a time) ---------- */
/* ---------- attendance count for a whole location (admins) ---------- */
let locAttUnsubs = [];
function watchLocAtt(loc) {
  const rooms = roomsIn(loc.id);
  const key = `${loc.id}|${state.attWeek}|${rooms.map((r) => r.id).join(',')}`;
  if (state.locAttKey === key) return;
  locAttUnsubs.forEach((u) => u?.());
  state.locAttKey = key;
  state.locAtt = {};
  locAttUnsubs = rooms.map((r) => store.watchWhere2('attendance', [['roomId', r.id], ['weekId', state.attWeek]], (docs) => {
    if (state.locAttKey !== key) return;
    state.locAtt[r.id] = new Set(docs.map((d) => d.personId)).size;
    softRender();
  }));
}
function locAttHtml(loc) {
  watchLocAtt(loc);
  const rooms = roomsIn(loc.id);
  const ready = rooms.every((r) => state.locAtt?.[r.id] !== undefined);
  const total = ready ? rooms.reduce((n, r) => n + state.locAtt[r.id], 0) : '…';
  const thisWeek = state.attWeek === weekStart(new Date());
  return fold('locAtt', `Here ${thisWeek ? 'this week' : `week of ${esc(weekLabel(state.attWeek))}`} · all of ${esc(loc.name)}`, total, `
    <nav class="week">
      <button data-act="attWeek" data-n="-1" aria-label="Previous week">◀</button>
      <div><strong>Week of ${weekLabel(state.attWeek)}</strong>
        ${thisWeek ? '<small>This week</small>' : '<button class="link small" data-act="attThisWeek">Jump to this week</button>'}</div>
      <button data-act="attWeek" data-n="1" aria-label="Next week">▶</button>
    </nav>
    <ul class="edit">${rooms.map((r) => `<li><span class="grow">${esc(r.name)}</span><b>${state.locAtt?.[r.id] ?? '…'}</b></li>`).join('')
      || '<li class="muted small">No rooms yet.</li>'}
      ${rooms.length ? `<li><span class="grow"><b>Total</b></span><b>${total}</b></li>` : ''}</ul>`);
}

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
    .filter((l) => !isOwnerL(l) && (hasAccessIn(l, loc) || adminOfL(l, loc.id) || state.leaderEdit === l.id || (isOwner() && unassigned(l))));
  const leadersHtml = `
    <p class="muted small">People with access to <b>${esc(loc.name)}</b>.${myLocations().length > 1 ? ' Switch locations at the top for the others.' : ''}
      ${isOwner() ? '' : ' Only the owner can add or change admins.'}</p>
    ${sortToggle()}
    <ul class="leaders">
      ${leaders.map((l) => {
        const editing = state.leaderEdit === l.id && canEditLeader(l);
        const self = l.id === state.user.email;
        return `<li>
          <div class="row">
            <span class="grow"><b>${esc(listName(l.name))}</b> <em class="badge">${roleOf(l)}</em>${self ? ' <small class="muted">you</small>' : ''}
              <small class="email">Username: ${esc(usernameOf(l))}</small><small class="email">${unassigned(l) ? 'Not in any location yet' : esc(accessIn(l, loc))}</small></span>
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
    ${locAttHtml(loc)}
    ${fold('rooms', `${esc(loc.name)} rooms`, locRooms.length, roomsHtml)}
    ${fold('leaders', 'Leaders', leaders.filter((l) => hasAccessIn(l, loc)).length, leadersHtml)}
    ${fold('bulk', 'Add many leaders', '', bulkHtml(loc))}
    ${fold('years', 'School years', yearsOf(loc).length ? currentYear(loc).name : '', yearsHtml(loc))}
    ${fold('log', 'Activity log', '', logHtml(loc))}
    ${fold('erase', 'Erase data', '', eraseHtml(loc))}`;

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
      ${sortToggle()}
      <ul class="edit">
        ${roomPeople().map((p) => `<li>
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
      <button class="ghost wide" data-act="export">Download this room (Excel)</button>
      <button class="ghost wide" data-act="exportAll">${isOwner() ? 'Download everything: all locations &amp; rooms (Excel)'
        : `Download everything in ${esc(locations().filter((x) => adminOf(x.id)).map((x) => x.name).join(' & '))} (Excel)`}</button>
      <button class="ghost wide" data-act="exportAllTime">Download all-time points for ${esc(loc.name)} (CSV)</button>
      <p class="muted small">A tab for each location${isOwner() ? '' : ' you run'}, with each room listed down the page: every kid's total points, times here, and points in each category (all time), plus a total for each room. Each location also gets an attendance tab: how many kids were there each week, by room. Opens in Excel or Google Sheets.</p>`)}
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
  const room = roomById(person.roomId) || currentRoom();
  const id = store.add('entries', {
    roomId: room.id, weekId: state.week, personId: person.id, personName: person.name,
    categoryId, categoryName: name, points,
    leaderEmail: state.user.email, leaderName: me()?.name || '', ts: Date.now(),
  });
  logIt(`${signed(points)} ${name} → ${person.name}`, 'add', state.week, room);
  navigator.vibrate?.(15);
  toast(`${signed(points)} ${esc(name)} → ${esc(person.name)}`, () => {
    store.remove('entries', id);
    logIt(`Undid ${signed(points)} ${name} → ${person.name}`, 'del', state.week, room);
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
  roomPickDone: () => { state.roomPickOpen = false; },
  tab: (d) => { state.tab = d.tab; state.personId = null; state.roomPickOpen = false; requestAnimationFrame(() => window.scrollTo(0, 0)); },
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
    const person = state.v.people.find((p) => p.id === state.personId);
    const cat = state.v.categories.find((c) => c.id === d.id);
    if (person && cat) addEntry(person, cat.name, Number(cat.points) || 0, cat.id);
  },
  custom: () => {
    const person = state.v.people.find((p) => p.id === state.personId);
    if (!person) return;
    const raw = prompt(`Points for ${person.name} (use a minus sign to take away):`);
    if (raw === null) return;
    const points = Number(raw);
    if (!Number.isFinite(points) || raw.trim() === '') return alert('Please enter a number.');
    const note = prompt('What for? (optional)') || 'Custom';
    addEntry(person, note, points);
  },
  delEntry: (d) => {
    const e = state.v.entries.find((x) => x.id === d.id);
    if (!e || !confirm(`Remove ${e.points} pts for "${e.categoryName}"?`)) return;
    store.remove('entries', d.id);
    const who = state.v.people.find((p) => p.id === e.personId)?.name || e.personName || '';
    logIt(`Removed ${signed(Number(e.points) || 0)} ${e.categoryName} from ${who}`, 'del', e.weekId, roomById(e.roomId));
  },
  undo: () => {},
  toggleAtt: (d) => {
    const id = `${state.week}_${d.id}`;
    const person = state.v.people.find((p) => p.id === d.id);
    if (!person) return;
    const room = roomById(person.roomId);
    if (state.v.attendance.some((a) => a.id === id)) {
      store.remove('attendance', id);
      logIt(`Unmarked ${person.name} as here`, 'del', state.week, room);
    } else {
      store.set('attendance', id, { roomId: room.id, weekId: state.week, personId: d.id, personName: person.name,
        points: attendancePoints(room), leaderName: me()?.name || '', ts: Date.now() });
      logIt(`Marked ${person.name} here (${signed(attendancePoints(room))})`, 'add', state.week, room);
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
  sortNames: (d) => {
    const v = d.v === 'last' ? 'last' : 'first';
    state.sortPick = v;
    try { localStorage.setItem('hgui_sort', v); } catch {}
    const l = me();
    if (l) store.update('leaders', l.id, { sort: v });
  },
  theme: (d) => {
    try { if (d.v === 'auto') localStorage.removeItem('hgui_theme'); else localStorage.setItem('hgui_theme', d.v); } catch { /* ignore */ }
    if (d.v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = d.v;
  },
  logWeek: (d) => { state.logWeek = shiftWeek(state.logWeek, Number(d.n)); },
  logThisWeek: () => { state.logWeek = weekStart(new Date()); },
  attWeek: (d) => { state.attWeek = shiftWeek(state.attWeek, Number(d.n)); },
  attThisWeek: () => { state.attWeek = weekStart(new Date()); },

  // rooms & locations
  delLocation: (d) => {
    const loc = state.locations.find((l) => l.id === d.id);
    if (!loc || !isOwner()) return;
    if (roomsIn(loc.id).length) return alert(`Remove the rooms in ${loc.name} first.`);
    if (confirm(`Delete location "${loc.name}"?`)) store.remove('locations', loc.id);
  },
  delRoom: async (d) => {
    const r = state.rooms.find((x) => x.id === d.id);
    if (!r) return;
    if (state.rooms.length === 1) return alert("You can't delete the last room.");
    if (!adminOf(r.locationId)) return;
    if (!confirm(`Delete room "${roomLabel(r)}" and all its kids, point categories, points, and attendance? This can't be undone.`)) return;
    logIt(`Deleted room "${r.name}"`, 'del', nowWeek(), r);
    try { await deleteRoomAll(r); toast(`Deleted ${esc(r.name)}.`); } catch (e) { console.error(e); showError('Could not delete all of that room. Try again.'); }
  },
  delYear: (d) => {
    const loc = curLoc();
    if (!loc || !adminOf(loc.id) || !confirm(`Remove the year "${d.name}"? No points are deleted; they just count toward the year before it.`)) return;
    store.update('locations', loc.id, { years: (loc.years || []).filter((y) => y.id !== d.id) });
    logIt(`Removed school year "${d.name}"`, 'del', nowWeek(), roomsIn(loc.id)[0]);
  },
  erase: async (d) => {
    const loc = curLoc();
    const [label, what] = ERASE[d.what] || [];
    if (!loc || !label || !adminOf(loc.id)) return;
    if (d.what === 'rooms' && state.rooms.every((r) => r.locationId === loc.id)) return alert("These are the app's only rooms. Add a room somewhere else first.");
    const typed = prompt(`Erase ${what} in ${loc.name}?\n\nThis can't be undone. Type ERASE to confirm.`);
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== 'ERASE') return alert('Nothing was erased.');
    toast('Erasing…');
    try {
      const firstRoom = roomsIn(loc.id)[0];
      const n = await eraseIn(loc, d.what);
      if (d.what !== 'log' && d.what !== 'rooms') logIt(`Erased all ${label.toLowerCase()} (${n})`, 'del', nowWeek(), firstRoom);
      toast(`Erased ${n} ${label.toLowerCase()} in ${esc(loc.name)}.`);
    } catch (e) {
      console.error(e);
      showError('Some of it could not be erased. Check your connection and try again.');
    }
  },
  bulkCancel: () => { state.bulk = null; },
  bulkClose: () => { state.bulkResult = null; state.bulkText = ''; },
  bulkRun: async () => {
    const b = state.bulk;
    if (!b) return;
    const rows = b.rows.filter((r) => !r.error);
    // People giving up a username go first, so others can take it.
    rows.sort((x, y) => (y.existing ? 1 : 0) - (x.existing ? 1 : 0));
    state.bulk = null;
    const out = [];
    for (const [i, r] of rows.entries()) {
      state.bulkBusy = `${i + 1} of ${rows.length}`;
      softRender();
      try { out.push({ name: r.name, username: r.username, ok: true, msg: await bulkOne(r) }); }
      catch (e) { console.error(e); out.push({ name: r.name, username: r.username, ok: false, msg: AUTH_ERRORS[e?.code] || e?.message || 'Failed' }); }
    }
    for (const r of b.rows.filter((x) => x.error)) out.push({ name: r.name, username: r.username, ok: false, msg: r.error });
    state.bulkBusy = null;
    state.bulkResult = out;
    const loc = curLoc();
    logIt(`Added/updated ${out.filter((x) => x.ok).length} leaders from a list`, 'add', nowWeek(), loc && roomsIn(loc.id)[0]);
    toast(`Done: ${out.filter((x) => x.ok).length} of ${out.length}.`);
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
  // One Excel file: a tab per location, each room a section with every kid's totals by category.
  exportAll: async () => {
    const locs = locations().filter((l) => adminOf(l.id));
    await downloadWorkbook(locs.map((l) => ({ name: l.name, rooms: roomsIn(l.id) })),
      `${isOwner() ? 'all-locations' : 'my-locations'}-${ymd(new Date())}.xlsx`);
  },
  // Every kid in the location and their points across all years. No rooms.
  exportAllTime: async () => {
    const loc = curLoc();
    if (!loc || !adminOf(loc.id)) return;
    toast('Building the file…');
    try {
      const ids = new Set(roomsIn(loc.id).map((r) => r.id));
      const [ppl, ents, atts] = await Promise.all(['people', 'entries', 'attendance'].map(async (c) =>
        (await Promise.all([...ids].map((id) => store.getWhere(c, 'roomId', id)))).flat()));
      const pts = new Map(ppl.map((p) => [p.id, 0]));
      for (const x of [...ents, ...atts]) if (pts.has(x.personId)) pts.set(x.personId, pts.get(x.personId) + (Number(x.points) || 0));
      const rows = ppl.map((p) => [p.name, pts.get(p.id)]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const cell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const csv = [['Kid', 'All-time points'], ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
      a.download = `${slug(loc.name)}-all-time-points-${ymd(new Date())}.csv`;
      a.click();
      toast('Downloaded.');
    } catch (e) {
      console.error(e);
      alert('Could not build the file. Check your connection and try again.');
    }
  },
  export: async () => {
    const r = currentRoom();
    if (!r) return;
    await downloadWorkbook([{ name: r.name, rooms: [r] }], `${slug(roomLabel(r))}-${ymd(new Date())}.xlsx`);
  },
};

/* ---------- Excel export ---------- */
let excelLib = null;
const loadExcel = () => (excelLib ??= new Promise((resolve, reject) => {
  const el = document.createElement('script');
  el.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  el.onload = () => resolve(window.ExcelJS);
  el.onerror = () => { excelLib = null; reject(new Error('Could not load the Excel maker.')); };
  document.head.appendChild(el);
}));
const sheetName = (name, used) => {
  let n = String(name).replace(/[\\/?*[\]:]/g, '-').slice(0, 31) || 'Sheet';
  for (let i = 2; used.has(n); i++) n = `${String(name).slice(0, 27)} (${i})`;
  used.add(n);
  return n;
};
// One row per kid: total, times attended, then points earned in each category (all time).
async function addRoomSection(ws, room) {
  const [ppl, cats, ents, atts] = await Promise.all(ROOM_COLS.map((c) => store.getWhere(c, 'roomId', room.id)));
  const catList = [...cats].sort(byOrder);
  const byCat = new Map(catList.map((c) => [c.id, c]));
  const byCatName = new Map(catList.map((c) => [norm(c.name), c]));
  const hasStart = ents.some((e) => e.weekId === CARRYOVER);
  const hasOther = ents.some((e) => e.weekId !== CARRYOVER && !byCat.get(e.categoryId) && !byCatName.get(norm(e.categoryName || '')));
  const cols = ['Kid', 'Total points', 'Times here', 'Attendance pts',
    ...(hasStart ? ['Starting total'] : []), ...catList.map((c) => c.name), ...(hasOther ? ['Other'] : [])];

  const title = ws.addRow([room.name]);
  title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  title.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } }; });
  ws.mergeCells(title.number, 1, title.number, cols.length);
  const head = ws.addRow(cols);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; });

  const rows = new Map(ppl.map((p) => [p.id, { name: p.name, total: 0, here: 0, att: 0, start: 0, other: 0, cat: new Map() }]));
  for (const a of atts) { const r = rows.get(a.personId); if (r) { r.here++; r.att += Number(a.points) || 0; r.total += Number(a.points) || 0; } }
  for (const e of ents) {
    const r = rows.get(e.personId);
    if (!r) continue;
    const pts = Number(e.points) || 0;
    r.total += pts;
    if (e.weekId === CARRYOVER) { r.start += pts; continue; }
    const c = byCat.get(e.categoryId) || byCatName.get(norm(e.categoryName || ''));
    if (c) r.cat.set(c.id, (r.cat.get(c.id) || 0) + pts); else r.other += pts;
  }
  const list = [...rows.values()].sort((x, y) => y.total - x.total || x.name.localeCompare(y.name));
  for (const r of list) {
    ws.addRow([r.name, r.total, r.here, r.att, ...(hasStart ? [r.start] : []), ...catList.map((c) => r.cat.get(c.id) || 0), ...(hasOther ? [r.other] : [])]);
  }
  if (!list.length) ws.addRow(['No kids yet']).font = { italic: true, color: { argb: 'FF888888' } };
  else {
    const sum = (f) => list.reduce((n, r) => n + f(r), 0);
    const tot = ws.addRow([`Room total (${list.length} kids)`, sum((r) => r.total), sum((r) => r.here), sum((r) => r.att),
      ...(hasStart ? [sum((r) => r.start)] : []), ...catList.map((c) => sum((r) => r.cat.get(c.id) || 0)), ...(hasOther ? [sum((r) => r.other)] : [])]);
    tot.font = { bold: true };
    tot.eachCell((c) => { c.border = { top: { style: 'thin' } }; });
  }
  ws.addRow([]);
  return { width: cols.length, atts };
}
// How many kids were there each week: a row per week, a column per room, and a total.
function addAttendanceSheet(ws, attByRoom) {
  const counts = attByRoom.map(([, atts]) => {
    const m = new Map();
    for (const a of atts) { if (!m.has(a.weekId)) m.set(a.weekId, new Set()); m.get(a.weekId).add(a.personId); }
    return m;
  });
  const weeks = [...new Set(counts.flatMap((m) => [...m.keys()]))].filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w)).sort();
  const multi = attByRoom.length > 1;
  const head = ws.addRow(['Week of', ...attByRoom.map(([r]) => r.name), ...(multi ? ['Total'] : [])]);
  head.font = { bold: true };
  head.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }; });
  const sums = attByRoom.map(() => 0);
  for (const w of weeks) {
    const n = counts.map((m) => m.get(w)?.size || 0);
    n.forEach((x, i) => { sums[i] += x; });
    ws.addRow([parseYmd(w).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), ...n, ...(multi ? [n.reduce((a, b) => a + b, 0)] : [])]);
  }
  if (!weeks.length) ws.addRow(['No attendance yet']).font = { italic: true, color: { argb: 'FF888888' } };
  else {
    const tot = ws.addRow(['Total', ...sums, ...(multi ? [sums.reduce((a, b) => a + b, 0)] : [])]);
    tot.font = { bold: true };
    tot.eachCell((c) => { c.border = { top: { style: 'thin' } }; });
  }
  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];
  ws.getColumn(1).width = 16;
  for (let i = 2; i <= attByRoom.length + 2; i++) ws.getColumn(i).width = 16;
}
async function downloadWorkbook(tabs, filename) {
  toast('Building the file…');
  try {
    const ExcelJS = await loadExcel();
    const wb = new ExcelJS.Workbook();
    const used = new Set();
    for (const t of tabs) {
      const ws = wb.addWorksheet(sheetName(t.name, used));
      let width = 4;
      const attByRoom = [];
      for (const r of t.rooms) { const res = await addRoomSection(ws, r); width = Math.max(width, res.width); attByRoom.push([r, res.atts]); }
      if (!t.rooms.length) ws.addRow(['No rooms yet']);
      ws.getColumn(1).width = 28;
      for (let i = 2; i <= width; i++) ws.getColumn(i).width = 14;
      if (t.rooms.length) addAttendanceSheet(wb.addWorksheet(sheetName(`${t.name} attendance`, used)), attByRoom);
    }
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = filename;
    a.click();
    toast('Downloaded.');
  } catch (e) {
    console.error(e);
    alert('Could not build the file. Check your connection and try again.');
  }
}

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
      <div class="chips">${roomPeople().filter((p) => p.id !== from.id).map((p) =>
        `<button class="chip" data-act="mergeInto" data-id="${p.id}">${esc(listName(p.name))} <b>${t.get(p.id)?.pts ?? 0}</b></button>`).join('')}</div>
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
  importPreview: (f) => {
    const parsed = parseImport(f.get('text'));
    if (!parsed.categories.length && !parsed.kids.length) {
      alert('Nothing found. Make sure you have a line that says CATEGORIES or KIDS above each list.');
      return false;
    }
    state.importPreview = parsed;
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
  bulkPreview: (f) => {
    state.bulkText = f.get('text');
    const suffix = String(f.get('suffix') || '').trim();
    const rows = parseBulk(state.bulkText, suffix);
    if (!rows.length) { alert('Nothing found. Put one person per line.'); return false; }
    state.bulk = { rows };
  },
  addYear: (f) => {
    const loc = state.locations.find((l) => l.id === f.get('locationId'));
    if (!loc || !adminOf(loc.id)) return false;
    const name = f.get('name').trim();
    const start = weekStart(parseYmd(f.get('start')));
    const end = f.get('end');
    if (end < f.get('start')) { alert('The end date has to be after the start date.'); return false; }
    if ((loc.years || []).some((y) => y.start === start)) { alert('A year already starts that week.'); return false; }
    store.update('locations', loc.id, { years: [...(loc.years || []), { id: newId(), name, start, end }] });
    logIt(`Started school year "${name}" (week of ${weekLabel(start)} to ${endLabel(end)})`, 'add', nowWeek(), roomsIn(loc.id)[0]);
    state.board = 'year'; state.boardYear = null;
    toast(`${esc(name)} starts the week of ${esc(weekLabel(start))}.`);
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
// Remember whether the Rooms picker is open, so re-drawing the page doesn't snap it shut.
app.addEventListener('toggle', (e) => {
  if (e.target.classList?.contains('room-multi')) state.roomPickOpen = e.target.open;
}, true);
app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.role === 'room') { setRoom(el.value); render(); return; }
  if (el.dataset.role === 'viewRoom') {
    const ids = new Set(state.viewIds);
    if (el.checked) ids.add(el.value); else ids.delete(el.value);
    if (!ids.size) { el.checked = true; toast('Keep at least one room checked.'); return; }
    setView([...ids]); render(); return;
  }
  if (el.dataset.role === 'viewAll') {
    setView(el.checked ? roomsHere().map((r) => r.id) : [state.roomId || roomsHere()[0]?.id]); render(); return;
  }
  if (el.dataset.role === 'loc') { setLoc(el.value); render(); return; }
  if (el.dataset.role === 'logRoom') { state.logRoom = el.value; render(); return; }
  if (el.dataset.role === 'boardYear') { state.boardYear = el.value; render(); return; }
  if (el.dataset.role === 'yearEnd') {
    const loc = curLoc();
    const y = (loc?.years || []).find((x) => x.id === el.dataset.id);
    if (!y || !adminOf(loc.id)) return;
    if (el.value && el.value < y.start) { alert('The end date has to be after the year starts.'); render(); return; }
    store.update('locations', loc.id, { years: loc.years.map((x) => (x.id === y.id ? { ...x, end: el.value || null } : x)) });
    logIt(el.value ? `Set "${y.name}" to end ${endLabel(el.value)}` : `Removed the end date from "${y.name}"`, 'add', nowWeek(), roomsIn(loc.id)[0]);
    return;
  }
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
