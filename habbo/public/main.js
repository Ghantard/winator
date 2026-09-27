import {
  iso, screenToTile, drawRoom, drawAvatar, drawNameTag, drawBubble,
} from './render.js';
import { getAvatarSprite } from './avatar.js';
import { PALETTES, HAIR_STYLES, DEFAULT_LOOK, sanitizeLook, randomLook } from './look.js';
import { FURNI, CATEGORIES, footprint, nextRotation } from './furni.js';
import { drawItem, drawThumbnail, itemDepth, isFlat, hasFrontLayer } from './furni-render.js';

const BUBBLE_MS = 7000;

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const state = {
  ws: null,
  myId: null,
  myKey: null,
  tickMs: 450,
  room: null,
  players: new Map(), // id -> { ...data, from, to, t0, bubble }
  items: new Map(), // id -> mobi pose
  inventory: [],
  credits: 0,
  camera: { x: 0, y: 0 },
  hover: null,
  selected: null, // id du mobi selectionne
  mode: null, // { kind: 'place' | 'move', type, dir, invId?, id? }
};

// ---------- Ecran de connexion : editeur d'avatar ----------

let look = { ...DEFAULT_LOOK };
try {
  look = sanitizeLook(JSON.parse(localStorage.getItem('habbo.look')));
  $('name-input').value = localStorage.getItem('habbo.name') ?? '';
} catch { /* stockage indisponible */ }

let previewDir = 2;
const OPTIONS = [
  { key: 'skin', label: 'Peau', colors: PALETTES.skin },
  { key: 'hairStyle', label: 'Coiffure', labels: HAIR_STYLES.map((h) => h.label) },
  { key: 'hair', label: 'Cheveux', colors: PALETTES.hair },
  { key: 'shirt', label: 'Haut', colors: PALETTES.shirt },
  { key: 'pants', label: 'Bas', colors: PALETTES.pants },
];

function buildEditor() {
  const root = $('look-options');
  root.replaceChildren();
  for (const opt of OPTIONS) {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = opt.label;
    const values = document.createElement('div');
    values.className = 'opt-values';
    const items = opt.colors ?? opt.labels;
    items.forEach((item, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (opt.colors) {
        b.className = 'swatch';
        b.style.background = item;
        b.setAttribute('aria-label', `${opt.label} ${i + 1}`);
      } else {
        b.className = 'chip';
        b.textContent = item;
      }
      b.setAttribute('aria-pressed', String(look[opt.key] === i));
      b.addEventListener('click', () => {
        look[opt.key] = i;
        buildEditor();
      });
      values.append(b);
    });
    row.append(label, values);
    root.append(row);
  }
}

function drawPreview(now) {
  if ($('login').hidden) return;
  const pc = $('preview');
  const pctx = pc.getContext('2d');
  pctx.clearRect(0, 0, pc.width, pc.height);
  pctx.imageSmoothingEnabled = false;
  const sprite = getAvatarSprite(look, previewDir, { blinking: now % 3500 < 130 });
  pctx.drawImage(sprite, 0, 0, sprite.width * 2, sprite.height * 2);
  requestAnimationFrame(drawPreview);
}

$('rotate-left').addEventListener('click', () => { previewDir = (previewDir + 7) % 8; });
$('rotate-right').addEventListener('click', () => { previewDir = (previewDir + 1) % 8; });
$('random-look').addEventListener('click', () => {
  look = randomLook();
  buildEditor();
});

buildEditor();
requestAnimationFrame(drawPreview);

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name-input').value.trim();
  if (!name) return;
  try {
    localStorage.setItem('habbo.name', name);
    localStorage.setItem('habbo.look', JSON.stringify(look));
  } catch { /* ignore */ }
  connect(name, look);
});

// ---------- Reseau ----------

function loadToken() {
  try {
    return localStorage.getItem('habbo.token');
  } catch {
    return null;
  }
}

