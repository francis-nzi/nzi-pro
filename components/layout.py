import streamlit as st
from contextlib import contextmanager
from typing import Callable, Optional


def page_header(title: str, subtitle: str = "", actions: Optional[Callable[[], None]] = None):
    c1, c2 = st.columns([8, 4])
    with c1:
        st.markdown(
            """
            <div class='page-header'>
              <div class='page-title'>%s</div>
              %s
            </div>
            """
            % (
                title,
                (f"<div class='page-subtitle'>{subtitle}</div>" if subtitle else ""),
            ),
            unsafe_allow_html=True,
        )
    with c2:
        if actions is not None:
            actions()


@contextmanager
def card(title: str = ""):
    st.markdown("<div class='card'>", unsafe_allow_html=True)
    if title:
        st.markdown(f"<div class='card-title'>{title}</div>", unsafe_allow_html=True)
    st.markdown("<div class='card-body'>", unsafe_allow_html=True)
    try:
        yield
    finally:
        st.markdown("</div></div>", unsafe_allow_html=True)
