#!/usr/bin/env python3
"""Drive a private headless Chrome (CDP, port 9333) against the mock server.

- Requests to https://license-server.abtools.workers.dev/claim are intercepted (Fetch domain)
  and proxied to the local mock, so the page is tested with its PRODUCTION URL and fetch options.
- googletagmanager / google-analytics / fonts are blocked: no real GA hit leaves this machine.
"""
import asyncio, base64, json, os, subprocess, sys, time, urllib.request, urllib.error
import websockets

SCRATCH = os.path.dirname(os.path.abspath(__file__))
MOCK = 'http://127.0.0.1:8765'
PAGE = 'http://localhost:8765/thank-you.html'
CDP_PORT = 9333
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
LOG = os.path.join(SCRATCH, 'requests.log')

results = []


def ok(name, cond, detail=''):
    results.append((bool(cond), name, detail))
    print(('  PASS ' if cond else '  FAIL ') + name + ((' — ' + str(detail)) if detail else ''), flush=True)


class Page:
    def __init__(self, ws):
        self.ws = ws
        self.id = 0
        self.pending = {}
        self.events = asyncio.Queue()
        self.reader = asyncio.create_task(self._read())

    async def _read(self):
        async for raw in self.ws:
            m = json.loads(raw)
            if 'id' in m and m['id'] in self.pending:
                self.pending.pop(m['id']).set_result(m)
            elif 'method' in m:
                if m['method'] == 'Fetch.requestPaused':
                    asyncio.create_task(self._intercept(m['params']))
                else:
                    await self.events.put(m)

    async def send(self, method, **params):
        self.id += 1
        fut = asyncio.get_event_loop().create_future()
        self.pending[self.id] = fut
        await self.ws.send(json.dumps({'id': self.id, 'method': method, 'params': params}))
        r = await fut
        if 'error' in r:
            raise RuntimeError('%s: %s' % (method, r['error']))
        return r.get('result', {})

    async def _intercept(self, p):
        url = p['request']['url']
        rid = p['requestId']
        if 'license-server.abtools.workers.dev/claim' in url:
            # sanity on what the page sends
            hdrs = {k.lower(): v for k, v in p['request']['headers'].items()}
            self.last_claim_headers = hdrs
            self.last_claim_url = url
            q = url.split('?', 1)[1] if '?' in url else ''
            try:
                r = urllib.request.urlopen(MOCK + '/claim?' + q, timeout=5)
                status, body, ctype = r.status, r.read(), r.headers.get('Content-Type', 'application/json')
            except urllib.error.HTTPError as e:
                status, body, ctype = e.code, e.read(), e.headers.get('Content-Type', 'application/json')
            headers = [
                {'name': 'Content-Type', 'value': ctype},
                {'name': 'Access-Control-Allow-Origin', 'value': hdrs.get('origin', 'http://localhost:8765')},
                {'name': 'Vary', 'value': 'Origin'},
                {'name': 'Cache-Control', 'value': 'no-store'},
            ]
            await self.send('Fetch.fulfillRequest', requestId=rid, responseCode=status, responseHeaders=headers,
                            body=base64.b64encode(body).decode())
        else:
            await self.send('Fetch.failRequest', requestId=rid, errorReason='BlockedByClient')

    async def eval(self, expr):
        r = await self.send('Runtime.evaluate', expression=expr, returnByValue=True, awaitPromise=True)
        if 'exceptionDetails' in r:
            raise RuntimeError(json.dumps(r['exceptionDetails'])[:400])
        return r['result'].get('value')

    async def goto(self, url):
        # Un URL che differisce solo per il «#» e' una fragment navigation (nessun reload): nel flusso
        # reale si arriva da checkout.stripe.com (cross-document), qui si passa da about:blank.
        if '#' in url:
            await self.send('Page.navigate', url='about:blank')
            await asyncio.sleep(0.3)
        await self.send('Page.navigate', url=url)
        # wait for load
        t = time.time()
        while time.time() - t < 10:
            try:
                if await self.eval('document.readyState') == 'complete':
                    return
            except Exception:
                pass
            await asyncio.sleep(0.1)

    async def wait_for(self, expr, timeout, poll=0.25):
        t = time.time()
        while time.time() - t < timeout:
            try:
                v = await self.eval(expr)
                if v:
                    return v, time.time() - t
            except Exception:
                pass
            await asyncio.sleep(poll)
        return None, time.time() - t


