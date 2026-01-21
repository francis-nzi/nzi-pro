import streamlit as st
from core.database import get_conn


def _job_types():
    with get_conn() as con:
        df = con.execute("SELECT name FROM job_types WHERE is_active=TRUE ORDER BY name").df()
        return df["name"].tolist() if not df.empty else ["CRP", "Consultancy", "LCA", "Training"]


def _subjects():
    with get_conn() as con:
        df = con.execute("SELECT name FROM time_subjects WHERE is_active=TRUE ORDER BY name").df()
        return df["name"].tolist() if not df.empty else ["Research", "Data Collection", "Analysis", "Reporting"]


def _clients():
    with get_conn() as con:
        return con.execute(
            "SELECT db_id, client_name FROM clients WHERE status='Active' ORDER BY client_name"
        ).df()


def _jobs_df(include_archived: bool = False):
    where = "" if include_archived else "WHERE j.status <> 'Archived'"
    with get_conn() as con:
        return con.execute(
            f"""
            SELECT j.job_id, j.job_number, c.client_name, j.job_type, j.title,
                   j.reporting_year, j.status, j.start_date, j.due_date
            FROM jobs j
            JOIN clients c ON c.db_id = j.client_db_id
            {where}
            ORDER BY j.created_at DESC
            """
        ).df()


def render():
    st.title("🧵 Jobs Register")

    st.session_state.setdefault("edit_job_id", None)

    # -------------------------
    # Add Job
    # -------------------------
    with st.expander("➕ Add Job", expanded=False):
        cdf = _clients()
        if cdf.empty:
            st.warning("Create a client first.")
        else:
            with st.form("add_job_form", clear_on_submit=True):
                c1, c2, c3 = st.columns(3)
                client_name = c1.selectbox("Client *", cdf["client_name"].tolist())
                jtype = c2.selectbox("Job Type *", _job_types())
                year = c3.number_input(
                    "Reporting Year *",
                    min_value=1990,
                    max_value=2100,
                    value=st.session_state.get("working_year", 2026),
                )

                title = st.text_input("Job Title/Description", "")
                c4, c5 = st.columns(2)
                start = c4.date_input("Start Date")
                due = c5.date_input("Due Date")

                if st.form_submit_button("Create Job"):
                    client_id = int(cdf.loc[cdf["client_name"] == client_name, "db_id"].iloc[0])

                    # Insert first to get job_id (Postgres IDENTITY/SERIAL)
                    with get_conn() as con:
                        row = con.execute(
                            """
                            INSERT INTO jobs
                              (client_db_id, job_type, job_number, title, reporting_year, status, start_date, due_date)
                            VALUES
                              (%s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING job_id
                            """,
                            [
                                client_id,
                                jtype,
                                "PENDING",  # will update to NZI-YYYY-XXXX once we know job_id
                                (title or "").strip() or "Untitled",
                                int(year),
                                "Open",
                                start,
                                due,
                            ],
                        ).fetchone()

                        job_id = int(row[0])
                        job_number = f"NZI-{int(year)}-{job_id:04d}"

                        con.execute(
                            "UPDATE jobs SET job_number=%s WHERE job_id=%s",
                            [job_number, job_id],
                        )

                    st.success(f"Job {job_number} created.")
                    st.rerun()

    # -------------------------
    # Jobs list + row actions
    # -------------------------
    st.markdown("### Jobs")
    show_archived = st.checkbox("Show archived", value=False)
    df = _jobs_df(include_archived=show_archived)

    if df.empty:
        st.info("No jobs yet.")
    else:
        # Header
        h = st.columns([2, 3, 3, 2, 2, 1, 1, 1])
        h[0].markdown("**Job**")
        h[1].markdown("**Client**")
        h[2].markdown("**Title**")
        h[3].markdown("**Type**")
        h[4].markdown("**Status**")
        h[5].markdown("**Open**")
        h[6].markdown("**Edit**")
        h[7].markdown("**Archive**")

