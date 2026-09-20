"""Scraper des cotes football Winamax.

Winamax n'expose pas d'API REST documentee, mais chaque page de paris sportifs
embarque son etat applicatif complet sous forme de JSON dans la variable
JavaScript ``PRELOADED_STATE``. On lit ce JSON directement :

- ``/paris-sportifs/sports/1``   : liste des matchs de football + marche 1N2
- ``/paris-sportifs/match/{id}`` : tous les marches du match, dont Double Chance

Les cotes renvoyees sont deja des cotes decimales (1.40, 5.10, ...).
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

BASE_URL = "https://www.winamax.fr"
SPORT_FOOTBALL = 1

# Identifiants de marches Winamax
MARKET_RESULT = 1  # 1N2 "Resultat"
MARKET_DOUBLE_CHANCE = 10  # "Double chance"

# Codes des issues Double Chance
DC_CODE_HOME_OR_DRAW = "9"  # 1X
DC_CODE_HOME_OR_AWAY = "10"  # 12
DC_CODE_AWAY_OR_DRAW = "11"  # X2

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}


class WinamaxError(RuntimeError):
    """Erreur de recuperation ou de lecture des donnees Winamax."""


@dataclass
class Match:
    match_id: int
    title: str
    home: str
    away: str
    competition: str
    start: datetime
    odds_home: float
    odds_draw: float
    odds_away: float
    # Double Chance reelle si disponible, sinon estimee (voir dc_is_estimated)
    odds_1x: float | None = None
    odds_x2: float | None = None
    odds_12: float | None = None
    dc_is_estimated: bool = False
    url: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def favorite(self) -> str:
        """'home' ou 'away' selon la cote la plus basse."""
        return "home" if self.odds_home <= self.odds_away else "away"

    @property
    def favorite_name(self) -> str:
        return self.home if self.favorite == "home" else self.away

    @property
    def favorite_odds(self) -> float:
        return self.odds_home if self.favorite == "home" else self.odds_away

    @property
    def favorite_dc_odds(self) -> float | None:
        """Cote Double Chance couvrant le favori et le nul (1X ou X2)."""
        return self.odds_1x if self.favorite == "home" else self.odds_x2

    @property
    def favorite_dc_label(self) -> str:
        return "1X" if self.favorite == "home" else "X2"

    @property
    def margin(self) -> float:
        """Marge bookmaker sur le 1N2 (overround - 1)."""
        return (1 / self.odds_home + 1 / self.odds_draw + 1 / self.odds_away) - 1


def _extract_preloaded_state(html: str) -> dict:
    """Extrait le JSON de la variable JavaScript PRELOADED_STATE."""
    anchor = html.find("PRELOADED_STATE")
    if anchor == -1:
        raise WinamaxError(
            "PRELOADED_STATE introuvable dans la reponse Winamax "
            "(page modifiee, blocage anti-bot ou redirection)."
        )
    start = html.find("{", anchor)
    if start == -1:
        raise WinamaxError("PRELOADED_STATE present mais sans objet JSON exploitable.")
    try:
        state, _ = json.JSONDecoder().raw_decode(html[start:])
    except json.JSONDecodeError as exc:
        raise WinamaxError(f"JSON Winamax illisible: {exc}") from exc
    return state


def _odds_of_bet(state: dict, bet: dict) -> dict[str, float]:
    """Mappe code d'issue -> cote decimale pour un pari donne."""
    outcomes = state.get("outcomes") or {}
    odds = state.get("odds") or {}
    result: dict[str, float] = {}
    for outcome_id in bet.get("outcomes") or []:
        key = str(outcome_id)
        outcome = outcomes.get(key)
        value = odds.get(key)
        if not outcome or value is None:
            continue
        code = str(outcome.get("code", "")).lower()
        try:
            result[code] = float(value)
        except (TypeError, ValueError):
            continue
    return result


def _find_bet(state: dict, match_id: int, market_id: int) -> dict | None:
    for bet in (state.get("bets") or {}).values():
        if not bet:
            continue
        if bet.get("matchId") == match_id and bet.get("marketId") == market_id:
            return bet
    return None


