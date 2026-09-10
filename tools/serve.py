#!/usr/bin/env python3
"""
tools/serve.py -- static dev server that refuses to be cached.

`python -m http.server` answers with Last-Modified and no cache directives, so
a browser will happily reuse a script it fetched a minute ago. During this
project that silently served a stale config.js through a full reload, and a
measurement taken against it led to a wrong conclusion about gohid behaviour --
the numbers on screen were from code that had already been edited.

Every response here carries no-store, so a reload always fetches the current
file. Serves the project root regardless of the shell's working directory.

    python tools/serve.py [port]
"""

import functools
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # The default logger prints every asset request; only surface problems.
        status = args[1] if len(args) > 1 else ""
        if str(status).startswith(("4", "5")):
            super().log_message(fmt, *args)


class ReusableServer(socketserver.TCPServer):
    # Without this a restart within the TIME_WAIT window fails to bind.
    allow_reuse_address = True


def main():
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with ReusableServer(("", PORT), handler) as httpd:
        print("serving %s at http://localhost:%d  (no-store)" % (ROOT, PORT))
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
