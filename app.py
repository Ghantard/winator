"""Interface Streamlit : cotes Winamax, detection de valeur et ticket de mises."""

from __future__ import annotations

from datetime import datetime, timezone

import streamlit as st

import auth
import odds_api
import risk_engine
import winamax_scraper
from winamax_scraper import WinamaxError

LEVEL_ICONS = {1: "🛡️", 2: "⚖️", 3: "🎯"}
LEVEL_COLORS = {1: "#1b9e5a", 2: "#d68910", 3: "#c0392b"}

st.set_page_config(
    page_title="Winator - Cotes Winamax",
    page_icon="⚽",
    layout="centered",
    initial_sidebar_state="auto",
)

if not auth.require_password():
    st.stop()

st.markdown(
    """
    <style>
      .block-container {padding-top: 1.2rem; padding-bottom: 3rem; max-width: 820px;}
      .wx-comp {font-size:.78rem; text-transform:uppercase; letter-spacing:.04em;
                opacity:.7;}
      .wx-title {font-size:1.12rem; font-weight:700; line-height:1.25;}
      .wx-when {font-size:.85rem; opacity:.75;}
      .wx-badge {display:inline-block; padding:.12rem .55rem; border-radius:999px;
                 font-size:.72rem; font-weight:700; color:#fff;}
      .wx-odds {display:flex; gap:.4rem; flex-wrap:wrap; margin:.5rem 0 .2rem;}
      .wx-odd {flex:1 1 90px; text-align:center; padding:.35rem .2rem;
               border:1px solid rgba(128,128,128,.35); border-radius:.5rem;}
      .wx-odd b {display:block; font-size:1.05rem;}
      .wx-odd span {font-size:.72rem; opacity:.7;}
      .wx-leg {border:1px solid rgba(128,128,128,.35); border-radius:.55rem;
               padding:.5rem .65rem; margin-bottom:.45rem;}
      .wx-leg-sel {font-weight:700; font-size:.95rem; margin-bottom:.35rem;}
      .wx-chips {display:flex; flex-wrap:wrap; gap:.35rem;}
      .wx-chip {font-size:.78rem; padding:.15rem .5rem; border-radius:.4rem;
                background:rgba(128,128,128,.14); white-space:nowrap;}
      .wx-sc {display:flex; justify-content:space-between; gap:.6rem;
              padding:.32rem 0; border-bottom:1px dashed rgba(128,128,128,.28);
              font-size:.88rem;}
      .wx-sc:last-child {border-bottom:none;}
      .wx-sc-lab {flex:1 1 auto;}
      .wx-sc-val {white-space:nowrap; font-variant-numeric:tabular-nums;}
      .wx-pos {color:#1b9e5a; font-weight:700;}
      .wx-neg {color:#c0392b; font-weight:700;}
      .wx-nul {opacity:.75; font-weight:700;}
      .wx-tk {display:flex; gap:.6rem; align-items:flex-start; padding:.6rem 0;
              border-bottom:1px solid rgba(128,128,128,.25);}
      .wx-tk:last-child {border-bottom:none;}
      .wx-tk-n {font-weight:700; opacity:.55; min-width:1.3rem;}
      .wx-tk-main {flex:1 1 auto; min-width:0;}
      .wx-tk-match {font-weight:700; font-size:.95rem;}
      .wx-tk-sel {font-size:.85rem; opacity:.85;}
      .wx-tk-meta {font-size:.75rem; opacity:.65; margin-top:.15rem;}
      .wx-tk-stake {text-align:right; white-space:nowrap;
                    font-variant-numeric:tabular-nums;}
      .wx-tk-stake b {font-size:1.05rem; display:block;}
      .wx-tk-stake span {font-size:.75rem; opacity:.7;}
      @media (max-width: 640px) {
        .block-container {padding-left:.7rem; padding-right:.7rem;}
        .wx-title {font-size:1rem;}
        .stTabs [data-baseweb="tab"] {padding:.35rem .5rem; font-size:.8rem;}
      }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_data(ttl=300, show_spinner=False)
def load_matches(limit: int, with_dc: bool, concurrency: int):
    """Scan Winamax, resultat mis en cache 5 minutes."""
    return winamax_scraper.scan(
        limit=limit, with_double_chance=with_dc, concurrency=concurrency
    )


@st.cache_data(ttl=600, show_spinner=False)
def load_market_reference(_matches, api_key: str, regions: str, max_leagues: int):
    """Consensus multi-bookmakers. Cache 10 min pour economiser les credits."""
    return odds_api.link_matches(
        _matches, api_key=api_key, regions=regions, max_leagues=max_leagues
    )


def euro(value: float) -> str:
    return f"{value:,.2f} €".replace(",", " ").replace(".", ",")


JOURS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"]


def format_start(dt: datetime) -> str:
    local = dt.astimezone()
    hours = (dt - datetime.now(timezone.utc)).total_seconds() / 3600
    if hours < 1:
        remaining = "dans moins d'1 h"
    elif hours < 24:
        remaining = f"dans {int(hours)} h"
    else:
        remaining = f"dans {int(hours // 24)} j"
    return f"{JOURS[local.weekday()]} {local:%d/%m à %H:%M} · {remaining}"


def odd_cell(value: float | None, label: str) -> str:
    text = f"{value:.2f}" if value else "—"
    return f'<div class="wx-odd"><b>{text}</b><span>{label}</span></div>'


def ev_html(ev_pct: float | None) -> str:
    if ev_pct is None:
        return '<span class="wx-nul">espérance inconnue</span>'
    css = "wx-pos" if ev_pct > 0 else "wx-neg"
    return f'<span class="{css}">espérance {ev_pct:+.2f} %</span>'


def render_portfolio(portfolio: risk_engine.Portfolio) -> None:
    st.subheader("🧾 Ticket du jour")

    if not portfolio.tickets:
        st.error(
            "**Aucun pari retenu.** " + (portfolio.notes[0] if portfolio.notes else "")
        )
        if portfolio.skipped_no_value:
            st.caption(
                f"{portfolio.skipped_no_value} match(s) écarté(s) : espérance "
                "négative ou sous le seuil."
            )
        return

    col1, col2, col3 = st.columns(3)
    col1.metric("Paris", len(portfolio.tickets))
    col2.metric(
        "Mise totale",
        euro(portfolio.total_stake),
        delta=f"{portfolio.exposure_pct:.1f} % bankroll",
        delta_color="off",
    )
    expected = portfolio.expected_profit
    col3.metric(
        "Espérance",
        euro(expected) if expected is not None else "inconnue",
        delta="Kelly fractionné" if portfolio.method == "kelly" else "répartition à plat",
        delta_color="off",
    )

    rows = []
    for index, ticket in enumerate(portfolio.tickets, start=1):
        match = ticket.match
        legs = " + ".join(
            f"{leg.selection} @ {leg.odds:.2f} : {euro(leg.stake)}"
            for leg in ticket.strategy.legs
        )
        rows.append(
            f'<div class="wx-tk"><div class="wx-tk-n">{index}</div>'
            f'<div class="wx-tk-main">'
            f'<div class="wx-tk-match">{match.home} — {match.away}</div>'
            f'<div class="wx-tk-sel">{LEVEL_ICONS[ticket.strategy.level]} '
            f"N{ticket.strategy.level} · {ticket.strategy.name} — {legs}</div>"
            f'<div class="wx-tk-meta">{format_start(match.start)} · '
            f"{ticket.reason}</div></div>"
            f'<div class="wx-tk-stake"><b>{euro(ticket.stake)}</b>'
            f"<span>gain {euro(ticket.potential_profit)}</span></div></div>"
        )
    st.markdown("".join(rows), unsafe_allow_html=True)

    st.caption(
        f"Budget alloué {euro(portfolio.max_exposure)} · engagé "
        f"{euro(portfolio.total_stake)} · retour si tout passe "
        f"{euro(portfolio.total_potential_return)}"
    )
    for note in portfolio.notes:
        st.warning(note)
    if portfolio.skipped_no_reference:
        st.caption(
            f"{portfolio.skipped_no_reference} match(s) sans référence "
            "multi-bookmakers, donc non éligibles au ticket."
        )


def render_strategy(strategy: risk_engine.Strategy, plan: risk_engine.MatchPlan) -> None:
    color = LEVEL_COLORS[strategy.level]
    st.markdown(
        f'<span class="wx-badge" style="background:{color}">'
        f"{LEVEL_ICONS[strategy.level]} Niveau {strategy.level} — "
        f"{strategy.risk_label}</span>",
        unsafe_allow_html=True,
    )
    st.caption(strategy.description)

    if not strategy.legs:
        st.warning("Stratégie non applicable sur ce match.")
        for note in strategy.notes:
            st.caption(f"• {note}")
        return

    st.markdown("**Mises exactes à saisir sur Winamax**")
    st.markdown(
        "".join(
            f'<div class="wx-leg"><div class="wx-leg-sel">{leg.selection}</div>'
            f'<div class="wx-chips">'
            f'<span class="wx-chip">Cote <b>{leg.odds:.2f}</b></span>'
            f'<span class="wx-chip">Mise <b>{euro(leg.stake)}</b></span>'
            f'<span class="wx-chip">Retour <b>{euro(leg.payout)}</b></span>'
            f"</div></div>"
            for leg in strategy.legs
        ),
        unsafe_allow_html=True,
    )

    col1, col2, col3 = st.columns(3)
    col1.metric("Mise totale", euro(strategy.total_stake))
    col2.metric(
        "Cote effective",
        f"{strategy.effective_odds:.2f}",
        help="Cote équivalente du montage complet, mises cumulées comprises.",
    )
    col3.metric("Gain max", euro(strategy.best_profit), delta=f"{strategy.roi_if_win:+.1f} %")

    st.markdown("**Scénarios**")
    rows = []
    for row in strategy.outcome_rows():
        net = row["Resultat net"]
        css = "wx-pos" if net > 0.004 else ("wx-neg" if net < -0.004 else "wx-nul")
        sign = "+" if net > 0 else ""
        rows.append(
            f'<div class="wx-sc"><span class="wx-sc-lab">{row["Scenario"]}</span>'
            f'<span class="wx-sc-val">{euro(row["Retour brut"])} · '
            f'<span class="{css}">{sign}{euro(net)}</span></span></div>'
        )
    st.markdown("".join(rows), unsafe_allow_html=True)

    cover = strategy.covered_probability or 0.0
    source = "consensus marché" if plan.has_market_reference else "cotes Winamax"
    st.markdown(
        f'<div class="wx-tk-meta">Pari retenu : <b>{strategy.pick}</b> · '
        f"probabilité de couverture {cover * 100:.1f} % ({source}) · "
        f"{ev_html(strategy.ev_pct)} · perte max "
        f"{euro(abs(strategy.worst_loss))}</div>",
        unsafe_allow_html=True,
    )

    for note in strategy.notes:
        st.warning(note)


def render_match(plan: risk_engine.MatchPlan) -> None:
    match = plan.match
    with st.container(border=True):
        st.markdown(
            f'<div class="wx-comp">{match.competition}</div>'
            f'<div class="wx-title">{match.home} — {match.away}</div>'
            f'<div class="wx-when">{format_start(match.start)}</div>',
            unsafe_allow_html=True,
        )
        suffix = " (est.)" if match.dc_is_estimated else ""
        st.markdown(
            '<div class="wx-odds">'
            + odd_cell(match.odds_home, "1")
            + odd_cell(match.odds_draw, "N")
            + odd_cell(match.odds_away, "2")
            + odd_cell(match.odds_1x, f"1X{suffix}")
            + odd_cell(match.odds_x2, f"X2{suffix}")
            + "</div>",
            unsafe_allow_html=True,
        )
        st.caption(
            f"Favori : **{match.favorite_name}** ({match.favorite_odds:.2f}) · "
            f"marge Winamax {match.margin * 100:.1f} %"
        )

        if plan.fair is not None:
            fair = plan.fair
            st.markdown(
                f'<div class="wx-tk-meta">Référence {fair.books_used} bookmakers '
                f"({fair.source}) · cotes équitables "
                f"{fair.fair_odds_home:.2f} / {fair.fair_odds_draw:.2f} / "
                f"{fair.fair_odds_away:.2f} · meilleur prix ailleurs "
                f"{fair.best_home:.2f} ({fair.best_book_home})</div>",
                unsafe_allow_html=True,
            )

        tabs = st.tabs(["🛡️ N1 · Très faible", "⚖️ N2 · Faible", "🎯 N3 · Modéré"])
        for level, tab in zip((1, 2, 3), tabs):
            with tab:
                render_strategy(plan.by_level(level), plan)

        st.link_button("Ouvrir le match sur Winamax", match.url, width="stretch")


# ---------------------------------------------------------------- Barre laterale
st.sidebar.title("⚙️ Paramètres")

bankroll = st.sidebar.number_input(
    "💶 Bankroll (€)",
    min_value=10.0,
    max_value=100_000.0,
    value=500.0,
    step=10.0,
    help="Capital total dédié aux paris. Toutes les mises en découlent.",
)

st.sidebar.divider()
st.sidebar.subheader("🧾 Ticket")
max_exposure_pct = (
    st.sidebar.slider(
        "Exposition totale max (% bankroll)",
        1,
        30,
        10,
        step=1,
        help="Somme maximale engagée sur l'ensemble des paris du ticket.",
    )
    / 100
)
max_bets = st.sidebar.slider("Nombre de paris max", 1, 12, 5)
selection_mode = st.sidebar.radio(
    "Sélection",
    ["Valeur uniquement", "Meilleurs paris (liste toujours remplie)"],
    help=(
        "Valeur uniquement : ne retient que les paris à espérance positive, "
        "donc souvent aucun. Meilleurs paris : classe les moins mauvais et "
        "remplit la liste, sans avantage démontré."
    ),
)
require_value = selection_mode == "Valeur uniquement"
min_edge_pct = st.sidebar.slider(
    "Edge minimum (%)",
    0.0,
    10.0,
    1.0,
    step=0.5,
    disabled=not require_value,
    help="Espérance minimale exigée pour retenir un pari.",
)
level_choice = st.sidebar.selectbox(
    "Niveau de risque du ticket",
    ["Auto (meilleure espérance)", "N1 · Double Chance", "N2 · DNB", "N3 · Victoire"],
)
forced_level = {"N1 · Double Chance": 1, "N2 · DNB": 2, "N3 · Victoire": 3}.get(
    level_choice
)

st.sidebar.divider()
st.sidebar.subheader("📊 Scan")
limit = st.sidebar.slider("Nombre de matchs à scanner", 5, 60, 20, step=5)
with_dc = st.sidebar.toggle(
    "Cotes Double Chance réelles",
    value=True,
    help="Une page Winamax par match. Plus lent, cotes 1X/X2 exactes.",
)

st.sidebar.divider()
st.sidebar.subheader("🎯 Détection de valeur")
stored_key = odds_api.get_api_key()
use_odds_api = st.sidebar.toggle(
    "Comparer 20+ bookmakers (The Odds API)",
    value=bool(stored_key),
    help=(
        "Sans cette comparaison, aucune espérance n'est calculable : la cote "
        "Winamax serait sa propre référence."
    ),
)
api_key_input = st.sidebar.text_input(
    "Clé API",
    value="",
    type="password",
    placeholder="chargée depuis secrets.toml" if stored_key else "clé the-odds-api",
    help="Laisser vide pour utiliser .streamlit/secrets.toml ou $ODDS_API_KEY.",
)
api_key = odds_api.get_api_key(api_key_input or None)
regions = st.sidebar.selectbox(
    "Régions bookmakers",
    ["eu", "eu,uk", "eu,uk,us"],
    help="Chaque région ajoutée coûte 1 crédit par ligue.",
)
max_leagues = st.sidebar.slider(
    "Ligues interrogées max",
    1,
    20,
    8,
    help="1 crédit par ligue et par région. Quota gratuit : 500 par mois.",
)

st.sidebar.divider()
st.sidebar.caption(
    "Jouer comporte des risques : endettement, isolement, dépendance. "
    "Appelez le 09 74 75 13 13 (appel non surtaxé). Interdit aux mineurs."
)

# ------------------------------------------------------------------ Corps de page
st.title("⚽ Winator")
st.caption("Cotes Winamax, comparaison multi-bookmakers et répartition des mises.")

if st.button("🚀 Scanner les opportunités Winamax", type="primary", width="stretch"):
    st.session_state["scan_requested"] = True
    load_matches.clear()
    load_market_reference.clear()

if not st.session_state.get("scan_requested"):
    st.info(
        "Réglez la bankroll et l'exposition maximale, puis lancez le scan. "
        "Le ticket indique quels matchs jouer et combien miser sur chacun."
    )
    st.stop()

with st.spinner("Récupération des cotes Winamax…"):
    try:
        matches = load_matches(limit, with_dc, 8)
    except WinamaxError as exc:
        st.error(f"Lecture des données Winamax impossible : {exc}")
        st.stop()
    except Exception as exc:
        st.error(f"Connexion à Winamax impossible : {type(exc).__name__} — {exc}")
        st.stop()

if not matches:
    st.warning("Aucun match de football à venir trouvé sur Winamax.")
    st.stop()

report = None
if use_odds_api and api_key:
    with st.spinner("Comparaison des bookmakers…"):
        report = load_market_reference(matches, api_key, regions, max_leagues)
elif use_odds_api:
    st.warning("Aucune clé The Odds API disponible : détection de valeur désactivée.")

fair_by_match_id = report.fair_by_match_id if report else {}
plans = risk_engine.build_plans(matches, bankroll, fair_by_match_id)

portfolio = risk_engine.build_portfolio(
    plans,
    bankroll=bankroll,
    max_exposure_pct=max_exposure_pct,
    max_bets=max_bets,
    min_edge_pct=min_edge_pct,
    forced_level=forced_level,
    require_value=require_value,
)

render_portfolio(portfolio)

if report:
    remaining = report.credits_remaining
    st.caption(
        f"The Odds API : {len(report.fair_by_match_id)}/{len(matches)} matchs "
        f"appariés · {len(report.leagues_queried)} ligue(s) · "
        f"{report.credits_used} crédit(s) utilisé(s)"
        + (f" · {remaining} restant(s)" if remaining is not None else "")
    )
    for error in report.errors:
        st.warning(f"The Odds API : {error}")
    if report.unmapped_competitions:
        with st.expander(
            f"{len(report.unmapped_competitions)} compétition(s) sans équivalent "
            "chez The Odds API"
        ):
            st.write(", ".join(report.unmapped_competitions))

st.divider()
st.subheader("📋 Détail des matchs")
st.caption("Cotes relevées à l'instant du scan. Elles bougent : revérifiez avant de valider.")

ticket_ids = {t.match.match_id for t in portfolio.tickets}
only_ticket = st.toggle("N'afficher que les matchs du ticket", value=False)
shown = [p for p in plans if not only_ticket or p.match.match_id in ticket_ids]
shown.sort(
    key=lambda p: (
        -(p.best_ev_pct if p.best_ev_pct is not None else -999),
        p.match.start,
    )
)

for plan in shown:
    render_match(plan)
