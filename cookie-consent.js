/* Consenso cookie + analytics — file UNICO per tutto il sito (04/09/2026).
 *
 * ⛔ PERCHE' ESISTE: il banner che RACCOGLIE il consenso viveva solo in start.html,
 * mentre 23 pagine avevano lo script che LEGGE il consenso. Chi atterrava da Google
 * su qualunque altra pagina non vedeva nessun banner, non poteva accettare, e ne'
 * GA4 ne' Cloudflare Insights partivano: i dati di traffico erano ciechi proprio
 * sulle pagine del funnel (pricing, pulse-edit, buy...).
 *
 * Include questo file in ogni pagina, prima di </body>:
 *   <script src="/cookie-consent.js" defer></script>
 *
 * Tutte le guardie sono difensive: se una pagina ha ancora il vecchio blocco inline
 * (start.html, index.html e le altre), NON si duplica niente — ne' il modal, ne' i tag.
 */
(function () {
  'use strict';

  var GA_ID = 'G-JV9DJHLCY2';
  var CF_TOKEN = '090ce13315b84609bc53b871490246d2';
  var CHIAVE = 'cookie_consent';

  function consenso() {
    try { return localStorage.getItem(CHIAVE); } catch (e) { return null; }
  }
  function salva(v) {
    try { localStorage.setItem(CHIAVE, v); } catch (e) { /* private mode: pazienza */ }
  }

  // ── analytics, entrambi dietro consenso ────────────────────────────────────
  function caricaGA() {
    if (window._gaLoaded) return;
    window._gaLoaded = true;
    // se la pagina ha ancora il blocco inline, la sua loadGA fa gia' tutto
    if (typeof window.loadGA === 'function') { window.loadGA(); return; }
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }

  function caricaCF() {
    if (window._cfInsightsLoaded) return;
    window._cfInsightsLoaded = true;
    var s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', '{"token":"' + CF_TOKEN + '"}');
    document.head.appendChild(s);
  }

  function attiva() { caricaGA(); caricaCF(); }

  // ── il modal, iniettato solo se la pagina non ne ha gia' uno ───────────────
  function costruisciModal() {
    if (document.getElementById('cookie-modal')) return document.getElementById('cookie-modal');
    var d = document.createElement('div');
    d.id = 'cookie-modal';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', 'Cookie preferences');
    d.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);' +
      'align-items:center;justify-content:center;z-index:99999;padding:20px;' +
      'font-family:inherit;backdrop-filter:blur(4px);';
    d.innerHTML =
      '<div style="background:#15152a;border:1px solid rgba(255,255,255,0.14);border-radius:16px;' +
      'max-width:440px;width:100%;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">' +
      '<h3 style="color:#fff;font-size:1.25rem;margin:0 0 12px;">Cookies</h3>' +
      '<p style="color:#a0a0b8;font-size:14px;line-height:1.6;margin:0 0 24px;">' +
      'This website uses cookies to enhance your browsing experience and analyze site performance. ' +
      'Cookies are not enabled until you accept. You may update your preferences anytime from the footer. ' +
      '<a href="/privacy.html" style="color:#7c6ff7;">Privacy Policy</a></p>' +
      '<div style="display:flex;gap:10px;">' +
      '<button type="button" data-cc="decline" style="flex:1;background:#2a2a3e;color:#fff;' +
      'border:1px solid rgba(255,255,255,0.3);padding:12px;border-radius:10px;cursor:pointer;' +
      'font-size:14px;font-weight:700;font-family:inherit;">Decline</button>' +
      '<button type="button" data-cc="accept" style="flex:1;background:#7c6ff7;color:#fff;' +
      'border:1px solid #7c6ff7;padding:12px;border-radius:10px;cursor:pointer;' +
      'font-size:14px;font-weight:700;font-family:inherit;">Accept</button>' +
      '</div></div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (ev) {
      var scelta = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-cc');
      if (scelta === 'accept') { salva('accepted'); d.style.display = 'none'; attiva(); }
      if (scelta === 'decline') { salva('declined'); d.style.display = 'none'; }
    });
    return d;
  }

  function mostraModal() { costruisciModal().style.display = 'flex'; }

  // il link in basso a sinistra, per cambiare idea dopo (obbligo GDPR)
  function costruisciLink() {
    // ⛔ la guardia deve vedere ANCHE il link vecchio, che non ha data-cc-manage ma
    // un onclick inline (start.html): senza questo il collaudo trovava 2 link.
    if (document.querySelector('[data-cc-manage], [onclick*="manageCookies"]')) return;
    var a = document.createElement('a');
    a.href = '#';
    a.setAttribute('data-cc-manage', '1');
    a.setAttribute('aria-label', 'Manage cookie preferences');
    a.textContent = '🍪 Manage cookies';
    a.style.cssText = 'position:fixed;bottom:14px;left:14px;background:rgba(15,15,26,0.92);' +
      'color:#9ca3af;border:1px solid rgba(255,255,255,0.12);padding:6px 12px;border-radius:999px;' +
      'font-size:11px;font-family:inherit;text-decoration:none;z-index:99998;backdrop-filter:blur(8px);';
    a.addEventListener('click', function (ev) { ev.preventDefault(); mostraModal(); });
    document.body.appendChild(a);
  }

  // le pagine vecchie chiamano queste dagli onclick inline: restano valide
  window.acceptCookies = function () {
    salva('accepted');
    var m = document.getElementById('cookie-modal');
    if (m) m.style.display = 'none';
    attiva();
  };
  window.declineCookies = function () {
    salva('declined');
    var m = document.getElementById('cookie-modal');
    if (m) m.style.display = 'none';
  };
  window.manageCookies = mostraModal;


  // ══════════════════════════════════════════════════════════════════════════
  // TRACCIAMENTO CLIC — un posto solo, per tutte le pagine.        (06/09/2026)
  //
  // ⛔ PERCHE' STA QUI. Prima ogni pagina aveva (o non aveva) il suo blocco:
  //    67 pagine avevano attributi `data-track`, ma solo 4 avevano un listener
  //    che li leggesse. La HOMEPAGE risultava a ZERO clic in GA — non perche'
  //    nessuno cliccasse, ma perche' nessuno stava ascoltando.
  //    Questo file e' incluso da 75 pagine su 75: metterlo qui li copre tutti.
  //
  // ⛔ E si usa la DELEGA su document, non querySelectorAll: la navigazione e i
  //    modali sono costruiti da pulse-nav.js DOPO, e un listener attaccato ai
  //    nodi esistenti al caricamento non li vedrebbe mai.
  // ══════════════════════════════════════════════════════════════════════════
  var TRACK_URL = 'https://license-server.abtools.workers.dev/track-click';
  var visti = {};

  function invia(evento, dati) {
    // GA solo col consenso (lo garantisce gia' caricaGA, ma gtag potrebbe
    // esistere per altre vie: meglio esplicito).
    if (consenso() === 'accepted' && typeof window.gtag === 'function') {
      try { window.gtag('event', evento, dati); } catch (e) {}
    }
  }

  function postTrack(corpo) {
    // ⛔ /track-click e' analitica di prima parte ma la privacy policy la
    //    dichiara consensuale: prima si chiede, poi si misura.
    if (consenso() !== 'accepted') return;
    try {
      fetch(TRACK_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo), keepalive: true
      }).catch(function () {});
    } catch (e) {}
  }

  // I nomi VERI dei file sul mirror. Le vecchie condizioni cercavano
  // "PulseEdit-macOS.zip" e "PulseEdit-Windows.zip": file che non esistono,
  // quindi download_trial non poteva scattare mai, e i .exe non erano coperti.
  var RE_DOWNLOAD = /\/(PulseEdit|PulseStudio|PulseColor|BeatMarkers)[^\/]*\.(dmg|exe|zip|pkg)(\?|$)/i;

  function piattaforma(href) {
    if (/\.dmg(\?|$)/i.test(href) || /macOS/i.test(href)) return 'macOS';
    if (/\.exe(\?|$)/i.test(href)) return 'Windows';
    return 'altro';
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a, button[data-track]') : null;
    if (!a) return;
    var href = a.href || '';
    var etichetta = a.getAttribute('data-track');

    if (etichetta) postTrack({ edition: etichetta, ref: location.pathname });

    if (RE_DOWNLOAD.test(href)) {
      var file = href.split('/').pop().split('?')[0];
      if (!visti['dl:' + file]) {
        visti['dl:' + file] = true;
        invia('download_trial', {
          event_category: 'conversion', event_label: file,
          file: file, platform: piattaforma(href), link_url: href
        });
      }
    }

    if (href.indexOf('/checkout.html') >= 0 || href.indexOf('buy.stripe.com') >= 0) {
      // ⛔ il piano si LEGGE dall'href invece di scriverlo a mano: prima le
      //    pagine dichiaravano valori diversi (e uno era il prodotto sbagliato).
      var annuale = /plan=yearly/.test(href);
      if (!visti['co:' + href]) {
        visti['co:' + href] = true;
        invia('begin_checkout', {
          event_category: 'conversion', event_label: 'Pulse Edit',
          value: annuale ? 130 : 13, currency: 'EUR',
          plan: annuale ? 'yearly' : 'monthly', link_url: href
        });
      }
    }
  }, true);
  window._pulseTrack = true;

  function avvia() {
    var stato = consenso();
    if (stato === 'accepted') attiva();
    else if (!stato) mostraModal();   // «declined» resta declined: non si richiede
    costruisciLink();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', avvia);
  } else {
    avvia();
  }
})();
