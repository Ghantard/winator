"""Moteur de gestion du risque : 3 niveaux de strategie par match + portefeuille.

Niveau 1 - Risque tres faible : Double Chance (1X, X2 ou 12).
Niveau 2 - Risque faible     : Draw No Bet manuel (mise repartie Victoire + Nul,
                               le nul rembourse 100 % de la mise totale).
Niveau 3 - Risque modere     : Pari simple sur une issue seche.

Choix du cote joue :

- Sans reference marche, chaque niveau joue le favori (cote la plus basse).
- Avec une reference multi-bookmakers (``odds_api.FairOdds``), chaque niveau
  retient l'issue a meilleure esperance. C'est indispensable : un favori est
  presque toujours correctement price, alors qu'un outsider ou un nul peut
  etre genereux chez Winamax.

Toutes les mises sont exprimees en euros, arrondies au centime.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# Part de bankroll engagee par niveau de risque (plafond par pari)
BANKROLL_PCT_LEVEL_1 = 0.03  # 3 % - risque tres faible
BANKROLL_PCT_LEVEL_2 = 0.02  # 2 % - risque faible
BANKROLL_PCT_LEVEL_3 = 0.01  # 1 % - risque modere (plafond impose)

PCT_BY_LEVEL = {
    1: BANKROLL_PCT_LEVEL_1,
    2: BANKROLL_PCT_LEVEL_2,
    3: BANKROLL_PCT_LEVEL_3,
}

# Mise minimale acceptee par Winamax sur une selection
MIN_STAKE = 1.0

# Fraction de Kelly appliquee : le Kelly complet est trop volatil, et une
# probabilite estimee n'est jamais exacte.
KELLY_FRACTION = 0.25

# Exposition totale par defaut, en part de bankroll
DEFAULT_MAX_EXPOSURE = 0.10

# Sur une petite bankroll, le minimum Winamax de 1 EUR depasse la part prevue
# par le niveau de risque. On accepte de remonter la mise jusqu'a cette part
# de bankroll ; au-dela, le pari est declare injouable plutot que de faire
# passer un "risque tres faible" pour ce qu'il n'est pas.
MAX_SINGLE_EXPOSURE = 0.20

OUTCOME_KEYS = ("home", "draw", "away")

DC_COVERAGE = {
    "1x": ("home", "draw"),
    "x2": ("away", "draw"),
    "12": ("home", "away"),
}
DC_LABELS = {"1x": "1X", "x2": "X2", "12": "12"}


def _stake_for_level(bankroll: float, level: int) -> tuple[float, list[str]]:
    """Mise du niveau, relevee au minimum Winamax si la bankroll est petite."""
    target = _floor_cents(bankroll * PCT_BY_LEVEL[level])
    if target >= MIN_STAKE:
        return target, []
    ceiling = bankroll * MAX_SINGLE_EXPOSURE
    if MIN_STAKE <= ceiling:
        pct = MIN_STAKE / bankroll * 100 if bankroll else 0
        return MIN_STAKE, [
            f"Bankroll trop petite pour {PCT_BY_LEVEL[level] * 100:.0f} % "
            f"({euro_min(target)}) : mise relevée au minimum Winamax de "
            f"{MIN_STAKE:.2f} €, soit {pct:.1f} % de la bankroll."
        ]
    return 0.0, [
        f"Bankroll insuffisante : le minimum Winamax de {MIN_STAKE:.2f} € "
        f"dépasserait {MAX_SINGLE_EXPOSURE * 100:.0f} % de la bankroll."
    ]


def euro_min(value: float) -> str:
    return f"{value:.2f} €"


def _floor_cents(value: float) -> float:
    return math.floor(value * 100) / 100


def _ceil_cents(value: float) -> float:
    return math.ceil(value * 100) / 100


@dataclass
class Leg:
    """Une ligne de pari a saisir sur Winamax."""

    selection: str
    odds: float
    stake: float

    @property
    def payout(self) -> float:
        return round(self.stake * self.odds, 2)


@dataclass
class Strategy:
    level: int
    name: str
    risk_label: str
    description: str
    legs: list[Leg]
    total_stake: float
    # Scenarios affichables : libelle -> retour brut encaisse
    outcomes: dict[str, float]
    # Memes retours, indexes par issue canonique : "home", "draw", "away"
    gross_by_key: dict[str, float]
    effective_odds: float
    implied_probability: float
    # Libelle court du pari, ex "1X", "DNB Getafe", "Match nul"
    pick: str = ""
    viable: bool = True
    notes: list[str] = field(default_factory=list)
    # Probabilite d'encaisser au moins la mise (source : marche ou Winamax)
    covered_probability: float | None = None
    # Renseignes uniquement avec une reference marche
    ev_pct: float | None = None
    kelly_fraction: float | None = None

    @property
    def best_profit(self) -> float:
        return round(max(self.outcomes.values()) - self.total_stake, 2)

    @property
    def worst_loss(self) -> float:
        return round(min(self.outcomes.values()) - self.total_stake, 2)

    @property
    def roi_if_win(self) -> float:
        if self.total_stake <= 0:
            return 0.0
        return round(self.best_profit / self.total_stake * 100, 1)

    @property
    def has_value(self) -> bool:
        return self.ev_pct is not None and self.ev_pct > 0

    def outcome_rows(self) -> list[dict]:
        return [
            {
                "Scenario": label,
                "Retour brut": round(gross, 2),
                "Resultat net": round(gross - self.total_stake, 2),
            }
            for label, gross in self.outcomes.items()
        ]

    def scaled_to(self, stake: float) -> "Strategy":
        """Copie de la strategie redimensionnee a une mise totale donnee."""
        if self.total_stake <= 0 or stake <= 0:
            return self
        ratio = stake / self.total_stake
        legs = [
            Leg(
                selection=leg.selection,
                odds=leg.odds,
                stake=_floor_cents(leg.stake * ratio),
            )
            for leg in self.legs
        ]
        real_total = round(sum(leg.stake for leg in legs), 2)
        return Strategy(
            level=self.level,
            name=self.name,
            risk_label=self.risk_label,
            description=self.description,
            legs=legs,
            total_stake=real_total,
            outcomes={k: round(v * ratio, 2) for k, v in self.outcomes.items()},
            gross_by_key={k: round(v * ratio, 2) for k, v in self.gross_by_key.items()},
            effective_odds=self.effective_odds,
            implied_probability=self.implied_probability,
            pick=self.pick,
            viable=self.viable,
            notes=list(self.notes),
            covered_probability=self.covered_probability,
            ev_pct=self.ev_pct,
            kelly_fraction=self.kelly_fraction,
        )


def _no_vig_probabilities(
    odds_home: float, odds_draw: float, odds_away: float
) -> tuple[float, float, float]:
    """Probabilites implicites 1N2 normalisees (marge bookmaker retiree)."""
    raw = (1 / odds_home, 1 / odds_draw, 1 / odds_away)
    total = sum(raw)
    return tuple(p / total for p in raw)  # type: ignore[return-value]


def _team_of(match, key: str) -> str:
    return match.home if key == "home" else match.away


def _odds_of(match, key: str) -> float:
    return {
        "home": match.odds_home,
        "draw": match.odds_draw,
        "away": match.odds_away,
    }[key]


def _dc_odds_of(match, dc_key: str) -> float | None:
    return {"1x": match.odds_1x, "x2": match.odds_x2, "12": match.odds_12}[dc_key]


def _empty(level: int, name: str, risk_label: str, reason: str, notes=None) -> Strategy:
    return Strategy(
        level=level,
        name=name,
        risk_label=risk_label,
        description=reason,
        legs=[],
        total_stake=0.0,
        outcomes={},
        gross_by_key={},
        effective_odds=0.0,
        implied_probability=0.0,
        viable=False,
        notes=list(notes or []),
    )


# ------------------------------------------------------------- Niveaux de risque


def level_1_double_chance(match, bankroll: float, dc_key: str = "1x") -> Strategy:
    """Niveau 1 : Double Chance (1X, X2 ou 12)."""
    stake, notes = _stake_for_level(bankroll, 1)
    dc_odds = _dc_odds_of(match, dc_key)
    covered = DC_COVERAGE[dc_key]
    excluded = next(k for k in OUTCOME_KEYS if k not in covered)
    if getattr(match, "dc_is_estimated", False):
        notes.append(
            "Cote Double Chance estimée à partir du 1N2 : vérifiez-la sur Winamax "
            "avant de miser."
        )
    if dc_odds is None or dc_odds <= 1.0:
        return _empty(
            1,
            "Double Chance",
            "Risque très faible",
            "Cote Double Chance indisponible pour ce match.",
            notes + ["Marché Double Chance non exploitable."],
        )
    if stake < MIN_STAKE:
        return _empty(
            1, "Double Chance", "Risque très faible",
            "Bankroll insuffisante pour ce niveau.", notes,
        )

    def label(key: str) -> str:
        return "Match nul" if key == "draw" else _team_of(match, key)

    selection = f"{label(covered[0])} ou {label(covered[1])} ({DC_LABELS[dc_key]})"
    gross = round(stake * dc_odds, 2)
    gross_by_key = {k: (gross if k in covered else 0.0) for k in OUTCOME_KEYS}

    return Strategy(
        level=1,
        name="Double Chance",
        risk_label="Risque très faible",
        description=(
            f"Un seul pari : {selection}. Perdant uniquement si "
            f"{label(excluded).lower() if excluded == 'draw' else label(excluded)} "
            "se produit."
        ),
        legs=[Leg(selection=selection, odds=dc_odds, stake=stake)],
        total_stake=stake,
        outcomes={
            f"Victoire {match.home}": gross_by_key["home"],
            "Match nul": gross_by_key["draw"],
            f"Victoire {match.away}": gross_by_key["away"],
        },
        gross_by_key=gross_by_key,
        effective_odds=dc_odds,
        implied_probability=1 / dc_odds,
        pick=DC_LABELS[dc_key],
        viable=True,
        notes=notes,
    )


def level_2_draw_no_bet(match, bankroll: float, side: str = "home") -> Strategy:
    """Niveau 2 : Draw No Bet reconstitue manuellement.

    La mise totale T est repartie entre la Victoire choisie (cote ``o_win``) et
    le Match nul (cote ``o_draw``) de sorte que le nul rembourse au moins
    100 % de T :

        stake_nul = T / o_draw      (arrondi au centime superieur)
        stake_vic = T - stake_nul
    """
    total, notes = _stake_for_level(bankroll, 2)
    o_win = _odds_of(match, side)
    o_draw = match.odds_draw
    backed = _team_of(match, side)
    loser = match.away if side == "home" else match.home

    if o_draw <= 1.0:
        return _empty(
            2, "Draw No Bet (manuel)", "Risque faible",
            "Cote du nul inexploitable.", notes,
        )

    # Les deux jambes doivent atteindre 1 EUR : la jambe nul vaut T / o_draw,
    # donc T doit valoir au moins o_draw ; la jambe victoire impose en plus
    # T >= o_draw / (o_draw - 1).
    minimum_total = _ceil_cents(max(o_draw, o_draw / (o_draw - 1)))
    if total < minimum_total:
        if minimum_total > bankroll * MAX_SINGLE_EXPOSURE:
            return _empty(
                2, "Draw No Bet (manuel)", "Risque faible",
                "Bankroll insuffisante pour un DNB sur ce match.",
                notes + [
                    f"Le DNB exige au moins {minimum_total:.2f} € ici (deux mises "
                    f"à 1 € minimum), soit plus de {MAX_SINGLE_EXPOSURE * 100:.0f} % "
                    "de la bankroll."
                ],
            )
        notes.append(
            f"Mise portée à {minimum_total:.2f} € : en dessous, une des deux "
            "jambes passerait sous le minimum Winamax de 1 €."
        )
        total = minimum_total

    stake_draw = _ceil_cents(total / o_draw)
    stake_win = round(total - stake_draw, 2)

    if stake_win <= 0:
        return _empty(
            2,
            "Draw No Bet (manuel)",
            "Risque faible",
            "Cote du nul trop basse : couvrir le nul absorbe toute la mise.",
            ["Répartition DNB impossible sur ce match."],
        )

    gross_win = round(stake_win * o_win, 2)
    gross_draw = round(stake_draw * o_draw, 2)
    effective_odds = round(gross_win / total, 3) if total else 0.0

    if effective_odds <= 1.0:
        notes.append(
            "Cote DNB effective inférieure à 1.00 : aucun gain possible, "
            "match à écarter."
        )
    if min(stake_win, stake_draw) < MIN_STAKE:
        notes.append(
            f"Une des deux mises est sous le minimum Winamax de {MIN_STAKE:.2f} €."
        )
    if gross_draw < total:
        notes.append("Remboursement du nul légèrement inférieur à 100 % (arrondis).")

    gross_by_key = {
        "home": gross_win if side == "home" else 0.0,
        "draw": gross_draw,
        "away": gross_win if side == "away" else 0.0,
    }

    return Strategy(
        level=2,
        name="Draw No Bet (manuel)",
        risk_label="Risque faible",
        description=(
            f"Deux paris simultanés : {backed} et Match nul. Le nul rembourse la "
            f"mise totale, seule une victoire de {loser} fait perdre."
        ),
        legs=[
            Leg(selection=f"Victoire {backed}", odds=o_win, stake=stake_win),
            Leg(selection="Match nul", odds=o_draw, stake=stake_draw),
        ],
        total_stake=total,
        outcomes={
            f"Victoire {match.home}": gross_by_key["home"],
            "Match nul (remboursé)": gross_draw,
            f"Victoire {match.away}": gross_by_key["away"],
        },
        gross_by_key=gross_by_key,
        effective_odds=effective_odds,
        implied_probability=(1 / effective_odds) if effective_odds > 0 else 0.0,
        pick=f"DNB {backed}",
        viable=effective_odds > 1.0,
        notes=notes,
    )


def level_3_single_win(match, bankroll: float, outcome: str = "home") -> Strategy:
    """Niveau 3 : pari simple sur une issue seche, 1 % de bankroll max."""
    stake, notes = _stake_for_level(bankroll, 3)
    odds = _odds_of(match, outcome)
    pick = "Match nul" if outcome == "draw" else f"Victoire {_team_of(match, outcome)}"
    if stake < MIN_STAKE:
        return _empty(
            3, "Pari simple", "Risque modéré",
            "Bankroll insuffisante pour ce niveau.", notes,
        )

    gross = round(stake * odds, 2)
    gross_by_key = {k: (gross if k == outcome else 0.0) for k in OUTCOME_KEYS}

    return Strategy(
        level=3,
        name="Pari simple",
        risk_label="Risque modéré",
        description=f"Un seul pari : {pick}. Mise plafonnée à 1 % de la bankroll.",
        legs=[Leg(selection=pick, odds=odds, stake=stake)],
        total_stake=stake,
        outcomes={
            f"Victoire {match.home}": gross_by_key["home"],
            "Match nul": gross_by_key["draw"],
            f"Victoire {match.away}": gross_by_key["away"],
        },
        gross_by_key=gross_by_key,
        effective_odds=odds,
        implied_probability=1 / odds,
        pick=pick,
        viable=True,
        notes=notes,
    )


# --------------------------------------------------------- Esperance et Kelly


def _annotate(strategy: Strategy, probs: dict[str, float], with_ev: bool) -> None:
    """Renseigne couverture, esperance et Kelly a partir des probabilites."""
    if not strategy.viable or strategy.total_stake <= 0 or not strategy.gross_by_key:
        return

    total = strategy.total_stake
    returns = {k: strategy.gross_by_key.get(k, 0.0) / total for k in OUTCOME_KEYS}

    # Issues gagnantes (retour > mise) et issues remboursees (retour ~ mise)
    prob_win = sum(probs[k] for k in OUTCOME_KEYS if returns[k] > 1.01)
    prob_refund = sum(probs[k] for k in OUTCOME_KEYS if 0.99 <= returns[k] <= 1.01)
    strategy.covered_probability = round(prob_win + prob_refund, 4)

    if not with_ev:
        return

    expected = sum(probs[k] * returns[k] for k in OUTCOME_KEYS)
    strategy.ev_pct = round((expected - 1) * 100, 2)

    # Kelly ramene a un pari a deux issues : on retire les cas de remboursement
    # (capital rendu), puis on applique la formule standard sur le reste.
    at_risk = 1 - prob_refund
    if at_risk <= 0 or prob_win <= 0:
        strategy.kelly_fraction = 0.0
        return
    win_return = sum(probs[k] * returns[k] for k in OUTCOME_KEYS if returns[k] > 1.01)
    odds_effective = win_return / prob_win
    prob_conditional = prob_win / at_risk
    if odds_effective <= 1.0:
        strategy.kelly_fraction = 0.0
        return
    kelly = (prob_conditional * odds_effective - 1) / (odds_effective - 1)
    strategy.kelly_fraction = round(max(kelly, 0.0) * at_risk, 4)


# ------------------------------------------------------------------- Plan match


@dataclass
class MatchPlan:
    """Les 3 strategies calculees pour un match, plus le contexte de lecture."""

    match: object
    bankroll: float
    strategies: list[Strategy]
    prob_home: float
    prob_draw: float
    prob_away: float
    # "winamax" = probabilites deduites des seules cotes Winamax (aucun edge
    # detectable), "marche" = consensus multi-bookmakers.
    prob_source: str = "winamax"
    fair: object | None = None

    @property
    def probs(self) -> dict[str, float]:
        return {"home": self.prob_home, "draw": self.prob_draw, "away": self.prob_away}

    @property
    def has_market_reference(self) -> bool:
        return self.prob_source == "marche"

    @property
    def best_strategy(self) -> Strategy | None:
        """Strategie a meilleure esperance, uniquement si elle est positive."""
        scored = [s for s in self.strategies if s.viable and s.ev_pct is not None]
        if not scored:
            return None
        best = max(scored, key=lambda s: s.ev_pct or 0.0)
        return best if (best.ev_pct or 0) > 0 else None

    @property
    def best_ev_pct(self) -> float | None:
        scored = [s.ev_pct for s in self.strategies if s.viable and s.ev_pct is not None]
        return max(scored) if scored else None

    @property
    def total_if_all_levels(self) -> float:
        return round(sum(s.total_stake for s in self.strategies if s.viable), 2)

    def by_level(self, level: int) -> Strategy:
        return next(s for s in self.strategies if s.level == level)


def _best_variant(match, bankroll: float, probs: dict[str, float], level: int) -> Strategy:
    """Construit la variante du niveau qui maximise l'esperance."""
    if level == 1:
        candidates = [
            level_1_double_chance(match, bankroll, key) for key in DC_COVERAGE
        ]
    elif level == 2:
        candidates = [level_2_draw_no_bet(match, bankroll, s) for s in ("home", "away")]
    else:
        candidates = [level_3_single_win(match, bankroll, k) for k in OUTCOME_KEYS]

    for candidate in candidates:
        _annotate(candidate, probs, with_ev=True)
    viable = [c for c in candidates if c.viable and c.ev_pct is not None]
    if not viable:
        return candidates[0]
    return max(viable, key=lambda c: c.ev_pct or 0.0)


