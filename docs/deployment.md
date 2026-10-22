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

## Automatisch auf GitHub Pages veröffentlichen

Der Workflow `.github/workflows/hoststar-deploy.yml` (**Build and deploy website**) baut bei jedem Push auf `main` die Datenpipeline und Three.js, führt die pytest-Tests aus und veröffentlicht den statischen Website-Ordner mit den offiziellen GitHub-Pages-Actions.

Unter **Settings → Pages → Build and deployment → Source** muss **GitHub Actions** ausgewählt sein. Die Website ist unter `https://zimphi75.github.io/brunnen-3d/` erreichbar. Das Repository kann bei einem geeigneten GitHub-Tarif privat bleiben; die veröffentlichte Website und ihre ausgelieferten Daten sind öffentlich.

Eine eigene Domain lässt sich später unter **Settings → Pages → Custom domain** verbinden. Für eine Subdomain zeigt der DNS-CNAME auf `zimphi75.github.io` (ohne Projektpfad). Alternativ kann die bisherige Website-Adresse per HTTP-Weiterleitung auf die Pages-URL zeigen; dabei wechselt die sichtbare Adresse zur Pages-URL. Bei einer eigenen Domain zuerst die Domain in Pages konfigurieren und den Domainbesitz verifizieren, dann DNS umstellen und HTTPS aktivieren.

Der Hoststar-Upload wird unabhängig davon über `HOSTSTAR_SFTP_ENABLED` gesteuert. Für den ausschliesslichen Betrieb auf Pages bleibt diese Variable auf `false`.

## Optional zusätzlich auf Hoststar veröffentlichen

Der gleiche Workflow kann den Website-Ordner zusätzlich auf Hoststar veröffentlichen. Der Upload zu Hoststar läuft verschlüsselt über explizites FTPS (Port 21). Manuelle Builds lassen sich unter **Actions → Build and deploy website → Run workflow** starten.

Vor dem ersten Deploy im GitHub-Repository unter **Settings → Secrets and variables → Actions** konfigurieren:

| Typ | Name | Wert |
|---|---|---|
| Secret | `HOSTSTAR_SFTP_SERVER` | Servername aus My Panel, z. B. `lx68.hoststar.hosting` |
| Secret | `HOSTSTAR_SFTP_USERNAME` | separater Hoststar-Dateiübertragungsbenutzer für Brunnen 3D |
| Secret | `HOSTSTAR_SFTP_PASSWORD` | Passwort dieses Benutzers (dieselben Hoststar-Zugangsdaten gelten für WebFTP, SFTP und FTPS) |
| Variable | `HOSTSTAR_SFTP_ENABLED` | `true` |

In Hoststar eine eigene Website/Subdomain (z. B. `brunnen3d.multikanal.ch`) anlegen und einen separaten FTP-Benutzer erstellen, der ausschliesslich auf das automatisch zugewiesene Webroot dieser Website beschränkt ist. Das SFTP-Konto startet dort; der Workflow lädt nach `./` hoch. Den Domain-Hauptordner `/home/ch71104/web` nicht als Ziel verwenden, wenn dort bereits eine Website liegt.

Die Zugangsdaten nie in Dateien oder Commits eintragen. Hoststar bietet für dieses Hosting SFTP (Port 5544) sowie explizites FTPS (Port 21) an. Der Workflow verwendet FTPS mit strikter TLS-Zertifikatsprüfung, da der SFTP-Login im GitHub-Runner trotz erfolgreichem WebFTP-Login abgelehnt wurde. Die Secret-Namen behalten aus Kompatibilitätsgründen den bisherigen `SFTP`-Teil.

Der zusätzliche Hoststar-Upload wird erst mit `HOSTSTAR_SFTP_ENABLED=true` ausgeführt. Ohne diese Freigabe bleibt nur der Hoststar-Deploy-Job übersprungen; die Veröffentlichung auf GitHub Pages läuft unabhängig davon.

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
