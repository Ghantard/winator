import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../server/pathfinding.js';
import { Room } from '../server/room.js';

const open = () => true;

test('findPath va en ligne droite sur un sol vide', () => {
  const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, open);
  assert.deepEqual(path, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
});

test('findPath utilise les diagonales', () => {
  const path = findPath({ x: 0, y: 0 }, { x: 3, y: 3 }, open);
  assert.equal(path.length, 3);
});

test('findPath contourne un mur sans couper les coins', () => {
  const walls = new Set(['1,0', '1,1']);
  const walk = (x, y) => x >= 0 && y >= 0 && x < 4 && y < 4 && !walls.has(`${x},${y}`);
  const path = findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, walk);
  assert.ok(path.length > 0);
  assert.ok(path.every((p) => walk(p.x, p.y)));
  let prev = { x: 0, y: 0 };
  for (const p of path) {
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    if (dx && dy) assert.ok(walk(prev.x + dx, prev.y) && walk(prev.x, prev.y + dy));
    prev = p;
  }
});

test('findPath renvoie [] si la destination est inaccessible', () => {
  const walk = (x, y) => x >= 0 && y >= 0 && x < 3 && y < 3 && !(x === 1);
  assert.deepEqual(findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, walk), []);
});

const def = {
  id: 't',
  name: 'Test',
  door: { x: 0, y: 0 },
  layout: ['0000', '0000', '0000'],
  furniture: [
    { type: 'table', x: 2, y: 0 },
    { type: 'chair', x: 3, y: 2, dir: 6 },
  ],
};

test('Room place les joueurs sur des cases libres pres de la porte', () => {
  const room = new Room(def);
  const a = { id: 1 };
  const b = { id: 2 };
  room.addPlayer(a);
  room.addPlayer(b);
  assert.deepEqual([a.x, a.y], [0, 0]);
  assert.notDeepEqual([b.x, b.y], [0, 0]);
});

test('Room refuse une destination bloquee par un meuble ou hors salle', () => {
  const room = new Room(def);
  const a = { id: 1 };
  room.addPlayer(a);
  assert.equal(room.requestMove(1, 2, 0), false);
  assert.equal(room.requestMove(1, 9, 9), false);
  assert.equal(room.requestMove(1, 1.5, 0), false);
});

test('Room avance d\'une case par tick et s\'assoit sur une chaise', () => {
  const room = new Room(def);
  const a = { id: 1 };
  room.addPlayer(a);
  assert.equal(room.requestMove(1, 3, 2), true);
  let last;
  for (let i = 0; i < 10 && a.path.length; i++) {
    const moves = room.tick();
    assert.equal(moves.length, 1);
    last = moves[0];
  }
  assert.deepEqual([a.x, a.y], [3, 2]);
  assert.equal(last.walking, false);
  assert.equal(last.sitting, true);
  assert.equal(last.dir, 6);
});

test('Room ne met jamais deux joueurs sur la meme case', () => {
  const room = new Room(def);
  const a = { id: 1 };
  const b = { id: 2 };
  room.addPlayer(a);
  room.addPlayer(b);
  room.requestMove(1, 1, 2);
  room.requestMove(2, 1, 2);
  for (let i = 0; i < 10; i++) {
    room.tick();
    assert.ok(!(a.x === b.x && a.y === b.y));
  }
});

test('sanitizeLook remplace les valeurs invalides par les valeurs par defaut', async () => {
  const { sanitizeLook, DEFAULT_LOOK } = await import('../public/look.js');
  assert.deepEqual(sanitizeLook(null), DEFAULT_LOOK);
  assert.deepEqual(
    sanitizeLook({ skin: 2, hairStyle: 99, hair: -1, shirt: 1.5, pants: '1', extra: 'x' }),
    { ...DEFAULT_LOOK, skin: 2 },
  );
});
