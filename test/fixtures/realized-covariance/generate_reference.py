"""Independent reference values for compute_realized_covariance (docs/REALIZED_COVARIANCE_PLAN.md, section 3b).

It implements the design's rules from the design text, not from the TypeScript source, on fixed-offset
calendars (no DST). The JavaScript tests run the same scenarios with real zones over periods without a
transition: America/New_York in January 2026 (UTC-5), Asia/Tokyo (UTC+9) and UTC. It uses numpy only, from a
fixed seed, and writes bars and expected outputs to reference.json, so the tests never run Python.

Run in the scratch venv, never the sealed study interpreter:

    <scratch>/refenv/bin/python -I -B generate_reference.py
"""
import json
import pathlib
import sys
from datetime import date, datetime, timedelta, timezone

import numpy as np

SEED = 20260929
rng = np.random.default_rng(SEED)
UTC = timezone.utc


def ms(dt):
    return int(dt.replace(tzinfo=UTC).timestamp() * 1000)


def iso(t_ms):
    return datetime.fromtimestamp(t_ms / 1000, UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def boundary(x, hh, mm, offset_minutes):
    """UTC ms of local hh:mm on calendar date x, for a fixed offset."""
    return ms(datetime(x.year, x.month, x.day, hh, mm) - timedelta(minutes=offset_minutes))


def calendar(rules, offset_minutes, from_date, to_date):
    hh, mm = map(int, rules["day_end_local"].split(":"))
    interval = rules["interval_minutes"]
    shift = 0 if hh * 60 + mm >= interval else 1   # label rule (design G1)
    end = lambda d: boundary(d + timedelta(days=shift), hh, mm, offset_minutes)
    weekdays = set(rules["day_weekdays"])
    produced = lambda d: d.isoweekday() in weekdays
    days, d = [], from_date
    while d <= to_date:
        if produced(d):
            p = d - timedelta(days=1)
            while not produced(p):
                p -= timedelta(days=1)
            start, stop = end(d - timedelta(days=1)), end(d)
            prev_end = end(p) if rules["first_interval"] == "from_previous_endpoint" else start
            days.append({"label": d.isoformat(), "start": start, "end": stop, "prev_end": prev_end,
                         "window_from": prev_end if rules["first_interval"] == "from_previous_endpoint" else start,
                         "expected": (stop - start) // (interval * 60000)})
        d += timedelta(days=1)
    return days


def compute(rules, offset_minutes, from_date, to_date, series):
    step = rules["interval_minutes"] * 60000
    scale = 100.0 if rules["return_unit"] == "log_percent" else 1.0
    days = calendar(rules, offset_minutes, from_date, to_date)
    n = len(series)
    closes = [{t * 1000: c for t, c in zip(s["open_time"], s["close"])} for s in series]
    valid = lambda i, t: isinstance(closes[i].get(t), float) and closes[i][t] > 0
    all_valid = lambda t: all(valid(i, t) for i in range(n))
    level = lambda i, t: scale * np.log(closes[i][t])
    out = {k: [] for k in ["dates", "windows", "expected_slots", "common_slots", "drop_cause", "rc", "daily_outer"]}
    identical = {(i, j) for i in range(n) for j in range(i + 1, n)}
    kept_any = False
    for day in days:
        expected = [day["start"] + k * step for k in range(day["expected"])]
        common = [t for t in expected if all_valid(t)]
        endpoint, prev_endpoint = day["end"] - step, day["prev_end"] - step
        cause = None
        if not all_valid(endpoint):
            cause = "no_endpoint"
        elif rules["first_interval"] == "from_previous_endpoint" and not all_valid(prev_endpoint):
            cause = "no_previous_endpoint"
        elif day["expected"] - len(common) > rules["max_missing_slots"]:
            cause = "too_many_missing_slots"
        rc = outer = None
        if cause is None:
            kept_any = True
            points = [prev_endpoint] + common if rules["first_interval"] == "from_previous_endpoint" else common
            levels = np.array([[level(i, t) for i in range(n)] for t in points])
            y = levels - levels[0]
            steps = np.diff(y, axis=0)
            r = levels[-1] - levels[0]
            rc_m = steps.T @ steps
            outer_m = np.outer(r, r)
            rc = float(rc_m[0, 0]) if n == 1 else rc_m.tolist()
            outer = float(outer_m[0, 0]) if n == 1 else outer_m.tolist()
            identical = {(i, j) for (i, j) in identical if all(closes[i].get(t) == closes[j].get(t) for t in points)}
        out["dates"].append(day["label"])
        out["windows"].append({"from": iso(day["window_from"]), "to": iso(day["end"])})
        out["expected_slots"].append(day["expected"])
        out["common_slots"].append(len(common))
        out["drop_cause"].append(cause)
        out["rc"].append(rc)
        out["daily_outer"].append(outer)
    out["identical_close_pairs"] = sorted([list(p) for p in identical]) if kept_any else []
    span_from = days[0]["prev_end"] - step if rules["first_interval"] == "from_previous_endpoint" else days[0]["start"]
    span_to = days[-1]["end"]
    for s in series:   # the design's coverage rule: a scenario must read only inside every series' bars
        assert s["open_time"][0] * 1000 <= span_from and span_to <= s["open_time"][-1] * 1000 + step, "outside coverage"
    out["envelope"] = {"from": iso(span_from), "to": iso(span_to)}
    out["non_slot_bars"], out["invalid_closes"] = [], []
    for s in series:
        non_slot = invalid = 0
        for t_s, c in zip(s["open_time"], s["close"]):
            t = t_s * 1000
            if t < span_from or t >= span_to:
                continue
            if not (isinstance(c, float) and c > 0):
                invalid += 1
            if any(d["window_from"] <= t < d["start"] for d in days):
                non_slot += 1
        out["non_slot_bars"].append(non_slot)
        out["invalid_closes"].append(invalid)
    return out


def bars_for(weeks_start, weeks, offset_minutes, interval, week_open, week_close, n, extra=None):
    """Correlated random-walk closes on every grid time from week_open (Sun, local) to week_close (Fri, local)."""
    step = interval * 60
    times = []
    for w in range(weeks):
        sunday = weeks_start + timedelta(days=7 * w)
        t = boundary(sunday, *week_open, offset_minutes) // 1000
        stop = boundary(sunday + timedelta(days=5), *week_close, offset_minutes) // 1000
        while t < stop:
            times.append(t)
            t += step
    if extra:
        times = sorted(set(times) | set(extra))
    mix = rng.normal(size=(n, n)) * 0.3 + np.eye(n)
    shocks = rng.normal(size=(len(times), n)) @ mix.T * 2e-4
    levels = np.cumsum(shocks, axis=0) + np.log(1.0 + np.arange(n) * 0.25)
    return times, [[float(v) for v in np.exp(levels[:, i])] for i in range(n)]


def series_list(times, closes, ids):
    return [{"series_id": sid, "open_time": list(times), "close": list(c)} for sid, c in zip(ids, closes)]


NY = -300          # America/New_York in January 2026
scenarios = []

# A: #100-shaped. Market Sun 17:00 to Fri 16:30 local, plus one Friday 16:45 bar and one Saturday bar (both
# non-slot bars inside the next Monday's window). Monday's slot 0 (Sun 16:45) is absent; Wednesday 2026-01-14
# is a holiday (no bars); one series misses 3 slots on 2026-01-20 and has a null and a zero close; 2026-01-22
# misses 10 slots. The range starts on Tuesday 2026-01-06, so the first day reads Monday's endpoint (D9).
sun0 = date(2026, 1, 4)
times, closes = bars_for(sun0, 4, NY, 15, (17, 0), (16, 45), 2,
                         extra=[boundary(date(2026, 1, 10), 12, 0, NY) // 1000, boundary(date(2026, 1, 16), 16, 45, NY) // 1000])
holiday = [t for t in times if boundary(date(2026, 1, 13), 16, 45, NY) // 1000 <= t < boundary(date(2026, 1, 14), 16, 45, NY) // 1000]
keep = [i for i, t in enumerate(times) if t not in set(holiday)]
times = [times[i] for i in keep]
closes = [[c[i] for i in keep] for c in closes]
day20 = boundary(date(2026, 1, 19), 16, 45, NY) // 1000
for k in (10, 11, 30):
    closes[1][times.index(day20 + k * 900)] = None
closes[1][times.index(day20 + 50 * 900)] = 0.0
day22 = boundary(date(2026, 1, 21), 16, 45, NY) // 1000
for k in range(20, 30):
    closes[0][times.index(day22 + k * 900)] = None
series_a = series_list(times, closes, ["fx:EURUSD", "fx:USDJPY"])
rules_a = {"interval_minutes": 15, "time_zone": "America/New_York", "day_end_local": "16:45", "day_weekdays": [1, 2, 3, 4, 5],
           "max_missing_slots": 6, "first_interval": "from_previous_endpoint", "return_unit": "log_percent"}
scenarios.append(("A_100_shaped", rules_a, NY, "2026-01-06", "2026-01-30", series_a))
# B: the same bars, within_day and log.
scenarios.append(("B_within_day_log", {**rules_a, "first_interval": "within_day", "return_unit": "log"}, NY, "2026-01-06", "2026-01-30", series_a))
# E: Tue-Fri production, so Monday's bars are non-slot bars inside Tuesday's window [Fri endpoint, Tue endpoint).
scenarios.append(("E_tuesday_to_friday", {**rules_a, "day_weekdays": [2, 3, 4, 5]}, NY, "2026-01-13", "2026-01-30", series_a))

# C: UTC 00:00 boundary (m < interval), every day, within_day, one series, 60-minute bars around the clock.
times_c = [ms(datetime(2026, 3, 1)) // 1000 + 3600 * k for k in range(24 * 12)]
walk = np.exp(np.cumsum(rng.normal(size=len(times_c)) * 1e-3))
series_c = [{"series_id": "fx:XAUUSD", "open_time": times_c, "close": [float(v) for v in walk]}]
scenarios.append(("C_utc_midnight", {"interval_minutes": 60, "time_zone": "UTC", "day_end_local": "00:00", "day_weekdays": [1, 2, 3, 4, 5, 6, 7],
                                     "max_missing_slots": 0, "first_interval": "within_day", "return_unit": "log_percent"},
                  0, "2026-03-02", "2026-03-10", series_c))

# D: Tokyo 07:00 (UTC+9), three series, from_previous_endpoint; s(D) lies on UTC date D-2.
times_d, closes_d = bars_for(date(2026, 6, 7), 2, 540, 15, (7, 0), (6, 45), 3)
scenarios.append(("D_tokyo_0700", {**rules_a, "time_zone": "Asia/Tokyo", "day_end_local": "07:00", "max_missing_slots": 2}, 540,
                  "2026-06-09", "2026-06-18", series_list(times_d, closes_d, ["jp:A", "jp:B", "jp:C"])))

# F: eight correlated series over two weeks.
times_f, closes_f = bars_for(sun0, 2, NY, 15, (17, 0), (16, 45), 8)
scenarios.append(("F_eight_series", rules_a, NY, "2026-01-06", "2026-01-16", series_list(times_f, closes_f, [f"fx:S{i}" for i in range(8)])))

# G: identical pairs (Q1). S0copy is S0 with the Friday 16:45 bar deleted and the Saturday bar stripped (bars no
# kept day uses), so it is still an identical pair; S2 differs.
friday_1645 = boundary(date(2026, 1, 9), 16, 45, NY) // 1000
times_g, closes_g = bars_for(sun0, 2, NY, 15, (17, 0), (16, 45), 2, extra=[boundary(date(2026, 1, 10), 12, 0, NY) // 1000, friday_1645])
saturday = boundary(date(2026, 1, 10), 12, 0, NY) // 1000
copy_times = [t for t in times_g if t not in (friday_1645, saturday)]
copy_closes = [c for t, c in zip(times_g, closes_g[0]) if t not in (friday_1645, saturday)]
series_g = [{"series_id": "fx:S0", "open_time": times_g, "close": closes_g[0]},
            {"series_id": "fx:S0copy", "open_time": copy_times, "close": copy_closes},
            {"series_id": "fx:S2", "open_time": times_g, "close": closes_g[1]}]
scenarios.append(("G_identical_pair", rules_a, NY, "2026-01-06", "2026-01-16", series_g))

reference = {
    "generator": "generate_reference.py (independent numpy implementation of the design rules, fixed offsets)",
    "python": sys.version.split()[0], "numpy": np.__version__, "seed": SEED,
    "tolerance": {"exact": ["dates", "windows", "expected_slots", "common_slots", "drop_cause", "identical_close_pairs",
                            "envelope", "non_slot_bars", "invalid_closes"], "relative": 1e-12, "relative_fields": ["rc", "daily_outer"]},
    "bar_sets": {},
    "scenarios": [],
}
for name, rules, offset, f, t, series in scenarios:
    expected = compute(rules, offset, date.fromisoformat(f), date.fromisoformat(t), series)
    # Scenarios that share bars (A, B and E) store them once.
    key = next((k for k, v in reference["bar_sets"].items() if v is series), None)
    if key is None:
        key = name
        reference["bar_sets"][key] = series
    reference["scenarios"].append({"name": name, "rules": rules, "from_date": f, "to_date": t,
                                   "bars": key, "expected": expected})
    kept = sum(c is None for c in expected["drop_cause"])
    print(name, len(expected["dates"]), "days,", kept, "kept, causes", sorted({c for c in expected["drop_cause"] if c}),
          "non-slot", expected["non_slot_bars"], "identical", expected["identical_close_pairs"])

out = pathlib.Path(__file__).parent / "reference.json"
out.write_text(json.dumps(reference, separators=(",", ":")) + "\n")
print("wrote", out.name, out.stat().st_size, "bytes")
