import { findPath, dirFromDelta } from './pathfinding.js';
import { BLOCKING_TYPES, SEAT_TYPES } from './rooms.js';

export class Room {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.layout = def.layout;
    this.height = def.layout.length;
    this.width = Math.max(...def.layout.map((row) => row.length));
    this.door = def.door;
    this.furniture = def.furniture.map((f, i) => ({ id: i + 1, w: 1, h: 1, dir: 4, ...f }));
    this.players = new Map();

    // Pre-calcul des cases bloquees et des sieges.
    this.blocked = new Set();
    this.seats = new Map();
    for (const f of this.furniture) {
      for (let dx = 0; dx < f.w; dx++) {
        for (let dy = 0; dy < f.h; dy++) {
          const k = `${f.x + dx},${f.y + dy}`;
          if (BLOCKING_TYPES.has(f.type)) this.blocked.add(k);
          if (SEAT_TYPES.has(f.type)) this.seats.set(k, f);
        }
      }
    }
  }

  isFloor(x, y) {
    return y >= 0 && y < this.height && x >= 0 && this.layout[y][x] === '0';
  }

  isWalkable(x, y) {
    return this.isFloor(x, y) && !this.blocked.has(`${x},${y}`);
  }

  occupant(x, y, exceptId) {
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.x === x && p.y === y) return p;
    }
    return null;
  }

  /** Place le joueur sur la porte, ou sur la case libre la plus proche. */
  addPlayer(player) {
    const spot = this.#freeSpotNear(this.door.x, this.door.y);
    Object.assign(player, { x: spot.x, y: spot.y, dir: 2, path: [], sitting: false });
    this.players.set(player.id, player);
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  /** Calcule le trajet vers (x, y). Retourne false si la destination est invalide. */
  requestMove(id, x, y) {
    const p = this.players.get(id);
    if (!p || !Number.isInteger(x) || !Number.isInteger(y)) return false;
    if (!this.isWalkable(x, y)) return false;
    const path = findPath(p, { x, y }, (cx, cy) => this.isWalkable(cx, cy));
    if (path.length === 0) return false;
    p.path = path;
    return true;
  }

  /** Avance chaque joueur d'une case. Retourne les deplacements a diffuser. */
  tick() {
    const moves = [];
    for (const p of this.players.values()) {
      if (p.path.length === 0) continue;
      let next = p.path[0];

      if (this.occupant(next.x, next.y, p.id)) {
        // Quelqu'un bloque : on recalcule en evitant les autres joueurs.
        const goal = p.path[p.path.length - 1];
        const path = findPath(p, goal, (cx, cy) => this.isWalkable(cx, cy) && !this.occupant(cx, cy, p.id));
        if (path.length === 0) {
          p.path = [];
          moves.push(this.#moveEvent(p));
          continue;
        }
        p.path = path;
        next = path[0];
      }

      p.dir = dirFromDelta(next.x - p.x, next.y - p.y);
      p.x = next.x;
      p.y = next.y;
      p.path.shift();
      p.sitting = false;

      if (p.path.length === 0) {
        const seat = this.seats.get(`${p.x},${p.y}`);
        if (seat) {
          p.sitting = true;
          p.dir = seat.dir;
        }
      }
      moves.push(this.#moveEvent(p));
    }
    return moves;
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      layout: this.layout,
      width: this.width,
      height: this.height,
      door: this.door,
      furniture: this.furniture,
      players: [...this.players.values()].map(publicPlayer),
    };
  }

  #moveEvent(p) {
    return { id: p.id, x: p.x, y: p.y, dir: p.dir, walking: p.path.length > 0, sitting: p.sitting };
  }

  #freeSpotNear(x, y) {
    // Parcours en largeur depuis la porte.
    const queue = [{ x, y }];
    const seen = new Set([`${x},${y}`]);
    while (queue.length) {
      const c = queue.shift();
      if (this.isWalkable(c.x, c.y) && !this.occupant(c.x, c.y)) return c;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const n = { x: c.x + dx, y: c.y + dy };
        const k = `${n.x},${n.y}`;
        if (!seen.has(k) && this.isFloor(n.x, n.y)) {
          seen.add(k);
          queue.push(n);
        }
      }
    }
    return { x, y };
  }
}

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, look: p.look,
    x: p.x, y: p.y, dir: p.dir, walking: p.path.length > 0, sitting: p.sitting,
  };
}
