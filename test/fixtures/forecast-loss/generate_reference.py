"""Independent reference values for compare_forecast_losses (docs/FORECAST_LOSS_COMPARISON_PLAN.md, section 3).

Synthetic series only, from a fixed seed. Writes hac-reference.json next to this script, including the series
themselves, so the TypeScript tests never regenerate or run Python.

  python3 -m venv refenv && refenv/bin/pip install numpy scipy statsmodels
  refenv/bin/python generate_reference.py
"""
import json
import math
import pathlib

import numpy as np
import scipy
import scipy.stats
import statsmodels
import statsmodels.api as sm

rng = np.random.default_rng(20260928)


def lag(t):
    return min(t - 1, math.floor(4 * (t / 100) ** (2 / 9)))


def hac_case(name, d):
    d = np.asarray(d, dtype=float)
    t = len(d)
    L = lag(t)
    fit = sm.OLS(d, np.ones(t)).fit(cov_type="HAC", cov_kwds={"maxlags": L, "use_correction": False}, use_t=False)
    se = float(fit.bse[0])
    dm = float(fit.params[0]) / se
    return {"name": name, "d": [float(x) for x in d], "T": t, "L": L, "dbar": float(np.mean(d)),
            "S": se * se * t, "DM": dm, "p_a": float(scipy.stats.norm.cdf(dm)), "p_b": float(scipy.stats.norm.sf(dm))}


def ar1(t, phi, mean):
    x = np.empty(t)
    x[0] = rng.normal()
    for i in range(1, t):
        x[i] = phi * x[i - 1] + rng.normal()
    return x + mean


cases = [
    hac_case("ar1_T250", ar1(250, 0.5, -0.15)),
    hac_case("heavy_tailed_T1000", 0.3 * rng.standard_t(3, 1000) - 0.02),
    hac_case("normal_T101", rng.normal(0.1, 1.0, 101)),
    hac_case("normal_T100_boundary", rng.normal(-0.05, 0.7, 100)),
]

phi_points = [-30, -10, -5, -3, -1.6448536269514722, -1, -0.5, 0, 0.5, 1, 1.6448536269514722, 3, 5, 10, 30]
phi = [{"x": x, "cdf": float(scipy.stats.norm.cdf(x)), "sf": float(scipy.stats.norm.sf(x))} for x in phi_points]

spearman_cases = []
for name, (a, b) in {
    "ties": ([1, 2, 2, 3, 4, 4, 4, 5], [2, 1, 3, 3, 5, 6, 6, 7]),
    "random": (list(rng.normal(size=40)), list(rng.normal(size=40))),
    "monotone": (list(range(10)), [x ** 3 for x in range(10)]),
}.items():
    spearman_cases.append({"name": name, "a": [float(x) for x in a], "b": [float(x) for x in b],
                           "rho": float(scipy.stats.spearmanr(a, b).statistic)})


def spd(n):
    m = rng.normal(size=(n, n))
    return m @ m.T + n * np.eye(n)


loss_cases = []
for n in (1, 2, 3, 8):
    sa, sb = spd(n), spd(n)
    r = rng.normal(size=n)
    for proxy_name, p in {"rank_one": np.outer(r, r), "full": spd(n) / 3, "zero": np.zeros((n, n))}.items():
        qlike = lambda s: float(np.linalg.slogdet(s)[1] + np.trace(np.linalg.solve(s, p)))
        mse = lambda s: float(np.sum((s - p) ** 2))
        loss_cases.append({"n": n, "proxy": proxy_name, "a": sa.tolist(), "b": sb.tolist(), "p": p.tolist(),
                           "qlike_a": qlike(sa), "qlike_b": qlike(sb), "mse_a": mse(sa), "mse_b": mse(sb)})

out = {
    "generator": "test/fixtures/forecast-loss/generate_reference.py",
    "seed": 20260928,
    "versions": {"numpy": np.__version__, "scipy": scipy.__version__, "statsmodels": statsmodels.__version__},
    "hac_call": 'sm.OLS(d, ones).fit(cov_type="HAC", cov_kwds={"maxlags": L, "use_correction": False}, use_t=False)',
    "hac": cases, "phi": phi, "spearman": spearman_cases, "losses": loss_cases,
}
path = pathlib.Path(__file__).with_name("hac-reference.json")
path.write_text(json.dumps(out, indent=1) + "\n")
print("wrote", path, "cases", len(cases), "phi", len(phi), "spearman", len(spearman_cases), "losses", len(loss_cases))
