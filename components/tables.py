
import streamlit as st
import pandas as pd
from core.constants import DISPLAY_NAMES

def prettify(df: pd.DataFrame) -> pd.DataFrame:
    return df.rename(columns={k:v for k,v in DISPLAY_NAMES.items() if k in df.columns})

def _init_pager_state(key: str, default_size: int = 50):
    st.session_state.setdefault(f"{key}_psize", default_size)
    st.session_state.setdefault(f"{key}_page", 0)
    return f"{key}_psize", f"{key}_page"

def _pager(df_len: int, key: str, where: str):
    ps_key, pg_key = _init_pager_state(key)
    psize = st.session_state[ps_key]
    page = st.session_state[pg_key]
    total_pages = max(1, (df_len + psize - 1)//psize)

    cols = st.columns([6,3,3])
    with cols[0]: st.caption(f"{df_len:,} rows total")
    with cols[1]:
        new_size = st.selectbox("Rows", [50,100,150,200], index=[50,100,150,200].index(psize), key=f"{key}_psel_{where}")
        if new_size != psize:
            st.session_state[ps_key] = new_size
            st.session_state[pg_key] = 0
            psize, page = new_size, 0
            total_pages = max(1, (df_len + psize - 1)//psize)
    with cols[2]:
        c1, c2, c3 = st.columns([1,2,1])
        if c1.button("◀", key=f"{key}_prev_{where}") and page>0:
            page -= 1; st.session_state[pg_key] = page
        c2.markdown(f"<div style='text-align:center'>Page {page+1} of {total_pages}</div>", unsafe_allow_html=True)
        if c3.button("▶", key=f"{key}_next_{where}") and page<total_pages-1:
            page += 1; st.session_state[pg_key] = page
    start = page*psize; end = min(start+psize, df_len)
    st.caption(f"Showing {start+1:,}–{end:,}")
    return start, end

def table_with_pager(df: pd.DataFrame, title: str, key: str):
    st.markdown(f"#### {title}")
    if df is None or df.empty:
        st.info("No rows.")
        return
    start, end = _pager(len(df), key, "top")
    st.dataframe(prettify(df.iloc[start:end].copy()), use_container_width=True)
    _pager(len(df), key, "bottom")
