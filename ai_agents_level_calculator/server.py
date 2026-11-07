"""AI Agents Level Calculator web server: Python standard library only, plus the app itself.

Serves the single-page frontend from ai_agents_level_calculator/static and two JSON
endpoints. All Clocked calls happen here, server-side; the browser
never sees the API key and never calls Clocked directly.

  GET  /            - the single-page app
  GET  /api/mode    - {"mode": "live" | "mock"}
  POST /api/audit   - {"agent_name", "platform", "evidence_text", "profile": {...}}
                      returns the audit dict from pipeline.run_audit
  POST /api/card    - the audit dict, returns the 9:16 PNG card
  GET  /api/demo    - the built-in demo audit (mock mode, statistics only)

Run:  python -m ai_agents_level_calculator.server
Then open http://localhost:8000 - no signup, no install for visitors.
Set CLOCKED_API_KEY in the environment for live mode; without it the
server runs in mock mode and says so on the page.
"""

import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from .card import render_card
from .clocked_client import ClockedClient
from .pipeline import run_audit

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
DEMO_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "examples", "demo_agent.json")

MIME = {".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png"}


def _mode():
    return "live" if os.environ.get("CLOCKED_API_KEY") else "mock"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, mime):
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            self._send_file(os.path.join(STATIC_DIR, "index.html"), "text/html")
            return
        if parsed.path == "/api/mode":
            self._send_json({"mode": _mode()})
            return
        if parsed.path == "/api/demo":
            with open(DEMO_PATH, encoding="utf-8") as f:
                demo = json.load(f)
            audit = run_audit(
                demo["agent_name"], demo["platform"], demo["evidence_text"],
                demo.get("profile"), client=ClockedClient(mode="mock"),
            )
            self._send_json(audit)
            return
        if parsed.path.startswith("/static/"):
            name = os.path.basename(parsed.path)
            path = os.path.join(STATIC_DIR, name)
            if os.path.isfile(path):
                ext = os.path.splitext(name)[1]
                self._send_file(path, MIME.get(ext, "application/octet-stream"))
                return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON."}, status=400)
            return
        if parsed.path == "/api/audit":
            audit = run_audit(
                payload.get("agent_name") or "Agent",
                payload.get("platform") or "other",
                payload.get("evidence_text") or "",
                payload.get("profile") or {},
                client=ClockedClient(mode=_mode()),
            )
            self._send_json(audit)
            return
        if parsed.path == "/api/card":
            if not payload.get("result"):
                self._send_json({"error": "Send an audit result to render a card."}, status=400)
                return
            buf = io.BytesIO()
            render_card(payload).save(buf, "PNG")
            body = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Disposition", 'attachment; filename="ai-agents-level-calculator-card.png"')
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()


def main():
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("AI Agents Level Calculator running at http://localhost:%d in %s mode." % (port, _mode()))
    print("No signup. Paste the link to your agent and ask for its level chart.")
    server.serve_forever()


if __name__ == "__main__":
    main()