def build_plan(match, bankroll: float, fair=None) -> MatchPlan:
    """Calcule les 3 niveaux de strategie pour un match.

    ``fair`` est un ``odds_api.FairOdds`` optionnel. Fourni, il remplace les
    probabilites deduites de Winamax, debloque le calcul d'esperance et permet
    de jouer une autre issue que le favori.
    """
    if fair is not None:
        probs = {
            "home": fair.prob_home,
            "draw": fair.prob_draw,
            "away": fair.prob_away,
        }
        source = "marche"
        strategies = [_best_variant(match, bankroll, probs, lvl) for lvl in (1, 2, 3)]
    else:
        p_home, p_draw, p_away = _no_vig_probabilities(
            match.odds_home, match.odds_draw, match.odds_away
        )
        probs = {"home": p_home, "draw": p_draw, "away": p_away}
        source = "winamax"
        favorite = match.favorite  # "home" ou "away"
        strategies = [
            level_1_double_chance(match, bankroll, "1x" if favorite == "home" else "x2"),
            level_2_draw_no_bet(match, bankroll, favorite),
            level_3_single_win(match, bankroll, favorite),
        ]
        for strategy in strategies:
            _annotate(strategy, probs, with_ev=False)

    return MatchPlan(
        match=match,
        bankroll=bankroll,
        strategies=strategies,
        prob_home=probs["home"],
        prob_draw=probs["draw"],
        prob_away=probs["away"],
        prob_source=source,
        fair=fair,
    )