for _, r in df.iterrows():
    jid = int(r["job_id"])

    # Row MUST match header column count
    c = st.columns([2, 3, 3, 2, 2, 1, 1, 1])
    c[0].write(r["job_number"])
    c[1].write(r["client_name"])
    c[2].write(r["title"])
    c[3].write(r["job_type"])
    c[4].write(r["status"])

    if c[5].button("📂", key=f"job_open_{jid}"):
        st.session_state["selected_job_id"] = jid
        st.session_state["active_page"] = "Job Folder"
        st.rerun()

    if c[6].button("✏️", key=f"job_edit_{jid}"):
        st.session_state["edit_job_id"] = jid
        st.rerun()

    if c[7].button("🗄️", key=f"job_arch_{jid}", disabled=(str(r["status"]) == "Archived")):
        with get_conn() as con:
            con.execute("UPDATE jobs SET status='Archived' WHERE job_id=%s", [jid])
        st.toast("Job archived")
        st.rerun()



        for _, r in df.iterrows():
            jid = int(r["job_id"])
            c = st.columns([2, 3, 3, 2, 2, 1, 1])
            c[0].write(r["job_number"])
            c[1].write(r["client_name"])
            c[2].write(r["title"])
            c[3].write(r["job_type"])
            c[4].write(r["status"])

            if c[5].button("📂", key=f"job_open_{jid}"):
                st.session_state["selected_job_id"] = jid
                st.session_state["active_page"] = "Job Folder"
                st.rerun()

            if c[6].button("✏️", key=f"job_edit_{jid}"):
                st.session_state["edit_job_id"] = jid
                st.rerun()

            if c[7].button("🗄️", key=f"job_arch_{jid}", disabled=(str(r["status"]) == "Archived")):
                with get_conn() as con:
                    con.execute("UPDATE jobs SET status='Archived' WHERE job_id=%s", [jid])
                st.toast("Job archived")
                st.rerun()

    # -------------------------
    # Inline edit panel
    # -------------------------
    edit_id = st.session_state.get("edit_job_id")
    if edit_id:
        st.markdown("---")
        st.markdown("### Edit Job")

        with get_conn() as con:
            row = con.execute(
                """
                SELECT job_id, job_type, title, reporting_year, status, start_date, due_date
                FROM jobs
                WHERE job_id=%s
                """,
                [int(edit_id)],
            ).fetchone()

        if not row:
            st.warning("Job not found.")
            st.session_state["edit_job_id"] = None
        else:
            job_id, job_type, title, reporting_year, status, start_date, due_date = row
            types = _job_types()
            statuses = ["Open", "In Progress", "Complete", "Archived"]

            with st.form("edit_job_form", clear_on_submit=False):
                c1, c2, c3 = st.columns(3)
                new_type = c1.selectbox("Job Type", types, index=types.index(job_type) if job_type in types else 0)
                new_year = c2.number_input("Reporting Year", min_value=1990, max_value=2100, value=int(reporting_year or 2026))
                new_status = c3.selectbox("Status", statuses, index=statuses.index(status) if status in statuses else 0)

                new_title = st.text_input("Title", value=title or "")
                c4, c5 = st.columns(2)
                new_start = c4.date_input("Start Date", value=start_date)
                new_due = c5.date_input("Due Date", value=due_date)

                b1, b2 = st.columns(2)
                save = b1.form_submit_button("Save")
                cancel = b2.form_submit_button("Cancel")

                if cancel:
                    st.session_state["edit_job_id"] = None
                    st.rerun()

                if save:
                    with get_conn() as con:
                        con.execute(
                            """
                            UPDATE jobs
                            SET job_type=%s, title=%s, reporting_year=%s, status=%s, start_date=%s, due_date=%s
                            WHERE job_id=%s
                            """,
                            [
                                new_type,
                                (new_title or "").strip(),
                                int(new_year),
                                new_status,
                                new_start,
                                new_due,
                                int(edit_id),
                            ],
                        )
                    st.success("Saved.")
                    st.session_state["edit_job_id"] = None
                    st.rerun()

    # -------------------------
    # Time logging (no next_id; assume time_id is IDENTITY/SERIAL)
    # -------------------------
    st.markdown("---")
    st.markdown("### ⏱ Log Time")

    with st.form("time_log_form", clear_on_submit=True):
        jdf = _jobs_df(include_archived=False)
        if jdf.empty:
            st.info("No jobs yet.")
            st.form_submit_button("Save Time Entry", disabled=True)
        else:
            jsel = st.selectbox("Job", jdf["job_number"] + " — " + jdf["client_name"])
            subj = st.selectbox("Subject", _subjects())
            wdate = st.date_input("Date")
            hours = st.number_input("Hours", min_value=0, max_value=24, value=1)
            quarter = st.selectbox("Quarter hour", [0, 15, 30, 45], index=0)
            minutes = int(hours * 60 + quarter)
            notes = st.text_area("Notes")

            if st.form_submit_button("Save Time Entry"):
                jid = int(jdf.loc[(jdf["job_number"] + " — " + jdf["client_name"]) == jsel, "job_id"].iloc[0])

                # current_user_email() is in core.auth in your codebase; import locally to avoid import cycles
                from core.auth import current_user_email
                user_id = current_user_email()

                with get_conn() as con:
                    con.execute(
                        """
                        INSERT INTO time_logs (job_id, user_id, subject, work_date, minutes, notes)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        [jid, user_id, subj, wdate, minutes, notes or None],
                    )

                st.success("Time logged.")
                st.rerun()

    with get_conn() as con:
        logs = con.execute(
            """
            SELECT tl.time_id, tl.work_date, tl.minutes, tl.subject, tl.notes,
                   j.job_number, c.client_name
            FROM time_logs tl
            JOIN jobs j ON j.job_id = tl.job_id
            JOIN clients c ON c.db_id = j.client_db_id
            ORDER BY tl.work_date DESC, tl.time_id DESC
            """
        ).df()

    if not logs.empty:
        logs["hours"] = (logs["minutes"] / 60).round(2)

    # If you still want paging here, keep your existing table_with_pager import and use it.
    try:
        from components.tables import table_with_pager
        table_with_pager(logs, "Time Logs", key="time_logs_tbl")
    except Exception:
        st.dataframe(logs, use_container_width=True)
