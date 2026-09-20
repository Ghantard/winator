"""Comparaison multi-bookmakers via The Odds API (the-odds-api.com).

Winamax seul ne permet pas de detecter un pari de valeur : sa propre cote sert
alors de reference. On interroge donc 20 a 38 bookmakers, on retire la marge de
chacun, et on en tire une probabilite de reference. L'ecart entre cette
probabilite et la cote Winamax est l'edge (positif = pari de valeur).

Cout en credits : 1 credit par ligue et par region interrogee. Seules les ligues
reellement presentes dans le scan Winamax sont interrogees, et les reponses sont
mises en cache.

La cle API n'est jamais ecrite dans ce fichier : elle vient de
``.streamlit/secrets.toml`` ou de la variable d'environnement ``ODDS_API_KEY``.
"""

from __future__ import annotations

import os
import statistics
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from difflib import SequenceMatcher

import httpx

BASE_URL = "https://api.the-odds-api.com/v4"

# Bookmakers les plus fiables pour estimer la vraie probabilite : Pinnacle
# (marge tres faible) et les exchanges, ou le prix est fixe par le marche.
SHARP_BOOKS = ("pinnacle", "betfair_ex_eu", "betfair_ex_uk", "smarkets", "matchbook")

# Exclus du consensus : ce sont les cotes que l'on cherche justement a juger.
EXCLUDED_BOOKS = ("winamax_fr", "winamax_de")

# Tolerance sur l'heure de coup d'envoi lors de l'appariement des matchs
MAX_START_DELTA_SECONDS = 3 * 3600

# Seuil de similarite des noms d'equipes (0-1)
MIN_NAME_SCORE = 0.62

# Competition Winamax -> cle de ligue The Odds API
SPORT_KEY_BY_COMPETITION = {
    "angleterre - premier league": "soccer_epl",
    "angleterre - championship": "soccer_efl_champ",
    "angleterre - league one": "soccer_england_league1",
    "angleterre - league two": "soccer_england_league2",
    "angleterre - efl cup": "soccer_england_efl_cup",
    "espagne - laliga": "soccer_spain_la_liga",
    "espagne - laliga 2": "soccer_spain_segunda_division",
    "italie - serie a": "soccer_italy_serie_a",
    "italie - serie b": "soccer_italy_serie_b",
    "allemagne - bundesliga": "soccer_germany_bundesliga",
    "allemagne - bundesliga 2": "soccer_germany_bundesliga2",
    "allemagne - 3. liga": "soccer_germany_liga3",
    "coupe d'allemagne": "soccer_germany_dfb_pokal",
    "france - ligue 1": "soccer_france_ligue_one",
    "pays-bas - eredivisie": "soccer_netherlands_eredivisie",
    "portugal - liga portugal": "soccer_portugal_primeira_liga",
    "liga portugal": "soccer_portugal_primeira_liga",
    "belgique - jupiler pro league": "soccer_belgium_first_div",
    "ecosse - premiership": "soccer_spl",
    "grece - super league": "soccer_greece_super_league",
    "turquie - super lig": "soccer_turkey_super_league",
    "suisse - super league": "soccer_switzerland_superleague",
    "autriche - bundesliga": "soccer_austria_bundesliga",
    "pologne - ekstraklasa": "soccer_poland_ekstraklasa",
    "suede - allsvenskan": "soccer_sweden_allsvenskan",
    "suede - superettan": "soccer_sweden_superettan",
    "norvege - eliteserien": "soccer_norway_eliteserien",
    "danemark - superliga": "soccer_denmark_superliga",
    "irlande - league of ireland": "soccer_league_of_ireland",
    "bresil - serie a": "soccer_brazil_campeonato",
    "bresil - serie b": "soccer_brazil_serie_b",
    "argentine - primera division": "soccer_argentina_primera_division",
    "mexique - liga mx": "soccer_mexico_ligamx",
    "etats-unis - major league soccer": "soccer_usa_mls",
    "coree du sud - k league 1": "soccer_korea_kleague1",
    "europe - ligue des champions": "soccer_uefa_champs_league",
    "europe - ligue europa": "soccer_uefa_europa_league",
    "europe - ligue conference": "soccer_uefa_europa_conference_league",
    "europe - ligue des nations": "soccer_uefa_nations_league",
    "amerique du sud - copa libertadores": "soccer_conmebol_copa_libertadores",
    "amerique du sud - copa sudamericana": "soccer_conmebol_copa_sudamericana",
}

# Bruit a retirer des noms de clubs avant comparaison
CLUB_NOISE = {
    "fc", "cf", "afc", "sc", "ac", "as", "sv", "vfl", "vfb", "tsv", "bsc", "if",
    "ff", "bk", "aik", "ik", "fk", "sk", "nk", "hk", "gk", "cd", "ud", "sd",
    "rc", "cs", "us", "ca", "club", "de", "the", "united", "city", "calcio",
    "spa", "srl", "ii", "b",
}


