// A* sur grille avec deplacements en 8 directions (comme Habbo).
// Les diagonales sont interdites si elles "coupent un coin" bloque.

const STEPS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

const SQRT2 = Math.SQRT2;

function heuristic(ax, ay, bx, by) {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
}

/**
 * Cherche un chemin de `start` a `goal`.
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} goal
 * @param {(x:number, y:number) => boolean} isWalkable
 * @param {number} [maxNodes] limite d'exploration pour borner le cout CPU
 * @returns {{x:number,y:number}[]} etapes sans la case de depart ; [] si aucun chemin
 */
export function findPath(start, goal, isWalkable, maxNodes = 4000) {
  if (start.x === goal.x && start.y === goal.y) return [];
  if (!isWalkable(goal.x, goal.y)) return [];

  const key = (x, y) => `${x},${y}`;
  const open = [{ x: start.x, y: start.y, g: 0, f: heuristic(start.x, start.y, goal.x, goal.y) }];
  const cameFrom = new Map();
  const bestG = new Map([[key(start.x, start.y), 0]]);
  const closed = new Set();
  let explored = 0;

  while (open.length > 0) {
    // Les salles sont petites : un scan lineaire suffit.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    const ck = key(current.x, current.y);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (current.x === goal.x && current.y === goal.y) {
      const path = [];
      let k = ck;
      while (k !== key(start.x, start.y)) {
        const [x, y] = k.split(',').map(Number);
        path.push({ x, y });
        k = cameFrom.get(k);
      }
      return path.reverse();
    }

    if (++explored > maxNodes) return [];

    for (const [dx, dy] of STEPS) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nk = key(nx, ny);
      if (closed.has(nk) || !isWalkable(nx, ny)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(current.x + dx, current.y) || !isWalkable(current.x, current.y + dy)) continue;
      }
      const g = current.g + (dx !== 0 && dy !== 0 ? SQRT2 : 1);
      if (g < (bestG.get(nk) ?? Infinity)) {
        bestG.set(nk, g);
        cameFrom.set(nk, ck);
        open.push({ x: nx, y: ny, g, f: g + heuristic(nx, ny, goal.x, goal.y) });
      }
    }
  }
  return [];
}

// Directions indexees 0..7, en coordonnees de grille.
export const DIRS = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

export function dirFromDelta(dx, dy) {
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const idx = DIRS.findIndex(([x, y]) => x === sx && y === sy);
  return idx === -1 ? 4 : idx;
}