def _competition_name(state: dict, match: dict) -> str:
    tournaments = state.get("tournaments") or {}
    tournament = tournaments.get(str(match.get("tournamentId"))) or {}
    name = tournament.get("tournamentName") or ""
    categories = state.get("categories") or {}
    category = categories.get(str(match.get("categoryId"))) or {}
    country = category.get("categoryName") or ""
    if name and country and country.lower() not in name.lower():
        return f"{country} - {name}"
    return name or country or "Competition inconnue"


def estimate_double_chance(odd_a: float, odd_b: float, margin: float = 0.06) -> float:
    """Estime une cote Double Chance a partir de deux cotes 1N2.

    La probabilite d'un Double Chance est la somme des probabilites implicites
    des deux issues couvertes. On applique ensuite une marge bookmaker pour
    rester proche des cotes reellement proposees par Winamax.
    """
    prob = (1 / odd_a) + (1 / odd_b)
    prob = min(prob * (1 + margin), 0.995)
    return round(1 / prob, 2)


def _parse_matches(state: dict, include_live: bool = False) -> list[Match]:
    now = datetime.now(timezone.utc)
    matches: list[Match] = []
    for raw in (state.get("matches") or {}).values():
        if not raw or raw.get("sportId") != SPORT_FOOTBALL:
            continue
        if not raw.get("available", True):
            continue
        if raw.get("status") != "PREMATCH" and not include_live:
            continue
        match_id = raw.get("matchId")
        main_bet_id = raw.get("mainBetId")
        if not match_id or not main_bet_id:
            continue
        bet = (state.get("bets") or {}).get(str(main_bet_id))
        if not bet or bet.get("marketId") != MARKET_RESULT:
            continue
        odds = _odds_of_bet(state, bet)
        if not {"1", "x", "2"} <= set(odds):
            continue
        start_ts = raw.get("matchStart")
        if not start_ts:
            continue
        start = datetime.fromtimestamp(int(start_ts), tz=timezone.utc)
        if start <= now and not include_live:
            continue
        matches.append(
            Match(
                match_id=int(match_id),
                title=raw.get("title") or "",
                home=raw.get("competitor1Name") or "",
                away=raw.get("competitor2Name") or "",
                competition=_competition_name(state, raw),
                start=start,
                odds_home=odds["1"],
                odds_draw=odds["x"],
                odds_away=odds["2"],
                url=f"{BASE_URL}/paris-sportifs/match/{match_id}",
            )
        )
    matches.sort(key=lambda m: m.start)
    return matches


def fetch_upcoming_matches(
    limit: int = 30,
    timeout: float = 25.0,
    include_live: bool = False,
) -> list[Match]:
    """Recupere les matchs de football a venir avec leurs cotes 1N2."""
    url = f"{BASE_URL}/paris-sportifs/sports/{SPORT_FOOTBALL}"
    with httpx.Client(headers=HEADERS, timeout=timeout, follow_redirects=True) as client:
        response = client.get(url)
        response.raise_for_status()
        state = _extract_preloaded_state(response.text)
    matches = _parse_matches(state, include_live=include_live)
    return matches[:limit] if limit else matches


async def _fetch_double_chance(
    client: httpx.AsyncClient, match: Match, semaphore: asyncio.Semaphore
) -> None:
    async with semaphore:
        try:
            response = await client.get(match.url)
            response.raise_for_status()
            state = _extract_preloaded_state(response.text)
        except (httpx.HTTPError, WinamaxError) as exc:
            match.warnings.append(
                f"Cotes Double Chance reelles indisponibles ({type(exc).__name__})."
            )
            return
        bet = _find_bet(state, match.match_id, MARKET_DOUBLE_CHANCE)
        if not bet:
            match.warnings.append("Marche Double Chance absent sur ce match.")
            return
        odds = _odds_of_bet(state, bet)
        match.odds_1x = odds.get(DC_CODE_HOME_OR_DRAW)
        match.odds_x2 = odds.get(DC_CODE_AWAY_OR_DRAW)
        match.odds_12 = odds.get(DC_CODE_HOME_OR_AWAY)


async def _enrich_all(matches: list[Match], concurrency: int, timeout: float) -> None:
    semaphore = asyncio.Semaphore(concurrency)
    limits = httpx.Limits(
        max_connections=concurrency, max_keepalive_connections=concurrency
    )
    async with httpx.AsyncClient(
        headers=HEADERS, timeout=timeout, follow_redirects=True, limits=limits
    ) as client:
        await asyncio.gather(
            *(_fetch_double_chance(client, m, semaphore) for m in matches)
        )