function connect(name, look) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  ws.addEventListener('open', () => send({ t: 'join', name, look, token: loadToken() }));
  ws.addEventListener('message', (e) => handle(JSON.parse(e.data)));
  ws.addEventListener('close', () => { $('disconnected').hidden = false; });
}

function send(msg) {
  if (state.ws?.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function addPlayer(p) {
  const pos = { x: p.x, y: p.y };
  state.players.set(p.id, { ...p, from: pos, to: pos, t0: 0, bubble: null });
}

function handle(msg) {
  switch (msg.t) {
    case 'welcome':
      state.myId = msg.id;
      state.myKey = msg.key;
      state.tickMs = msg.tickMs;
      try { localStorage.setItem('habbo.token', msg.token); } catch { /* ignore */ }
      $('login').hidden = true;
      $('topbar').hidden = false;
      $('chat-form').hidden = false;
      $('chat-log').hidden = false;
      renderRoomList(msg.rooms);
      setInventory(msg.inventory, msg.credits);
      break;

    case 'room':
      state.room = msg.room;
      state.players.clear();
      state.items = new Map(msg.room.items.map((i) => [i.id, i]));
      msg.room.players.forEach(addPlayer);
      $('room-name').textContent = msg.room.name;
      $('navigator').hidden = true;
      select(null);
      setMode(null);
      centerCamera();
      logSystem(`Tu entres dans « ${msg.room.name} ».`);
      break;

    case 'player_joined':
      addPlayer(msg.player);
      logSystem(`${msg.player.name} est arrive.`);
      break;

    case 'player_left': {
      const p = state.players.get(msg.id);
      if (p) logSystem(`${p.name} est parti.`);
      state.players.delete(msg.id);
      break;
    }

    case 'moves': {
      const now = performance.now();
      for (const m of msg.moves) {
        const p = state.players.get(m.id);
        if (!p) continue;
        p.from = msg.warp ? { x: m.x, y: m.y } : currentPos(p, now);
        p.to = { x: m.x, y: m.y };
        p.t0 = msg.warp ? 0 : now;
        Object.assign(p, { x: m.x, y: m.y, z: m.z, dir: m.dir, walking: m.walking, sitting: m.sitting });
      }
      break;
    }

    case 'chat': {
      const p = state.players.get(msg.id);
      if (!p) break;
      p.bubble = { text: msg.text, at: performance.now() };
      logChat(p, msg.text);
      break;
    }

    case 'item_add':
    case 'item_update':
      state.items.set(msg.item.id, msg.item);
      if (state.selected === msg.item.id) renderInfo();
      break;

    case 'item_remove':
      state.items.delete(msg.id);
      if (state.selected === msg.id) select(null);
      if (state.mode?.kind === 'move' && state.mode.id === msg.id) setMode(null);
      break;

    case 'inventory':
      setInventory(msg.inventory, msg.credits);
      break;

    case 'bought':
      toast(`${FURNI[msg.type].name} ajoute a ton inventaire.`);
      break;

    case 'error':
      toast(msg.text, true);
      break;

    case 'rooms':
      renderRoomList(msg.rooms);
      break;

    default:
      break;
  }
}

// ---------- Interface : chat, navigateur, messages ----------

function logLine(build) {
  const log = $('chat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 20;
  const line = document.createElement('div');
  line.className = 'line';
  build(line);
  log.append(line);
  while (log.children.length > 100) log.firstChild.remove();
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function logSystem(text) {
  logLine((line) => {
    line.classList.add('system');
    line.textContent = text;
  });
}

function logChat(p, text) {
  logLine((line) => {
    const name = document.createElement('span');
    name.className = 'name';
    const shirt = PALETTES.shirt[p.look.shirt];
    name.style.color = p.look.shirt === 6 ? '#9fb0c6' : shirt;
    name.textContent = `${p.name} : `;
    line.append(name, document.createTextNode(text));
  });
}

let toastTimer = null;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

function renderRoomList(rooms) {
  const list = $('room-list');
  list.replaceChildren();
  for (const r of rooms) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    if (state.room?.id === r.id) b.classList.add('current');
    const name = document.createElement('span');
    name.textContent = r.name;
    const count = document.createElement('span');
    count.textContent = `${r.count} 👤`;
    b.append(name, count);
    b.addEventListener('click', () => send({ t: 'goto', room: r.id }));
    li.append(b);
    list.append(li);
  }
}

function togglePanel(id, onOpen) {
  const panel = $(id);
  const opening = panel.hidden;
  // Un seul grand panneau a gauche a la fois.
  for (const other of ['navigator', 'catalog', 'inventory']) if (other !== id) $(other).hidden = true;
  panel.hidden = !opening;
  if (opening && onOpen) onOpen();
}

$('nav-btn').addEventListener('click', () => togglePanel('navigator', () => send({ t: 'rooms' })));
$('cat-btn').addEventListener('click', () => togglePanel('catalog', renderCatalog));
$('inv-btn').addEventListener('click', () => togglePanel('inventory', renderInventory));
document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => {
    $(b.dataset.close).hidden = true;
    if (b.dataset.close === 'furni-info') select(null);
  });
});

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  const text = input.value.trim();
  if (text) send({ t: 'chat', text });
  input.value = '';
});