def build_plans(
    matches, bankroll: float, fair_by_match_id: dict | None = None
) -> list[MatchPlan]:
    fair_by_match_id = fair_by_match_id or {}
    return [
        build_plan(m, bankroll, fair=fair_by_match_id.get(m.match_id)) for m in matches
    ]


# ----------------------------------------------------------------- Portefeuille


@dataclass
class Ticket:
    """Un pari retenu dans le portefeuille, avec sa mise definitive."""

    plan: MatchPlan
    strategy: Strategy
    reason: str

    @property
    def match(self):
        return self.plan.match

    @property
    def stake(self) -> float:
        return self.strategy.total_stake

    @property
    def potential_return(self) -> float:
        return round(max(self.strategy.outcomes.values()), 2)

    @property
    def potential_profit(self) -> float:
        return self.strategy.best_profit


@dataclass
class Portfolio:
    """Liste de paris a jouer et repartition des mises sur la bankroll."""

    bankroll: float
    tickets: list[Ticket] = field(default_factory=list)
    max_exposure: float = 0.0
    method: str = "fixe"  # "kelly" ou "fixe"
    skipped_no_value: int = 0
    skipped_no_reference: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def total_stake(self) -> float:
        return round(sum(t.stake for t in self.tickets), 2)

    @property
    def exposure_pct(self) -> float:
        if self.bankroll <= 0:
            return 0.0
        return round(self.total_stake / self.bankroll * 100, 2)

    @property
    def total_potential_return(self) -> float:
        return round(sum(t.potential_return for t in self.tickets), 2)

    @property
    def expected_profit(self) -> float | None:
        """Esperance totale en euros, si toutes les references sont connues."""
        if not self.tickets or any(t.strategy.ev_pct is None for t in self.tickets):
            return None
        return round(
            sum(t.stake * (t.strategy.ev_pct or 0) / 100 for t in self.tickets), 2
        )