class OddsApiError(RuntimeError):
    """Erreur d'appel a The Odds API."""


@dataclass
class FairOdds:
    """Probabilites de reference issues du consensus des bookmakers."""

    prob_home: float
    prob_draw: float
    prob_away: float
    books_used: int
    source: str  # "sharp" ou "consensus"
    best_home: float = 0.0
    best_draw: float = 0.0
    best_away: float = 0.0
    best_book_home: str = ""
    best_book_draw: str = ""
    best_book_away: str = ""
    event_home: str = ""
    event_away: str = ""

    @property
    def fair_odds_home(self) -> float:
        return 1 / self.prob_home if self.prob_home else 0.0

    @property
    def fair_odds_draw(self) -> float:
        return 1 / self.prob_draw if self.prob_draw else 0.0

    @property
    def fair_odds_away(self) -> float:
        return 1 / self.prob_away if self.prob_away else 0.0


@dataclass
class LinkReport:
    """Bilan d'un appariement Winamax <-> The Odds API."""

    fair_by_match_id: dict[int, FairOdds] = field(default_factory=dict)
    credits_used: int = 0
    credits_remaining: int | None = None
    leagues_queried: list[str] = field(default_factory=list)
    unmapped_competitions: list[str] = field(default_factory=list)
    unmatched_titles: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def get_api_key(explicit: str | None = None) -> str | None:
    """Cle API : argument explicite, puis secrets Streamlit, puis environnement."""
    if explicit:
        return explicit.strip()
    try:
        import streamlit as st

        key = st.secrets.get("ODDS_API_KEY")  # type: ignore[union-attr]
        if key:
            return str(key).strip()
    except Exception:
        pass
    key = os.environ.get("ODDS_API_KEY")
    return key.strip() if key else None


def _strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def normalize_competition(name: str) -> str:
    text = _strip_accents(name).lower().strip()
    for junk in ("mcdonald's", "®", "™"):
        text = text.replace(junk, "")
    return " ".join(text.split())


def normalize_team(name: str) -> str:
    text = _strip_accents(name).lower()
    text = "".join(c if c.isalnum() or c.isspace() else " " for c in text)
    tokens = [t for t in text.split() if t and t not in CLUB_NOISE]
    return " ".join(tokens) if tokens else " ".join(text.split())


def sport_key_for(competition: str) -> str | None:
    """Cle The Odds API correspondant a une competition Winamax."""
    normalized = normalize_competition(competition)
    if normalized in SPORT_KEY_BY_COMPETITION:
        return SPORT_KEY_BY_COMPETITION[normalized]
    # Tolere les suffixes de sponsor : "france - ligue 1 mcdonald s"
    for key, sport_key in SPORT_KEY_BY_COMPETITION.items():
        if normalized.startswith(key):
            return sport_key
    return None