window.addEventListener('keydown', (e) => {
  if (!state.room || e.ctrlKey || e.metaKey || e.altKey) return;
  const active = document.activeElement;
  const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (e.key === 'Escape') {
    if (state.mode) setMode(null);
    else select(null);
    if (typing) active.blur();
    return;
  }
  if (typing) return;
  if (state.mode && (e.key === 'r' || e.key === 'R')) {
    state.mode.dir = nextRotation(FURNI[state.mode.type], state.mode.dir);
    return;
  }
  // Taper n'importe ou envoie le focus dans le chat.
  if (e.key.length === 1 || e.key === 'Enter') $('chat-input').focus();
});

// ---------- Catalogue ----------

let catTab = CATEGORIES[0].id;
let catChoice = null;

function renderCatalog() {
  const tabs = $('cat-tabs');
  tabs.replaceChildren();
  for (const cat of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = cat.label;
    b.setAttribute('aria-pressed', String(cat.id === catTab));
    b.addEventListener('click', () => {
      catTab = cat.id;
      renderCatalog();
    });
    tabs.append(b);
  }

  const grid = $('cat-grid');
  grid.replaceChildren();
  for (const [type, def] of Object.entries(FURNI)) {
    if (def.cat !== catTab) continue;
    const cell = furniCell(type, `${def.price} cr.`);
    cell.setAttribute('aria-pressed', String(type === catChoice));
    cell.title = def.name;
    cell.addEventListener('click', () => {
      catChoice = type;
      renderCatalog();
    });
    grid.append(cell);
  }

  const def = FURNI[catChoice];
  $('cat-name').textContent = def ? def.name : 'Choisis un mobi';
  $('cat-price').textContent = def ? `${def.price} credits` : '';
  $('cat-buy').disabled = !def || state.credits < def.price;
  $('cat-buy').textContent = def && state.credits < def.price ? 'Pas assez de credits' : 'Acheter';
  const preview = $('cat-preview');
  if (def) {
    preview.hidden = false;
    drawThumbnail(preview, catChoice, 96);
  } else {
    preview.hidden = true;
  }
}

$('cat-buy').addEventListener('click', () => {
  if (catChoice) send({ t: 'buy', type: catChoice });
});

function furniCell(type, label, badge) {
  const cell = document.createElement('button');
  cell.type = 'button';
  cell.className = 'furni-cell';
  const thumb = document.createElement('canvas');
  drawThumbnail(thumb, type, 60);
  const text = document.createElement('span');
  text.textContent = label;
  cell.append(thumb, text);
  if (badge) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = badge;
    cell.append(b);
  }
  return cell;
}

// ---------- Inventaire ----------

