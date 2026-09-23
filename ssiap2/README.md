# SSIAP 2 — Simulator Pro v6.0

Simulation de vacation SSIAP 2 (chef d'équipe au PCS) en boucle infinie :
RPG / management / exploitation SSI. Page HTML autonome, sans dépendance ni
build — ouvrir `ssiap2/index.html` dans un navigateur (optimisé mobile, la
progression est sauvegardée dans le `localStorage`).

## Boucle de jeu

| Phase | Contenu |
|---|---|
| **0 — Prise de poste** | Choix du site (ERP M, ERP U, ERP O/N, IGH, Industriel) **et du type de vacation** (Jour 07h-19h / Nuit 19h-07h), tirage de l'équipe (2 SSIAP 1 + stagiaire éventuel) |
| **1 — Vacation 12 h** | 8 rondes planifiées avec tolérance et pointage badge, **situations à conduire acte par acte** au tableau, avec l'équipe, sur le site, au téléphone et au registre, chrono de levée de doute, registre matériel, modes dégradés, effectif de sécurité, QCM et exercices CMSI. De jour la vacation s'ouvre par la prise de poste et se termine par la fermeture ; **de nuit c'est l'inverse** : la ronde de fermeture ouvre le poste (verrouillage, extinction, départ du public) et la ronde d'ouverture le termine avant la relève du matin |
| **2 — Débriefing SSIAP 3** | Note sur 6 axes : Réglementation, Réactivité, Management/RH, Qualité MCI, Gestion du matériel, Formation — XP, prime de vacation, succès |
| **3 — Inter-vacation** | Arbre de compétences des SSIAP 1 (vitesse, vigilance, endurance, badge), boutique PCS, historique, changement de site / de vacation |

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

## Le site a un état, et cet état produit les événements

Les incidents ne sont plus tirés au sort : chaque zone porte un état vivant —
charge calorifique, encombrement, compartimentage, travaux par point chaud,
détection en service ou non, anomalies signalées mais non traitées — d'où
découle un **niveau de risque** visible sur le plan et détaillé dans l'écran
**ÉTAT DU SITE**, cause par cause.

- Une anomalie **traitée** disparaît de la zone ; **consignée**, elle s'y
  inscrit et fait monter le risque. Une cale laissée sur une porte coupe-feu
  perce le compartimentage, un extincteur laissé obstrué encombre l'accès.
- Un **permis de feu signé sans contrôle** crée un point chaud non surveillé
  pendant 90 minutes, dans cette zone précise.
- Une zone laissée trop longtemps en rouge **finit par produire son sinistre** :
  le feu naît là où la négligence s'est accumulée.
- Un feu dans une zone **inhibée ou en panne de détection ne déclenche aucune
  alarme** : il couve, et n'est découvert que par un agent en ronde ou par la
  fumée, avec le retard que cela suppose.
- Un sinistre non traité grandit par paliers ; au stade 3 il **se propage à une
  zone voisine si le compartimentage a été percé**. Un agent envoyé sur place
  l'éteint tant qu'il est au stade 1 ou 2 — plus lentement si l'accès est
  encombré —, au-delà il faut les secours.
- Le risque se traite : un agent peut être envoyé **lever les réserves** d'une
  zone (dégagement, remise en ordre), ce qui fait redescendre son niveau.
- L'état du site à la relève pèse sur la note : zones laissées à risque,
  anomalies non traitées et propagations entrent dans l'axe Réglementation.

Vérifié par simulation comparée de deux vacations complètes jouées par un
robot, l'une traitant les anomalies, l'autre les consignant systématiquement :
la seconde finit avec 4 à 9 anomalies non traitées, 1 à 3 zones à risque,
plusieurs propagations et un score d'exploitation trois à six fois inférieur.

## Le sinistre majeur et la commission de sécurité

Un feu qui atteint le stade généralisé, ou qui se propage à une autre zone,
devient un **sinistre majeur** : la vacation ne peut plus être bonne, et la
commission de sécurité est saisie.

Chaque décision qui affaiblit une zone est horodatée dans un registre des
causes, invisible en jeu : anomalie signalée mais laissée en l'état,
inhibition posée, permis de feu accordé sans contrôle, alarme laissée sans
décision, ronde non effectuée. Au débriefing, la commission relit ce registre
et reconstitue la chronologie du sinistre, ligne par ligne :

```
20:14  Anomalie « Porte coupe-feu calée » signalée en Réserves.
       Ordre du PCS : consigner sans retirer la cale. Restée en l'état.
21:44  Détection de Réserves inhibée par le PCS.
01:04  Départ de feu en Réserves.
01:04  Aucun report au CMSI : la détection de la zone était hors service.
01:23  Sinistre découvert 19 min après son départ (par Karim, en ronde).
01:53  Propagation au Cinéma par un compartimentage percé.
```

Le verdict distingue trois cas, parce qu'un simulateur ne doit pas punir la
malchance : **aléa** (aucune faute retenue, note plafonnée à 75),
**manquements contributifs** (60), **enchaînement de décisions** (45, mention
« Défaillance grave »). Les manquements sont pondérés : une ronde non faite
pèse moins qu'une inhibition oubliée ou qu'une porte coupe-feu laissée calée.

Vérifié par simulation : la vacation négligente termine systématiquement avec
13 ou 14 causes tracées et la note plafonnée à 45, la vacation soignée avec
trois causes mineures et 55 à 60.

## L'évacuation

« Alarme générale » n'est plus un bouton sans suite mais une phase entière,
avec sa fenêtre de conduite.

- **La conduite dépend du type d'établissement.** Évacuation totale en ERP M,
  O/N et industriel ; **transfert horizontal** en établissement de santé ;
  **évacuation du compartiment** en IGH. Ordonner la mauvaise conduite coûte
  cher, vaut une remarque du chef de service et une ligne au registre des
  causes. L'évacuation par les ascenseurs est proposée — et proscrite.
- **Le nombre d'occupants dépend du site et de l'heure** : 420 personnes dans
  un centre commercial en journée, 8 la nuit ; 190 patients la nuit dans un
  établissement de santé.
- **Les guides-files font tout.** Sans personne pour prendre la circulation,
  les occupants sortent seuls et lentement (une vingtaine en six minutes) ; avec
  deux agents désignés, le flux est dix fois plus rapide. Un agent en ronde
  rappelé comme guide-file libère sa ronde.
- **L'état du site freine l'évacuation** : circulation encombrée, issue de
  secours condamnée, sinistre en cours — chaque obstacle ralentit le flux et
  augmente le nombre de personnes qui restent en arrière. Ce sont exactement les
  anomalies que le PCS a laissées passer les heures précédentes.
- **Comptage au point de rassemblement**, possible à partir de 75 % d'évacués :
  il révèle les manquants et leur dernier point connu — l'une des zones gênées.
  Il faut alors envoyer une **reconnaissance**, qui les ramène.
- **Déclarer l'évacuation terminée** sans avoir compté, ou avec des manquants,
  coûte lourdement et s'inscrit au registre des causes ; menée conforme, dans
  les délais et sans manquant, elle rapporte. Puis vient le retour au calme.

## La prise de poste et l'accueil des secours

**Les 45 premières minutes comptent.** Trois contrôles sont attendus : essai
des liaisons radio, contrôle du CMSI et du SDI, comptage du trousseau et des
badges. Chaque vacation cache des anomalies que seuls ces contrôles révèlent —
une VHF à batterie faible, un dérangement de zone hérité de la veille, un
trousseau non restitué. Contrôlées, elles sont traitées : le poste défaillant
est écarté, la maintenance SSI demandée, le trousseau manquant signalé et les
rondes basculées sur le passe général. Non contrôlées, elles se rappellent au
bon souvenir du PCS : le talkie lâche en pleine ronde et l'agent devient
injoignable, la zone en dérangement reste sans détection — en silence, jusqu'au
jour où il s'y passe quelque chose.

**Appeler les secours ne suffit pas, il faut les recevoir.** Un appel au 18 ou
au 15 déclenche un délai d'arrivée réel, affiché au bandeau, et il faut
désigner un agent pour l'accueil et le guidage. Personne à l'entrée : six
minutes perdues à chercher l'accès, une pénalité, et une ligne au registre des
causes que la commission relèvera. Agent présent : plan du site et clés remis,
prise en compte immédiate, et les sapeurs-pompiers prennent le sinistre à leur
compte.

## Le PCS envoie, l'agent exécute et rend compte

Un chef de poste ne traite rien depuis son fauteuil. **Toute action de terrain
passe désormais par un agent que le joueur désigne nommément**, avec ce que
cela implique : il faut quelqu'un de disponible, joignable, et qualifié.

- **La levée de doute.** Une alarme feu n'engage plus automatiquement un agent :
  le PCS ouvre la liste de l'équipe et choisit qui part — disponible ou en
  ronde (elle est alors suspendue et reprenable), avec ou sans radio, moral
  haut ou bas. Le compteur réglementaire des 3 à 5 minutes court à partir de
  l'ordre. **Personne d'envoyé, c'est une faute** : l'équipe relance à deux
  minutes, puis à cinq minutes le manquement est acté, pénalisé et inscrit au
  registre des causes.
- **Le compte-rendu.** Arrivé sur place, l'agent constate et **rend compte par
  radio** : départ de feu naissant, sinistre déclaré, fumées de chantier,
  détecteur en dérangement, déclencheur manuel brisé, fumée de cuisson, odeur
  de brûlé sans flamme. Chaque constat ouvre ses **conduites à tenir propres** —
  attaque à l'extincteur et alerte en parallèle sur un foyer naissant, alarme
  générale et repli sur un sinistre déclaré, arrêt des travaux et ventilation
  sur un point chaud, demande de maintenance sur un dérangement, remplacement
  de la vitre et réarmement du DM après un acte malveillant. Les manœuvres
  proscrites sont proposées comme les autres et coûtent ce qu'elles valent.
- **L'agent attend vraiment.** Tant que l'ordre n'est pas donné, il reste sur
  zone : relance radio à trois minutes, perte de moral, et à sept minutes un
  défaut de commandement au débriefing.
- **Le réarmement des DAS.** Un désenfumage commandé, un compartimentage, une
  détection feu font partir les clapets coupe-feu, les volets et les portes en
  position de sécurité. **Ils ne reviennent pas tout seuls** : il faut envoyer
  un agent les réarmer sur place, zone par zone. Tant que ce n'est pas fait, le
  CMSI refuse le réarmement et le dit ; passé 45 minutes l'installation non
  réarmée est relevée ; à la relève, chaque DAS laissé en sécurité est une
  non-conformité au registre des causes.
- **Le réarmement ne s'improvise pas.** Le CMSI refuse également tout
  réarmement tant qu'aucun compte-rendu de terrain n'a établi la cause du
  déclenchement : on ne réarme pas une installation qu'on n'a pas contrôlée.
- **Le secours à victime.** Un malaise ou un accident du travail envoie un
  agent avec le sac de secours et le DAE — et **tous les agents ne sont pas
  recyclés SST**, la liste le signale avant le choix. Sur place, il donne un
  bilan : victime inconsciente qui respire et mise en PLS, chute avec suspicion
  rachidienne, malaise sur victime consciente. Le PCS décide alors : appel du
  15 avec surveillance continue, appel du 15 **plus désignation immédiate de
  l'accueil des secours**, ou l'erreur classique — faire déplacer une victime
  qu'il ne fallait pas mobiliser.
- **L'accueil des secours** est devenu une mission comme les autres : on
  désigne qui va recevoir et guider les engins, il se poste à l'entrée avec le
  plan et le trousseau, et il n'est libéré qu'une fois les secours pris en
  compte.

Le bandeau d'état compte en permanence les alarmes sans agent sur zone, les
comptes-rendus en attente d'ordre, les DAS à réarmer, le binôme à compléter et
les dispositions d'accueil à prendre ; l'écran **ACTIONS** ouvre un bloc
*Missions terrain* pour répondre à chacun.

## L'alerte, le binôme et l'accueil des engins

Décrocher ne suffit pas, et un agent seul sur un foyer n'est pas une équipe.

- **Le message d'alerte se compose.** Appeler le 18 ou le 15 ouvre trois
  rubriques : qui parle et d'où, la nature exacte du sinistre et sa
  localisation, puis les victimes, les mesures déjà prises et l'itinéraire
  d'accès. Les propositions sont **mélangées et non commentées** : c'est au
  chef d'équipe de savoir ce que doit contenir un message d'alerte. Message
  complet, les engins partent sur une adresse précise ; message tronqué, deux
  minutes de plus ; message bâclé ou communication abandonnée, quatre minutes
  de plus, une pénalité et une ligne au registre des causes.
- **On n'attaque jamais seul.** Ordonner l'attaque d'un foyer engage l'agent et
  ouvre aussitôt la désignation de **l'équipier du binôme**. Seul, l'agent
  attaque deux fois moins vite — il doit surveiller son propre repli — et le
  dit à la radio ; sans équipier au bout de deux minutes, c'est une mise en
  danger consignée au registre.
- **Les dispositions avant l'arrivée.** Un agent est envoyé ramener les
  ascenseurs au niveau d'accès et les condamner, couper les fluides du secteur
  et dégager la voie engins — l'itinéraire de brancardage et l'ascenseur
  réservé quand c'est le 15 qui vient. Sans ces dispositions, les engins
  perdent trois minutes à se mettre en station, et c'est au registre.
- **L'accueil et le guidage** restent une mission à part entière : plan du
  site, trousseau, bilan remis au COS.
- **Le COS garde la main.** Tant que les secours sont engagés sur le sinistre,
  le CMSI refuse le réarmement : l'installation n'appartient plus au PCS.

Le débriefing ajoute cinq lignes : *alarmes avec un agent envoyé sur zone*,
*DAS réarmés avant la relève*, *messages d'alerte complets*, *attaques menées
en binôme* et *dispositions prises avant l'arrivée des engins*.

## Conduire une situation — la boucle du jeu

Le chef d'équipe **ne choisit pas une réponse dans une liste**. Il conduit une
situation avec les instruments dont il dispose, dans l'ordre qu'il juge bon, et
il en répond.

1. **Une situation s'ouvre.** Elle s'inscrit dans le bandeau des situations,
   sous le planning des rondes, avec sa zone, son âge et le nombre d'actes déjà
   engagés. Une situation urgente interrompt le poste une fois ; ensuite elle
   attend là, et c'est au chef d'y revenir. Jusqu'à trois peuvent courir
   ensemble : la pression du jeu, c'est la charge et le nombre d'agents
   disponibles, pas un compte à rebours.
2. **La fiche montre ce qui arrive au PCS** : ce qu'affiche le tableau de
   signalisation, ce que dit la radio, ce que dit le téléphone, qui se présente
   au poste, et ce qui se joue. Aucune réponse n'est proposée.
3. **Vous agissez, acte par acte.** Trente-quatre instruments répartis sur cinq
   pupitres : **CMSI** (arrêt du signal sonore, lecture du tableau, temporisation,
   alarme générale, désenfumage, compartimentage, inhibition, acquittement,
   réarmement), **ÉQUIPE** (levée de doute, binôme d'attaque, RIA, secouriste,
   défibrillateur, assistance ascenseur, réarmement des DAS, dispositions,
   accueil des secours…), **SITE** (baliser et interdire l'accès, couper les
   fluides, surveillance renforcée, vidéoprotection, contrôle avant travaux,
   permis de feu, entretien d'équipe), **APPELS** (18, 15, police, ascensoriste,
   maintenance, astreinte, direction) et **REGISTRE** (consignation au registre
   de sécurité, qui ouvre la rédaction de main courante).
   Chaque acte s'inscrit dans le journal de la situation, horodaté et numéroté.
4. **Vous clôturez quand vous estimez en avoir fini.** Le SSIAP 3 rend alors son
   verdict : ce que vous avez tenu, **ce qui manquait** et pourquoi, **ce qui
   n'aurait pas dû être fait**, et si **l'ordre des actes** a été respecté — on
   n'envoie pas en levée de doute avant d'avoir lu le tableau, on ne réarme pas
   avant le compte rendu, on n'alerte pas les secours avant d'avoir levé le doute.

Chaque scénario porte donc trois listes : les **actes requis**, les **manœuvres
à proscrire** et les **couples d'actes dont l'ordre compte**. Ne rien engager
dans le délai est une faute ; au triple du délai la situation se clôt d'office
sans le poste. Le débriefing rejoue ensuite chaque situation de la vacation avec
ce qui a été tenu, omis ou proscrit.

Les quatorze situations : alarme feu sur une seule détection · feu confirmé par
plusieurs détections · déclencheur manuel · feu sur appareil de cuisson ·
personne au sol · arrêt cardiaque · accident du travail · dérangement SSI ·
travaux par point chaud · personne bloquée en ascenseur · odeur de gaz ·
intrusion de nuit · départ imprévu d'un agent · tension dans l'équipe.

## Le site garde la trace des vacations précédentes

Ce qu'une vacation laisse derrière elle, la suivante le trouve. Chaque site
conserve, d'un poste à l'autre : les anomalies non traitées zone par zone,
l'encombrement et le compartimentage abîmés, **les zones laissées inhibées**
et les demandes d'intervention en cours.

- À la prise de poste, un écran **CONSIGNES DE LA RELÈVE** énumère ce dont on
  hérite : « Cinéma : détection laissée INHIBÉE par la vacation précédente »,
  « Réserves : porte coupe-feu calée toujours non traitée », « Food-court :
  bloc de secours en attente d'intervention », le dernier sinistre du site.
  Une zone inhibée reste inhibée : il faudra la lever soi-même.
- **Faire intervenir un tiers n'est pas réparer.** Demander la maintenance
  ou l'astreinte laisse l'anomalie en place, mais compte pour moitié dans le
  risque : le PCS a fait sa part. L'intervention arrive **deux vacations plus
  tard**, et la main courante l'enregistre : « Maintenance passée sur « Bloc de
  secours HS » en Food-court ». Consigner sans rien demander, en revanche,
  laisse l'anomalie indéfiniment.
- L'écran de choix du site affiche l'état de chacun — « 1 zone inhibée ·
  3 anomalies non traitées · 1 maintenance attendue · 4 vacations » ou
  « site en ordre ». On peut fuir un site qu'on a laissé se dégrader, ou y
  retourner pour le remettre d'aplomb.

## Les agents se souviennent

Chaque SSIAP 1 porte un **moral** qui survit d'une vacation à l'autre, avec la
liste de ses griefs. Il baisse quand on le laisse sans instruction, qu'on
l'envoie épuisé ou sans talkie, qu'on classe son signalement sans suite, qu'on
lui ordonne une manœuvre à proscrire, ou qu'il encaisse trois rondes de plus
que ses collègues. Il remonte quand on lui répond vite, qu'on traite ce qu'il a
trouvé, qu'on lui accorde une pause quand il est fatigué, qu'on le forme.

Le moral n'est pas cosmétique, il change ce que l'agent fait :

- **sous 35** il traîne (20 % plus lent) et **cesse de remonter les anomalies
  mineures** — il les « note » sans demander d'ordre, et elles s'inscrivent
  dans l'état de la zone comme non traitées ;
- **sous 20** il refuse une ronde s'il a déjà fait plus que sa part, et la
  ronde revient au planning ;
- **au-dessus de 80** il est 10 % plus rapide.

La boucle est donc fermée avec le reste : un agent qu'on a mal commandé fait
monter le risque d'une zone sans qu'on le sache, et c'est la commission de
sécurité qui le révèle après le sinistre.

L'équipe est tirée en priorité parmi les agents avec qui vous avez déjà
tourné — sans équipe stable, la mémoire ne voudrait rien dire —, et la prise de
poste dit ce que chacun a gardé de la dernière fois. Le **stagiaire** suit une
progression de formation (rondes en binôme, QCM, anomalies expliquées) et passe
son examen SSIAP 1 après trois vacations : réussi au-dessus de 70/100, sinon
« l'encadrement n'a pas suivi ».

L'écran **ÉQUIPE** des actions PCS donne le moral, la fatigue, la charge et les
griefs de chacun, et la progression du stagiaire.

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

## Tenue du code

Le moteur ne garde que ce qui agit sur la partie : les objets de boutique et
les branches de compétences sans effet ont été retirés plutôt que laissés en
promesse, les compteurs de débriefing devenus inutiles après le passage à la
notation par ratios ont disparu, les deux banques de questions (formation et
audit) sont fusionnées, et le bandeau d'état ne répète plus ce que l'en-tête
et les cartes d'agents affichent déjà.

## Tests

Parcours vérifiés au navigateur (Playwright, Chromium headless) : démarrage
jour/nuit sur les 5 sites, vacation complète de 12 h jusqu'au débriefing,
dotation/restitution du matériel, erreur de trousseau, désignation de l'agent
en levée de doute et compte-rendu terrain, conduites à tenir par constat,
réarmement des DAS et refus de réarmement du CMSI sans compte-rendu, chaîne
secours à victime (bilan → 15 → accueil), bascule groupe,
liaison de secours, surveillance compensatoire, inhibition/levée, refus du
compartimentage hors IGH, DAT complète, renfort RH, règle du binôme,
conduite complète d'une situation (journal des actes, changement de pupitre,
consignation au registre et retour à la fiche, verdict affiché, manœuvre à
proscrire relevée, situation abandonnée puis close d'office), bandeau des
situations et bascule de l'une à l'autre, composition du message d'alerte
(complet comme abandonné), les quatorze
situations du poste (textes, clés d'effet, ordre d'affichage tiré au sort,
déclencheur manuel sans feu réel, surveillance après travaux et reprise de feu,
odeur de gaz, ascenseur bloqué, arrêt cardiaque avec DAE), dispositions
d'accueil et retard des engins quand elles manquent, binôme d'attaque
constitué ou laissé seul, refus de réarmement tant que le COS est engagé.
