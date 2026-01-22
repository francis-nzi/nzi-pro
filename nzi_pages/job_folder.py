import streamlit as st
from datetime import timedelta
from core.database import get_conn


def _payment_terms():
    with get_conn() as con:
        df = con.execute(
            "SELECT term_id, name FROM payment_terms_lookup WHERE is_active=TRUE ORDER BY term_id"
        ).df()
    if df.empty:
        return [(1, "100% in advance")]
    return list(df.itertuples(index=False, name=None))  # [(term_id, name), ...]


def _datasets():
    """Return list of (dataset_id, label). Safe if datasets table not ready."""
    try:
        with get_conn() as con:
            df = con.execute(
                "SELECT dataset_id, name, year, analysis_type, country FROM datasets ORDER BY year DESC, name"
            ).df()
        if df.empty:
            return []
        out = []
        for _, r in df.iterrows():
            out.append((int(r["dataset_id"]), f'[{int(r["dataset_id"])}] {r["name"]} — {r["analysis_type"]} — {r["country"]} {int(r["year"])}'))
        return out
    except Exception:
        return []


def _ensure_crp_rows(job_id: int, default_reporting_year: int):
    """Create default rows for crp_job_details, job_plan, and job_scope_config if missing."""
    with get_conn() as con:
        # CRP details
        con.execute(
            """
            INSERT INTO crp_job_details
              (job_id, reporting_year, payment_term_id, is_benchmark, is_renewal, free_training_place)
            VALUES
              (%s, %s, 1, FALSE, FALSE, FALSE)
            ON CONFLICT (job_id) DO NOTHING
            """,
            [job_id, int(default_reporting_year)],
        )

        # Job plan
        con.execute(
            """
            INSERT INTO job_plan (job_id, override_dates)
            VALUES (%s, FALSE)
            ON CONFLICT (job_id) DO NOTHING
            """,
            [job_id],
        )

        # Scopes config
        for scope in ("Scope 1", "Scope 2", "Scope 3"):
            con.execute(
                """
                INSERT INTO job_scope_config (job_id, scope, include_scope, dataset_id, factor_method)
                VALUES (%s, %s, TRUE, NULL, NULL)
                ON CONFLICT (job_id, scope) DO NOTHING
                """,
                [job_id, scope],
            )


def _calc_plan_dates(start_date):
    if not start_date:
        return None, None, None
    return (
        start_date + timedelta(days=45),
        start_date + timedelta(days=60),
        start_date + timedelta(days=90),
    )