function setInventory(inventory, credits) {
  state.inventory = inventory;
  state.credits = credits;
  $('credits-value').textContent = String(credits);
  if (!$('inventory').hidden) renderInventory();
  if (!$('catalog').hidden) renderCatalog();
  // Fin du mode pose si on n'a plus ce mobi.
  if (state.mode?.kind === 'place') {
    const next = inventory.find((i) => i.type === state.mode.type);
    if (next) state.mode.invId = next.id;
    else setMode(null);
  }
}

function renderInventory() {
  const groups = new Map();
  for (const entry of state.inventory) {
    if (!groups.has(entry.type)) groups.set(entry.type, []);
    groups.get(entry.type).push(entry);
  }
  const grid = $('inv-grid');
  grid.replaceChildren();
  for (const [type, entries] of groups) {
    const def = FURNI[type];
    if (!def) continue;
    const cell = furniCell(type, def.name, entries.length > 1 ? `x${entries.length}` : null);
    cell.title = def.name;
    cell.addEventListener('click', () => {
      setMode({ kind: 'place', type, invId: entries[0].id, dir: def.rotations[0] });
      $('inventory').hidden = true;
    });
    grid.append(cell);
  }
  $('inv-empty').hidden = groups.size > 0;
}

// ---------- Mobi selectionne ----------

function select(id) {
  state.selected = id;
  renderInfo();
}

function renderInfo() {
  const item = state.items.get(state.selected);
  const panel = $('furni-info');
  if (!item) {
    panel.hidden = true;
    return;
  }
  const def = FURNI[item.type];
  const mine = item.owner && item.owner === state.myKey;
  panel.hidden = false;
  $('info-name').textContent = def.name;
  drawThumbnail($('info-preview'), item.type, 110, item.dir);
  $('info-owner').textContent = item.owner ? `Proprietaire : ${item.ownerName}` : 'Mobilier de l\'hotel';
  $('info-use').hidden = !def.use;
  $('info-use').textContent = {
    toggle: 'Allumer / eteindre', gate: 'Ouvrir / fermer', dice: 'Lancer', spin: 'Faire tourner', teleport: 'Se teleporter',
  }[def.use] ?? 'Utiliser';
  if (item.type === 'fridge') $('info-use').textContent = 'Ouvrir / fermer';
  for (const id of ['info-rotate', 'info-move', 'info-pickup']) $(id).hidden = !mine;
  $('info-rotate').hidden = !mine || def.rotations.length < 2;
}

$('info-use').addEventListener('click', () => send({ t: 'use', id: state.selected }));
$('info-rotate').addEventListener('click', () => send({ t: 'rotate_item', id: state.selected }));
$('info-pickup').addEventListener('click', () => {
  send({ t: 'pickup', id: state.selected });
  select(null);
});
$('info-move').addEventListener('click', () => {
  const item = state.items.get(state.selected);
  if (item) setMode({ kind: 'move', type: item.type, id: item.id, dir: item.dir });
});

function setMode(mode) {
  state.mode = mode;
  $('place-hint').hidden = !mode;
}

// ---------- Camera et souris ----------

function viewSize() {
  return { w: canvas.clientWidth, h: canvas.clientHeight };
}

function centerCamera() {
  const r = state.room;
  const { w, h } = viewSize();
  const mid = iso(r.width / 2, r.height / 2);
  state.camera.x = Math.round(w / 2 - mid.x);
  state.camera.y = Math.round(h / 2 - mid.y + 40);
}

function canvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return { x: clientX - rect.left - state.camera.x, y: clientY - rect.top - state.camera.y };
}

function tileAt(clientX, clientY) {
  const p = canvasPoint(clientX, clientY);
  return screenToTile(p.x, p.y);
}

// Test au pixel pres : on dessine le mobi seul sur un canvas de 1x1 pixel.
const pickCanvas = document.createElement('canvas');
pickCanvas.width = 1;
pickCanvas.height = 1;
const pickCtx = pickCanvas.getContext('2d', { willReadFrequently: true });

