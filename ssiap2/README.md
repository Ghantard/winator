# SSIAP 2 — Simulator Pro v6.0

Simulation de vacation SSIAP 2 (chef d'équipe au PCS) en boucle infinie :
RPG / management / exploitation SSI. Page HTML autonome, sans dépendance ni
build — ouvrir `ssiap2/index.html` dans un navigateur (optimisé mobile, la
progression est sauvegardée dans le `localStorage`).

## Boucle de jeu

| Phase | Contenu |
|---|---|
| **0 — Prise de poste** | Choix du site (ERP M, ERP U, ERP O/N, IGH, Industriel) **et du type de vacation** (Jour 07h-19h / Nuit 19h-07h), tirage de l'équipe (2 SSIAP 1 + stagiaire éventuel) |
| **1 — Vacation 12 h** | 8 rondes planifiées avec tolérance et pointage badge, événements SDI, chrono de levée de doute, registre matériel, modes dégradés, incidents RH, QCM et exercices CMSI. De jour la vacation s'ouvre par la prise de poste et se termine par la fermeture ; **de nuit c'est l'inverse** : la ronde de fermeture ouvre le poste (verrouillage, extinction, départ du public) et la ronde d'ouverture le termine avant la relève du matin |
| **2 — Débriefing SSIAP 3** | Note sur 6 axes : Réglementation, Réactivité, Management/RH, Qualité MCI, Gestion du matériel, Formation — XP, prime de vacation, succès |
| **3 — Inter-vacation** | Arbre de compétences des SSIAP 1, boutique PCS, historique, changement de site / de vacation |

## Moteur v6 — ce qui a été ajouté

- **Registre matériel PCS** : trousseaux nommés par usage (🔥 Clés SSI, ⚙ Clés
  techniques, 👁 Clés accès, 🧿 Passe général pour l'ouverture et la fermeture),
  3 talkies VHF (icône dessinée, pas un poste de radio) et 3 badges de pointage. Le registre se lit par agent : trois cases
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

## Première vacation guidée

Six repères déclenchés par la situation réelle (prise de poste, première ronde
à assigner, première alarme, premier agent en attente d'ordres, premier mode
dégradé, approche de la relève). Le poste est figé pendant la lecture pour ne
pas punir un débutant, et le guide se termine tout seul ; il est réactivable
depuis l'écran d'accueil.

## Notation

Chaque axe est la **moyenne pondérée de ratios « tenu / présenté »**, pas un
compteur ouvert : rondes tenues sur rondes prévues, alarmes traitées dans le
délai, levées de doute sous 5 minutes, ordres donnés aux agents en attente,
manœuvres SSI justifiées, inhibitions levées, modes dégradés traités, départs
en ronde complets, points ouverts du premier coup, matériel restitué, MCI
conformes, audits réussis. Un axe sans occasion vaut 70 — une vacation calme
n'est ni récompensée ni punie —, et l'attente de formation se réduit quand la
vacation a été chargée. Le débriefing affiche le détail chiffré de chaque
ratio, pour que la note se lise au lieu de se subir.

## Conduite de la vacation

- **Chaque anomalie a ses propres ordres.** Plus de « traiter sur place »
  générique : les 21 anomalies de ronde portent leurs conduites à tenir
  réelles, avec la bonne, les passables et celle à proscrire — dégager
  l'accès à un extincteur plutôt que le déplacer, retirer la cale d'une porte
  coupe-feu, baliser et faire consigner un câble dénudé plutôt que l'isoler au
  ruban, couper l'arrivée de gaz sans aucune source d'énergie plutôt que
  chercher la fuite à la lampe, ne pas toucher un objet abandonné, relever une
  plaque à distance au lieu d'aller au contact. Une manœuvre à proscrire coûte
  des points, vaut une remarque du SSIAP 3 et compte au débriefing. Certains
  ordres modifient vraiment l'installation : inhiber une zone « en attendant »
  la laisse inhibée jusqu'à la relève, remettre une détection en service la
  réarme pour de bon — et l'anomalie « zone encore inhibée » ne se présente que
  si une zone l'est réellement.
- **Répondre à un agent tient en un geste.** Dès qu'un agent trouve une
  anomalie, une barre rouge apparaît juste au-dessus de ses cartes : nom,
  anomalie, zone, temps d'attente et un bouton RÉPONDRE pleine hauteur. La
  feuille d'ordres (traiter, consigner, retour au PC, appeler les secours)
  s'ouvre aussi bien par cette barre que par la carte d'alerte de la main
  courante ou par la carte de l'agent — trois chemins, la même feuille.
- **Le stagiaire suit son maître de stage.** Il part avec lui dès que
  celui-ci sort en ronde, sans qu'on ait à le demander, et le suit partout :
  déroutement, rappel au PCS, retour au poste. Il ne reste au PCS que si le
  chef de poste l'a explicitement détaché, et une commande le remet en binôme.
- **Un agent en attente d'ordres ne reste pas silencieux.** Le nombre d'agents
  bloqués s'affiche dans le bandeau et sur une pastille du bouton ⚡. L'agent
  relance à 4 puis 8 minutes ; à 12 minutes sans instruction, il tranche seul —
  aucun point pour le PCS et un malus d'encadrement, parce que le manquement
  est celui du chef de poste.
- **Les alarmes interrompent le PCS.** Un départ de feu, une urgence médicale
  ou un accident du travail ouvre la modale de décision de lui-même. **La
  vacation est figée pendant la lecture** : le temps de jeu défile environ une
  seconde réelle par minute simulée, un décompte à l'écran ne laissait pas le
  temps de lire la situation. Le délai ne se consomme donc que lorsque l'alarme
  est laissée de côté, écran fermé (12 min de jeu pour une alarme urgente,
  25 pour les autres). Passé ce délai, l'événement se solde sans vous —
  sinistre aggravé, victime non prise en charge, reprise en main par le
  SSIAP 3 — avec une sanction lourde et un compteur « alarmes non traitées »
  au débriefing. Une alarme qui survient pendant un autre écran est mise en
  file et s'ouvre dès que le PCS est libre ; dans la main courante, la carte
  d'un agent bloqué en attente d'ordres passe devant les alarmes en cours.
- **La ronde se pilote en cours de route.** Toucher la carte d'un agent en
  ronde donne : dérouter vers une zone (ou directement vers l'alarme en cours),
  rappeler au PCS, reprendre la ronde là où elle a été laissée, détacher le
  stagiaire du binôme. Une ronde suspendue conserve sa progression et ne se
  « manque » plus au chronomètre : elle se solde par son achèvement ou reste
  inachevée à la relève. Un agent rappelé libère sa ronde, qui est à réaffecter
  et reprend depuis le début.
- **La vacation survit à l'interruption.** L'état complet du poste est écrit
  sur disque à chaque minute simulée, et quand l'application passe en
  arrière-plan. Un appel entrant, un onglet vidé ou un rechargement ramènent un
  bandeau « Vacation interrompue » sur l'écran d'accueil : reprendre à l'heure
  exacte (rondes, dotations, modes dégradés, main courante) ou abandonner le
  poste.

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
