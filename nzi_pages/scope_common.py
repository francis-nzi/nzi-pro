import streamlit as st
from core.database import get_conn


def _col_exists(table: str, col: str) -> bool:
    with get_conn() as con:
        r = con.execute(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name=%s AND column_name=%s
            """,
            [table, col],
        ).fetchone()
    return bool(r)


def _get_job_context(job_id: int):
    with get_conn() as con:
        row = con.execute(
            """
            SELECT j.job_number, j.title, j.start_date, j.status, c.client_name
            FROM jobs j
            JOIN clients c ON c.db_id = j.client_db_id
            WHERE j.job_id=%s
            """,
            [int(job_id)],
        ).fetchone()
    return row


def _get_scope_config(job_id: int, scope: str):
    with get_conn() as con:
        r = con.execute(
            """
            SELECT include_scope, dataset_id, factor_method
            FROM job_scope_config
            WHERE job_id=%s AND scope=%s
            """,
            [int(job_id), scope],
        ).fetchone()
    if not r:
        return True, None, "Activity"
    return bool(r[0]), r[1], r[2] or "Activity"


def _search_factors(dataset_id, scope: str, query: str):
    """
    Best-effort factor lookup search. Works even if factor_lookup schema varies.
    We check columns and build a safe query.
    """
    if not query:
        return []

    has_dataset = _col_exists("factor_lookup", "dataset_id")
    has_scope = _col_exists("factor_lookup", "scope")
    has_category = _col_exists("factor_lookup", "category")
    has_subcat = _col_exists("factor_lookup", "subcategory")
    has_unit = _col_exists("factor_lookup", "unit")
    has_factor = _col_exists("factor_lookup", "factor")
    has_name = _col_exists("factor_lookup", "name")  # some schemas use name

    # Build select list safely
    select_cols = ["factor_id"]
    if has_name:
        select_cols.append("name")
    if has_category:
        select_cols.append("category")
    if has_subcat:
        select_cols.append("subcategory")
    if has_unit:
        select_cols.append("unit")
    if has_factor:
        select_cols.append("factor")

    select_sql = ", ".join(select_cols)

    # Build where clauses
    wh = []
    params = []

    if has_dataset and dataset_id is not None:
        wh.append("dataset_id=%s")
        params.append(int(dataset_id))

    if has_scope:
        wh.append("scope=%s")
        params.append(scope)

    # Search text across name/category/subcategory
    like = f"%{query.strip()}%"
    search_terms = []
    if has_name:
        search_terms.append("name ILIKE %s")
        params.append(like)
    if has_category:
        search_terms.append("category ILIKE %s")
        params.append(like)
    if has_subcat:
        search_terms.append("subcategory ILIKE %s")
        params.append(like)

    if search_terms:
        wh.append("(" + " OR ".join(search_terms) + ")")

    where_sql = ("WHERE " + " AND ".join(wh)) if wh else ""
    sql = f"SELECT {select_sql} FROM factor_lookup {where_sql} ORDER BY factor_id DESC LIMIT 200"

    try:
        with get_conn() as con:
            df = con.execute(sql, params).df()
    except Exception:
        return []

    results = []
    for _, r in df.iterrows():
        fid = int(r.get("factor_id"))
        name = r.get("name") if "name" in df.columns else None
        cat = r.get("category") if "category" in df.columns else None
        sub = r.get("subcategory") if "subcategory" in df.columns else None
        unit = r.get("unit") if "unit" in df.columns else None
        fac = r.get("factor") if "factor" in df.columns else None

        parts = []
        if name:
            parts.append(str(name))
        if cat:
            parts.append(str(cat))
        if sub:
            parts.append(str(sub))
        if unit:
            parts.append(f"unit={unit}")
        if fac is not None:
            parts.append(f"factor={fac}")

        label = f"[{fid}] " + " | ".join(parts) if parts else f"[{fid}] factor"
        results.append((fid, label, fac, unit, cat, sub))
    return results


def _list_entries(job_id: int, scope: str, include_archived: bool):
    where = "" if include_archived else "AND is_archived=FALSE"
    with get_conn() as con:
        df = con.execute(
            f"""
            SELECT entry_id, category, subcategory, description, amount, unit,
                   factor_id, factor_value, tco2e, method, notes, updated_at
            FROM crp_scope_entries
            WHERE job_id=%s AND scope=%s
            {where}
            ORDER BY entry_id DESC
            """,
            [int(job_id), scope],
        ).df()
    return df


def render_scope(scope: str):
    job_id = st.session_state.get("selected_job_id")
    if not job_id:
        st.info("No job selected.")
        if st.button("Back to Jobs"):
            st.session_state["active_page"] = "Jobs"
            st.rerun()
        return

    ctx = _get_job_context(int(job_id))
    if not ctx:
        st.warning("Job not found.")
        return

    job_number, title, start_date, status, client_name = ctx
    st.title(f"📦 {scope} — Data Entry")
    st.caption(f"**{job_number}** — {client_name} — {title or ''}")

    inc, dataset_id, factor_method = _get_scope_config(int(job_id), scope)
    if not inc:
        st.warning(f"{scope} is disabled for this job. Enable it in Job Folder → Data Collection.")
        if st.button("Back to Job Folder"):
            st.session_state["active_page"] = "Job Folder"
            st.rerun()
        return

    top = st.columns([1, 1, 2])
    if top[0].button("← Back to Job Folder"):
        st.session_state["active_page"] = "Job Folder"
        st.rerun()
    top[1].metric("Dataset ID", "" if dataset_id is None else str(dataset_id))
    top[2].write(f"Method default: **{factor_method or 'Activity'}**")

    st.markdown("---")

    st.session_state.setdefault("edit_entry_id", None)

    # -------------------------
    # Add entry
    # -------------------------
    with st.expander("➕ Add entry", expanded=True):
        with st.form(f"add_{scope}_entry", clear_on_submit=True):
            c1, c2, c3 = st.columns(3)
            method = c1.selectbox("Method", ["Activity", "Spend", "Custom"], index=0)
            category = c2.text_input("Category")
            subcategory = c3.text_input("Subcategory")

            desc = st.text_input("Description")

            c4, c5, c6 = st.columns(3)
            amount = c4.number_input("Amount", min_value=0.0, value=0.0)
            unit = c5.text_input("Unit (e.g., kWh, miles, £)", value="")
            tco2e_override = c6.number_input("tCO₂e (override, optional)", min_value=0.0, value=0.0)

            st.markdown("**Emission factor (optional)**")
            q = st.text_input("Search factors", placeholder="Type to search factor lookup…")
            factors = _search_factors(dataset_id, scope, q) if q else []
            factor_choice = None
            factor_value = None
            if factors:
                labels = [f[1] for f in factors]
                pick = st.selectbox("Matching factors", labels)
                factor_choice = factors[labels.index(pick)][0]
                factor_value = factors[labels.index(pick)][2]
            else:
                st.caption("No factor selected. You can enter custom tCO₂e or add factors/datasets later.")

            notes = st.text_area("Notes", height=80)

            if st.form_submit_button("Save entry"):
                # Compute tco2e if not overridden
                tco2e = float(tco2e_override) if tco2e_override and tco2e_override > 0 else None
                if tco2e is None and factor_value is not None:
                    try:
                        tco2e = float(amount) * float(factor_value)
                    except Exception:
                        tco2e = None

                with get_conn() as con:
                    con.execute(
                        """
                        INSERT INTO crp_scope_entries
                          (job_id, scope, category, subcategory, description, amount, unit,
                           dataset_id, factor_id, factor_value, tco2e, method, notes, updated_at)
                        VALUES
                          (%s, %s, %s, %s, %s, %s, %s,
                           %s, %s, %s, %s, %s, %s, NOW())
                        """,
                        [
                            int(job_id), scope,
                            (category or "").strip() or None,
                            (subcategory or "").strip() or None,
                            (desc or "").strip() or None,
                            float(amount) if amount is not None else None,
                            (unit or "").strip() or None,
                            int(dataset_id) if dataset_id is not None else None,
                            int(factor_choice) if factor_choice is not None else None,
                            float(factor_value) if factor_value is not None else None,
                            float(tco2e) if tco2e is not None else None,
                            method,
                            (notes or "").strip() or None,
                        ],
                    )
                st.success("Saved.")
                st.rerun()

    # -------------------------
    # Entries table
    # -------------------------
    st.markdown("### Entries")
    show_archived = st.checkbox("Show archived entries", value=False, key=f"show_arch_{scope}")
    df = _list_entries(int(job_id), scope, include_archived=show_archived)

    if df.empty:
        st.info("No entries yet.")
        return

    h = st.columns([2, 2, 3, 1, 1, 1, 1, 1])
    h[0].markdown("**Category**")
    h[1].markdown("**Subcategory**")
    h[2].markdown("**Description**")
    h[3].markdown("**Amount**")
    h[4].markdown("**Unit**")
    h[5].markdown("**tCO₂e**")
    h[6].markdown("**Edit**")
    h[7].markdown("**Archive**")

    for _, r in df.iterrows():
        eid = int(r["entry_id"])
        c = st.columns([2, 2, 3, 1, 1, 1, 1, 1])

        c[0].write(r.get("category") or "")
        c[1].write(r.get("subcategory") or "")
        c[2].write(r.get("description") or "")
        c[3].write("" if r.get("amount") is None else r.get("amount"))
        c[4].write(r.get("unit") or "")
        c[5].write("" if r.get("tco2e") is None else r.get("tco2e"))

        if c[6].button("✏️", key=f"edit_{scope}_{eid}"):
            st.session_state["edit_entry_id"] = eid
            st.rerun()

        if c[7].button("🗄️", key=f"arch_{scope}_{eid}"):
            with get_conn() as con:
                con.execute(
                    "UPDATE crp_scope_entries SET is_archived=TRUE, updated_at=NOW() WHERE entry_id=%s",
                    [eid],
                )
            st.toast("Archived")
            st.rerun()

    # -------------------------
    # Edit panel
    # -------------------------
    edit_id = st.session_state.get("edit_entry_id")
    if edit_id:
        st.markdown("---")
        st.markdown("### Edit entry")

        with get_conn() as con:
            row = con.execute(
                """
                SELECT entry_id, category, subcategory, description, amount, unit,
                       factor_id, factor_value, tco2e, method, notes
                FROM crp_scope_entries
                WHERE entry_id=%s
                """,
                [int(edit_id)],
            ).fetchone()

        if not row:
            st.session_state["edit_entry_id"] = None
            st.warning("Entry not found.")
            return

        (eid, category, subcategory, description, amount, unit,
         factor_id, factor_value, tco2e, method, notes) = row

        with st.form(f"edit_{scope}_{eid}", clear_on_submit=False):
            c1, c2, c3 = st.columns(3)
            new_method = c1.selectbox("Method", ["Activity", "Spend", "Custom"], index=["Activity", "Spend", "Custom"].index(method or "Activity"))
            new_cat = c2.text_input("Category", value=category or "")
            new_sub = c3.text_input("Subcategory", value=subcategory or "")
            new_desc = st.text_input("Description", value=description or "")

            c4, c5, c6 = st.columns(3)
            new_amount = c4.number_input("Amount", min_value=0.0, value=float(amount or 0.0))
            new_unit = c5.text_input("Unit", value=unit or "")
            new_tco2e = c6.number_input("tCO₂e", min_value=0.0, value=float(tco2e or 0.0))

            new_notes = st.text_area("Notes", value=notes or "", height=80)

            b1, b2 = st.columns(2)
            save = b1.form_submit_button("Save")
            cancel = b2.form_submit_button("Cancel")

            if cancel:
                st.session_state["edit_entry_id"] = None
                st.rerun()

            if save:
                with get_conn() as con:
                    con.execute(
                        """
                        UPDATE crp_scope_entries
                        SET category=%s, subcategory=%s, description=%s,
                            amount=%s, unit=%s,
                            tco2e=%s, method=%s, notes=%s,
                            updated_at=NOW()
                        WHERE entry_id=%s
                        """,
                        [
                            (new_cat or "").strip() or None,
                            (new_sub or "").strip() or None,
                            (new_desc or "").strip() or None,
                            float(new_amount) if new_amount is not None else None,
                            (new_unit or "").strip() or None,
                            float(new_tco2e) if new_tco2e is not None else None,
                            new_method,
                            (new_notes or "").strip() or None,
                            int(eid),
                        ],
                    )
                st.success("Updated.")
                st.session_state["edit_entry_id"] = None
                st.rerun()