function itemAtPoint(clientX, clientY) {
  const p = canvasPoint(clientX, clientY);
  const now = performance.now();
  const order = sortedItems().reverse();
  for (const item of order) {
    pickCtx.setTransform(1, 0, 0, 1, 0, 0);
    pickCtx.clearRect(0, 0, 1, 1);
    pickCtx.setTransform(1, 0, 0, 1, -p.x, -p.y);
    drawItem(pickCtx, item, now, 'all', { fx: false });
    if (pickCtx.getImageData(0, 0, 1, 1).data[3] > 20) return item;
  }
  return null;
}

/** Mobis du plus lointain au plus proche (plats en premier). */
function sortedItems() {
  return [...state.items.values()].sort((a, b) => (isFlat(b) - isFlat(a)) || (itemDepth(a) - itemDepth(b)) || (a.z - b.z));
}

let drag = null;

canvas.addEventListener('pointerdown', (e) => {
  drag = { sx: e.clientX, sy: e.clientY, cx: state.camera.x, cy: state.camera.y, moved: false };
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (Math.hypot(dx, dy) > 6) drag.moved = true;
    if (drag.moved) {
      state.camera.x = drag.cx + dx;
      state.camera.y = drag.cy + dy;
    }
  }
  if (state.room) state.hover = tileAt(e.clientX, e.clientY);
});

canvas.addEventListener('pointerup', (e) => {
  const click = drag && !drag.moved && state.room;
  drag = null;
  if (!click) return;
  const t = tileAt(e.clientX, e.clientY);

  if (state.mode) {
    const m = state.mode;
    if (m.kind === 'place') send({ t: 'place', id: m.invId, x: t.x, y: t.y, dir: m.dir });
    else send({ t: 'move_item', id: m.id, x: t.x, y: t.y, dir: m.dir });
    if (m.kind === 'move') setMode(null);
    return;
  }

  const item = itemAtPoint(e.clientX, e.clientY);
  if (item) {
    select(item.id);
    const def = FURNI[item.type];
    // Un clic sur un siege ou un mobi traversable y conduit l'avatar.
    if (def.sit !== undefined || def.walkable || (def.use === 'gate' && item.state === 1)) {
      const r = { ...footprint(def, item.dir), x: item.x, y: item.y };
      const inside = t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;
      send({ t: 'move', x: inside ? t.x : item.x, y: inside ? t.y : item.y });
    }
    return;
  }
  select(null);
  send({ t: 'move', x: t.x, y: t.y });
});

canvas.addEventListener('dblclick', (e) => {
  if (!state.room || state.mode) return;
  const item = itemAtPoint(e.clientX, e.clientY);
  if (item && FURNI[item.type].use) send({ t: 'use', id: item.id });
});

canvas.addEventListener('contextmenu', (e) => {
  // Clic droit : tourner le mobi en cours de pose.
  if (!state.mode) return;
  e.preventDefault();
  state.mode.dir = nextRotation(FURNI[state.mode.type], state.mode.dir);
});

canvas.addEventListener('pointerleave', () => { state.hover = null; });

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const { w, h } = viewSize();
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------- Apercu de pose ----------

/** Estimation cote client de la validite d'une pose (le serveur a le dernier mot). */
function previewPlacement(type, x, y, dir, ignoreId) {
  const def = FURNI[type];
  const fp = footprint(def, dir);
  const room = state.room;
  let z = 0;
  let ok = true;
  for (let dx = 0; dx < fp.w; dx++) {
    for (let dy = 0; dy < fp.h; dy++) {
      const tx = x + dx;
      const ty = y + dy;
      if (ty < 0 || ty >= room.height || tx < 0 || room.layout[ty][tx] !== '0') ok = false;
      if (room.door.x === tx && room.door.y === ty) ok = false;
      for (const other of state.items.values()) {
        if (other.id === ignoreId) continue;
        const ofp = footprint(FURNI[other.type], other.dir);
        if (tx < other.x || tx >= other.x + ofp.w || ty < other.y || ty >= other.y + ofp.h) continue;
        if (!FURNI[other.type].stackable) ok = false;
        z = Math.max(z, other.z + FURNI[other.type].height);
      }
    }
  }
  return { ok, z };
}