def _team_score(a: str, b: str) -> float:
    na, nb = normalize_team(a), normalize_team(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        return 0.93
    return SequenceMatcher(None, na, nb).ratio()


def devig(price_home: float, price_draw: float, price_away: float) -> tuple[float, float, float]:
    """Retire la marge d'un bookmaker par normalisation des probabilites."""
    raw = (1 / price_home, 1 / price_draw, 1 / price_away)
    total = sum(raw)
    return tuple(p / total for p in raw)  # type: ignore[return-value]


def _event_prices(event: dict) -> tuple[list[tuple[str, float, float, float]], dict]:
    """Extrait (book, cote_home, cote_nul, cote_away) et les meilleurs prix."""
    home_team = event.get("home_team", "")
    away_team = event.get("away_team", "")
    rows: list[tuple[str, float, float, float]] = []
    best = {
        "home": (0.0, ""),
        "draw": (0.0, ""),
        "away": (0.0, ""),
    }
    for book in event.get("bookmakers") or []:
        key = book.get("key", "")
        market = next(
            (m for m in book.get("markets") or [] if m.get("key") == "h2h"), None
        )
        if not market:
            continue
        prices: dict[str, float] = {}
        for outcome in market.get("outcomes") or []:
            name = outcome.get("name", "")
            price = outcome.get("price")
            if not price:
                continue
            if name == "Draw":
                prices["draw"] = float(price)
            elif name == home_team:
                prices["home"] = float(price)
            elif name == away_team:
                prices["away"] = float(price)
        if len(prices) != 3:
            continue
        if key not in EXCLUDED_BOOKS:
            for side in ("home", "draw", "away"):
                if prices[side] > best[side][0]:
                    best[side] = (prices[side], key)
        rows.append((key, prices["home"], prices["draw"], prices["away"]))
    return rows, best


def consensus_from_event(event: dict) -> FairOdds | None:
    """Probabilites de reference : bookmakers sharp si presents, sinon mediane."""
    rows, best = _event_prices(event)
    usable = [r for r in rows if r[0] not in EXCLUDED_BOOKS]
    if not usable:
        return None

    sharp = [r for r in usable if r[0] in SHARP_BOOKS]
    selected = sharp if sharp else usable
    source = "sharp" if sharp else "consensus"

    probs = [devig(r[1], r[2], r[3]) for r in selected]
    p_home = statistics.median(p[0] for p in probs)
    p_draw = statistics.median(p[1] for p in probs)
    p_away = statistics.median(p[2] for p in probs)
    total = p_home + p_draw + p_away
    if total <= 0:
        return None

    return FairOdds(
        prob_home=p_home / total,
        prob_draw=p_draw / total,
        prob_away=p_away / total,
        books_used=len(selected),
        source=source,
        best_home=best["home"][0],
        best_draw=best["draw"][0],
        best_away=best["away"][0],
        best_book_home=best["home"][1],
        best_book_draw=best["draw"][1],
        best_book_away=best["away"][1],
        event_home=event.get("home_team", ""),
        event_away=event.get("away_team", ""),
    )


def fetch_active_sport_keys(api_key: str, timeout: float = 20.0) -> set[str]:
    """Ligues actuellement actives. Appel gratuit, ne consomme aucun credit."""
    try:
        response = httpx.get(
            f"{BASE_URL}/sports/", params={"apiKey": api_key}, timeout=timeout
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise OddsApiError(f"Appel /sports impossible : {exc}") from exc
    return {s["key"] for s in response.json() if s.get("active")}


def fetch_league_odds(
    api_key: str,
    sport_key: str,
    regions: str = "eu",
    timeout: float = 25.0,
) -> tuple[list[dict], int, int | None]:
    """Cotes 1N2 d'une ligue. Renvoie (evenements, credits utilises, restants)."""
    params = {
        "apiKey": api_key,
        "regions": regions,
        "markets": "h2h",
        "oddsFormat": "decimal",
    }
    try:
        response = httpx.get(
            f"{BASE_URL}/sports/{sport_key}/odds", params=params, timeout=timeout
        )
    except httpx.HTTPError as exc:
        raise OddsApiError(f"{sport_key} : {exc}") from exc
    if response.status_code == 401:
        raise OddsApiError("Cle API refusee (401).")
    if response.status_code == 429:
        raise OddsApiError("Quota The Odds API epuise (429).")
    if response.status_code != 200:
        raise OddsApiError(f"{sport_key} : HTTP {response.status_code}")

    used = int(response.headers.get("x-requests-last", 0) or 0)
    remaining_raw = response.headers.get("x-requests-remaining")
    remaining = int(remaining_raw) if remaining_raw not in (None, "") else None
    return response.json(), used, remaining


def _match_event(match, events: list[dict]) -> FairOdds | None:
    """Retrouve l'evenement The Odds API correspondant a un match Winamax."""
    best_score = 0.0
    best_event = None
    for event in events:
        commence = event.get("commence_time")
        if not commence:
            continue
        try:
            start = datetime.fromisoformat(commence.replace("Z", "+00:00"))
        except ValueError:
            continue
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if abs((start - match.start).total_seconds()) > MAX_START_DELTA_SECONDS:
            continue
        score_home = _team_score(match.home, event.get("home_team", ""))
        score_away = _team_score(match.away, event.get("away_team", ""))
        score = (score_home + score_away) / 2
        if score > best_score:
            best_score, best_event = score, event
    if best_event is None or best_score < MIN_NAME_SCORE:
        return None
    return consensus_from_event(best_event)


def link_matches(
    matches,
    api_key: str,
    regions: str = "eu",
    max_leagues: int = 12,
) -> LinkReport:
    """Associe chaque match Winamax au consensus multi-bookmakers.

    Une seule requete par ligue presente dans ``matches``, limitee a
    ``max_leagues`` pour garder la consommation de credits sous controle.
    """
    report = LinkReport()
    if not matches:
        return report

    try:
        active = fetch_active_sport_keys(api_key)
    except OddsApiError as exc:
        report.errors.append(str(exc))
        return report

    # Regroupe les matchs par ligue The Odds API
    by_sport: dict[str, list] = {}
    for match in matches:
        sport_key = sport_key_for(match.competition)
        if not sport_key or sport_key not in active:
            if match.competition not in report.unmapped_competitions:
                report.unmapped_competitions.append(match.competition)
            continue
        by_sport.setdefault(sport_key, []).append(match)

    # Priorite aux ligues couvrant le plus de matchs
    ordered = sorted(by_sport.items(), key=lambda kv: len(kv[1]), reverse=True)
    for sport_key, league_matches in ordered[:max_leagues]:
        try:
            events, used, remaining = fetch_league_odds(api_key, sport_key, regions)
        except OddsApiError as exc:
            report.errors.append(str(exc))
            continue
        report.credits_used += used
        if remaining is not None:
            report.credits_remaining = remaining
        report.leagues_queried.append(sport_key)
        for match in league_matches:
            fair = _match_event(match, events)
            if fair:
                report.fair_by_match_id[match.match_id] = fair
            else:
                report.unmatched_titles.append(match.title)

    return report
