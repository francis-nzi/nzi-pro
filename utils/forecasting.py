
import pandas as pd
def build_forecast_df(bmark_year:int, net_zero_year:int, interim_year:int, s1:int, s2:int, s3:int, baseline:dict) -> pd.DataFrame:
    years = list(range(bmark_year, net_zero_year + 1))
    data = []
    for y in years:
        row = {"Year": y}
        for scope, pct in [("Scope 1", s1), ("Scope 2", s2), ("Scope 3", s3)]:
            E0 = baseline.get(scope, 0.0)
            if E0 <= 0: target = 0.0
            else:
                if y <= interim_year:
                    frac = 0 if interim_year == bmark_year else (y - bmark_year) / (interim_year - bmark_year)
                    target = E0 * (1 - (pct/100.0) * max(0,min(1,frac)))
                else:
                    E_i = E0 * (1 - pct/100.0)
                    frac2 = 0 if net_zero_year == interim_year else (y - interim_year) / (net_zero_year - interim_year)
                    target = max(E_i * (1 - max(0,min(1,frac2))), 0.0)
            row[scope] = target
        row["Total"] = row["Scope 1"] + row["Scope 2"] + row["Scope 3"]
        data.append(row)
    return pd.DataFrame(data)