// ---------- Boucle de rendu ----------

function currentPos(p, now) {
  const t = Math.min(1, (now - p.t0) / state.tickMs);
  return { x: p.from.x + (p.to.x - p.from.x) * t, y: p.from.y + (p.to.y - p.from.y) * t };
}

function frame(now) {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#11161f';
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  const room = state.room;
  if (room) {
    ctx.translate(state.camera.x, state.camera.y);

    const m = state.mode;
    const ghost = m && state.hover
      ? { ...previewPlacement(m.type, state.hover.x, state.hover.y, m.dir, m.id), type: m.type, x: state.hover.x, y: state.hover.y, dir: m.dir }
      : null;
    drawRoom(ctx, room, m ? null : state.hover);

    const items = sortedItems();
    for (const item of items) if (isFlat(item)) drawItem(ctx, item, now);

    // Tri par profondeur : (case, couche, hauteur).
    // Couches : 0 = mobi, 1 = avatar, 2 = partie avant d'un mobi (dossier, montant).
    const drawables = [];
    for (const item of items) {
      if (isFlat(item)) continue;
      const depth = itemDepth(item);
      const layered = hasFrontLayer(item);
      drawables.push({ depth, layer: 0, z: item.z, draw: () => drawItem(ctx, item, now, layered ? 'base' : 'all') });
      if (layered) drawables.push({ depth, layer: 2, z: item.z, draw: () => drawItem(ctx, item, now, 'front') });
    }
    const heads = [];
    for (const p of state.players.values()) {
      const pos = currentPos(p, now);
      const moving = now - p.t0 < state.tickMs;
      // Pendant un pas, on prend la plus "avancee" des deux cases pour ne pas passer sous un meuble.
      const depth = moving ? Math.max(p.from.x + p.from.y, p.to.x + p.to.y) : p.to.x + p.to.y;
      drawables.push({
        depth,
        layer: 1,
        z: p.z ?? 0,
        draw: () => heads.push({ p, head: drawAvatar(ctx, p, pos, now, moving || p.walking) }),
      });
    }
    drawables.sort((a, b) => a.depth - b.depth || a.layer - b.layer || a.z - b.z);
    drawables.forEach((d) => d.draw());

    // Contour du mobi selectionne.
    const sel = state.items.get(state.selected);
    if (sel && !m) {
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(now / 200);
      ctx.globalCompositeOperation = 'lighter';
      drawItem(ctx, sel, now, 'all', { fx: false });
      ctx.restore();
    }

    // Fantome du mobi en cours de pose / deplacement.
    if (ghost) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      drawItem(ctx, { ...ghost, z: ghost.z, state: 0 }, now, 'all', { fx: false });
      ctx.restore();
      const fp = footprint(FURNI[m.type], m.dir);
      ctx.save();
      ctx.strokeStyle = ghost.ok ? 'rgba(80,220,120,.9)' : 'rgba(240,80,80,.9)';
      ctx.lineWidth = 2;
      const pts = [iso(ghost.x, ghost.y), iso(ghost.x + fp.w, ghost.y), iso(ghost.x + fp.w, ghost.y + fp.h), iso(ghost.x, ghost.y + fp.h)];
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // Etiquettes et bulles par-dessus tout.
    for (const { p, head } of heads) {
      drawNameTag(ctx, p.name, head.x, head.y, p.id === state.myId);
    }
    for (const { p, head } of heads) {
      if (!p.bubble) continue;
      const age = now - p.bubble.at;
      if (age > BUBBLE_MS) {
        p.bubble = null;
        continue;
      }
      const alpha = age > BUBBLE_MS - 800 ? (BUBBLE_MS - age) / 800 : 1;
      drawBubble(ctx, p.name, p.bubble.text, head.x, head.y - 16, alpha);
    }
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
