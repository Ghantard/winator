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

- **Registre matériel PCS** : 4 trousseaux (dont passe général tracé), 3 VHF,
  3 badges de pointage. Dotation et restitution nominatives, journal d'emprunt.
  Un trousseau inadapté = porte verrouillée, 6 minutes perdues et point de ronde
  non contrôlé ; un départ sans radio coupe la liaison terrain ; un départ sans
  badge rend le pointage quasi impossible ; le matériel non restitué à la relève
  est sanctionné. Le registre liste les zones ouvertes par chaque trousseau, et
  le planning, le bandeau de ronde et l'écran d'affectation indiquent le
  trousseau nécessaire, les points que la dotation de l'agent n'ouvre pas et les
  radios ou badges manquants.
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

## Tests

Parcours vérifiés au navigateur (Playwright, Chromium headless) : démarrage
jour/nuit sur les 5 sites, vacation complète de 12 h jusqu'au débriefing,
dotation/restitution du matériel, erreur de trousseau, levée de doute dans les
délais, refus de réarmement pendant la levée de doute, bascule groupe,
liaison de secours, surveillance compensatoire, inhibition/levée, refus du
compartimentage hors IGH, DAT complète, renfort RH, règle du binôme.
