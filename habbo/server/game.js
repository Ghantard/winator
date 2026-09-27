// Logique de jeu : comptes, salles, catalogue, inventaire et interactions avec les mobis.
// Independant du transport : chaque client fournit une fonction `send(msg)`.
import crypto from 'node:crypto';
import { Room, publicPlayer } from './room.js';
import { ROOM_DEFS } from './rooms.js';
import { Store } from './store.js';
import { sanitizeLook } from '../public/look.js';
import { FURNI, initialState } from '../public/furni.js';

export const TICK_MS = 450;
const CHAT_MIN_INTERVAL_MS = 600;
const MAX_INVENTORY = 500;
const DICE_ROLL_MS = 1200;
const TELEPORT_MS = 900;
export const CREDIT_DRIP = 10;

function cleanText(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

export class Game {
  /** @param {Store} store */
  constructor(store) {
    this.store = store;
    this.clients = new Map(); // id joueur -> client
    this.nextPlayerId = 1;
    this.rooms = new Map();

    for (const def of ROOM_DEFS) {
      const saved = store.roomItems(def.id);
      const room = new Room(def, saved ?? []);
      if (!saved) this.#seed(room, def);
      room.onEvent = (msg) => this.broadcast(room, msg);
      room.onChange = () => store.saveSoon();
      this.rooms.set(def.id, room);
    }
    store.getRooms = () => Object.fromEntries([...this.rooms].map(([id, r]) => [id, [...r.items.values()]]));
  }

  #seed(room, def) {
    for (const f of def.furniture) {
      const fdef = FURNI[f.type];
      const err = room.placeItem({
        id: this.store.nextItemId(),
        type: f.type,
        x: f.x,
        y: f.y,
        dir: f.dir ?? fdef.rotations[0],
        z: 0,
        state: f.state ?? initialState(fdef),
        owner: null,
        ownerName: 'Hotel',
        link: null,
      });
      if (err) console.warn(`Mobi de depart ${f.type} (${f.x},${f.y}) dans ${def.id} : ${err}`);
    }
  }

  // ---------- Connexions ----------

  connect(send, close = () => {}) {
    return { send, close, player: null, room: null, key: null, user: null, lastChat: 0, teleporting: false };
  }

  disconnect(client) {
    if (!client.player) return;
    this.clients.delete(client.player.id);
    this.leaveRoom(client);
  }

  handle(client, msg) {
    if (!msg || typeof msg.t !== 'string' || !Object.hasOwn(HANDLERS, msg.t)) return;
    if (msg.t !== 'join' && !client.player) return;
    HANDLERS[msg.t].call(this, client, msg);
  }

  tick() {
    for (const room of this.rooms.values()) {
      if (room.players.size) room.tick();
    }
  }

  /** Credits offerts regulierement aux joueurs connectes. */
  dripCredits() {
    for (const c of this.clients.values()) {
      c.user.credits += CREDIT_DRIP;
      this.sendInventory(c);
    }
    this.store.saveSoon();
  }

  // ---------- Outils ----------

  broadcast(room, msg, exceptId) {
    for (const id of room.players.keys()) {
      if (id !== exceptId) this.clients.get(id)?.send(msg);
    }
  }

  roomList() {
    return [...this.rooms.values()].map((r) => ({ id: r.id, name: r.name, count: r.players.size }));
  }

  findItem(id) {
    for (const room of this.rooms.values()) {
      const item = room.items.get(id);
      if (item) return { room, item };
    }
    return null;
  }

  error(client, text) {
    client.send({ t: 'error', text });
  }

  sendInventory(client) {
    client.send({ t: 'inventory', inventory: client.user.inventory, credits: client.user.credits });
  }

  leaveRoom(client) {
    if (!client.room) return;
    client.room.removePlayer(client.player.id);
    this.broadcast(client.room, { t: 'player_left', id: client.player.id });
    client.room = null;
  }

  enterRoom(client, roomId, at) {
    const target = this.rooms.get(roomId);
    if (!target || (target === client.room && !at)) return;
    this.leaveRoom(client);
    client.room = target;
    target.addPlayer(client.player, at);
    client.send({ t: 'room', room: target.snapshot() });
    this.broadcast(target, { t: 'player_joined', player: publicPlayer(client.player) }, client.player.id);
  }

  /** Mobi de la salle courante que le joueur a le droit de modifier. */
  ownedItem(client, id) {
    const item = client.room?.items.get(id);
    if (!item) {
      this.error(client, 'Ce mobi n\'existe plus.');
      return null;
    }
    if (item.owner !== client.key) {
      this.error(client, 'Ce mobi ne t\'appartient pas.');
      return null;
    }
    return item;
  }

  // ---------- Interactions ----------

  useItem(client, item) {
    const room = client.room;
    const def = FURNI[item.type];
    const p = client.player;
    switch (def.use) {
      case 'toggle':
        room.setItemState(item, (item.state + 1) % def.states);
        break;

      case 'gate':
        if (item.state === 1 && [...room.players.values()].some((o) => Room.covers(item, o.x, o.y))) {
          this.error(client, 'Quelqu\'un est dans le portillon.');
          return;
        }
        room.setItemState(item, item.state === 1 ? 0 : 1);
        break;

      case 'dice':
      case 'spin': {
        if (room.distanceTo(p, item) > 1) {
          this.error(client, def.use === 'dice' ? 'Approche-toi du de pour le lancer.' : 'Approche-toi de la bouteille.');
          return;
        }
        const rolling = def.use === 'dice' ? 0 : -1;
        if (item.state === rolling) return;
        room.setItemState(item, rolling);
        setTimeout(() => {
          if (room.items.get(item.id) !== item) return;
          const result = def.use === 'dice' ? 1 + crypto.randomInt(6) : crypto.randomInt(8);
          room.setItemState(item, result);
        }, DICE_ROLL_MS);
        break;
      }

      case 'teleport':
        this.teleport(client, item);
        break;

      default:
        break;
    }
  }

  teleport(client, item) {
    const room = client.room;
    const p = client.player;
    if (!Room.covers(item, p.x, p.y) || p.path.length) {
      room.requestMove(p.id, item.x, item.y);
      this.error(client, 'Entre dans le teleporteur, puis double-clique dessus.');
      return;
    }
    if (client.teleporting) return;
    const dest = item.link != null ? this.findItem(item.link) : null;
    if (!dest) {
      this.error(client, 'Le teleporteur relie n\'est pose dans aucune salle.');
      return;
    }
    client.teleporting = true;
    room.setItemState(item, 1);
    setTimeout(() => {
      client.teleporting = false;
      if (room.items.get(item.id) === item) room.setItemState(item, 0);
      // Le joueur a pu partir entre-temps.
      if (!this.clients.has(p.id) || client.room !== room || !Room.covers(item, p.x, p.y)) return;
      const target = this.findItem(item.link);
      if (!target) return;
      const { room: destRoom, item: destItem } = target;
      if (destRoom.occupant(destItem.x, destItem.y, p.id)) {
        this.error(client, 'Quelqu\'un bloque le teleporteur d\'arrivee.');
        return;
      }
      if (destRoom === room) {
        room.warp(p, destItem.x, destItem.y);
      } else {
        this.enterRoom(client, destRoom.id, { x: destItem.x, y: destItem.y });
      }
      destRoom.setItemState(destItem, 1);
      setTimeout(() => {
        if (destRoom.items.get(destItem.id) === destItem) destRoom.setItemState(destItem, 0);
      }, 600);
    }, TELEPORT_MS);
  }
}

