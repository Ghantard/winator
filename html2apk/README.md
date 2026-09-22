# html2apk

Transforme un site web ou un dossier HTML local en APK Android, en une commande.

```bash
html2apk build ./mon-site --output ./mon-app.apk
html2apk build https://exemple.fr --output ./exemple.apk
```

Un site d'exemple est fourni dans `examples/hello` pour un premier essai.

## Comment ça marche

Les deux sources passent par le même pipeline : un projet [Capacitor](https://capacitorjs.com)
jetable est généré dans un dossier temporaire, la plateforme Android y est ajoutée, Gradle
produit un APK de debug, et l'APK est signé puis copié à l'emplacement demandé. Le projet
temporaire est supprimé à la fin — sauf en cas d'échec, où il est conservé pour inspection.

La différence entre les deux modes :

| Source | Contenu de l'app | Hors ligne |
|---|---|---|
| **Dossier** | les fichiers sont embarqués dans l'APK | fonctionne entièrement |
| **URL** | la WebView charge le site en direct (`server.url`) | page de secours embarquée |

## Installation

```bash
npm install
npm run build
```

Le binaire est alors `node dist/cli.js`, ou `html2apk` si vous liez le paquet
(`npm link`).

## Prérequis

**Par défaut, aucun** : le build tourne dans Docker, et l'image est construite automatiquement
au premier lancement. Il vous faut seulement Docker démarré.

Pour builder sans Docker (`--no-docker`), il vous faut en local :

- Node.js 18 ou plus
- un **JDK 21** — le template Android de Capacitor 8 compile en `sourceCompatibility 21`
- le SDK Android avec `platforms;android-36` et `build-tools;36.0.0`, et `ANDROID_HOME` défini

## Options

```
html2apk build <source> [options]

  <source>                        URL https:// ou chemin d'un dossier contenant index.html

  -o, --output <file>             chemin de l'APK généré         (défaut : ./output.apk)
  --app-id <id>                   identifiant d'application      (défaut : com.html2apk.app)
  --app-name <name>               nom affiché                    (défaut : nom du dossier,
                                                                  ou hôte du site)
  --keystore <file>               keystore de signature          (défaut : keystore de debug)
  --keystore-password <password>  mot de passe de la keystore
  --key-alias <alias>             alias de la clé
  --no-docker                     builder avec la toolchain locale
  --docker-image <name>           image à utiliser               (défaut : html2apk:local)
  -v, --verbose                   afficher toutes les commandes et leur sortie
  --log-level <level>             debug | info | warn | error    (défaut : info)
```

### Signature

Sans option, l'APK est signé avec une keystore de debug générée à la première utilisation
dans `~/.html2apk/debug.keystore` (RSA 2048, 30 ans, permissions `600`). Elle est réutilisée
ensuite, y compris depuis Docker — le dossier est monté dans le conteneur, sinon chaque build
signerait avec une clé différente et l'app changerait d'identité.

Pour une vraie clé de publication :

```bash
html2apk build ./mon-site \
  --keystore ~/keys/release.jks \
  --key-alias release \
  --keystore-password "$MON_MOT_DE_PASSE"
```

Le mot de passe peut aussi venir de la variable `HTML2APK_KEYSTORE_PASSWORD`, ce qui évite
de le faire apparaître dans l'historique du shell. Dans tous les cas il est transmis à
`apksigner` par l'environnement, jamais en argument de commande — il n'apparaît donc ni dans
`ps` ni dans les logs.

Une keystore personnalisée absente est une erreur : elle n'est jamais générée à la volée,
car cela changerait silencieusement l'identité de l'application.

## Développement

```bash
npm run dev -- build ./mon-site   # exécution directe via ts-node
npm test                          # tests unitaires
npm run test:e2e                  # build réel de bout en bout (lent, toolchain requise)
npm run typecheck
```

Les tests e2e construisent de vrais APK : ils sont dans leur propre suite avec un timeout de
5 minutes, et se désactivent en annonçant ce qui manque si ni Docker ni toolchain locale ne
sont disponibles. `HTML2APK_E2E_REQUIRE=1` transforme ce skip en échec, pour qu'une CI ne
passe pas au vert sans avoir rien construit. `HTML2APK_E2E_MODE=docker|local` force un mode
plutôt que de prendre celui qui se trouve disponible.

## Intégration continue

`.github/workflows/html2apk.yml` lance trois jobs : les tests unitaires, un build réel avec
la toolchain du runner (`--no-docker`), et un build réel dans l'image Docker. Les deux
derniers construisent les APK de démonstration et les publient en artifacts téléchargeables
depuis la page du run — c'est le moyen le plus simple d'obtenir un APK installable sans rien
installer localement.

## État

Ce qui est vérifié par des tests automatisés : la détection de source, la génération du
projet Capacitor et de sa configuration, l'enchaînement des commandes, la résolution et la
génération de keystore, la construction des arguments Docker, et toute la couche d'affichage.

Ce qui n'a **pas** été vérifié sur un APK réel : l'étape finale du build Gradle, la signature
par `apksigner`, et le build dans Docker. L'environnement de développement utilisé n'avait ni
SDK Android, ni accès à `dl.google.com`, ni démon Docker. Le pipeline a été exécuté pour de
vrai jusqu'à l'appel Gradle inclus, dans les deux modes.
