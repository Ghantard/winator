// Catalogue du mobilier ("mobis"). Partage entre le client et le serveur.
//
// w, h        empreinte en cases pour les directions 0 et 4 (echangee pour 2 et 6)
// height      hauteur d'empilement en pixels (ce qu'on peut poser dessus commence la)
// stackable   on peut poser d'autres mobis dessus
// walkable    on peut marcher dessus
// sit         hauteur d'assise en pixels (le mobi est un siege)
// rotations   directions autorisees (0 haut-droite, 2 bas-droite, 4 bas-gauche, 6 haut-gauche)
// use         interaction : toggle | dice | spin | teleport | gate
// states      nombre d'etats pour toggle / gate
// pair        le catalogue en livre deux, relies entre eux (teleporteurs)

export const CATEGORIES = [
  { id: 'sieges', label: 'Sieges' },
  { id: 'tables', label: 'Tables' },
  { id: 'deco', label: 'Deco' },
  { id: 'lumiere', label: 'Lumieres' },
  { id: 'jeux', label: 'Jeux' },
  { id: 'construction', label: 'Construction' },
];

const ALL_DIRS = [4, 2, 0, 6];
const FACING = [4, 2, 0, 6];

export const FURNI = {
  // Sieges
  chair_wood: { name: 'Chaise en bois', cat: 'sieges', price: 3, w: 1, h: 1, height: 12, sit: 12, walkable: true, rotations: ALL_DIRS, color: '#a0703f' },
  chair_blue: { name: 'Chaise bleue', cat: 'sieges', price: 3, w: 1, h: 1, height: 12, sit: 12, walkable: true, rotations: ALL_DIRS, color: '#3b6ea8' },
  armchair_red: { name: 'Fauteuil club rouge', cat: 'sieges', price: 8, w: 1, h: 1, height: 14, sit: 14, walkable: true, rotations: ALL_DIRS, color: '#b23a3a' },
  armchair_black: { name: 'Fauteuil club noir', cat: 'sieges', price: 8, w: 1, h: 1, height: 14, sit: 14, walkable: true, rotations: ALL_DIRS, color: '#3a3a42' },
  sofa_purple: { name: 'Canape violet', cat: 'sieges', price: 12, w: 2, h: 1, height: 14, sit: 14, walkable: true, rotations: ALL_DIRS, color: '#6b4fa0' },
  sofa_green: { name: 'Canape vert', cat: 'sieges', price: 12, w: 2, h: 1, height: 14, sit: 14, walkable: true, rotations: ALL_DIRS, color: '#3f8a52' },
  stool: { name: 'Tabouret de bar', cat: 'sieges', price: 4, w: 1, h: 1, height: 20, sit: 20, walkable: true, rotations: [4], color: '#c43b52' },
  bench: { name: 'Banc de parc', cat: 'sieges', price: 6, w: 2, h: 1, height: 12, sit: 12, walkable: true, rotations: ALL_DIRS, color: '#8a5a33' },

  // Tables
  table_square: { name: 'Table carree', cat: 'tables', price: 5, w: 1, h: 1, height: 24, stackable: true, rotations: [4], color: '#8a5a33' },
  table_big: { name: 'Grande table', cat: 'tables', price: 10, w: 2, h: 2, height: 24, stackable: true, rotations: [4], color: '#6e4a2c' },
  table_low: { name: 'Table basse en verre', cat: 'tables', price: 7, w: 2, h: 1, height: 12, stackable: true, rotations: [4, 2], color: '#9fd3e0' },
  bar_counter: { name: 'Comptoir de bar', cat: 'tables', price: 6, w: 1, h: 1, height: 30, stackable: true, rotations: [4, 2], color: '#5a3a22' },

  // Deco
  plant: { name: 'Plante verte', cat: 'deco', price: 3, w: 1, h: 1, height: 40, rotations: [4] },
  palm: { name: 'Palmier', cat: 'deco', price: 6, w: 1, h: 1, height: 70, rotations: [4] },
  rug_red: { name: 'Tapis rouge', cat: 'deco', price: 4, w: 3, h: 3, height: 0, walkable: true, stackable: true, rotations: [4], color: '#b84a4a' },
  rug_blue: { name: 'Tapis bleu', cat: 'deco', price: 4, w: 3, h: 3, height: 0, walkable: true, stackable: true, rotations: [4], color: '#3a5f9a' },
  rug_gold: { name: 'Tapis dore', cat: 'deco', price: 4, w: 2, h: 2, height: 0, walkable: true, stackable: true, rotations: [4], color: '#d9a441' },
  aquarium: { name: 'Aquarium', cat: 'deco', price: 15, w: 2, h: 1, height: 34, rotations: [4, 2], color: '#4aa3d8' },
  fridge: { name: 'Frigo', cat: 'deco', price: 8, w: 1, h: 1, height: 46, rotations: FACING, use: 'toggle', states: 2, color: '#e8ecef' },
  tv: { name: 'Television', cat: 'deco', price: 10, w: 1, h: 1, height: 30, rotations: FACING, use: 'toggle', states: 2, color: '#2e2e34' },
  fireplace: { name: 'Cheminee', cat: 'deco', price: 14, w: 2, h: 1, height: 44, rotations: FACING, use: 'toggle', states: 2, color: '#9a4a3a' },
  trophy: { name: 'Trophee en or', cat: 'deco', price: 20, w: 1, h: 1, height: 22, rotations: [4], color: '#e6b33a' },

  // Lumieres
  lamp_floor: { name: 'Lampe sur pied', cat: 'lumiere', price: 5, w: 1, h: 1, height: 70, rotations: [4], use: 'toggle', states: 2, color: '#f3d98b' },
  lava_lamp: { name: 'Lampe a lave', cat: 'lumiere', price: 6, w: 1, h: 1, height: 28, rotations: [4], use: 'toggle', states: 2, color: '#e0703a' },
  disco_ball: { name: 'Boule disco', cat: 'lumiere', price: 18, w: 1, h: 1, height: 90, rotations: [4], use: 'toggle', states: 2, color: '#d0d6e0' },

  // Jeux
  dice: { name: 'De', cat: 'jeux', price: 2, w: 1, h: 1, height: 12, rotations: [4], use: 'dice', color: '#f4f4f4' },
  bottle: { name: 'Bouteille a faire tourner', cat: 'jeux', price: 2, w: 1, h: 1, height: 6, rotations: [4], use: 'spin', color: '#3f9a4b' },
  teleport: { name: 'Teleporteurs (x2)', cat: 'jeux', price: 25, w: 1, h: 1, height: 74, walkable: true, rotations: FACING, use: 'teleport', pair: true, color: '#8a93a6' },
  gate: { name: 'Portillon', cat: 'jeux', price: 5, w: 1, h: 1, height: 26, rotations: [4, 2], use: 'gate', states: 2, color: '#c9ccd2' },

  // Construction
  block_white: { name: 'Bloc blanc', cat: 'construction', price: 2, w: 1, h: 1, height: 32, stackable: true, rotations: [4], color: '#eeeeee' },
  block_red: { name: 'Bloc rouge', cat: 'construction', price: 2, w: 1, h: 1, height: 32, stackable: true, rotations: [4], color: '#c43b3b' },
  block_blue: { name: 'Bloc bleu', cat: 'construction', price: 2, w: 1, h: 1, height: 32, stackable: true, rotations: [4], color: '#3b6ec4' },
  block_green: { name: 'Bloc vert', cat: 'construction', price: 2, w: 1, h: 1, height: 32, stackable: true, rotations: [4], color: '#3f9a4b' },
  block_yellow: { name: 'Bloc jaune', cat: 'construction', price: 2, w: 1, h: 1, height: 32, stackable: true, rotations: [4], color: '#e6c23a' },
  block_black: { name: 'Bloc noir', cat: 'construction', price: 2, w: 1, h: 1, height: 32, stackable: true, rotations: [4], color: '#2e2e34' },
  tile_half: { name: 'Demi-bloc blanc', cat: 'construction', price: 1, w: 1, h: 1, height: 16, stackable: true, rotations: [4], color: '#dcdcdc' },
};

/** Empreinte d'un mobi selon sa direction. */
export function footprint(def, dir) {
  return dir === 2 || dir === 6 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
}

/** Direction suivante autorisee (pour le bouton "tourner"). */
export function nextRotation(def, dir) {
  const i = def.rotations.indexOf(dir);
  return def.rotations[(i + 1) % def.rotations.length];
}

/** Etat initial d'un mobi fraichement pose. */
export function initialState(def) {
  if (def.use === 'dice') return 1;
  return 0;
}