// Gestionnaires de messages (appeles avec `this` = Game).
const HANDLERS = {
  join(client, msg) {
    if (client.player) return;
    const token = typeof msg.token === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(msg.token)
      ? msg.token
      : crypto.randomUUID();
    const key = Store.keyFor(token);

    // Un meme compte ne peut etre connecte qu'une fois : l'ancienne connexion est fermee.
    for (const other of this.clients.values()) {
      if (other.key === key) {
        this.disconnect(other);
        other.close();
      }
    }

    const id = this.nextPlayerId++;
    const user = this.store.user(key);
    user.name = cleanText(msg.name, 16) || `Invite${id}`;
    client.key = key;
    client.user = user;
    client.player = { id, name: user.name, look: sanitizeLook(msg.look) };
    this.clients.set(id, client);
    client.send({
      t: 'welcome', id, token, key, tickMs: TICK_MS, rooms: this.roomList(),
      credits: user.credits, inventory: user.inventory,
    });
    this.enterRoom(client, ROOM_DEFS[0].id);
  },

  move(client, msg) {
    if (client.room) client.room.requestMove(client.player.id, msg.x, msg.y);
  },

  chat(client, msg) {
    if (!client.room) return;
    const text = cleanText(msg.text, 120);
    const now = Date.now();
    if (!text || now - client.lastChat < CHAT_MIN_INTERVAL_MS) return;
    client.lastChat = now;
    this.broadcast(client.room, { t: 'chat', id: client.player.id, text });
  },

  goto(client, msg) {
    this.enterRoom(client, msg.room);
  },

  rooms(client) {
    client.send({ t: 'rooms', rooms: this.roomList() });
  },

  buy(client, msg) {
    const def = Object.hasOwn(FURNI, msg.type) ? FURNI[msg.type] : null;
    if (!def) return;
    const user = client.user;
    const count = def.pair ? 2 : 1;
    if (user.credits < def.price) {
      this.error(client, 'Tu n\'as pas assez de credits.');
      return;
    }
    if (user.inventory.length + count > MAX_INVENTORY) {
      this.error(client, 'Ton inventaire est plein.');
      return;
    }
    user.credits -= def.price;
    if (def.pair) {
      const a = this.store.nextItemId();
      const b = this.store.nextItemId();
      user.inventory.push({ id: a, type: msg.type, link: b }, { id: b, type: msg.type, link: a });
    } else {
      user.inventory.push({ id: this.store.nextItemId(), type: msg.type });
    }
    this.store.saveSoon();
    this.sendInventory(client);
    client.send({ t: 'bought', type: msg.type });
  },

  place(client, msg) {
    if (!client.room) return;
    const inv = client.user.inventory;
    const idx = inv.findIndex((i) => i.id === msg.id);
    if (idx === -1) return;
    const entry = inv[idx];
    const def = FURNI[entry.type];
    const err = client.room.placeItem({
      id: entry.id,
      type: entry.type,
      x: msg.x,
      y: msg.y,
      dir: def.rotations.includes(msg.dir) ? msg.dir : def.rotations[0],
      z: 0,
      state: initialState(def),
      owner: client.key,
      ownerName: client.user.name,
      link: entry.link ?? null,
    });
    if (err) {
      this.error(client, err);
      return;
    }
    inv.splice(idx, 1);
    this.store.saveSoon();
    this.sendInventory(client);
  },

  move_item(client, msg) {
    const item = this.ownedItem(client, msg.id);
    if (!item) return;
    const def = FURNI[item.type];
    const dir = def.rotations.includes(msg.dir) ? msg.dir : item.dir;
    const err = client.room.moveItem(item.id, msg.x, msg.y, dir);
    if (err) this.error(client, err);
  },

  rotate_item(client, msg) {
    const item = this.ownedItem(client, msg.id);
    if (!item) return;
    const err = client.room.rotateItem(item.id);
    if (err) this.error(client, err);
  },

  pickup(client, msg) {
    const item = this.ownedItem(client, msg.id);
    if (!item) return;
    const res = client.room.removeItem(item.id);
    if (res.error) {
      this.error(client, res.error);
      return;
    }
    const entry = { id: item.id, type: item.type };
    if (item.link != null) entry.link = item.link;
    client.user.inventory.push(entry);
    this.store.saveSoon();
    this.sendInventory(client);
  },

  use(client, msg) {
    const item = client.room?.items.get(msg.id);
    if (item) this.useItem(client, item);
  },
};
