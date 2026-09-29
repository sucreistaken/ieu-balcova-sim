"""Static file server without caching, for local development.

Usage: python3 tools/serve.py [port] [host]   (defaults 8765 and 127.0.0.1), then open http://127.0.0.1:8765/
"""
import http.server
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    host = sys.argv[2] if len(sys.argv) > 2 else '127.0.0.1'
    with http.server.ThreadingHTTPServer((host, port), Handler) as srv:
        print(f'Serving {ROOT} at http://{host}:{port}/')
        srv.serve_forever()
