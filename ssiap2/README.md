# SSIAP 2 — Simulator Pro v6.0

Simulation de vacation SSIAP 2 (chef d'équipe au PCS) en boucle infinie :
RPG / management / exploitation SSI. Page HTML autonome, sans dépendance ni
build — ouvrir `ssiap2/index.html` dans un navigateur (optimisé mobile, la
progression est sauvegardée dans le `localStorage`).

## Boucle de jeu

| Phase | Contenu |
|---|---|
| **0 — Prise de poste** | Choix du site (ERP M, ERP U, ERP O/N, IGH, Industriel) **et du type de vacation** (Jour 07h-19h / Nuit 19h-07h), tirage de l'équipe (2 SSIAP 1 + stagiaire éventuel) |
| **1 — Vacation 12 h** | 8 rondes planifiées avec tolérance et pointage badge, événements SDI, chrono de levée de doute, registre matériel, modes dégradés, incidents RH, QCM et exercices CMSI |
| **2 — Débriefing SSIAP 3** | Note sur 6 axes : Réglementation, Réactivité, Management/RH, Qualité MCI, Gestion du matériel, Formation — XP, prime de vacation, succès |
| **3 — Inter-vacation** | Arbre de compétences des SSIAP 1, boutique PCS, historique, changement de site / de vacation |

## Moteur v6 — ce qui a été ajouté

- **Registre matériel PCS** : trousseaux nommés par usage (🔥 Clés SSI, ⚙ Clés
  techniques, 👁 Clés accès, 🧿 Passe général pour l'ouverture et la fermeture),
  3 VHF et 3 badges de pointage. Le registre se lit par agent : trois cases
  (trousseau / radio / badge) que l'on touche pour équiper ou restituer, et la
  liste des zones qu'ouvre chaque trousseau. **La dotation est automatique à
  l'affectation d'une ronde** : radio, badge et trousseau du type de ronde, avec
  repli sur le passe général si le trousseau est déjà porté (repli tracé et
  compté au débriefing). Le jeu reste tendu par la rareté : deux rondes du même
  type en parallèle, un râtelier vide, et le PCS doit arbitrer. Les conséquences
  demeurent : trousseau inadapté = porte verrouillée, 6 minutes perdues et point
  non contrôlé ; départ sans radio = liaison terrain coupée ; sans badge le
  pointage échoue ; matériel non restitué à la relève = sanction.
- **Modes dégradés** : coupure secteur (bascule groupe électrogène à confirmer
  sous 3 min), panne du relais VHF (messages brouillés, liaison téléphonique de
  secours à activer), panne de détection sur une zone (mesures compensatoires :
  rondes rapprochées + maintenance).
- **Exploitation SSI / CMSI** : BPS (arrêt du signal sonore), acquittement,
  réarmement (refusé pendant une levée de doute), inhibition / levée
  d'inhibition de zone (inhibition oubliée = non-conformité à la relève),
  désenfumage manuel (injustifié = sanction), compartimentage réservé aux IGH,
  alarme générale.
- **Chrono de levée de doute** : déclenché par la décision d'envoyer un agent
  sur un départ de feu, décompte visible au bandeau, pénalité au-delà de 5 min.
- **RH de crise** : rappel d'astreinte / prestataire / arbitrage SSIAP 3 avec
  délai d'arrivée et intégration du renfort à l'équipe ; procédure d'accident du
  travail (DAT) en 4 étapes à choix multiples.
- **Binôme stagiaire obligatoire** : une ronde confiée au stagiaire est
  automatiquement affectée à son tuteur et le stagiaire l'accompagne ; refusée si
  le tuteur n'est pas disponible. Suivi du niveau de stress.

## Correctifs sur le moteur existant

- Les commandes du panneau **Actions PCS** (`data-pcs`) n'étaient jamais
  exécutées : le routeur de clics sortait sur l'absence de `data-act`.
- `#metaDate` n'existait pas dans le DOM : `startGame()` levait une exception
  avant `setInterval(tick)`, la vacation ne démarrait donc jamais.
- `site.dayMod` / `site.nightMod` n'étaient définis nulle part : `nextEventAt`
  devenait `NaN` et plus aucun événement ne se déclenchait après le premier.
- Ajout du CSS manquant de `.orderBtn` et d'un ordre d'empilement explicite des
  overlays.

## Interface mobile

Conçue pour le téléphone : en-tête tenant sur une ligne quelle que soit la
largeur, zones tactiles d'au moins 42 px, textes agrandis, fenêtres calées sur
la hauteur réelle du viewport (`dvh`) et les encoches (`safe-area-inset`),
notifications déplacées en bas hors des titres, barre des agents défilable
horizontalement dès l'arrivée d'un renfort. Vérifié de 360 à 430 px de large
sans débordement horizontal.

## Tests

Parcours vérifiés au navigateur (Playwright, Chromium headless) : démarrage
jour/nuit sur les 5 sites, vacation complète de 12 h jusqu'au débriefing,
dotation/restitution du matériel, erreur de trousseau, levée de doute dans les
délais, refus de réarmement pendant la levée de doute, bascule groupe,
liaison de secours, surveillance compensatoire, inhibition/levée, refus du
compartimentage hors IGH, DAT complète, renfort RH, règle du binôme.
