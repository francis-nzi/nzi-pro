import streamlit as st
from datetime import datetime
from core.database import get_conn


def _ghg_unit_default(u: str | None) -> str:
    s = (u or "").strip()
    return s or "kgCO2e"


def _kg_to_t(value: float) -> float:
    return value / 1000.0


def _to_tco2e(amount: float, factor: float, ghg_unit: str | None) -> float:
    """Convert amount*factor to tonnes CO2e based on ghg_unit."""
    ghg = (_ghg_unit_default(ghg_unit)).replace(" ", "").lower()
    emissions = float(amount) * float(factor)
    # Default DESNZ factors are kgCO2e
    if ghg.startswith("kg"):
        return _kg_to_t(emissions)
    # if already tonnes
    if ghg.startswith("t") or "tonne" in ghg:
        return emissions
    # conservative fallback: assume kg if unknown
    return _kg_to_t(emissions)



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



def _get_dataset_year(dataset_id: int | None):
    if dataset_id is None:
        return None
    try:
        with get_conn() as con:
            r = con.execute("SELECT year FROM datasets WHERE dataset_id=%s", [int(dataset_id)]).fetchone()
        return int(r[0]) if r and r[0] is not None else None
    except Exception:
        return None

def _search_factors(dataset_id, scope: str, query: str, year: int | None = None, all_years: bool = False):
    """
    Best-effort factor lookup search.

    Supports newer NZI Pro schema (factor_lookup.db_id, level_1..4, column_text, uom, ghg_unit, year)
    while remaining compatible with older schemas (factor_id, category/subcategory, unit, name).
    """
    if not query:
        return []

    # Column existence checks (safe across schema variants)
    has_dataset = _col_exists("factor_lookup", "dataset_id")
    has_scope = _col_exists("factor_lookup", "scope")
    has_year = _col_exists("factor_lookup", "year")

    # ID column variants
    has_factor_id = _col_exists("factor_lookup", "factor_id")
    has_db_id = _col_exists("factor_lookup", "db_id")
    id_col = "factor_id" if has_factor_id else ("db_id" if has_db_id else None)
    if id_col is None:
        return []

    # New schema columns
    has_l1 = _col_exists("factor_lookup", "level_1")
    has_l2 = _col_exists("factor_lookup", "level_2")
    has_l3 = _col_exists("factor_lookup", "level_3")
    has_l4 = _col_exists("factor_lookup", "level_4")
    has_coltext = _col_exists("factor_lookup", "column_text")
    has_uom = _col_exists("factor_lookup", "uom")
    has_ghg = _col_exists("factor_lookup", "ghg_unit")

    # Older schema columns
    has_category = _col_exists("factor_lookup", "category")
    has_subcat = _col_exists("factor_lookup", "subcategory")
    has_unit = _col_exists("factor_lookup", "unit")
    has_name = _col_exists("factor_lookup", "name")

    has_factor = _col_exists("factor_lookup", "factor")

    # Build select list safely (alias id to factor_id)
    select_cols = []
    if id_col == "factor_id":
        select_cols.append("factor_id")
    else:
        select_cols.append(f"{id_col} AS factor_id")

    if has_year:
        select_cols.append("year")

    # Prefer new schema fields first
    if has_l1:
        select_cols.append("level_1")
    if has_l2:
        select_cols.append("level_2")
    if has_l3:
        select_cols.append("level_3")
    if has_l4:
        select_cols.append("level_4")
    if has_coltext:
        select_cols.append("column_text")
    if has_uom:
        select_cols.append("uom")
    if has_ghg:
        select_cols.append("ghg_unit")

    # Fallback fields (older schemas)
    if has_name:
        select_cols.append("name")
    if has_category and not has_l1:
        select_cols.append("category")
    if has_subcat and not has_l2:
        select_cols.append("subcategory")
    if has_unit and not has_uom:
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

    if has_year and (year is not None) and (not all_years):
        wh.append("year=%s")
        params.append(int(year))

    # Search text across likely text columns
    like = f"%{query.strip()}%"
    search_terms = []

    for col in ["name", "category", "subcategory", "level_1", "level_2", "level_3", "level_4", "column_text"]:
        if _col_exists("factor_lookup", col):
            search_terms.append(f"{col} ILIKE %s")
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

        # Extract display parts
        year_v = r.get("year") if "year" in df.columns else None
        l1 = r.get("level_1") if "level_1" in df.columns else (r.get("category") if "category" in df.columns else None)
        l2 = r.get("level_2") if "level_2" in df.columns else (r.get("subcategory") if "subcategory" in df.columns else None)
        l3 = r.get("level_3") if "level_3" in df.columns else None
        l4 = r.get("level_4") if "level_4" in df.columns else None
        coltext = r.get("column_text") if "column_text" in df.columns else (r.get("name") if "name" in df.columns else None)

        uom = r.get("uom") if "uom" in df.columns else (r.get("unit") if "unit" in df.columns else None)
        ghg = r.get("ghg_unit") if "ghg_unit" in df.columns else None
        fac = r.get("factor") if "factor" in df.columns else None

        parts = []
        if year_v is not None and str(year_v) != "nan":
            parts.append(str(int(year_v)))
        if l1:
            parts.append(str(l1))
        if l2:
            parts.append(str(l2))
        if l3:
            parts.append(str(l3))
        if l4:
            parts.append(str(l4))
        if coltext:
            parts.append(str(coltext))
        if uom:
            parts.append(f"uom={uom}")
        if ghg:
            parts.append(f"ghg={str(ghg).replace(' ', '')}")
        if fac is not None:
            parts.append(f"factor={fac}")

        label = f"[{fid}] " + " | ".join(parts) if parts else f"[{fid}] factor"
        results.append(
            {
                "factor_id": fid,
                "label": label,
                "factor": fac,
                "uom": uom,
                "ghg_unit": ghg,
                "year": (int(year_v) if year_v is not None and str(year_v) != "nan" else None),
            }
        )
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

    dataset_year = _get_dataset_year(dataset_id)
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

    # Phase A toggle: simplified row-by-row entry (job_scope_rows)
    st.session_state.setdefault("use_simplified_rows", True)
    use_simple = st.checkbox(
        "Use simplified row-by-row entry (recommended)",
        key=f"use_simple_{scope}",
        value=st.session_state.get("use_simplified_rows", True),
    )
    st.session_state["use_simplified_rows"] = use_simple

    if use_simple:
        st.markdown("### Row-by-row entries")

        st.session_state.setdefault("edit_scope_row_id", None)

        # -------------------------
        # Add row (cascading selector)
        # -------------------------
        with st.expander("➕ Add row", expanded=True):
            with st.form(f"add_{scope}_row", clear_on_submit=True):
                # Cascading factor selection
                levels_exist = True
                with get_conn() as con:
                    levels_exist = _col_exists(con, "factor_lookup", "level_1")

                if levels_exist:
                    l1_opts = _factor_cascade_options(int(dataset_id), scope)
                    l1 = st.selectbox("Category (Level 1) *", l1_opts, index=0 if l1_opts else None)
                    l2_opts = []
                    if l1:
                        df_l2 = _factor_rows_for_levels(int(dataset_id), scope, l1=l1)[["level_2"]].dropna().drop_duplicates().sort_values("level_2")
                        l2_opts = df_l2["level_2"].tolist()
                    l2 = st.selectbox("Level 2", l2_opts, index=0 if l2_opts else None)

                    l3_opts = []
                    if l1 and l2:
                        df_l3 = _factor_rows_for_levels(int(dataset_id), scope, l1=l1, l2=l2)[["level_3"]].dropna().drop_duplicates().sort_values("level_3")
                        l3_opts = df_l3["level_3"].tolist()
                    l3 = st.selectbox("Level 3", l3_opts, index=0 if l3_opts else None)

                    l4_opts = []
                    if l1 and l2 and l3:
                        df_l4 = _factor_rows_for_levels(int(dataset_id), scope, l1=l1, l2=l2, l3=l3)[["level_4"]].dropna().drop_duplicates().sort_values("level_4")
                        l4_opts = df_l4["level_4"].tolist()
                    l4 = st.selectbox("Level 4", l4_opts, index=0 if l4_opts else None)

                    fdf = _factor_rows_for_levels(int(dataset_id), scope, l1=l1, l2=l2, l3=l3, l4=l4)
                else:
                    # Legacy: category/subcategory
                    l1_opts = _factor_cascade_options(int(dataset_id), scope)
                    l1 = st.selectbox("Category *", l1_opts, index=0 if l1_opts else None)
                    l2_opts = []
                    if l1:
                        ftmp = _factor_rows_for_levels(int(dataset_id), scope, l1=l1)
                        if "level_2" in ftmp.columns:
                            l2_opts = sorted([x for x in ftmp["level_2"].dropna().unique().tolist() if str(x).strip() != ""])
                    l2 = st.selectbox("Subcategory", l2_opts, index=0 if l2_opts else None)
                    fdf = _factor_rows_for_levels(int(dataset_id), scope, l1=l1, l2=l2)

                if fdf is None or fdf.empty:
                    st.info("Select levels to load factors.")
                    st.form_submit_button("Add row", disabled=True)
                else:
                    # Choose the specific factor line
                    fdf = fdf.copy()
                    disp = (fdf["column_text"].fillna("").astype(str).str.strip() + " — " + fdf["uom"].fillna("").astype(str).str.strip()).tolist()
                    choice = st.selectbox("Factor line *", disp)
                    frow = fdf.iloc[disp.index(choice)]

                    st.write(f"**ID:** {frow.get('original_id')}")
                    st.write(f"**UOM:** {frow.get('uom')}")
                    st.write(f"**Factor:** {frow.get('factor')} ({_ghg_unit_default(frow.get('ghg_unit'))})")

                    c1, c2, c3 = st.columns(3)
                    qty = c1.number_input("Quantity", min_value=0.0, value=0.0, step=1.0)
                    enabled = c2.checkbox("Enabled", value=True)
                    report_label = c3.text_input("Report label")

                    notes = st.text_area("Notes")

                    o1, o2 = st.columns(2)
                    override = o1.number_input("Override tCO2e (optional)", min_value=0.0, value=0.0, step=0.001)
                    override_reason = o2.text_input("Override reason (required if override used)")

                    submitted = st.form_submit_button("Add row")
                    if submitted:
                        calc = _calc_row_tco2e(qty, frow.get("factor"), frow.get("ghg_unit"))
                        use_override = override is not None and float(override) > 0.0
                        if use_override and not (override_reason or "").strip():
                            st.error("Override reason is required when override is set.")
                        else:
                            rid = _insert_job_scope_row(
                                {
                                    "job_id": int(job_id),
                                    "scope": scope,
                                    "dataset_id": int(dataset_id) if dataset_id is not None else None,
                                    "factor_db_id": int(frow.get("db_id")),
                                    "original_id": str(frow.get("original_id")),
                                    "level_1": frow.get("level_1"),
                                    "level_2": frow.get("level_2"),
                                    "level_3": frow.get("level_3"),
                                    "level_4": frow.get("level_4"),
                                    "column_text": frow.get("column_text"),
                                    "report_label": (report_label or "").strip() or None,
                                    "notes": (notes or "").strip() or None,
                                    "enabled": bool(enabled),
                                    "qty": float(qty),
                                    "uom": frow.get("uom"),
                                    "factor": float(frow.get("factor")),
                                    "ghg_unit": _ghg_unit_default(frow.get("ghg_unit")),
                                    "calc_tco2e": calc,
                                    "override_tco2e": float(override) if use_override else None,
                                    "override_reason": (override_reason or "").strip() if use_override else None,
                                }
                            )
                            st.success(f"Row added (ID {rid}).")
                            st.rerun()

        st.markdown("---")
        show_disabled = st.checkbox("Show disabled rows", value=True, key=f"show_dis_{scope}")
        sdf = _job_scope_rows_df(int(job_id), scope, include_disabled=show_disabled)

        if sdf.empty:
            st.info("No rows yet.")
        else:
            # Totals
            used = []
            for _, rr in sdf.iterrows():
                if not bool(rr.get("enabled", True)):
                    continue
                v = rr.get("override_tco2e")
                if v is None or str(v) == "nan":
                    v = rr.get("calc_tco2e")
                try:
                    used.append(float(v) if v is not None else 0.0)
                except Exception:
                    used.append(0.0)
            st.metric("Total tCO2e (enabled rows)", round(sum(used), 4))

            # Header
            h = st.columns([1, 3, 3, 1.5, 1.5, 1.2, 1.2, 1.2])
            h[0].markdown("**On**")
            h[1].markdown("**Label / Activity**")
            h[2].markdown("**Factor (ID)**")
            h[3].markdown("**Qty**")
            h[4].markdown("**Calc tCO2e**")
            h[5].markdown("**Override**")
            h[6].markdown("**Used**")
            h[7].markdown("**Actions**")

            for _, rr in sdf.iterrows():
                rid = int(rr["row_id"])
                is_override = rr.get("override_tco2e") is not None and str(rr.get("override_tco2e")) != "nan"
                used_val = rr.get("override_tco2e") if is_override else rr.get("calc_tco2e")
                prefix = "🟧 " if is_override else ""
                c = st.columns([1, 3, 3, 1.5, 1.5, 1.2, 1.2, 1.2])
                enabled_now = c[0].checkbox("", value=bool(rr.get("enabled", True)), key=f"en_{scope}_{rid}")
                act = f"{prefix}{rr.get('report_label') or ''}\n{rr.get('level_1') or ''} / {rr.get('level_2') or ''} / {rr.get('level_3') or ''} / {rr.get('level_4') or ''}\n{rr.get('column_text') or ''}"
                c[1].write(act)

                c[2].write(f"{rr.get('factor')} {rr.get('ghg_unit')}\nID: {rr.get('original_id')}")
                c[3].write(rr.get("qty"))
                c[4].write(rr.get("calc_tco2e"))
                c[5].write(rr.get("override_tco2e") if is_override else "")
                c[6].write(used_val)

                # Actions: Edit / Delete
                if c[7].button("✏️", key=f"edit_row_{scope}_{rid}"):
                    st.session_state["edit_scope_row_id"] = rid
                    st.rerun()

                if c[7].button("🗑️", key=f"del_row_{scope}_{rid}"):
                    _delete_job_scope_row(rid)
                    st.toast("Row deleted")
                    st.rerun()

            edit_rid = st.session_state.get("edit_scope_row_id")
            if edit_rid:
                st.markdown("### Edit row")
                row = sdf.loc[sdf["row_id"] == int(edit_rid)]
                if row.empty:
                    st.session_state["edit_scope_row_id"] = None
                else:
                    rr = row.iloc[0]
                    with st.form(f"edit_scope_row_{scope}_{edit_rid}"):
                        enabled = st.checkbox("Enabled", value=bool(rr.get("enabled", True)))
                        report_label = st.text_input("Report label", value=rr.get("report_label") or "")
                        notes = st.text_area("Notes", value=rr.get("notes") or "")
                        qty = st.number_input("Quantity", min_value=0.0, value=float(rr.get("qty") or 0.0), step=1.0)
                        override = st.number_input("Override tCO2e (optional)", min_value=0.0, value=float(rr.get("override_tco2e") or 0.0), step=0.001)
                        override_reason = st.text_input("Override reason", value=rr.get("override_reason") or "")

                        b1, b2 = st.columns(2)
                        save = b1.form_submit_button("Save")
                        cancel = b2.form_submit_button("Cancel")

                        if cancel:
                            st.session_state["edit_scope_row_id"] = None
                            st.rerun()

                        if save:
                            calc = _calc_row_tco2e(qty, rr.get("factor"), rr.get("ghg_unit"))
                            use_override = override is not None and float(override) > 0.0
                            if use_override and not (override_reason or "").strip():
                                st.error("Override reason is required when override is set.")
                            else:
                                _update_job_scope_row(
                                    int(edit_rid),
                                    {
                                        "enabled": bool(enabled),
                                        "report_label": (report_label or "").strip() or None,
                                        "notes": (notes or "").strip() or None,
                                        "qty": float(qty),
                                        "calc_tco2e": calc,
                                        "override_tco2e": float(override) if use_override else None,
                                        "override_reason": (override_reason or "").strip() if use_override else None,
                                    },
                                )
                                st.success("Saved.")
                                st.session_state["edit_scope_row_id"] = None
                                st.rerun()

        # Stop here so the legacy UI below doesn't also render
        st.stop()


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
            tco2e_override = c6.number_input("tCO₂e (tonnes) override (optional)", min_value=0.0, value=0.0)

            st.markdown("**Emission factor (optional)**")
            q = st.text_input("Search factors", placeholder="Type to search factor lookup…")
            search_all_years = st.checkbox(
                "Search all years",
                value=False,
                help="By default we filter factors to the selected dataset year for this job. Enable this to search across all years in the dataset.",
            )
            factors = _search_factors(
                dataset_id,
                scope,
                q,
                year=dataset_year,
                all_years=search_all_years,
            ) if q else []
            factor_choice = None
            factor_value = None
            factor_ghg_unit = None
            if factors:
                labels = [f["label"] for f in factors]
                pick = st.selectbox("Matching factors", labels)
                chosen = factors[labels.index(pick)]
                factor_choice = chosen["factor_id"]
                factor_value = chosen["factor"]
                factor_ghg_unit = chosen.get("ghg_unit")
            else:

                st.caption("No factor selected. You can enter custom tCO₂e or add factors/datasets later.")

            notes = st.text_area("Notes", height=80)

            if st.form_submit_button("Save entry"):
                # Compute tco2e if not overridden
                tco2e = float(tco2e_override) if tco2e_override and tco2e_override > 0 else None
                if tco2e is None and factor_value is not None:
                    try:
                        # factor * amount is typically in kgCO2e; convert to tonnes for reporting/storage
                        tco2e = _to_tco2e(float(amount), float(factor_value), factor_ghg_unit)
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
