# Deployment

Die Anwendung besteht ausschliesslich aus statischen Dateien. Jeder Webserver genügt (nginx, Caddy, Apache, S3 mit CDN, GitHub Pages).

## Zu veröffentlichende Dateien

```
index.html
css/
js/
public/data/        (Ausgabe der Pipeline)
public/vendor/      (three.js, per scripts/vendor_three.py)
```

Nicht nötig: `pipeline/`, `tests/`, `.venv/`, `docs/`.

## Ablauf

1. Pipeline ausführen (`python -m pipeline.run_all`) und `python scripts/vendor_three.py`.
2. Verzeichnisse oben auf den Webserver kopieren.
3. MIME-Typen prüfen: `.js` als `text/javascript`, `.json` als `application/json`, `.bin` als `application/octet-stream`.

## Automatisch auf Hoststar veröffentlichen

Das GitHub-Repository enthält den Workflow `.github/workflows/hoststar-deploy.yml`. Bei jedem Push auf `main` baut GitHub Actions die Datenpipeline und Three.js, führt die pytest-Tests aus und stellt daraus den statischen Website-Ordner zusammen. Der Upload zu Hoststar läuft über FTPS. Manuelle Builds lassen sich unter **Actions → Build and deploy to Hoststar → Run workflow** starten.

Vor dem ersten Deploy im GitHub-Repository unter **Settings → Secrets and variables → Actions** konfigurieren:

| Typ | Name | Wert |
|---|---|---|
| Secret | `HOSTSTAR_FTP_SERVER` | FTP-Servername aus Hoststars My Panel |
| Secret | `HOSTSTAR_FTP_USERNAME` | FTP-Benutzername |
| Secret | `HOSTSTAR_FTP_PASSWORD` | FTP-Passwort |
| Secret | `HOSTSTAR_FTP_DIRECTORY` | Zielverzeichnis der Website, z. B. das im My Panel angezeigte Domain-Verzeichnis |
| Variable | `HOSTSTAR_FTP_ENABLED` | `true` |

Das Zielverzeichnis sollte ausschliesslich für Brunnen 3D verwendet werden: Der FTP-Workflow synchronisiert den Website-Inhalt dorthin. Die FTP-Zugangsdaten nie in Dateien oder Commits eintragen. Der Workflow erwartet explizites FTPS auf dem Standardport 21. Falls Hoststar für das Hosting nur unverschlüsseltes FTP oder einen abweichenden Port freigibt, muss das Protokoll im Workflow angepasst werden.

Die Site wird erst nach dem Setzen von `HOSTSTAR_FTP_ENABLED` veröffentlicht. Ohne diese Variable werden Build, Datengenerierung und Tests ausgeführt, der Deploy-Job bleibt übersprungen.

## Empfehlungen für den Betrieb

- **Kompression**: gzip oder Brotli für `.json`, `.js` und `.bin` einschalten (gemessen mit gzip -9: `buildings.json` 1.0 MB → 153 KB, `buildings3d.bin` 8.6 MB → 2.1 MB, `dem.bin` 3.0 MB → 1.7 MB, `roads.json` 536 KB → 161 KB).
- **Caching**: `public/vendor/` und Bilder mit `Cache-Control: public, max-age=31536000, immutable`; `public/data/*.json|bin` mit Revalidierung (`no-cache` plus `ETag`/`Last-Modified`) oder Hash im Dateinamen.
- **HTTPS** ist für WebGL nicht Pflicht, für Produktion aber üblich.
- **CORS** ist nicht nötig, solange alles von derselben Herkunft kommt. Die Laufzeit-APIs (Open-Meteo, transport.opendata.ch, wms.geo.admin.ch) erlauben Browserzugriffe.
- **Content-Security-Policy** (Vorschlag): `default-src 'self'; connect-src 'self' https://api.open-meteo.com https://transport.opendata.ch; img-src 'self' data: blob: https://wms.geo.admin.ch; style-src 'self' 'unsafe-inline'`
- **Lizenzen**: Quellenangaben müssen erhalten bleiben (siehe README). Open-Meteo erfordert für kommerzielle Nutzung einen API-Schlüssel.

## Beispiel nginx

```nginx
server {
  listen 80;
  root /srv/brunnen-3d;
  gzip on;
  gzip_types application/json text/javascript application/octet-stream text/css;
  location /public/vendor/ { add_header Cache-Control "public, max-age=31536000, immutable"; }
  location /public/data/   { add_header Cache-Control "no-cache"; }
}
```

## Daten aktualisieren

`pipeline/cache/` löschen (oder nur einzelne Unterordner) und `python -m pipeline.run_all` erneut ausführen. Die GWR-Daten ändern täglich, swisstopo-Daten jährlich bis alle sechs Jahre.

## Spätere Erweiterungen

Ein Backend (FastAPI oder Node) mit Caching ist nur nötig für geschützte APIs (z. B. ÖV-Echtzeitpositionen mit Token) oder serverseitige Analysen (Routing, Isochronen). PostgreSQL/PostGIS bietet sich für Parzellen und Statistiken an.
