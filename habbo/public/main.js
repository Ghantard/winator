import {
  iso, screenToTile, drawRoom, drawFurniture, furnitureDepth,
  drawAvatar, drawNameTag, drawBubble, chairBackInFront, drawChairBack,
} from './render.js';

const COLORS = ['#3b82c4', '#c43b52', '#2f9e5b', '#d9a441', '#8b5cc4', '#e0703a', '#222831', '#e8e8e8'];
const BUBBLE_MS = 7000;

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const state = {
  ws: null,
  myId: null,
  tickMs: 450,
  room: null,
  players: new Map(), // id -> { ...data, from, to, t0, bubble }
  camera: { x: 0, y: 0 },
  hover: null,
};

// ---------- Ecran de connexion ----------

let chosenColor = COLORS[0];
for (const color of COLORS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.style.background = color;
  b.setAttribute('aria-label', `Couleur ${color}`);
  b.setAttribute('aria-pressed', String(color === chosenColor));
  b.addEventListener('click', () => {
    chosenColor = color;
    document.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', String(s === b)));
  });
  $('swatches').append(b);
}

try {
  $('name-input').value = localStorage.getItem('habbo.name') ?? '';
} catch { /* stockage indisponible */ }

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name-input').value.trim();
  if (!name) return;
  try { localStorage.setItem('habbo.name', name); } catch { /* ignore */ }
  connect(name, chosenColor);
});

// ---------- Reseau ----------

function connect(name, color) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  ws.addEventListener('open', () => send({ t: 'join', name, color }));
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
      state.tickMs = msg.tickMs;
      $('login').hidden = true;
      $('topbar').hidden = false;
      $('chat-form').hidden = false;
      $('chat-log').hidden = false;
      renderRoomList(msg.rooms);
      break;

    case 'room':
      state.room = msg.room;
      state.players.clear();
      msg.room.players.forEach(addPlayer);
      $('room-name').textContent = msg.room.name;
      $('navigator').hidden = true;
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
        p.from = currentPos(p, now);
        p.to = { x: m.x, y: m.y };
        p.t0 = now;
        Object.assign(p, { x: m.x, y: m.y, dir: m.dir, walking: m.walking, sitting: m.sitting });
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

    case 'rooms':
      renderRoomList(msg.rooms);
      break;

    default:
      break;
  }
}

// ---------- Interface ----------

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
    name.style.color = p.color === '#222831' ? '#9fb0c6' : p.color;
    name.textContent = `${p.name} : `;
    line.append(name, document.createTextNode(text));
  });
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

$('nav-btn').addEventListener('click', () => {
  const nav = $('navigator');
  nav.hidden = !nav.hidden;
  if (!nav.hidden) send({ t: 'rooms' });
});
$('nav-close').addEventListener('click', () => { $('navigator').hidden = true; });

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  const text = input.value.trim();
  if (text) send({ t: 'chat', text });
  input.value = '';
});

// Taper n'importe ou envoie le focus dans le chat.
window.addEventListener('keydown', (e) => {
  if (!state.room || e.ctrlKey || e.metaKey || e.altKey) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
  if (e.key.length === 1 || e.key === 'Enter') $('chat-input').focus();
});

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

function tileAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return screenToTile(clientX - rect.left - state.camera.x, clientY - rect.top - state.camera.y);
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
  if (drag && !drag.moved && state.room) {
    const t = tileAt(e.clientX, e.clientY);
    send({ t: 'move', x: t.x, y: t.y });
  }
  drag = null;
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
    drawRoom(ctx, room, state.hover);

    // Tri par profondeur : mobilier et avatars melanges.
    const drawables = [];
    for (const f of room.furniture) {
      if (f.type === 'rug') continue;
      drawables.push({ depth: furnitureDepth(f), order: 0, draw: () => drawFurniture(ctx, f) });
      if (f.type === 'chair' && chairBackInFront(f)) {
        drawables.push({ depth: furnitureDepth(f), order: 2, draw: () => drawChairBack(ctx, f) });
      }
    }
    const heads = [];
    for (const p of state.players.values()) {
      const pos = currentPos(p, now);
      const moving = now - p.t0 < state.tickMs;
      // Pendant un pas, on prend la plus "avancee" des deux cases pour ne pas passer sous un meuble.
      const depth = moving ? Math.max(p.from.x + p.from.y, p.to.x + p.to.y) : p.to.x + p.to.y;
      drawables.push({
        depth,
        order: 1,
        draw: () => heads.push({ p, head: drawAvatar(ctx, p, pos, now, moving || p.walking) }),
      });
    }
    drawables.sort((a, b) => a.depth - b.depth || a.order - b.order);
    drawables.forEach((d) => d.draw());

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
