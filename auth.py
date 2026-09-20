"""Verrou d'acces par mot de passe pour le deploiement public.

Une app deployee sur Streamlit Community Cloud est accessible a quiconque
connait son URL. Sans verrou, n'importe quel visiteur consomme les credits
The Odds API du proprietaire. Ce module bloque l'app tant que le mot de passe
attendu n'est pas fourni.

Le mot de passe vient de ``st.secrets["APP_PASSWORD"]`` ou de la variable
d'environnement ``APP_PASSWORD``. S'il n'est defini nulle part, l'app reste
ouverte : c'est le cas normal en local, signale par un avertissement.
"""

from __future__ import annotations

import hmac
import os

import streamlit as st

SESSION_KEY = "auth_ok"


def _expected_password() -> str | None:
    try:
        value = st.secrets.get("APP_PASSWORD")
        if value:
            return str(value)
    except Exception:
        pass
    value = os.environ.get("APP_PASSWORD")
    return value or None


def require_password() -> bool:
    """Renvoie True si l'acces est autorise, sinon affiche le formulaire.

    L'appelant doit arreter le script (``st.stop()``) quand False est renvoye.
    """
    expected = _expected_password()

    if not expected:
        st.sidebar.warning(
            "Aucun mot de passe défini : l'app est ouverte à qui connaît l'URL. "
            "Définissez APP_PASSWORD avant tout déploiement public.",
            icon="⚠️",
        )
        return True

    if st.session_state.get(SESSION_KEY):
        return True

    st.title("⚽ Winator")
    st.caption("Accès réservé.")
    with st.form("login"):
        password = st.text_input("Mot de passe", type="password")
        submitted = st.form_submit_button("Entrer", width="stretch")
    if submitted:
        if hmac.compare_digest(password, expected):
            st.session_state[SESSION_KEY] = True
            st.rerun()
        else:
            st.error("Mot de passe incorrect.")
    return False
