import { findPath, dirFromDelta } from './pathfinding.js';
import { FURNI, footprint, nextRotation } from '../public/furni.js';

export const MAX_STACK = 240;

export class Room {
  /**
   * @param {object} def    definition statique (id, nom, plan, porte)
   * @param {object[]} items mobis poses dans la salle
   */
  constructor(def, items = []) {
    this.id = def.id;
    this.name = def.name;
    this.layout = def.layout;
    this.height = def.layout.length;
    this.width = Math.max(...def.layout.map((row) => row.length));
    this.door = def.door;
    this.items = new Map(items.map((i) => [i.id, i]));
    this.players = new Map();
    /** Appele pour chaque evenement a diffuser dans la salle. */
    this.onEvent = () => {};
    /** Appele quand les mobis changent (pour la sauvegarde). */
    this.onChange = () => {};
  }

  // ---------- Geometrie ----------

  isFloor(x, y) {
    return y >= 0 && y < this.height && x >= 0 && this.layout[y][x] === '0';
  }

  isDoor(x, y) {
    return this.door.x === x && this.door.y === y;
  }

  static rect(item) {
    const fp = footprint(FURNI[item.type], item.dir);
    return { x: item.x, y: item.y, w: fp.w, h: fp.h };
  }

  static covers(item, x, y) {
    const r = Room.rect(item);
    return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  }

  static overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  /** Mobis sur une case, du plus bas au plus haut. */
  itemsAt(x, y, ignoreId) {
    const list = [];
    for (const item of this.items.values()) {
      if (item.id !== ignoreId && Room.covers(item, x, y)) list.push(item);
    }
    return list.sort((a, b) => a.z - b.z);
  }

  isWalkable(x, y) {
    if (!this.isFloor(x, y)) return false;
    return this.itemsAt(x, y).every((item) => {
      const def = FURNI[item.type];
      if (def.use === 'gate') return item.state === 1;
      return def.walkable || def.sit !== undefined;
    });
  }

  /** Siege le plus haut sur une case, s'il y en a un. */
  seatAt(x, y) {
    const items = this.itemsAt(x, y);
    const top = items[items.length - 1];
    if (!top || FURNI[top.type].sit === undefined) return null;
    return { z: top.z + FURNI[top.type].sit, dir: top.dir };
  }

