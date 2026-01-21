import streamlit as st
from core.database import get_conn


def render():
    st.title("📂 Job Folder")

    job_id = st.session_state.get("selected_job_id")
    if not job_id:
        st.info("No job selected.")
        if st.button("Back to Jobs"):
            st.session_state["active_page"] = "Jobs"
            st.rerun()
        return

    with get_conn() as con:
        row = con.execute(
            """
            SELECT j.job_id, j.job_number, j.title, j.job_type, j.reporting_year, j.status,
                   j.start_date, j.due_date, j.client_db_id, c.client_name
            FROM jobs j
            JOIN clients c ON c.db_id = j.client_db_id
            WHERE j.job_id=%s
            """,
            [int(job_id)],
        ).fetchone()

    if not row:
        st.warning("Job not found.")
        st.session_state["selected_job_id"] = None
        return

    (jid, job_number, title, job_type, reporting_year, status,
     start_date, due_date, client_db_id, client_name) = row

    st.caption(f"**{job_number}** — {client_name}")

    # Basic editable details
    with st.form("job_folder_form", clear_on_submit=False):
        c1, c2, c3 = st.columns(3)
        new_title = c1.text_input("Title", value=title or "")
        new_type = c2.text_input("Job Type", value=job_type or "")
        new_year = c3.number_input("Reporting Year", min_value=1990, max_value=2100, value=int(reporting_year or 2026))

        c4, c5, c6 = st.columns(3)
        new_status = c4.selectbox("Status", ["Open", "In Progress", "Complete", "Archived"],
                                  index=["Open", "In Progress", "Complete", "Archived"].index(status) if status in ["Open","In Progress","Complete","Archived"] else 0)
        new_start = c5.date_input("Start Date", value=start_date)
        new_due = c6.date_input("Due Date", value=due_date)

        notes = st.text_area("Notes / Summary", value="", placeholder="(Optional – add later)")

        b1, b2 = st.columns(2)
        save = b1.form_submit_button("Save")
        back = b2.form_submit_button("Back to Jobs")

        if back:
            st.session_state["active_page"] = "Jobs"
            st.rerun()

        if save:
            with get_conn() as con:
                con.execute(
                    """
                    UPDATE jobs
                    SET title=%s, job_type=%s, reporting_year=%s, status=%s, start_date=%s, due_date=%s
                    WHERE job_id=%s
                    """,
                    [(new_title or "").strip(), (new_type or "").strip(), int(new_year),
                     new_status, new_start, new_due, int(jid)],
                )
            st.success("Saved.")
            st.rerun()
