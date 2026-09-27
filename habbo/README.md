# Hotel Pixel — mini jeu social facon Habbo

Prototype de jeu social isometrique multijoueur, ecrit de zero.

## Lancer le jeu

```bash
cd habbo
npm install
npm start          # http://localhost:3000  (PORT=xxxx pour changer)
```

Ouvre deux onglets pour voir deux joueurs interagir.

Les comptes, inventaires et mobis poses sont sauvegardes dans `data/state.json`
(`DATA_FILE=...` pour changer). Le compte est lie au navigateur par un jeton secret
garde dans le `localStorage`.

## Fonctionnalites

- Salles isometriques (sol, murs, porte) dessinees au Canvas 2D
- Deplacement au clic, case par case, avec recherche de chemin A* (8 directions)
- Multijoueur temps reel via WebSocket, le serveur fait autorite sur les positions
- Collisions avec le mobilier et entre joueurs
- Mobis (mobilier) facon hotel, dessines par le code dans un style inspire des jeux isometriques :
  - catalogue de 36 mobis (sieges, tables, deco, lumieres, jeux, blocs de construction) paye en credits
    (500 au depart, +10 toutes les 5 minutes de connexion)
  - inventaire, pose avec apercu (vert/rouge), rotation (R ou clic droit), deplacement, ramassage
  - empilement sur les tables, comptoirs et blocs
  - seul le proprietaire peut bouger ou ramasser ses mobis ; le mobilier de depart appartient a l'hotel
  - interactions au double-clic : lampes, tele, frigo, cheminee et boule disco (allumer / eteindre),
    de a lancer, bouteille a faire tourner, portillon a ouvrir, teleporteurs relies par paire
    (y compris d'une salle a l'autre)
  - sieges, fauteuils, canapes, bancs et tabourets : on s'y assoit en s'arretant dessus
- Salle "La Terrasse" vide, pour construire
- Avatars en pixel art style "hotel" generes par le code : 8 directions, contours sombres,
  marche en 4 images, position assise, clignement des yeux, bouche qui bouge en parlant
- Editeur d'avatar a l'entree : peau, coiffure, couleur de cheveux, haut, bas (+ tirage au hasard)
- Chat avec bulles au-dessus des avatars + historique
- Navigateur de salles (Hall d'accueil, Le Petit Cafe) avec nombre de joueurs
- Camera deplacable en glissant la souris

## Architecture

```
server/
  index.js        serveur HTTP (fichiers statiques) + WebSocket
  game.js         logique de jeu : comptes, catalogue, inventaire, interactions
  room.js         etat d'une salle : joueurs, mobis, empilement, collisions, deplacements
  store.js        sauvegarde JSON sur disque
  pathfinding.js  A* sur grille
  rooms.js        definition des salles et du mobilier
public/
  index.html, style.css
  main.js         reseau, interface, camera, boucle de rendu
  render.js       rendu isometrique (sol, murs, meubles, avatars, bulles)
  avatar.js       generation et cache des sprites d'avatars en pixel art
  look.js         palettes et validation de l'apparence (partage client/serveur)
  furni.js        catalogue des mobis (partage client/serveur)
  furni-render.js dessin des mobis, miniatures du catalogue
test/             tests unitaires (npm test)
```

### Protocole (JSON sur `/ws`)

| Client -> serveur                    | Serveur -> client                                        |
|--------------------------------------|----------------------------------------------------------|
| `join {name, look, token}`           | `welcome {id, token, key, tickMs, rooms, credits, inventory}` |
| `move {x, y}`                        | `room {room}` (plan, mobis, joueurs presents)            |
| `chat {text}`                        | `player_joined`, `player_left`                           |
| `goto {room}`, `rooms`               | `moves {moves: [{id, x, y, z, dir, walking, sitting}]}`  |
| `buy {type}`                         | `inventory {inventory, credits}`, `bought {type}`        |
| `place {id, x, y, dir}`              | `item_add {item}`                                        |
| `move_item {id, x, y, dir}`, `rotate_item {id}` | `item_update {item}`                          |
| `pickup {id}`                        | `item_remove {id}`                                       |
| `use {id}`                           | `chat {id, text}`, `rooms {rooms}`, `error {text}`       |

## Prochaines etapes possibles

- Salles creees par les joueurs (avec droits) et echanges de mobis entre joueurs
- Mobis muraux (posters, fenetres) et papiers peints / sols
- Plus de vetements et accessoires (chapeaux, lunettes), gestes (saluer, danser)
- Vrais sprites pixel art a la place des formes dessinees
