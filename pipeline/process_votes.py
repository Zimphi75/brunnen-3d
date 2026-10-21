"""Eidgenössische Abstimmungen (BFS voteinfo, Open Data) -> votes.json.

Der Server der Quelle sendet keine CORS-Header und liefert pro Abstimmungstag
rund 6 MB. Darum wird die Auswahl hier einmal gezogen und kompakt abgelegt,
statt im Browser geladen zu werden.
"""
from __future__ import annotations

import datetime
import json
import subprocess

from . import config

BASE = "https://ogd-static.voteinfo-app.ch/v1/ogd/sd-t-17-02-{date}-eidgAbstimmung.json"
# Eidgenössische Abstimmungstage (Bundeskanzlei); nicht abrufbare Tage werden übersprungen.
DATES = [
    "20260927", "20260614", "20260308", "20251130", "20250928", "20250518", "20250209",
    "20241124", "20240922", "20240609", "20240303", "20230618", "20230312", "20220925",
]
CANTON_SZ = "5"


def fetch(date: str):
    dest = config.CACHE_DIR / "votes" / f"{date}.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        # curl nutzt die System-Zertifikate; die Kette der Quelle ist für Pythons certifi unvollständig.
        result = subprocess.run(
            ["curl", "-fsSL", "--max-time", "120", "-o", str(dest), BASE.format(date=date)],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            dest.unlink(missing_ok=True)
            return None
    return json.loads(dest.read_text())


def main() -> None:
    bfs = str(config.MUNICIPALITY_BFS)
    rows = []
    for date in DATES:
        data = fetch(date)
        if not data:
            print(f"  {date}: nicht verfügbar")
            continue
        for proposal in data.get("schweiz", {}).get("vorlagen", []):
            title = next((t["text"] for t in proposal.get("vorlagenTitel", []) if t.get("langKey") == "de"), "Vorlage")
            canton = next((k for k in proposal.get("kantone", []) if str(k.get("geoLevelnummer")) == CANTON_SZ), None)
            town = next((g for g in (canton or {}).get("gemeinden", []) if str(g.get("geoLevelnummer")) == bfs), None)
            result = (town or {}).get("resultat") or {}
            if result.get("jaStimmenInProzent") is None:
                continue
            rows.append({
                "date": date, "title": title,
                "local": result["jaStimmenInProzent"], "turnout": result.get("stimmbeteiligungInProzent"),
                "canton": (canton.get("resultat") or {}).get("jaStimmenInProzent"),
                "swiss": (proposal.get("resultat") or {}).get("jaStimmenInProzent"),
                "accepted": proposal.get("vorlageAngenommen"),
            })
        print(f"  {date}: ok")
    payload = {
        "bfs": int(bfs), "retrieved": datetime.date.today().isoformat(),
        "source": "BFS voteinfo (Open Data), ogd-static.voteinfo-app.ch", "votes": rows,
    }
    (config.OUT_DIR / "votes.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1))
    print(f"votes.json: {len(rows)} Vorlagen")


if __name__ == "__main__":
    main()
