"""Cross-check calendar-reference.json with Python's standard-library zoneinfo (plan section 3a, P7).

zoneinfo reads the operating system's tzdata, independent of the ICU copy that Node's Intl uses.
Run with a scratch interpreter only, never the sealed study interpreter:

    <scratch>/refenv/bin/python -I -B check_calendar_zoneinfo.py
"""
import json
import pathlib
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, TZPATH

here = pathlib.Path(__file__).parent
cases = json.loads((here / "calendar-reference.json").read_text())["cases"]


def resolve(zone, date, time):
    y, m, d = map(int, date.split("-"))
    hh, mm = map(int, time.split(":"))
    found = set()
    for fold in (0, 1):
        local = datetime(y, m, d, hh, mm, tzinfo=ZoneInfo(zone), fold=fold)
        instant = local.astimezone(timezone.utc)
        back = instant.astimezone(ZoneInfo(zone))
        if (back.year, back.month, back.day, back.hour, back.minute, back.second) == (y, m, d, hh, mm, 0):
            found.add(instant)
    iso = sorted(i.strftime("%Y-%m-%dT%H:%M:%S.000Z") for i in found)
    return "gap" if not iso else iso[0] if len(iso) == 1 else iso


version = next((pathlib.Path(p) / "+VERSION" for p in TZPATH if (pathlib.Path(p) / "+VERSION").exists()), None)
print("python", sys.version.split()[0], "tzdata", version.read_text().strip() if version else "unknown")
failures = 0
for case in cases:
    got = resolve(case["zone"], case["date"], case["time"])
    ok = got == case["expect"]
    failures += not ok
    print("ok  " if ok else "FAIL", case["zone"], case["date"], case["time"], got)
sys.exit(1 if failures else 0)