def render():
    st.title("📂 Job Folder — Carbon Reduction Plan")

    job_id = st.session_state.get("selected_job_id")
    if not job_id:
        st.info("No job selected.")
        if st.button("Back to Jobs"):
            st.session_state["active_page"] = "Jobs"
            st.rerun()
        return

    # Load base job
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

    # Ensure related rows exist
    _ensure_crp_rows(int(jid), int(reporting_year or st.session_state.get("working_year", 2026)))

    # Load CRP details + plan + scopes
    with get_conn() as con:
        crp = con.execute(
            """
            SELECT reporting_period_from, reporting_period_to, is_benchmark, reporting_year,
                   is_renewal, client_order_number,
                   client_contact_name, client_contact_email,
                   report_signee_name, report_signee_position,
                   payment_term_id, free_training_place,
                   num_employees, turnover_gbp, premises_size_m2,
                   vehicles_owned, vehicles_leased, premises_owned, premises_leased
            FROM crp_job_details
            WHERE job_id=%s
            """,
            [int(jid)],
        ).fetchone()

        plan = con.execute(
            """
            SELECT data_collection_due, first_draft_due, final_report_due, override_dates
            FROM job_plan
            WHERE job_id=%s
            """,
            [int(jid)],
        ).fetchone()

        scopes = con.execute(
            """
            SELECT scope, include_scope, dataset_id, factor_method
            FROM job_scope_config
            WHERE job_id=%s
            ORDER BY scope
            """,
            [int(jid)],
        ).df()

    st.caption(f"**{job_number}** — {client_name}")

    tab1, tab2, tab3 = st.tabs(["🧾 CRP Setup", "🗓️ Job Plan", "📦 Data Collection"])

    # -------------------------
    # TAB 1: CRP Setup
    # -------------------------
    with tab1:
        st.subheader("CRP reporting & admin")

        (rp_from, rp_to, is_bench, crp_year,
         is_renewal, client_order,
         contact_name, contact_email,
         signee_name, signee_pos,
         payment_term_id, free_training,
         num_emp, turnover_gbp, prem_m2,
         veh_own, veh_lease, prem_own, prem_lease) = crp

        # Payment terms dropdown
        pt = _payment_terms()
        pt_ids = [p[0] for p in pt]
        pt_labels = [p[1] for p in pt]
        try:
            pt_index = pt_ids.index(int(payment_term_id))
        except Exception:
            pt_index = 0

        with st.form("crp_setup_form", clear_on_submit=False):
            c1, c2, c3 = st.columns(3)
            new_rp_from = c1.date_input("Reporting period from", value=rp_from)
            new_rp_to = c2.date_input("Reporting period to", value=rp_to)
            new_is_bench = c3.checkbox("Benchmark year?", value=bool(is_bench))

            # Benchmark: B => reporting year still required
            new_year = st.number_input(
                "Reporting year (required even if benchmark)",
                min_value=1990,
                max_value=2100,
                value=int(crp_year),
            )

            c1, c2, c3 = st.columns(3)
            new_is_renewal = c1.checkbox("Renewal?", value=bool(is_renewal))
            new_client_order = c2.text_input("Client order number", value=client_order or "")
            new_free_training = c3.checkbox("Free training place?", value=bool(free_training))

            st.markdown("**Client contact**")
            c1, c2 = st.columns(2)
            new_contact_name = c1.text_input("Contact name", value=contact_name or "")
            new_contact_email = c2.text_input("Contact email", value=contact_email or "")

            st.markdown("**Report sign-off**")
            c1, c2 = st.columns(2)
            new_signee_name = c1.text_input("Signee name", value=signee_name or "")
            new_signee_pos = c2.text_input("Signee position", value=signee_pos or "")

            new_payment_term_label = st.selectbox("Payment terms", pt_labels, index=pt_index)
            new_payment_term_id = pt_ids[pt_labels.index(new_payment_term_label)]

            st.markdown("---")
            st.subheader("CRP business metrics")

            c1, c2, c3 = st.columns(3)
            new_num_emp = c1.number_input("Number of employees", min_value=0, value=int(num_emp or 0))
            new_turnover = c2.number_input("Turnover (£)", min_value=0.0, value=float(turnover_gbp or 0.0))
            new_prem_m2 = c3.number_input("Premises size (m²)", min_value=0.0, value=float(prem_m2 or 0.0))

            c1, c2, c3, c4 = st.columns(4)
            new_veh_own = c1.number_input("Vehicles owned", min_value=0, value=int(veh_own or 0))
            new_veh_lease = c2.number_input("Vehicles leased", min_value=0, value=int(veh_lease or 0))
            new_prem_own = c3.number_input("Premises owned", min_value=0, value=int(prem_own or 0))
            new_prem_lease = c4.number_input("Premises leased", min_value=0, value=int(prem_lease or 0))

            b1, b2 = st.columns(2)
            save = b1.form_submit_button("Save CRP details")
            back = b2.form_submit_button("Back to Jobs")

            if back:
                st.session_state["active_page"] = "Jobs"
                st.rerun()

            if save:
                # Update base jobs table too (keep reporting_year aligned)
                with get_conn() as con:
                    con.execute(
                        """
                        UPDATE jobs
                        SET reporting_year=%s
                        WHERE job_id=%s
                        """,
                        [int(new_year), int(jid)],
                    )

                    con.execute(
                        """
                        UPDATE crp_job_details
                        SET reporting_period_from=%s,
                            reporting_period_to=%s,
                            is_benchmark=%s,
                            reporting_year=%s,
                            is_renewal=%s,
                            client_order_number=%s,
                            client_contact_name=%s,
                            client_contact_email=%s,
                            report_signee_name=%s,
                            report_signee_position=%s,
                            payment_term_id=%s,
                            free_training_place=%s,
                            num_employees=%s,
                            turnover_gbp=%s,
                            premises_size_m2=%s,
                            vehicles_owned=%s,
                            vehicles_leased=%s,
                            premises_owned=%s,
                            premises_leased=%s,
                            updated_at=NOW()
                        WHERE job_id=%s
                        """,
                        [
                            new_rp_from, new_rp_to,
                            bool(new_is_bench), int(new_year),
                            bool(new_is_renewal),
                            (new_client_order or "").strip() or None,
                            (new_contact_name or "").strip() or None,
                            (new_contact_email or "").strip() or None,
                            (new_signee_name or "").strip() or None,
                            (new_signee_pos or "").strip() or None,
                            int(new_payment_term_id),
                            bool(new_free_training),
                            int(new_num_emp) if new_num_emp is not None else None,
                            float(new_turnover) if new_turnover is not None else None,
                            float(new_prem_m2) if new_prem_m2 is not None else None,
                            int(new_veh_own) if new_veh_own is not None else None,
                            int(new_veh_lease) if new_veh_lease is not None else None,
                            int(new_prem_own) if new_prem_own is not None else None,
                            int(new_prem_lease) if new_prem_lease is not None else None,
                            int(jid),
                        ],
                    )
                st.success("Saved.")
                st.rerun()

    # -------------------------
    # TAB 2: Job Plan
    # -------------------------
    with tab2:
        st.subheader("Milestones")
        data_due, draft_due, final_due, override_dates = plan

        # Compute defaults from current job start date
        def_data, def_draft, def_final = _calc_plan_dates(start_date)

        with st.form("job_plan_form", clear_on_submit=False):
            c1, c2, c3 = st.columns(3)
            st.caption("Default: Data collection +45d, First draft +60d, Final report +90d (from Job Start Date)")

            new_override = st.checkbox("Override milestone dates", value=bool(override_dates))

            if not new_override:
                c1.date_input("Data collection due", value=def_data or data_due, disabled=True)
                c2.date_input("First draft due", value=def_draft or draft_due, disabled=True)
                c3.date_input("Final report due", value=def_final or final_due, disabled=True)

                # We'll save computed values
                save_data, save_draft, save_final = def_data, def_draft, def_final
            else:
                # Manual entries
                save_data = c1.date_input("Data collection due", value=data_due or def_data)
                save_draft = c2.date_input("First draft due", value=draft_due or def_draft)
                save_final = c3.date_input("Final report due", value=final_due or def_final)

            b1, b2 = st.columns(2)
            save = b1.form_submit_button("Save milestones")
            back = b2.form_submit_button("Back to Jobs")

            if back:
                st.session_state["active_page"] = "Jobs"
                st.rerun()

            if save:
                with get_conn() as con:
                    con.execute(
                        """
                        UPDATE job_plan
                        SET data_collection_due=%s,
                            first_draft_due=%s,
                            final_report_due=%s,
                            override_dates=%s,
                            updated_at=NOW()
                        WHERE job_id=%s
                        """,
                        [save_data, save_draft, save_final, bool(new_override), int(jid)],
                    )
                st.success("Saved.")
                st.rerun()

    # -------------------------
    # TAB 3: Data Collection (Scopes + datasets)
    # -------------------------
    with tab3:
        st.subheader("Scopes & dataset selection")

        ds = _datasets()
        ds_ids = [d[0] for d in ds]
        ds_labels = [d[1] for d in ds]
        methods = ["Activity", "Spend", "Custom"]

        if scopes.empty:
            st.info("No scope config rows found. (They will be auto-created on load.)")
        else:
            with st.form("scope_cfg_form", clear_on_submit=False):
                for scope_name in ["Scope 1", "Scope 2", "Scope 3"]:
                    row = scopes[scopes["scope"] == scope_name]
                    if row.empty:
                        include = True
                        dataset_id = None
                        method = None
                    else:
                        include = bool(row.iloc[0]["include_scope"])
                        dataset_id = row.iloc[0]["dataset_id"]
                        method = row.iloc[0]["factor_method"]

                    st.markdown(f"#### {scope_name}")
                    c1, c2, c3 = st.columns([1.2, 4, 1.5])
                    new_include = c1.checkbox("Include", value=include, key=f"inc_{scope_name}")

                    # Dataset dropdown
                    if ds:
                        # index: blank + datasets
                        options = ["(None)"] + ds_labels
                        if dataset_id is None:
                            idx = 0
                        else:
                            try:
                                idx = 1 + ds_ids.index(int(dataset_id))
                            except Exception:
                                idx = 0
                        pick = c2.selectbox("Dataset", options, index=idx, key=f"ds_{scope_name}")
                        new_dataset_id = None if pick == "(None)" else ds_ids[ds_labels.index(pick)]
                    else:
                        c2.info("No datasets found yet (Admin → Datasets & Factors).")
                        new_dataset_id = None

                    # Method
                    if method in methods:
                        midx = methods.index(method)
                    else:
                        midx = 0
                    new_method = c3.selectbox("Method", methods, index=midx, key=f"m_{scope_name}")

                    st.markdown("<div class='hr'></div>", unsafe_allow_html=True)

                save = st.form_submit_button("Save scope configuration")
                if save:
                    with get_conn() as con:
                        for scope_name in ["Scope 1", "Scope 2", "Scope 3"]:
                            inc = bool(st.session_state.get(f"inc_{scope_name}", True))
                            # Dataset selection stored via the selectbox key
                            ds_pick = st.session_state.get(f"ds_{scope_name}")
                            if ds_pick and ds_pick != "(None)" and ds_pick in ds_labels:
                                dsid = ds_ids[ds_labels.index(ds_pick)]
                            else:
                                dsid = None
                            meth = st.session_state.get(f"m_{scope_name}", "Activity")

                            con.execute(
                                """
                                UPDATE job_scope_config
                                SET include_scope=%s, dataset_id=%s, factor_method=%s
                                WHERE job_id=%s AND scope=%s
                                """,
                                [inc, dsid, meth, int(jid), scope_name],
                            )
                    st.success("Saved.")
                    st.rerun()

        st.caption("Next: we’ll re-enable Scope 1/2/3 data entry pages and filter factor searches by the selected dataset per scope.")