  occupant(x, y, exceptId) {
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.x === x && p.y === y) return p;
    }
    return null;
  }

  // ---------- Joueurs ----------

  /** Place le joueur sur la case demandee si possible, sinon pres de la porte. */
  addPlayer(player, at) {
    const spot = at && this.isWalkable(at.x, at.y) && !this.occupant(at.x, at.y)
      ? at
      : this.#freeSpotNear(this.door.x, this.door.y);
    Object.assign(player, { x: spot.x, y: spot.y, dir: 2, path: [], sitting: false, z: 0 });
    this.players.set(player.id, player);
    this.#updateStance(player);
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

  /** Teleporte un joueur sur une case de la salle (sans animation de marche). */
  warp(p, x, y) {
    p.x = x;
    p.y = y;
    p.path = [];
    this.#updateStance(p);
    this.onEvent({ t: 'moves', moves: [moveEvent(p)], warp: true });
  }

  /** Avance chaque joueur d'une case et diffuse les deplacements. */
  tick() {
    const moves = [];
    for (const p of this.players.values()) {
      if (p.path.length === 0) continue;
      let next = p.path[0];

      if (this.occupant(next.x, next.y, p.id) || !this.isWalkable(next.x, next.y)) {
        // Chemin bloque (joueur, portillon ferme, mobi pose) : on recalcule.
        const goal = p.path[p.path.length - 1];
        const path = findPath(p, goal, (cx, cy) => this.isWalkable(cx, cy) && !this.occupant(cx, cy, p.id));
        if (path.length === 0) {
          p.path = [];
          moves.push(moveEvent(p));
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
      p.z = 0;
      if (p.path.length === 0) this.#updateStance(p);
      moves.push(moveEvent(p));
    }
    if (moves.length) this.onEvent({ t: 'moves', moves });
    return moves;
  }

  #updateStance(p) {
    const seat = p.path.length === 0 ? this.seatAt(p.x, p.y) : null;
    p.sitting = !!seat;
    p.z = seat ? seat.z : 0;
    if (seat) p.dir = seat.dir;
  }

  /** Remet a jour la posture des joueurs a l'arret sur une zone (apres un changement de mobi). */
  #refreshPlayersIn(rect) {
    const moves = [];
    for (const p of this.players.values()) {
      if (p.path.length || !Room.overlaps(rect, { x: p.x, y: p.y, w: 1, h: 1 })) continue;
      this.#updateStance(p);
      moves.push(moveEvent(p));
    }
    if (moves.length) this.onEvent({ t: 'moves', moves });
  }

  // ---------- Mobilier ----------

  /**
   * Verifie qu'un mobi peut etre pose. Retourne { z } ou { error }.
   * @param {number} [ignoreId] mobi a ignorer (celui qu'on deplace)
   */
  checkPlacement(type, x, y, dir, ignoreId) {
    const def = FURNI[type];
    if (!def) return { error: 'Mobi inconnu.' };
    if (!def.rotations.includes(dir)) return { error: 'Direction impossible pour ce mobi.' };
    if (![x, y].every(Number.isInteger)) return { error: 'Position invalide.' };
    const fp = footprint(def, dir);
    const passable = def.walkable || def.sit !== undefined;
    let z = 0;
    for (let dx = 0; dx < fp.w; dx++) {
      for (let dy = 0; dy < fp.h; dy++) {
        const tx = x + dx;
        const ty = y + dy;
        if (!this.isFloor(tx, ty)) return { error: 'Il faut poser le mobi sur le sol.' };
        if (this.isDoor(tx, ty)) return { error: 'On ne peut rien poser devant la porte.' };
        if (!passable && this.occupant(tx, ty)) return { error: 'Quelqu\'un se trouve a cet endroit.' };
        for (const below of this.itemsAt(tx, ty, ignoreId)) {
          const bdef = FURNI[below.type];
          if (!bdef.stackable) return { error: 'On ne peut rien empiler sur ce mobi.' };
          z = Math.max(z, below.z + bdef.height);
        }
      }
    }
    if (z + def.height > MAX_STACK) return { error: 'La pile est trop haute.' };
    return { z };
  }

  /** Vrai si un autre mobi est pose sur celui-ci. */
  hasItemsOnTop(item) {
    const def = FURNI[item.type];
    const rect = Room.rect(item);
    for (const other of this.items.values()) {
      if (other.id === item.id) continue;
      if (other.z >= item.z + def.height && other.z > item.z && Room.overlaps(rect, Room.rect(other))) return true;
    }
    return false;
  }

  /** Pose un nouveau mobi. Retourne un message d'erreur ou null. */
  placeItem(item) {
    const check = this.checkPlacement(item.type, item.x, item.y, item.dir);
    if (check.error) return check.error;
    item.z = check.z;
    this.items.set(item.id, item);
    this.onEvent({ t: 'item_add', item });
    this.onChange();
    this.#refreshPlayersIn(Room.rect(item));
    return null;
  }

  /** Deplace et/ou tourne un mobi. Retourne un message d'erreur ou null. */
  moveItem(id, x, y, dir) {
    const item = this.items.get(id);
    if (!item) return 'Ce mobi n\'existe plus.';
    if (this.hasItemsOnTop(item)) return 'Enleve d\'abord ce qui est pose dessus.';
    const check = this.checkPlacement(item.type, x, y, dir, id);
    if (check.error) return check.error;
    const before = Room.rect(item);
    Object.assign(item, { x, y, dir, z: check.z });
    this.onEvent({ t: 'item_update', item });
    this.onChange();
    this.#refreshPlayersIn(before);
    this.#refreshPlayersIn(Room.rect(item));
    return null;
  }

  rotateItem(id) {
    const item = this.items.get(id);
    if (!item) return 'Ce mobi n\'existe plus.';
    const dir = nextRotation(FURNI[item.type], item.dir);
    if (dir === item.dir) return null;
    return this.moveItem(id, item.x, item.y, dir);
  }

  /** Retire un mobi de la salle. Retourne { item } ou { error }. */
  removeItem(id) {
    const item = this.items.get(id);
    if (!item) return { error: 'Ce mobi n\'existe plus.' };
    if (this.hasItemsOnTop(item)) return { error: 'Enleve d\'abord ce qui est pose dessus.' };
    this.items.delete(id);
    this.onEvent({ t: 'item_remove', id });
    this.onChange();
    this.#refreshPlayersIn(Room.rect(item));
    return { item };
  }

  setItemState(item, state) {
    item.state = state;
    this.onEvent({ t: 'item_update', item });
    this.onChange();
  }

  /** Distance (en cases) entre un joueur et l'empreinte d'un mobi. */
  distanceTo(p, item) {
    const r = Room.rect(item);
    const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w - 1));
    const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h - 1));
    return Math.max(dx, dy);
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      layout: this.layout,
      width: this.width,
      height: this.height,
      door: this.door,
      items: [...this.items.values()],
      players: [...this.players.values()].map(publicPlayer),
    };
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

function moveEvent(p) {
  return { id: p.id, x: p.x, y: p.y, z: p.z, dir: p.dir, walking: p.path.length > 0, sitting: p.sitting };
}

export function publicPlayer(p) {
  return {
    id: p.id, name: p.name, look: p.look,
    x: p.x, y: p.y, z: p.z, dir: p.dir, walking: p.path.length > 0, sitting: p.sitting,
  };
}