def _allocate(
    strategy: Strategy, desired: float, bankroll: float, remaining: float
) -> float | None:
    """Mise finale d'un pari, ou None si le budget restant ne suffit pas.

    ``strategy.total_stake`` est deja la plus petite mise jouable du montage
    (minimum Winamax sur chaque jambe compris) : on ne descend jamais en
    dessous, on monte seulement jusqu'au plafond du niveau.
    """
    floor_stake = strategy.total_stake
    if floor_stake < MIN_STAKE:
        return None
    cap = max(bankroll * PCT_BY_LEVEL[strategy.level], floor_stake)
    stake = _floor_cents(min(max(desired, floor_stake), cap))
    if stake < floor_stake or stake > remaining:
        return None
    return stake


def _select_strategy(plan: MatchPlan, forced_level: int | None) -> Strategy | None:
    if forced_level:
        strategy = plan.by_level(forced_level)
        return strategy if strategy.viable else None
    viable = [s for s in plan.strategies if s.viable]
    if not viable:
        return None
    scored = [s for s in viable if s.ev_pct is not None]
    if scored:
        return max(scored, key=lambda s: s.ev_pct or 0.0)
    # Sans esperance : le niveau 1 est le moins volatil
    return plan.by_level(1) if plan.by_level(1).viable else viable[0]


