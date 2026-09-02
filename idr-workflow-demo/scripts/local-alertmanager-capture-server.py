#!/usr/bin/env python3
"""Loopback-only notification capture server for Alertmanager routing tests."""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--port", required=True, type=int)
parser.add_argument("--output", required=True)
parser.add_argument("--ready-file", required=True)
args = parser.parse_args()
output = Path(args.output)
ready_file = Path(args.ready_file)
allowed = {"/pagerduty-abort", "/slack-abort", "/pagerduty-no-go", "/slack-no-go", "/slack-warning", "/discard"}


class CaptureHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        size = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(size).decode("utf-8", errors="replace")
        if self.path not in allowed:
            self.send_response(404)
            self.end_headers()
            return
        with output.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"path": self.path, "body": body}, separators=(",", ":")) + "\n")
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok\n")

    def log_message(self, _format: str, *_args: object) -> None:
        return


server = ThreadingHTTPServer(("127.0.0.1", args.port), CaptureHandler)
ready_file.write_text("ready\n", encoding="utf-8")
try:
    server.serve_forever(poll_interval=0.2)
finally:
    server.server_close()
