
import streamlit as st
import plotly.express as px
from core.database import get_conn

def render():
    st.title("🏠 Executive Overview")
    with get_conn() as con:
        total = con.execute("SELECT COUNT(*) FROM clients WHERE status='Active'").fetchone()[0]
        ind = con.execute("SELECT COALESCE(industry,'Unspecified') AS industry, COUNT(*) AS count FROM clients WHERE status='Active' GROUP BY 1 ORDER BY 2 DESC").df()
    c1, c2 = st.columns([1,2])
    c1.metric("Active Clients", int(total))
    if not ind.empty and ind["count"].sum()>0:
        c2.plotly_chart(px.pie(ind, values="count", names="industry", title="Portfolio by Sector", hole=0.45), use_container_width=True)
    else:
        st.info("No active clients yet.")