def enrich_with_double_chance(
    matches: list[Match],
    concurrency: int = 8,
    timeout: float = 25.0,
    fallback_to_estimate: bool = True,
) -> list[Match]:
    """Complete chaque match avec les cotes Double Chance reelles de Winamax.

    Une page par match est necessaire : les appels sont paralleles. Si une page
    echoue et que ``fallback_to_estimate`` est vrai, la cote est estimee depuis
    le 1N2 et le match est marque ``dc_is_estimated``.
    """
    if not matches:
        return matches
    asyncio.run(_enrich_all(matches, concurrency=concurrency, timeout=timeout))
    for match in matches:
        missing = (
            match.odds_1x is None or match.odds_x2 is None or match.odds_12 is None
        )
        if missing and fallback_to_estimate:
            match.dc_is_estimated = True
            if match.odds_1x is None:
                match.odds_1x = estimate_double_chance(match.odds_home, match.odds_draw)
            if match.odds_x2 is None:
                match.odds_x2 = estimate_double_chance(match.odds_away, match.odds_draw)
            if match.odds_12 is None:
                match.odds_12 = estimate_double_chance(match.odds_home, match.odds_away)
    return matches


def scan(
    limit: int = 30,
    with_double_chance: bool = True,
    concurrency: int = 8,
    include_live: bool = False,
) -> list[Match]:
    """Recupere les matchs a venir avec cotes 1N2 et Double Chance."""
    matches = fetch_upcoming_matches(limit=limit, include_live=include_live)
    if with_double_chance:
        enrich_with_double_chance(matches, concurrency=concurrency)
    else:
        for match in matches:
            match.dc_is_estimated = True
            match.odds_1x = estimate_double_chance(match.odds_home, match.odds_draw)
            match.odds_x2 = estimate_double_chance(match.odds_away, match.odds_draw)
            match.odds_12 = estimate_double_chance(match.odds_home, match.odds_away)
    return matches


def diagnose(timeout: float = 25.0) -> dict:
    """Etat brut de la reponse Winamax, pour comprendre un scan vide.

    Winamax est un operateur sous licence francaise : depuis une IP hors de
    France, la page peut etre remplacee par une page de restriction qui ne
    contient aucun match. Cette fonction rapporte ce qui a reellement ete recu.
    """
    url = f"{BASE_URL}/paris-sportifs/sports/{SPORT_FOOTBALL}"
    report: dict = {"url": url}
    try:
        with httpx.Client(
            headers=HEADERS, timeout=timeout, follow_redirects=True
        ) as client:
            response = client.get(url)
        report["status"] = response.status_code
        report["final_url"] = str(response.url)
        report["html_length"] = len(response.text)
        report["has_state"] = "PRELOADED_STATE" in response.text
        if not report["has_state"]:
            report["excerpt"] = response.text[:400]
            return report
        state = _extract_preloaded_state(response.text)
        matches = (state.get("matches") or {}).values()
        football = [m for m in matches if m and m.get("sportId") == SPORT_FOOTBALL]
        now = datetime.now(timezone.utc)
        report["state_keys"] = sorted(state.keys())[:20]
        report["matches_total"] = len(list(matches))
        report["football_total"] = len(football)
        report["football_prematch"] = sum(
            1 for m in football if m.get("status") == "PREMATCH"
        )
        report["football_future"] = sum(
            1
            for m in football
            if m.get("matchStart")
            and datetime.fromtimestamp(int(m["matchStart"]), tz=timezone.utc) > now
        )
        report["bets_total"] = len(state.get("bets") or {})
        report["odds_total"] = len(state.get("odds") or {})
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    return report


if __name__ == "__main__":
    started = time.time()
    data = scan(limit=5)
    for m in data:
        flag = " (estime)" if m.dc_is_estimated else ""
        print(
            f"{m.start:%d/%m %H:%M} | {m.competition} | {m.title} | "
            f"1N2 {m.odds_home}/{m.odds_draw}/{m.odds_away} | "
            f"1X {m.odds_1x} X2 {m.odds_x2} 12 {m.odds_12}{flag}"
        )
    print(f"{len(data)} matchs en {time.time() - started:.1f}s")
