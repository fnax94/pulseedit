# Collaudo della thank-you page (03/09/2026)

`server.py` — mock di pulseedit.com + `/claim` finto (scenari per prefisso del sid: PEND, MULTI, RATE, FLAKY, NEVER…).
`cdp_test.py` — 58 prove su Chrome headless PRIVATO (porta 9333, mai la 9222 di Abramo): pending→ready, 2 chiavi,
404/400/429/500, timeout 120 s, JS disabilitato, senza session_id, URL ripulita, purchase GA4 una volta, clipboard.

    cd ~/scripts/pulseedit-site/tests/claim
    lsof -ti :8765 | xargs kill 2>/dev/null; rm -f requests.log
    python3 server.py ~/scripts/pulseedit-site 8765 &
    SID_SEP='#' python3 cdp_test.py     # payment link (fragment)
    SID_SEP='?' python3 cdp_test.py     # link vecchi (query)

⛔ `requests.log` e' in append e il mock tiene «primo hit per sid» in memoria: uccidere per PORTA (non `pkill -f`,
la cmdline e' `python3 server.py` senza cartella) e cancellare il log prima di ogni giro, o la cadenza dei poll esce falsa.