def build_portfolio(
    plans: list[MatchPlan],
    bankroll: float,
    max_exposure_pct: float = DEFAULT_MAX_EXPOSURE,
    max_bets: int = 5,
    min_edge_pct: float = 0.0,
    forced_level: int | None = None,
    kelly_fraction: float = KELLY_FRACTION,
    require_value: bool = True,
) -> Portfolio:
    """Construit la liste des matchs a jouer et la mise exacte sur chacun.

    ``require_value`` a True (defaut) ne retient que les paris dont l'esperance
    depasse ``min_edge_pct``, dimensionnes par Kelly fractionne. A False, la
    liste est remplie avec les meilleurs paris disponibles et les mises sont
    reparties a plat : c'est alors une selection de confort, sans avantage
    demontre.
    """
    budget = round(bankroll * max_exposure_pct, 2)
    portfolio = Portfolio(bankroll=bankroll, max_exposure=budget)
    portfolio.skipped_no_reference = sum(1 for p in plans if not p.has_market_reference)

    candidates: list[tuple[MatchPlan, Strategy]] = []
    for plan in plans:
        strategy = _select_strategy(plan, forced_level)
        if strategy is None:
            continue
        if require_value:
            if strategy.ev_pct is None:
                continue
            if strategy.ev_pct <= min_edge_pct:
                portfolio.skipped_no_value += 1
                continue
        candidates.append((plan, strategy))

    if not candidates:
        portfolio.method = "kelly" if require_value else "fixe"
        if require_value:
            portfolio.notes.append(
                "Aucun pari à espérance positive sur ce scan. Ne rien miser est "
                "le résultat correct, pas un échec du scan. Passez en sélection "
                "« meilleurs paris » pour obtenir une liste quand même."
            )
        return portfolio

    # Tri : par esperance si connue, sinon par probabilite de couverture
    candidates.sort(
        key=lambda ps: (
            ps[1].ev_pct if ps[1].ev_pct is not None else -999,
            ps[1].covered_probability or 0,
        ),
        reverse=True,
    )
    candidates = candidates[:max_bets]

    if require_value:
        portfolio.method = "kelly"
        remaining = budget
        for plan, strategy in candidates:
            kelly_stake = bankroll * (strategy.kelly_fraction or 0.0) * kelly_fraction
            stake = _allocate(strategy, kelly_stake, bankroll, remaining)
            if stake is None:
                continue
            sized = strategy.scaled_to(stake)
            if not sized.legs or any(leg.stake < MIN_STAKE for leg in sized.legs):
                continue
            remaining = round(remaining - sized.total_stake, 2)
            books = plan.fair.books_used if plan.fair else 0
            portfolio.tickets.append(
                Ticket(
                    plan=plan,
                    strategy=sized,
                    reason=(
                        f"{sized.pick} · edge {sized.ev_pct:+.2f} % · "
                        f"Kelly {kelly_fraction:.2f}× · {books} books"
                    ),
                )
            )
            if remaining < MIN_STAKE:
                break
        if not portfolio.tickets:
            portfolio.notes.append(
                "Paris à espérance positive trouvés, mais les mises Kelly "
                "tombent sous le minimum de 1 € : augmentez la bankroll ou "
                "l'exposition."
            )
        return portfolio

    # --- Selection sans exigence de valeur : repartition a plat ---
    portfolio.method = "fixe"
    per_bet = _floor_cents(budget / len(candidates))
    remaining = budget
    for plan, strategy in candidates:
        stake = _allocate(strategy, per_bet, bankroll, remaining)
        if stake is None:
            continue
        sized = strategy.scaled_to(stake)
        if not sized.legs or any(leg.stake < MIN_STAKE for leg in sized.legs):
            continue
        remaining = round(remaining - sized.total_stake, 2)
        if sized.ev_pct is not None:
            reason = f"{sized.pick} · espérance {sized.ev_pct:+.2f} % · répartition à plat"
        else:
            reason = f"{sized.pick} · couverture {(sized.covered_probability or 0) * 100:.1f} %"
        portfolio.tickets.append(Ticket(plan=plan, strategy=sized, reason=reason))

    negative = [t for t in portfolio.tickets if (t.strategy.ev_pct or 0) <= 0]
    if negative:
        portfolio.notes.append(
            f"{len(negative)} pari(s) de cette liste ont une espérance négative : "
            "c'est une sélection de confort, pas un avantage démontré."
        )
    elif portfolio.skipped_no_reference:
        portfolio.notes.append(
            "Sans référence multi-bookmakers, aucune espérance n'est calculable : "
            "cette liste classe les paris, elle ne prouve aucun avantage."
        )
    return portfolio
