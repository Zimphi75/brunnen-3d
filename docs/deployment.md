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

Das GitHub-Repository enthält den Workflow `.github/workflows/hoststar-deploy.yml`. Bei jedem Push auf `main` baut GitHub Actions die Datenpipeline und Three.js, führt die pytest-Tests aus und stellt daraus den statischen Website-Ordner zusammen. Der Upload zu Hoststar läuft verschlüsselt über explizites FTPS (Port 21). Manuelle Builds lassen sich unter **Actions → Build and deploy to Hoststar → Run workflow** starten.

Vor dem ersten Deploy im GitHub-Repository unter **Settings → Secrets and variables → Actions** konfigurieren:

| Typ | Name | Wert |
|---|---|---|
| Secret | `HOSTSTAR_SFTP_SERVER` | Servername aus My Panel, z. B. `lx68.hoststar.hosting` |
| Secret | `HOSTSTAR_SFTP_USERNAME` | separater Hoststar-Dateiübertragungsbenutzer für Brunnen 3D |
| Secret | `HOSTSTAR_SFTP_PASSWORD` | Passwort dieses Benutzers (dieselben Hoststar-Zugangsdaten gelten für WebFTP, SFTP und FTPS) |
| Variable | `HOSTSTAR_SFTP_ENABLED` | `true` |

In Hoststar eine eigene Website/Subdomain (z. B. `brunnen3d.multikanal.ch`) anlegen und einen separaten FTP-Benutzer erstellen, der ausschliesslich auf das automatisch zugewiesene Webroot dieser Website beschränkt ist. Das SFTP-Konto startet dort; der Workflow lädt nach `./` hoch. Den Domain-Hauptordner `/home/ch71104/web` nicht als Ziel verwenden, wenn dort bereits eine Website liegt.

Die Zugangsdaten nie in Dateien oder Commits eintragen. Hoststar bietet für dieses Hosting SFTP (Port 5544) sowie explizites FTPS (Port 21) an. Der Workflow verwendet FTPS mit strikter TLS-Zertifikatsprüfung, da der SFTP-Login im GitHub-Runner trotz erfolgreichem WebFTP-Login abgelehnt wurde. Die Secret-Namen behalten aus Kompatibilitätsgründen den bisherigen `SFTP`-Teil.

Die Site wird erst nach dem Setzen von `HOSTSTAR_SFTP_ENABLED` veröffentlicht. Ohne diese Variable werden Build, Datengenerierung und Tests ausgeführt, der Deploy-Job bleibt übersprungen.

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
