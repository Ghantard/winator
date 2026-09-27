# Hotel Pixel — mini jeu social facon Habbo

Prototype de jeu social isometrique multijoueur, ecrit de zero.

## Lancer le jeu

```bash
cd habbo
npm install
npm start          # http://localhost:3000  (PORT=xxxx pour changer)
```

Ouvre deux onglets pour voir deux joueurs interagir.

## Fonctionnalites (etape 1)

- Salles isometriques (sol, murs, porte) dessinees au Canvas 2D
- Deplacement au clic, case par case, avec recherche de chemin A* (8 directions)
- Multijoueur temps reel via WebSocket, le serveur fait autorite sur les positions
- Collisions avec le mobilier et entre joueurs
- Chaises : on s'y assoit en s'arretant dessus
- Avatars en pixel art style "hotel" generes par le code : 8 directions, contours sombres,
  marche en 4 images, position assise, clignement des yeux, bouche qui bouge en parlant
- Editeur d'avatar a l'entree : peau, coiffure, couleur de cheveux, haut, bas (+ tirage au hasard)
- Chat avec bulles au-dessus des avatars + historique
- Navigateur de salles (Hall d'accueil, Le Petit Cafe) avec nombre de joueurs
- Camera deplacable en glissant la souris

## Architecture

```
server/
  index.js        serveur HTTP (fichiers statiques) + WebSocket + boucle de jeu
  room.js         etat d'une salle : joueurs, collisions, deplacements par tick
  pathfinding.js  A* sur grille
  rooms.js        definition des salles et du mobilier
public/
  index.html, style.css
  main.js         reseau, interface, camera, boucle de rendu
  render.js       rendu isometrique (sol, murs, meubles, avatars, bulles)
  avatar.js       generation et cache des sprites d'avatars en pixel art
  look.js         palettes et validation de l'apparence (partage client/serveur)
test/             tests unitaires (npm test)
```

### Protocole (JSON sur `/ws`)

| Client -> serveur            | Serveur -> client                                 |
|------------------------------|---------------------------------------------------|
| `join {name, look}`          | `welcome {id, tickMs, rooms}`                     |
| `move {x, y}`                | `room {room}` (salle + joueurs presents)          |
| `chat {text}`                | `player_joined`, `player_left`                    |
| `goto {room}`                | `moves {moves: [{id, x, y, dir, walking, sitting}]}` |
| `rooms`                      | `chat {id, text}`, `rooms {rooms}`                |

## Prochaines etapes possibles

- Inventaire et pose/rotation/deplacement de meubles par les joueurs
- Comptes persistants (SQLite) et salles creees par les joueurs
- Plus de vetements et accessoires (chapeaux, lunettes), gestes (saluer, danser)
- Vrais sprites pixel art a la place des formes dessinees