def mock_log(sid):
    with open(LOG) as f:
        return [(int(l.split()[0]), int(l.split()[2])) for l in f if l.split()[1] == sid]


STATE = """(function(){var g=function(i){return document.getElementById(i)};return {
  href: location.href,
  stored: (function(){try{return sessionStorage.getItem('pe_claim_sid')}catch(e){return 'ERR'}})(),
  claimHidden: g('claim').hidden,
  pending: !g('claim-pending').hidden, ready: !g('claim-ready').hidden, fail: !g('claim-fail').hidden,
  h1sub: g('h1-sub').textContent, lede: g('lede').textContent,
  keys: Array.from(document.querySelectorAll('#keys code')).map(function(c){return c.textContent}),
  copyBtns: document.querySelectorAll('#keys .btn--copy').length,
  dl: Array.from(document.querySelectorAll('#dl-wrap a')).map(function(a){return [a.textContent,a.href,a.className]}),
  dlGroups: Array.from(document.querySelectorAll('#dl-wrap .dl__label')).map(function(a){return a.textContent}),
  mail: g('mail').textContent,
  staticDlHidden: g('static-dl').hidden,
  stepMail: g('step-mail').textContent,
  purchases: (window.dataLayer||[]).filter(function(a){return a[0]==='event'&&a[1]==='purchase'}).map(function(a){return a[2]}),
  outcomes: (window.dataLayer||[]).filter(function(a){return a[0]==='event'&&a[1]==='claim_outcome'}).map(function(a){return a[2]}),
  title: document.title,
  referrer: (document.querySelector('meta[name=referrer]')||{}).content,
  scriptOrder: Array.from(document.head.querySelectorAll('script')).map(function(s){return s.src||s.textContent.slice(0,40).replace(/\\s+/g,' ')})
}})()"""


SEP = os.environ.get('SID_SEP', '?')   # '?' = link vecchi · '#' = payment link dal 03/09 (fragment)

async def scenario(pg, name, sid, wait_ready=14):
    print('\n== %s (%s)' % (name, sid or 'no session_id'), flush=True)
    url = PAGE + (SEP + 'session_id=' + sid if sid is not None else '')
    await pg.goto(url)
    s0 = await pg.eval(STATE)
    return s0


