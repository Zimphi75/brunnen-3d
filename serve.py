"""Lokaler statischer Webserver für Brunnen 3D (Python-Standardbibliothek, ohne Abhängigkeiten).

Aufruf: python serve.py [port]
"""
import http.server
import socketserver
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".bin": "application/octet-stream",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        # Revalidierung über Last-Modified/304: Änderungen sind sofort sichtbar, unveränderte Daten werden nicht neu geladen.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT))) as server:
        print(f"Brunnen 3D: http://127.0.0.1:{port}/")
        server.serve_forever()


if __name__ == "__main__":
    main()
