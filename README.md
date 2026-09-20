# Winator

Analyse des cotes football Winamax, comparaison multi-bookmakers et répartition
des mises sur une bankroll.

## Ce que fait l'app

- **Scan Winamax** : matchs de football à venir, cotes 1N2 et Double Chance,
  lues dans l'état JSON embarqué dans les pages de paris sportifs.
- **Référence marché** : 20 à 38 bookmakers via The Odds API. La marge de chaque
  book est retirée, la médiane donne une probabilité de référence. Winamax est
  exclu du consensus.
- **3 niveaux de risque par match** :
  - N1 — Double Chance (1X, X2 ou 12)
  - N2 — Draw No Bet manuel, le nul rembourse 100 % de la mise totale
  - N3 — Pari simple sur une issue sèche
  Avec référence marché, chaque niveau retient l'issue à meilleure espérance,
  pas systématiquement le favori.
- **Ticket du jour** : liste des matchs à jouer et mise exacte sur chacun.
  Mode « Valeur uniquement » (Kelly fractionné, espérance positive exigée) ou
  « Meilleurs paris » (liste toujours remplie, répartition à plat).

## Ce que l'app ne fait pas

Elle ne garantit aucun gain. La marge Winamax est de 8 à 12 % selon les matchs,
et la plupart des scans ne trouvent aucun pari à espérance positive : le mode
« Valeur uniquement » renvoie alors une liste vide, ce qui est le résultat
correct. Le mode « Meilleurs paris » remplit la liste mais son espérance reste
négative, et l'app l'affiche.

## Installation locale

```bash
python -m pip install -r requirements.txt
```

Créer `.streamlit/secrets.toml` à partir de `.streamlit/secrets.toml.example` :

```toml
ODDS_API_KEY = "ta-cle-the-odds-api"
```

Lancer :

```bash
python -m streamlit run app.py
```

`python -m` est nécessaire quand `Scripts/` n'est pas dans le PATH.

## Déploiement sur Streamlit Community Cloud

1. Pousser ce dossier sur un dépôt GitHub. `.streamlit/secrets.toml` est dans
   `.gitignore` et ne doit jamais être commité.
2. Sur [share.streamlit.io](https://share.streamlit.io), connecter le dépôt et
   choisir `app.py` comme fichier principal.
3. Dans **App settings > Secrets**, coller :

   ```toml
   ODDS_API_KEY = "ta-cle-the-odds-api"
   APP_PASSWORD = "un-mot-de-passe-long"
   ```

   `APP_PASSWORD` est obligatoire en ligne : sans lui, toute personne qui
   connaît l'URL consomme les crédits The Odds API du compte.

## Android

L'app est une application web : il n'y a pas d'APK. Une fois déployée, ouvrir
l'URL dans Chrome sur le téléphone, puis **menu ⋮ > Ajouter à l'écran
d'accueil**. L'app obtient une icône et s'ouvre en plein écran, sans barre
d'adresse. L'interface est déjà dimensionnée pour un écran de téléphone.

## Consommation de crédits The Odds API

Le quota gratuit est de 500 requêtes par mois. Un scan coûte 1 crédit par ligue
et par région interrogée. Avec les réglages par défaut (8 ligues, région `eu`),
un scan coûte 8 crédits, et le résultat est mis en cache 10 minutes. Le curseur
« Ligues interrogées max » contrôle directement cette dépense.

## Fichiers

| Fichier | Rôle |
|---|---|
| `app.py` | Interface Streamlit |
| `winamax_scraper.py` | Lecture des cotes Winamax (httpx) |
| `odds_api.py` | Consensus multi-bookmakers, appariement des matchs |
| `risk_engine.py` | Niveaux de risque, espérance, Kelly, portefeuille |
| `auth.py` | Verrou par mot de passe pour le déploiement public |

## Avertissement

Jouer comporte des risques : endettement, isolement, dépendance. Appelez le
09 74 75 13 13 (appel non surtaxé). Interdit aux mineurs.