async def main():
    prof = os.path.join(SCRATCH, 'chrome-profile')
    subprocess.run(['rm', '-rf', prof])
    chrome = subprocess.Popen([CHROME, '--headless=new', '--remote-debugging-port=%d' % CDP_PORT,
                               '--user-data-dir=' + prof, '--no-first-run', '--no-default-browser-check',
                               '--window-size=390,844', 'about:blank'],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                ver = json.load(urllib.request.urlopen('http://127.0.0.1:%d/json/version' % CDP_PORT))
                break
            except Exception:
                time.sleep(0.2)
        print('Chrome', ver['Browser'], flush=True)
        req = urllib.request.Request('http://127.0.0.1:%d/json/new?about:blank' % CDP_PORT, method='PUT')
        tab = json.load(urllib.request.urlopen(req))
        async with websockets.connect(tab['webSocketDebuggerUrl'], max_size=None) as ws:
            pg = Page(ws)
            await pg.send('Page.enable')
            await pg.send('Runtime.enable')
            await pg.send('Emulation.setDeviceMetricsOverride', width=390, height=844, deviceScaleFactor=2, mobile=True)
            await pg.send('Fetch.enable', patterns=[
                {'urlPattern': '*license-server.abtools.workers.dev/*'},
                {'urlPattern': '*googletagmanager.com/*'}, {'urlPattern': '*google-analytics.com/*'},
                {'urlPattern': '*fonts.googleapis.com/*'}, {'urlPattern': '*fonts.gstatic.com/*'},
            ])
            try:
                await pg.send('Browser.grantPermissions', permissions=['clipboardReadWrite', 'clipboardSanitizedWrite'],
                              origin='http://localhost:8765')
            except Exception as e:
                print('  (clipboard permission not granted: %s)' % str(e)[:80])

            # ---------- A. PEND: pending x3 then ready ----------
            sid = 'cs_test_PEND' + 'a1B2c3D4e5F6g7H8i9J0k1L2'
            t_nav = time.time()
            s = await scenario(pg, 'A. pending x3 -> ready', sid)
            ok('meta referrer no-referrer', s['referrer'] == 'no-referrer', s['referrer'])
            ok('session capture script is the FIRST head script, before gtag',
               'STORE' in s['scriptOrder'][0] and 'dataLayer' in s['scriptOrder'][1], s['scriptOrder'][:2])
            ok('URL stripped of session_id', s['href'] == PAGE, s['href'])
            ok('sid in sessionStorage', s['stored'] == sid, s['stored'])
            ok('claim box visible + pending state', (not s['claimHidden']) and s['pending'] and not s['ready'] and not s['fail'])
            ok('no purchase before response', len(s['purchases']) == 0, s['purchases'])
            ok('title says Pulse Edit (no "Free")', s['title'] == 'Thank you — Pulse Edit', s['title'])
            ok('lede says Pulse Edit (no "Free")', 'Pulse Edit' in s['lede'] and 'Free' not in s['lede'], s['lede'])
            v, dt = await pg.wait_for("!document.getElementById('claim-ready').hidden", 20)
            s = await pg.eval(STATE)
            ok('ready state reached', v, 'after %.1fs from load' % (time.time() - t_nav))
            ok('key rendered', s['keys'] == ['PE-TEST-AAAA-BBBB-CCCC-DDDD'], s['keys'])
            ok('copy button present', s['copyBtns'] == 1, s['copyBtns'])
            ok('downloads from response (mac, win buttons + zip link)',
               [d[0] for d in s['dl']] == ['Download — macOS', 'Download — Windows', 'Windows portable ZIP'], s['dl'])
            ok('static fallback downloads hidden', s['staticDlHidden'])
            ok('mail line masked + spam hint', 't***@example.com' in s['mail'] and 'spam' in s['mail'] and 'also sent' in s['mail'], s['mail'])
            ok('h1/lede/step updated', s['h1sub'] == 'Your license is ready.' and 'Copy your license key' in s['stepMail'], s['h1sub'])
            ok('purchase fired once on ready, no claim_outcome', len(s['purchases']) == 1 and len(s['outcomes']) == 0, (s['purchases'], s['outcomes']))
            if s['purchases']:
                p = s['purchases'][0]
                ok('transaction_id = 10-hex hash, not the sid',
                   len(p['transaction_id']) == 10 and all(c in '0123456789abcdef' for c in p['transaction_id']) and sid not in json.dumps(p), p['transaction_id'])
                exp = await pg.eval("crypto.subtle.digest('SHA-256', new TextEncoder().encode('%s')).then(function(b){return Array.from(new Uint8Array(b)).slice(0,5).map(function(x){return ('0'+x.toString(16)).slice(-2)}).join('')})" % sid)
                ok('transaction_id == first 10 hex of sha-256(sid)', p['transaction_id'] == exp, '%s vs %s' % (p['transaction_id'], exp))
                ok('value/currency from response (13 EUR), item_name from product_name',
                   p.get('value') == 13 and p.get('currency') == 'EUR' and p['items'][0]['item_name'] == 'Pulse Edit' and p['items'][0].get('price') == 13, p)
            cad = mock_log(sid)
            ok('poll cadence 3s, +2s, +2s, +2s (mock log ms)', len(cad) == 4 and all(abs(cad[i][0] - 2000 * i) < 400 for i in range(4)), cad)
            ok('fetch sent no cookies/credentials header, Accept json',
               'cookie' not in pg.last_claim_headers and pg.last_claim_headers.get('accept') == 'application/json', pg.last_claim_headers)
            ok('fetch URL = production endpoint with sid', pg.last_claim_url == 'https://license-server.abtools.workers.dev/claim?session_id=' + sid, pg.last_claim_url)
            # copy button
            await pg.send('Emulation.setFocusEmulationEnabled', enabled=True)
            box = await pg.eval("(function(){var r=document.querySelector('#keys .btn--copy').getBoundingClientRect();return [r.x+r.width/2, r.y+r.height/2]})()")
            for typ in ('mouseMoved', 'mousePressed', 'mouseReleased'):
                await pg.send('Input.dispatchMouseEvent', type=typ, x=box[0], y=box[1], button='left', clickCount=1)
            await asyncio.sleep(0.4)
            btxt = await pg.eval("document.querySelector('#keys .btn--copy').textContent")
            clip = None
            try:
                clip = await pg.eval('navigator.clipboard.readText()')
            except Exception as e:
                clip = 'ERR ' + str(e)[:60]
            ok('copy button feedback', btxt in ('Copied', 'Select & copy'), btxt)
            ok('clipboard holds the key', clip == 'PE-TEST-AAAA-BBBB-CCCC-DDDD', clip)
            await asyncio.sleep(2.4)
            ok('copy button label restored', await pg.eval("document.querySelector('#keys .btn--copy').textContent") == 'Copy')
            # reload: sid from sessionStorage, no duplicate purchase
            await pg.send('Page.reload')
            await asyncio.sleep(1.0)
            s = await pg.eval(STATE)
            ok('after reload: URL clean, sid recovered from sessionStorage, pending shown', s['href'] == PAGE and s['stored'] == sid and s['pending'], (s['href'], s['stored'], s['pending']))
            v, _ = await pg.wait_for("!document.getElementById('claim-ready').hidden", 8)
            s = await pg.eval(STATE)
            ok('after reload: ready again (KV-first)', v and s['keys'] == ['PE-TEST-AAAA-BBBB-CCCC-DDDD'])
            ok('after reload: purchase NOT re-fired, no outcome either', len(s['purchases']) == 0 and len(s['outcomes']) == 0, (s['purchases'], s['outcomes']))

            # ---------- B. MULTI ----------
            sid = 'cs_test_MULTI' + 'a1B2c3D4e5F6g7H8i9J0k1L'
            await scenario(pg, 'B. two keys, nested downloads, mailed:false, amount_total', sid)
            v, _ = await pg.wait_for("!document.getElementById('claim-ready').hidden", 8)
            s = await pg.eval(STATE)
            ok('ready', v)
            ok('two keys, two copy buttons', len(s['keys']) == 2 and s['copyBtns'] == 2, s['keys'])
            ok('title plural', await pg.eval("document.getElementById('ready-title').textContent") == 'Your Pulse Edit license keys')
            ok('download groups per product, evil + phish groups dropped', [g.lower() for g in s['dlGroups']] == ['pulse edit', 'pulse color'], s['dlGroups'])
            ok('no javascript:/http: links rendered', all(d[1].startswith('https://') for d in s['dl']) and len(s['dl']) == 5, s['dl'])
            ALLOWED = ('pulse-edit-mirror.abtools.workers.dev', 'github.com', 'objects.githubusercontent.com', 'pulseedit.com', 'www.pulseedit.com')
            ok('safeUrl allowlist: every rendered host is allowlisted, the https lookalike/stranger hosts are gone',
               all(d[1].split('/')[2].lower() in ALLOWED for d in s['dl']) and not any('evil' in d[1] for d in s['dl']), [d[1] for d in s['dl']])
            ok('mailed:false copy', s['mail'].startswith('The email is on its way to a***@studio.it'), s['mail'])
            ok('purchase value from amount_total (13000 -> 130)', s['purchases'] and s['purchases'][0].get('value') == 130 and s['purchases'][0].get('currency') == 'EUR', s['purchases'])

            # ---------- C. MISS (404 not_found) ----------
            sid = 'cs_test_MISS' + 'a1B2c3D4e5F6g7H8i9J0k1L2'
            t_nav = time.time()
            await scenario(pg, 'C. 404 not_found', sid)
            v, _ = await pg.wait_for("!document.getElementById('claim-fail').hidden", 8)
            s = await pg.eval(STATE)
            ok('fail state after first poll', v and s['fail'] and not s['pending'], 'after %.1fs' % (time.time() - t_nav))
            ok('fail copy: email + support address', 'support@pulseedit.com' in await pg.eval("document.getElementById('claim-fail').textContent"))
            ok('static downloads still visible', not s['staticDlHidden'])
            ok('h1 sub -> Check your email.', s['h1sub'] == 'Check your email.', s['h1sub'])
            ok('404: NO purchase, claim_outcome not_found (hashed id)', len(s['purchases']) == 0 and [o.get('outcome') for o in s['outcomes']] == ['not_found'] and len(s['outcomes'][0].get('transaction_id', '')) == 10 and sid not in json.dumps(s['outcomes']), (s['purchases'], s['outcomes']))
            await asyncio.sleep(2.5)
            ok('404 is terminal: exactly one request', len(mock_log(sid)) == 1, mock_log(sid))

            # ---------- D. BAD (400) ----------
            sid = 'cs_test_BAD' + 'a1B2c3D4e5F6g7H8i9J0k1L2m'
            await scenario(pg, 'D. 400 bad_id', sid)
            v, _ = await pg.wait_for("!document.getElementById('claim-fail').hidden", 8)
            await asyncio.sleep(2.5)
            ok('fail state, terminal', v and len(mock_log(sid)) == 1, mock_log(sid))
            s = await pg.eval(STATE)
            ok('400: NO purchase, claim_outcome bad_id', len(s['purchases']) == 0 and [o.get('outcome') for o in s['outcomes']] == ['bad_id'], (s['purchases'], s['outcomes']))

            # ---------- E. RATE (429 retry_in 4) ----------
            sid = 'cs_test_RATE' + 'a1B2c3D4e5F6g7H8i9J0k1L2'
            await scenario(pg, 'E. 429 retry_in:4 then ready', sid)
            v, _ = await pg.wait_for("!document.getElementById('claim-ready').hidden", 12)
            cad = mock_log(sid)
            ok('ready after honoring retry_in (2nd poll >= 4s after the 429, not 2s)', v and len(cad) == 2 and 3800 <= cad[1][0] <= 4600, cad)

            # ---------- F. FLAKY (500,500,garbage,ready) ----------
            sid = 'cs_test_FLAKY' + 'a1B2c3D4e5F6g7H8i9J0k1L'
            await scenario(pg, 'F. 500 x2, non-JSON, then ready', sid)
            v, _ = await pg.wait_for("!document.getElementById('claim-ready').hidden", 12)
            s = await pg.eval(STATE)
            cad = mock_log(sid)
            ok('ready after retries', v and len(cad) == 4, cad)
            ok('empty downloads -> static fallback stays visible', not s['staticDlHidden'] and s['dl'] == [])

            # ---------- H. no session_id ----------
            await pg.eval('sessionStorage.clear()')
            s = await scenario(pg, 'H. no session_id', None)
            ok('claim box hidden, static page', s['claimHidden'] and s['href'] == PAGE)
            ok('no purchase event, no claim_outcome', len(s['purchases']) == 0 and len(s['outcomes']) == 0)
            await asyncio.sleep(3.6)
            ok('no /claim request at all', not os.path.getsize(LOG) or all(l.split()[1] != '' for l in open(LOG)))

            # ---------- I. unknown sid: live worker TODAY answers generic 404 ----------
            sid = 'cs_live_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'
            await scenario(pg, 'I. generic 404 {"error":"Not found"} (worker before /claim ships)', sid)
            v, _ = await pg.wait_for("!document.getElementById('claim-fail').hidden", 8)
            ok('graceful fail state', v)
            s = await pg.eval(STATE)
            ok('generic 404: claim_outcome not_found, no purchase', len(s['purchases']) == 0 and [o.get('outcome') for o in s['outcomes']] == ['not_found'], (s['purchases'], s['outcomes']))

            # ---------- J. malformed sid ----------
            await pg.eval('sessionStorage.clear()')
            await scenario(pg, 'J. malformed session_id=hello', 'hello')
            s = await pg.eval(STATE)
            ok('URL stripped, claim hidden (static page)', s['href'] == PAGE and s['claimHidden'], s['href'])
            await asyncio.sleep(0.5)
            s = await pg.eval(STATE)
            ok('malformed id: NO purchase, claim_outcome bad_id with a hashed id', len(s['purchases']) == 0 and [o.get('outcome') for o in s['outcomes']] == ['bad_id'] and s['outcomes'][0]['transaction_id'] != 'hello', (s['purchases'], s['outcomes']))

            # ---------- K. JS disabled ----------
            await pg.send('Emulation.setScriptExecutionDisabled', value=True)
            sid = 'cs_test_PEND' + 'z1B2c3D4e5F6g7H8i9J0k1L2'
            if SEP == '#': await pg.send('Page.navigate', url='about:blank'); await asyncio.sleep(0.3)
            await pg.send('Page.navigate', url=PAGE + SEP + 'session_id=' + sid)
            await asyncio.sleep(1.5)
            html = (await pg.send('Runtime.evaluate', expression='1')) if False else None
            dom = await pg.send('DOM.getDocument', depth=-1)
            outer = await pg.send('DOM.getOuterHTML', nodeId=dom['root']['nodeId'])
            h = outer['outerHTML']
            ok('JS off: claim box stays hidden attr, static copy present',
               'id="claim" hidden' in h and 'on their way to your email' in h and 'Download — macOS' in h)
            await pg.send('Emulation.setScriptExecutionDisabled', value=False)

            # ---------- G. NEVER: full timeout (120 s) ----------
            sid = 'cs_test_NEVER' + 'a1B2c3D4e5F6g7H8i9J0k1L'
            t_nav = time.time()
            await scenario(pg, 'G. pending forever -> timeout at 120s (this takes 2 minutes)', sid)
            v, _ = await pg.wait_for("!document.getElementById('claim-fail').hidden", 135, poll=1.0)
            s = await pg.eval(STATE)
            cad = [c[0] for c in mock_log(sid)]
            print('  cadence (s):', [round(c / 1000, 1) for c in cad])
            expected = list(range(3000, 30000, 2000)) + [31000] + list(range(36000, 120001, 5000))
            ok('timeout -> fail state', v and s['fail'], 'after %.0fs' % (time.time() - t_nav))
            ok('%d polls, cadence 3..29 by 2, 31, 36..116 by 5' % len(expected),
               len(cad) == len(expected) and all(abs(a + 3000 - b) < 600 for a, b in zip(cad, expected)), (len(cad), cad[-3:]))
            ok('timeout: NO purchase, claim_outcome timeout', len(s['purchases']) == 0 and [o.get('outcome') for o in s['outcomes']] == ['timeout'], (s['purchases'], s['outcomes']))

            # screenshots for the report
            for nm, sid in (('ready', 'cs_test_PENDa1B2c3D4e5F6g7H8i9J0k1L2'), ('fail', 'cs_test_MISSa1B2c3D4e5F6g7H8i9J0k1L2'), ('nosid', None)):
                await scenario(pg, 'shot ' + nm, sid)
                if sid:
                    await pg.wait_for("document.getElementById('claim-pending').hidden", 12)
                shot = await pg.send('Page.captureScreenshot', format='png', captureBeyondViewport=True)
                with open(os.path.join(SCRATCH, 'shot_%s.png' % nm), 'wb') as f:
                    f.write(base64.b64decode(shot['data']))
            await pg.send('Emulation.setDeviceMetricsOverride', width=1280, height=900, deviceScaleFactor=1, mobile=False)
            await scenario(pg, 'shot desktop pending', 'cs_test_NEVERb1B2c3D4e5F6g7H8i9J0k1L')
            await asyncio.sleep(0.5)
            shot = await pg.send('Page.captureScreenshot', format='png', captureBeyondViewport=True)
            with open(os.path.join(SCRATCH, 'shot_desktop_pending.png'), 'wb') as f:
                f.write(base64.b64decode(shot['data']))
    finally:
        chrome.terminate()
    n_ok = sum(1 for r in results if r[0])
    print('\n%d/%d checks passed' % (n_ok, len(results)))
    for r in results:
        if not r[0]:
            print('FAILED:', r[1], r[2])
    sys.exit(0 if n_ok == len(results) else 1)


asyncio.run(main())
