#!/usr/bin/env python3
"""Mock of pulseedit.com + license-server /claim for testing thank-you.html locally.

Serves the site directory statically and a fake /claim whose behaviour depends on
the session id (so one server covers every scenario):

  cs_test_PEND...   -> pending x3, then ready (single key, flat downloads map)
  cs_test_MULTI...  -> ready at once: 2 keys, nested per-product downloads, mailed:false, amount 130 EUR
  cs_test_MISS...   -> 404 {status:"not_found"}
  cs_test_BAD...    -> 400 {error:"bad_id"}
  cs_test_RATE...   -> 429 retry_in:4 once, then ready
  cs_test_FLAKY...  -> 500 twice, then network-ish garbage (non-JSON 200), then ready
  cs_test_NEVER...  -> pending forever (timeout test)
  anything else     -> 404 {"error":"Not found"} (what the live worker answers TODAY, before /claim exists)

Every /claim hit is appended to requests.log as "<t_ms_since_first_hit_for_sid> <sid> <status>".
"""
import json, os, sys, time, re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

SITE = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/scripts/pulseedit-site')
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'requests.log')

RE_SID = re.compile(r'^cs_(live|test)_[A-Za-z0-9]{20,80}$')
counters = {}
first_seen = {}

FLAT_DL = {
    'macUrl': 'https://pulse-edit-mirror.abtools.workers.dev/PulseEdit-macOS.dmg',
    'winUrl': 'https://pulse-edit-mirror.abtools.workers.dev/PulseEdit-Setup.exe',
    'winZipUrl': 'https://pulse-edit-mirror.abtools.workers.dev/PulseEdit-Windows.zip',
}
NESTED_DL = {
    'pulse_edit': FLAT_DL,
    'pulse_color': {
        'macUrl': 'https://pulse-edit-mirror.abtools.workers.dev/files/PulseColor-macOS.dmg',
        'winUrl': 'https://pulse-edit-mirror.abtools.workers.dev/files/PulseColor-Setup.exe',
    },
    'evil': {'macUrl': 'javascript:alert(1)', 'winUrl': 'http://insecure.example/x.exe'},  # must be dropped
    # https but NOT an allowlisted host (lookalike of the mirror + a bare stranger): must be dropped too
    'phish': {'macUrl': 'https://pulse-edit-mirror.abtools.workers.dev.evil.example/PulseEdit.dmg',
              'winUrl': 'https://evil.example/PulseEdit-Setup.exe'},
}


def claim_response(sid):
    n = counters[sid] = counters.get(sid, 0) + 1
    if 'PEND' in sid:
        if n <= 3:
            return 200, {'status': 'pending', 'retry_in': 2}
        return 200, {'status': 'ready', 'keys': ['PE-TEST-AAAA-BBBB-CCCC-DDDD'], 'product_name': 'Pulse Edit',
                     'downloads': FLAT_DL, 'email_masked': 't***@example.com', 'mailed': True,
                     'source': 'webhook', 'amount': 13, 'currency': 'eur'}
    if 'MULTI' in sid:
        return 200, {'status': 'ready', 'keys': ['PE-MULTI-1111-2222-3333-4444', 'PE-MULTI-5555-6666-7777-8888'],
                     'product_name': 'Pulse Edit', 'downloads': NESTED_DL, 'email_masked': 'a***@studio.it',
                     'mailed': False, 'source': 'claim', 'minted': True, 'amount_total': 13000, 'currency': 'EUR'}
    if 'MISS' in sid:
        return 404, {'status': 'not_found'}
    if 'BAD' in sid:
        return 400, {'error': 'bad_id'}
    if 'RATE' in sid:
        if n == 1:
            return 429, {'error': 'rate_limited', 'retry_in': 4}
        return 200, {'status': 'ready', 'keys': ['PE-RATE-AAAA-BBBB-CCCC-DDDD'], 'product_name': 'Pulse Edit',
                     'downloads': FLAT_DL, 'email_masked': 'r***@example.com', 'mailed': True, 'source': 'webhook'}
    if 'FLAKY' in sid:
        if n <= 2:
            return 500, {'error': 'boom'}
        if n == 3:
            return 200, None  # non-JSON body
        return 200, {'status': 'ready', 'keys': ['PE-FLAKY-AAAA-BBBB-CCCC-DDDD'], 'product_name': 'Pulse Edit',
                     'downloads': {}, 'email_masked': 'f***@example.com', 'mailed': True, 'source': 'replay'}
    if 'NEVER' in sid:
        return 200, {'status': 'pending', 'retry_in': 2}
    return 404, {'error': 'Not found'}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SITE, **kw)

    def log_message(self, fmt, *args):
        pass

    def _cors(self):
        origin = self.headers.get('Origin')
        if origin:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Cache-Control', 'no-store')

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path != '/claim':
            return super().do_GET()
        sid = (parse_qs(u.query).get('session_id') or [''])[0]
        if not RE_SID.match(sid):
            code, body = 400, {'error': 'bad_id'}
        else:
            code, body = claim_response(sid)
        t0 = first_seen.setdefault(sid, time.time())
        with open(LOG, 'a') as f:
            f.write('%d %s %d\n' % (int((time.time() - t0) * 1000), sid, code))
        raw = b'not json at all' if body is None else json.dumps(body).encode()
        self.send_response(code)
        self._cors()
        self.send_header('Content-Type', 'application/json' if body is not None else 'text/plain')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


if __name__ == '__main__':
    open(LOG, 'w').close()
    print('mock on http://localhost:%d serving %s' % (PORT, SITE), flush=True)
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
