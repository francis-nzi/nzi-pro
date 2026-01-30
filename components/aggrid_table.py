import pandas as pd
import streamlit as st


def render_single_select_grid(
    df: pd.DataFrame,
    *,
    key: str,
    selection_column: str = "db_id",
    height: int = 520,
    fit_columns_on_grid_load: bool = True,
    column_order: list[str] | None = None,
    column_labels: dict[str, str] | None = None,
    hide_columns: list[str] | None = None,
):
    try:
        from st_aggrid import AgGrid, GridOptionsBuilder, GridUpdateMode, DataReturnMode
    except Exception as e:
        st.error("AG Grid is not available. Ensure 'streamlit-aggrid' is installed.")
        raise e

    if df is None or df.empty:
        return None

    view = df.copy()

    if column_order:
        cols = [c for c in column_order if c in view.columns]
        for c in view.columns:
            if c not in cols:
                cols.append(c)
        view = view[cols]

    gb = GridOptionsBuilder.from_dataframe(view)
    gb.configure_default_column(
        resizable=True,
        sortable=True,
        filter=True,
        wrapText=True,
        autoHeight=True,
    )
    gb.configure_selection("single", use_checkbox=True)
    if fit_columns_on_grid_load:
        gb.configure_grid_options(domLayout="normal")

    if column_labels:
        for col_key, label in column_labels.items():
            if col_key in view.columns:
                gb.configure_column(col_key, headerName=label)

    if hide_columns:
        for col_key in hide_columns:
            if col_key in view.columns:
                gb.configure_column(col_key, hide=True)

    grid_options = gb.build()

    res = AgGrid(
        view,
        gridOptions=grid_options,
        height=height,
        fit_columns_on_grid_load=fit_columns_on_grid_load,
        update_mode=GridUpdateMode.SELECTION_CHANGED,
        data_return_mode=DataReturnMode.AS_INPUT,
        allow_unsafe_jscode=False,
        key=key,
    )

    res_dict = res if isinstance(res, dict) else {}
    selected_rows = res_dict.get("selected_rows")
    if selected_rows is None:
        return None

    if isinstance(selected_rows, pd.DataFrame):
        selected = selected_rows.to_dict("records")
    elif isinstance(selected_rows, list):
        selected = selected_rows
    else:
        try:
            selected = list(selected_rows)
        except Exception:
            selected = []

    if len(selected) == 0:
        return None

    selected_row = selected[0]
    if selection_column not in df.columns:
        return selected_row

    try:
        sel_id = int(selected_row.get(selection_column))
    except Exception:
        return selected_row

    matches = df[df[selection_column].astype(str) == str(sel_id)]
    if matches.empty:
        return selected_row

    return matches.iloc[0].to_dict()
