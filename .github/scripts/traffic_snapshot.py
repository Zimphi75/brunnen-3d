"""Sichert die GitHub-Traffic-Statistik (nur 14 Tage verfügbar) dauerhaft als CSV.

Aufruf: python traffic_snapshot.py <zielordner>
Braucht die gh-CLI mit einem Token, das die Traffic-API lesen darf (GH_TOKEN).
Bestehende Zeilen werden pro Datum (bzw. Datum+Quelle/Pfad) aktualisiert, nie dupliziert.
"""
import csv
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = os.environ.get("REPO", "Zimphi75/brunnen-3d")


def api(endpoint):
    out = subprocess.run(
        ["gh", "api", f"repos/{REPO}/traffic/{endpoint}"],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def upsert(path, header, key_len, rows):
    data = {}
    if path.exists():
        with path.open(newline="") as f:
            for row in csv.DictReader(f):
                data[tuple(row[h] for h in header[:key_len])] = row
    for row in rows:
        data[tuple(str(row[h]) for h in header[:key_len])] = row
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        for k in sorted(data):
            w.writerow(data[k])


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    out.mkdir(parents=True, exist_ok=True)
    today = dt.date.today().isoformat()

    views = api("views")["views"]
    upsert(out / "views.csv", ["date", "views", "uniques"], 1,
           [{"date": v["timestamp"][:10], "views": v["count"], "uniques": v["uniques"]} for v in views])

    clones = api("clones")["clones"]
    upsert(out / "clones.csv", ["date", "clones", "uniques"], 1,
           [{"date": c["timestamp"][:10], "clones": c["count"], "uniques": c["uniques"]} for c in clones])

    # Referrer und Pfade liefert GitHub nur als 14-Tage-Summe -> Tages-Schnappschuss.
    upsert(out / "referrers.csv", ["snapshot", "referrer", "count", "uniques"], 2,
           [{"snapshot": today, "referrer": r["referrer"], "count": r["count"], "uniques": r["uniques"]}
            for r in api("popular/referrers")])
    upsert(out / "paths.csv", ["snapshot", "path", "count", "uniques"], 2,
           [{"snapshot": today, "path": p["path"], "count": p["count"], "uniques": p["uniques"]}
            for p in api("popular/paths")])
    print(f"Traffic-Schnappschuss {today} gespeichert in {out}")


if __name__ == "__main__":
    main()
