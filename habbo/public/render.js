import { getAvatarSprite, CENTER_X, FOOT_Y, SEAT_Y } from './avatar.js';

// Rendu isometrique sur Canvas 2D.
// Grille : x vers le bas-droite, y vers le bas-gauche. La case (x, y)
// occupe [x, x+1] x [y, y+1] ; iso(x, y) donne le coin haut du losange.

export const TILE_W = 64;
export const TILE_H = 32;
const WALL_H = 110;

// Directions indexees 0..7 (doit correspondre au serveur).
export const DIRS = [
  [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

export function iso(x, y) {
  return { x: (x - y) * (TILE_W / 2), y: (x + y) * (TILE_H / 2) };
}

export function screenToTile(sx, sy) {
  const a = sx / (TILE_W / 2);
  const b = sy / (TILE_H / 2);
  return { x: Math.floor((a + b) / 2), y: Math.floor((b - a) / 2) };
}

/** Eclaircit (amount > 0) ou assombrit une couleur "#rrggbb" ou "rgb(r,g,b)". */
export function shade(color, amount) {
  let rgb;
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    rgb = [n >> 16, (n >> 8) & 255, n & 255];
  } else {
    rgb = color.match(/\d+/g).map(Number);
  }
  const [r, g, b] = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c * (1 + amount)))));
  return `rgb(${r},${g},${b})`;
}

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const up = (p, h) => ({ x: p.x, y: p.y - h });

// ---------- Salle ----------

export function drawRoom(ctx, room, hover, hoverColor = 'rgba(255,255,255,.85)') {
  const floor = (x, y) => y >= 0 && y < room.height && x >= 0 && room.layout[y][x] === '0';

  // Murs : sur les bords arriere (voisin x-1 ou y-1 hors sol).
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (!floor(x, y)) continue;
      const isDoor = room.door.x === x && room.door.y === y;
      if (!floor(x, y - 1)) {
        const p1 = iso(x, y), p2 = iso(x + 1, y);
        poly(ctx, [p1, p2, up(p2, WALL_H), up(p1, WALL_H)], '#b9c6d6', '#a3b1c2');
      }
      if (!floor(x - 1, y) && !isDoor) {
        const p1 = iso(x, y), p2 = iso(x, y + 1);
        poly(ctx, [p1, p2, up(p2, WALL_H), up(p1, WALL_H)], '#d5dfea', '#c0ccd9');
      }
    }
  }

  // Sol en damier.
  for (let y = 0; y < room.height; y++) {
    for (let x = 0; x < room.width; x++) {
      if (!floor(x, y)) continue;
      const isDoor = room.door.x === x && room.door.y === y;
      const color = isDoor ? '#6f5a3c' : (x + y) % 2 ? '#9aa86a' : '#a6b477';
      poly(ctx, [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)], color, 'rgba(0,0,0,.12)');
    }
  }

  // Case survolee.
  if (hover && floor(hover.x, hover.y)) {
    const { x, y } = hover;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = hoverColor;
    ctx.beginPath();
    const pts = [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)];
    ctx.moveTo(pts[0].x, pts[0].y);
    pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- Avatars ----------


export function drawAvatar(ctx, p, pos, now, walking) {
  const c = iso(pos.x + 0.5, pos.y + 0.5);
  const talking = p.bubble && now - p.bubble.at < 1500 && Math.floor(now / 140) % 2 === 0;
  const blinking = (now + p.id * 1733) % 4200 < 130;
  const sprite = getAvatarSprite(p.look, p.dir, {
    frame: walking ? Math.floor(now / 115) % 4 : 0,
    sitting: p.sitting && !walking,
    talking,
    blinking,
  });

  // Ombre.
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, 13, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  const sitting = p.sitting && !walking;
  const left = Math.round(c.x - CENTER_X);
  const top = Math.round(sitting ? c.y - (p.z ?? 12) + 2 - SEAT_Y : c.y + 2 - FOOT_Y);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sprite, left, top);

  return { x: c.x, y: top + 2 };
}

export function drawNameTag(ctx, name, x, y, highlight) {
  ctx.font = '600 11px system-ui, sans-serif';
  const w = ctx.measureText(name).width + 10;
  ctx.fillStyle = highlight ? 'rgba(47,125,79,.9)' : 'rgba(0,0,0,.55)';
  roundRect(ctx, x - w / 2, y - 16, w, 15, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x, y - 8.5);
}

export function drawBubble(ctx, name, text, x, y, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '13px system-ui, sans-serif';
  const lines = wrap(ctx, `${name} : ${text}`, 200);
  const lh = 16;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  const h = lines.length * lh + 10;
  const bx = x - w / 2;
  const by = y - h - 10;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#1b1b1b';
  ctx.lineWidth = 1.5;
  roundRect(ctx, bx, by, w, h, 8);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6, by + h);
  ctx.lineTo(x, by + h + 8);
  ctx.lineTo(x + 6, by + h);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 6 + i * lh));
  ctx.restore();
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
