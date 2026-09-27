import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, publicPlayer } from './room.js';
import { ROOM_DEFS } from './rooms.js';

const PORT = Number(process.env.PORT) || 3000;
const TICK_MS = 450;
const CHAT_MIN_INTERVAL_MS = 600;
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const rooms = new Map(ROOM_DEFS.map((def) => [def.id, new Room(def)]));
const clients = new Map(); // id -> { ws, player, room, lastChat }
let nextId = 1;

// ---------- HTTP (fichiers statiques) ----------

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);

// ---------- WebSocket ----------

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const id of room.players.keys()) {
    if (id === exceptId) continue;
    const c = clients.get(id);
    if (c && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }
}

function roomList() {
  return [...rooms.values()].map((r) => ({ id: r.id, name: r.name, count: r.players.size }));
}

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function enterRoom(client, roomId) {
  const target = rooms.get(roomId);
  if (!target || target === client.room) return;
  if (client.room) {
    client.room.removePlayer(client.player.id);
    broadcast(client.room, { t: 'player_left', id: client.player.id });
  }
  client.room = target;
  target.addPlayer(client.player);
  send(client.ws, { t: 'room', room: target.snapshot() });
  broadcast(target, { t: 'player_joined', player: publicPlayer(client.player) }, client.player.id);
}

const handlers = {
  join(client, msg) {
    if (client.player) return;
    const id = nextId++;
    const color = /^#[0-9a-f]{6}$/i.test(msg.color ?? '') ? msg.color : '#3b82c4';
    client.player = { id, name: cleanText(msg.name, 16) || `Invite${id}`, color };
    clients.set(id, client);
    send(client.ws, { t: 'welcome', id, tickMs: TICK_MS, rooms: roomList() });
    enterRoom(client, ROOM_DEFS[0].id);
  },

  move(client, msg) {
    if (!client.room) return;
    client.room.requestMove(client.player.id, msg.x, msg.y);
  },

  chat(client, msg) {
    if (!client.room) return;
    const text = cleanText(msg.text, 120);
    const now = Date.now();
    if (!text || now - client.lastChat < CHAT_MIN_INTERVAL_MS) return;
    client.lastChat = now;
    broadcast(client.room, { t: 'chat', id: client.player.id, text });
  },

  goto(client, msg) {
    if (!client.player) return;
    enterRoom(client, msg.room);
  },

  rooms(client) {
    send(client.ws, { t: 'rooms', rooms: roomList() });
  },
};

wss.on('connection', (ws) => {
  const client = { ws, player: null, room: null, lastChat: 0 };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const handler = msg && typeof msg.t === 'string' && Object.hasOwn(handlers, msg.t) ? handlers[msg.t] : null;
    if (!handler) return;
    if (msg.t !== 'join' && !client.player) return;
    handler(client, msg);
  });

  ws.on('close', () => {
    if (!client.player) return;
    clients.delete(client.player.id);
    if (client.room) {
      client.room.removePlayer(client.player.id);
      broadcast(client.room, { t: 'player_left', id: client.player.id });
    }
  });
});

// ---------- Boucle de jeu ----------

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    const moves = room.tick();
    if (moves.length) broadcast(room, { t: 'moves', moves });
  }
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Serveur pret : http://localhost:${PORT}`);
});
