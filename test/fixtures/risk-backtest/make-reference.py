#!/usr/bin/env python3
"""Independent reference for backtest_risk_forecast's statistics (docs/RISK_FORECAST_BACKTEST_PLAN.md, step 2, P1).

Recomputes LR_uc, LR_ind, LR_cc and the asymptotic chi-square p-values for a pinned case table in 60-digit decimal
arithmetic, independently of the TypeScript code, and writes reference.json beside this file. It needs only the
Python standard library:

    python3 test/fixtures/risk-backtest/make-reference.py

The levels are the doubles 0.01 and 0.05 exactly (Decimal(float)), so the reference answers the same question as the
code. Values are written as decimal strings with 30 significant digits.
"""
import json
import random
from decimal import Decimal, getcontext
from pathlib import Path

getcontext().prec = 60
PI = Decimal("3.14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798")
TINY = Decimal(10) ** -70


def ln(x):
    return Decimal(x).ln()


def kupiec(x, T, alpha):
    a = Decimal(alpha)
    total = Decimal(0)
    if x > 0:
        total += x * ln((Decimal(x) / T) / a)
    if T - x > 0:
        total += (T - x) * ln((Decimal(T - x) / T) / (1 - a))
    return max(Decimal(0), 2 * total)


def independence(n00, n01, n10, n11):
    N = n00 + n01 + n10 + n11
    m0, m1, c0, c1 = n00 + n01, n10 + n11, n00 + n10, n01 + n11
    total = Decimal(0)
    for n, m, c in ((n00, m0, c0), (n01, m0, c1), (n10, m1, c0), (n11, m1, c1)):
        if n > 0:
            total += n * ln(Decimal(n * N) / (m * c))
    return max(Decimal(0), 2 * total)


def erfc(x):
    """erfc by its Taylor series below 2 and by the Laplace continued fraction (modified Lentz) from 2."""
    if x < 2:
        term, total, n = x, Decimal(0), 0
        while True:
            add = term / (2 * n + 1)
            total += add
            if abs(add) < TINY:
                break
            n += 1
            term = -term * x * x / n
        return 1 - 2 / PI.sqrt() * total
    # erfc(x) = exp(-x^2)/sqrt(pi) / (x + (1/2)/(x + 1/(x + (3/2)/(x + ...)))), with a_k = k/2.
    f = x
    C, D = x, Decimal(0)
    k = 1
    while True:
        a = Decimal(k) / 2
        D = x + a * D
        D = 1 / (D if D != 0 else TINY)
        C = x + a / C
        delta = C * D
        f *= delta
        if abs(delta - 1) < TINY:
            break
        k += 1
    return (-(x * x)).exp() / PI.sqrt() / f


def chi_square_survival(statistic, df):
    return erfc((statistic / 2).sqrt()) if df == 1 else (-statistic / 2).exp()


def digits(value):
    return format(value, ".30g")


def main():
    kupiec_cases = set()
    for T in (250, 500, 1900, 2698, 3000, 5000):
        for alpha in (0.01, 0.05):
            k0 = round(alpha * T)
            for x in (0, 1, k0 - 1, k0, k0 + 1, 2 * k0, 3 * k0, T):
                if 0 <= x <= T:
                    kupiec_cases.add((x, T, alpha))
    kupiec_cases.add((27, 2698, 0.01))   # the plan review's worst relative error
    tables = {
        (1805, 95, 95, 5), (3610, 190, 190, 10),   # equal rates: exactly 0
        (4281, 217, 217, 11),                      # a tiny statistic from large terms
        (0, 0, 0, 0), (10, 0, 0, 0), (0, 0, 0, 10), (9, 1, 1, 0), (100, 5, 5, 0),
        (1880, 10, 10, 9), (1890, 9, 9, 0), (4900, 49, 49, 1), (4000, 300, 300, 100), (2400, 60, 61, 3),
    }
    rng = random.Random(20261001)
    while len(tables) < 60:
        N = rng.choice((249, 499, 1899, 2999, 4999))
        hit_rate = rng.choice((0.01, 0.05))
        hits = max(1, round(N * hit_rate * rng.uniform(0.6, 1.6)))
        n11 = rng.randint(0, max(0, min(hits // 3, 8)))
        n01 = hits - n11
        n10 = n01
        n00 = N - n01 - n10 - n11
        if n00 >= 0:
            tables.add((n00, n01, n10, n11))
    kupiec_rows = [{"x": x, "T": T, "alpha": alpha, "statistic": digits(kupiec(x, T, alpha))}
                   for x, T, alpha in sorted(kupiec_cases)]
    independence_rows = [{"table": list(t), "statistic": digits(independence(*t))} for t in sorted(tables)]
    conditional_rows = []
    for (x, T, alpha), table in zip(sorted(kupiec_cases)[::7], sorted(tables)[::4]):
        conditional_rows.append({"x": x, "T": T, "alpha": alpha, "table": list(table),
                                 "statistic": digits(kupiec(x, T, alpha) + independence(*table))})
    chi_rows = []
    for text in ("1e-10", "1e-5", "0.01", "0.5", "1", "3.841458820694124", "5.991464547107979", "10", "50", "100",
                 "300", "600", "1000", "1300"):
        for df in (1, 2):
            p = chi_square_survival(Decimal(text), df)
            chi_rows.append({"statistic": text, "df": df, "p": digits(p)})
    out = {
        "generated_by": "test/fixtures/risk-backtest/make-reference.py (Python decimal, 60 digits)",
        "kupiec": kupiec_rows,
        "independence": independence_rows,
        "conditional": conditional_rows,
        "chi_square": chi_rows,
    }
    path = Path(__file__).with_name("reference.json")
    path.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {path}: {len(kupiec_rows)} kupiec, {len(independence_rows)} independence, "
          f"{len(conditional_rows)} conditional, {len(chi_rows)} chi-square")


if __name__ == "__main__":
    main()
