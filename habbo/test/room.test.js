import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../server/pathfinding.js';
import { Room } from '../server/room.js';
import { Game } from '../server/game.js';
import { Store, START_CREDITS } from '../server/store.js';
import { FURNI } from '../public/furni.js';

// ---------- Recherche de chemin ----------

const open = () => true;

test('findPath va en ligne droite sur un sol vide', () => {
  const path = findPath({ x: 0, y: 0 }, { x: 3, y: 0 }, open);
  assert.deepEqual(path, [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
});

test('findPath utilise les diagonales', () => {
  assert.equal(findPath({ x: 0, y: 0 }, { x: 3, y: 3 }, open).length, 3);
});

test('findPath contourne un mur sans couper les coins', () => {
  const walls = new Set(['1,0', '1,1']);
  const walk = (x, y) => x >= 0 && y >= 0 && x < 4 && y < 4 && !walls.has(`${x},${y}`);
  const path = findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, walk);
  assert.ok(path.length > 0);
  let prev = { x: 0, y: 0 };
  for (const p of path) {
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    assert.ok(walk(p.x, p.y));
    if (dx && dy) assert.ok(walk(prev.x + dx, prev.y) && walk(prev.x, prev.y + dy));
    prev = p;
  }
});

test('findPath renvoie [] si la destination est inaccessible', () => {
  const walk = (x, y) => x >= 0 && y >= 0 && x < 3 && y < 3 && x !== 1;
  assert.deepEqual(findPath({ x: 0, y: 0 }, { x: 2, y: 2 }, walk), []);
});

// ---------- Salle ----------

const DEF = { id: 't', name: 'Test', door: { x: 0, y: 0 }, layout: ['00000', '00000', '00000', '00000'] };
let nextId = 1;
const item = (type, x, y, extra = {}) => ({
  id: nextId++, type, x, y, dir: FURNI[type].rotations[0], z: 0, state: 0, owner: 'k', ownerName: 'A', link: null, ...extra,
});

function roomWith(...items) {
  const room = new Room(DEF);
  for (const it of items) assert.equal(room.placeItem(it), null);
  return room;
}

function walkUntilStopped(room, p) {
  let last;
  for (let i = 0; i < 20 && p.path.length; i++) last = room.tick().find((m) => m.id === p.id) ?? last;
  return last;
}

test('Room : un joueur s\'assoit sur une chaise et prend sa direction', () => {
  const room = roomWith(item('chair_wood', 3, 2, { dir: 6 }));
  const p = { id: 1 };
  room.addPlayer(p);
  assert.equal(room.requestMove(1, 3, 2), true);
  const last = walkUntilStopped(room, p);
  assert.deepEqual([p.x, p.y], [3, 2]);
  assert.equal(last.sitting, true);
  assert.equal(last.dir, 6);
  assert.equal(last.z, 12);
});

test('Room : les mobis non traversables bloquent la marche', () => {
  const room = roomWith(item('table_square', 2, 0));
  room.addPlayer({ id: 1 });
  assert.equal(room.isWalkable(2, 0), false);
  assert.equal(room.requestMove(1, 2, 0), false);
});

test('Room : empilement sur une table, refuse sur une plante', () => {
  const table = item('table_square', 2, 2);
  const room = roomWith(table);
  const block = item('block_red', 2, 2);
  assert.equal(room.placeItem(block), null);
  assert.equal(block.z, FURNI.table_square.height);
  assert.match(room.placeItem(item('plant', 4, 3)) ?? '', /^$/);
  assert.ok(room.placeItem(item('dice', 4, 3)));
  // On ne peut pas deplacer la table tant qu'il y a quelque chose dessus.
  assert.ok(room.moveItem(table.id, 1, 1, 4));
  assert.ok(room.removeItem(table.id).error);
});

test('Room : placement refuse hors du sol, sur la porte ou sur un joueur', () => {
  const room = new Room(DEF);
  room.addPlayer({ id: 1 }); // sur la porte (0,0)
  assert.ok(room.placeItem(item('plant', 9, 9)));
  assert.ok(room.placeItem(item('plant', 0, 0)));
  room.players.get(1).x = 3;
  room.players.get(1).y = 3;
  assert.ok(room.placeItem(item('plant', 3, 3)));
  // Un siege peut etre pose sous un joueur.
  assert.equal(room.placeItem(item('chair_wood', 3, 3)), null);
});

test('Room : les grands mobis tournent et changent d\'empreinte', () => {
  const sofa = item('sofa_purple', 1, 1, { dir: 4 });
  const room = roomWith(sofa);
  assert.equal(room.isWalkable(2, 1), true); // siege
  assert.equal(room.itemsAt(2, 1).length, 1);
  assert.equal(room.rotateItem(sofa.id), null);
  assert.equal(sofa.dir, 2);
  assert.equal(room.itemsAt(2, 1).length, 0);
  assert.equal(room.itemsAt(1, 2).length, 1);
});

test('Room : le portillon ferme bloque, ouvert laisse passer', () => {
  const gate = item('gate', 2, 1, { state: 0 });
  const room = roomWith(gate);
  assert.equal(room.isWalkable(2, 1), false);
  gate.state = 1;
  assert.equal(room.isWalkable(2, 1), true);
});

test('Room : deux joueurs ne sont jamais sur la meme case', () => {
  const room = new Room(DEF);
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

// ---------- Jeu (catalogue, inventaire, droits, interactions) ----------

function setup() {
  const game = new Game(new Store(null));
  const join = (name) => {
    const inbox = [];
    const client = game.connect((m) => inbox.push(m));
    game.handle(client, { t: 'join', name, token: `token-${name}-0123456789abcdef` });
    game.handle(client, { t: 'goto', room: 'terrasse' });
    return { client, inbox, last: (t) => inbox.filter((m) => m.t === t).at(-1) };
  };
  return { game, join };
}

test('Game : acheter debite les credits et remplit l\'inventaire', () => {
  const { game, join } = setup();
  const a = join('alice');
  game.handle(a.client, { t: 'buy', type: 'chair_wood' });
  const inv = a.last('inventory');
  assert.equal(inv.credits, START_CREDITS - FURNI.chair_wood.price);
  assert.equal(inv.inventory.length, 1);
  game.handle(a.client, { t: 'buy', type: 'n_existe_pas' });
  assert.equal(a.client.user.inventory.length, 1);
});

test('Game : les teleporteurs sont livres par paire et relies', () => {
  const { game, join } = setup();
  const a = join('alice');
  game.handle(a.client, { t: 'buy', type: 'teleport' });
  const [t1, t2] = a.client.user.inventory;
  assert.equal(t1.link, t2.id);
  assert.equal(t2.link, t1.id);
});

test('Game : pas assez de credits', () => {
  const { game, join } = setup();
  const a = join('alice');
  a.client.user.credits = 1;
  game.handle(a.client, { t: 'buy', type: 'palm' });
  assert.equal(a.client.user.inventory.length, 0);
  assert.ok(a.last('error'));
});

test('Game : poser, puis seul le proprietaire peut ramasser', () => {
  const { game, join } = setup();
  const a = join('alice');
  const b = join('bob');
  game.handle(a.client, { t: 'buy', type: 'plant' });
  const { id } = a.client.user.inventory[0];
  game.handle(a.client, { t: 'place', id, x: 5, y: 5, dir: 4 });
  assert.equal(a.client.user.inventory.length, 0);
  assert.ok(a.client.room.items.has(id));
  assert.ok(b.inbox.some((m) => m.t === 'item_add' && m.item.id === id));

  game.handle(b.client, { t: 'pickup', id });
  assert.ok(a.client.room.items.has(id));
  assert.match(b.last('error').text, /appartient pas/);

  game.handle(a.client, { t: 'pickup', id });
  assert.equal(a.client.room.items.has(id), false);
  assert.equal(a.client.user.inventory[0].id, id);
});

test('Game : le mobilier de l\'hotel ne peut pas etre ramasse', () => {
  const { game, join } = setup();
  const a = join('alice');
  const hotelItem = [...a.client.room.items.values()][0];
  game.handle(a.client, { t: 'pickup', id: hotelItem.id });
  assert.ok(a.client.room.items.has(hotelItem.id));
});

test('Game : une lampe s\'allume et s\'eteint', () => {
  const { game, join } = setup();
  const a = join('alice');
  game.handle(a.client, { t: 'buy', type: 'lamp_floor' });
  const { id } = a.client.user.inventory[0];
  game.handle(a.client, { t: 'place', id, x: 5, y: 5, dir: 4 });
  const lamp = a.client.room.items.get(id);
  game.handle(a.client, { t: 'use', id });
  assert.equal(lamp.state, 1);
  game.handle(a.client, { t: 'use', id });
  assert.equal(lamp.state, 0);
});

test('Game : il faut etre a cote du de pour le lancer', () => {
  const { game, join } = setup();
  const a = join('alice');
  game.handle(a.client, { t: 'buy', type: 'dice' });
  const { id } = a.client.user.inventory[0];
  game.handle(a.client, { t: 'place', id, x: 10, y: 10, dir: 4 });
  const dice = a.client.room.items.get(id);
  game.handle(a.client, { t: 'use', id });
  assert.equal(dice.state, 1);
  assert.match(a.last('error').text, /Approche/);

  const p = a.client.player;
  p.x = 9;
  p.y = 9;
  game.handle(a.client, { t: 'use', id });
  assert.equal(dice.state, 0); // en train de rouler
});

test('Game : reconnexion avec le meme jeton = meme inventaire', () => {
  const { game } = setup();
  const token = 'mon-jeton-secret-123456';
  const c1 = game.connect(() => {});
  game.handle(c1, { t: 'join', name: 'alice', token });
  game.handle(c1, { t: 'buy', type: 'dice' });
  game.disconnect(c1);
  const c2 = game.connect(() => {});
  game.handle(c2, { t: 'join', name: 'alice', token });
  assert.equal(c2.user.inventory.length, 1);
});

test('sanitizeLook remplace les valeurs invalides par les valeurs par defaut', async () => {
  const { sanitizeLook, DEFAULT_LOOK } = await import('../public/look.js');
  assert.deepEqual(sanitizeLook(null), DEFAULT_LOOK);
  assert.deepEqual(
    sanitizeLook({ skin: 2, hairStyle: 99, hair: -1, shirt: 1.5, pants: '1', extra: 'x' }),
    { ...DEFAULT_LOOK, skin: 2 },
  );
});
