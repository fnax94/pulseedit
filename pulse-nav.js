/* Pulse suite navbar behaviour (shared by every static page):
   - burger toggle for the mobile menu
   - "Download" in the nav opens the two-product chooser modal
     (same modal as pulse-edit.html, built here so every page gets it) */
(function () {
  var nav = document.querySelector('header.nav');
  if (!nav) return;

  // ── Products dropdown — fonte unica per tutte le pagine ──────────────────
  // Raggruppa i prodotti per edizione di Resolve (Abramo, 29/08/2026).
  function pnavCol(title, items) {
    var h = '<div><p style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 8px;color:#6c6557;white-space:nowrap;">' + title + '</p>';
    items.forEach(function (it) {
      h += '<a href="' + it[0] + '" style="display:block;padding:7px 8px;margin:0 -8px;border-radius:8px;text-decoration:none;color:#17150f;">' +
           '<span style="font-weight:700;font-size:14px;letter-spacing:0;text-transform:none;">' + it[1] + '</span>' +
           '<span style="display:block;font-size:12px;color:#6c6557;letter-spacing:0;text-transform:none;margin-top:1px;">' + it[2] + '</span></a>';
    });
    return h + '</div>';
  }
  var links = nav.querySelector('.nav__links');
  if (links) {
    links.innerHTML =
      '<div class="pnav" style="position:relative;display:inline-block;">' +
      '<a href="/#products" class="pnav__t" aria-haspopup="true" aria-expanded="false">Products <span style="font-size:9px;">&#9662;</span></a>' +
      '<div class="pnav__m" style="display:none;position:absolute;left:-18px;top:100%;padding-top:12px;z-index:80;">' +
      '<div style="background:#f3efe6;color:#17150f;border:1px solid rgba(23,21,15,.15);border-radius:14px;box-shadow:0 18px 60px rgba(23,21,15,.22);padding:18px 20px;min-width:560px;display:grid;grid-template-columns:1fr 1fr;gap:22px;text-align:left;">' +
      pnavCol('For DaVinci Resolve Free', [
        ['/pulse-edit.html', 'Pulse Edit', 'Beat-synced auto-edit, via OTIO'],
        ['/pulse-color.html', 'Pulse Color', 'Film looks &amp; filter FX (Studio too)']]) +
      pnavCol('For DaVinci Resolve Studio', [
        ['/pulse-studio.html', 'Pulse Studio', 'The whole edit, built inside Resolve'],
        ['/pulse-color.html', 'Pulse Color', 'Film looks &amp; filter FX']]) +
      '</div></div></div>' +
      '<a href="/#pricing">Pricing</a><a href="/blog/">Blog</a>';

    var pn = links.querySelector('.pnav');
    var pt = pn.querySelector('.pnav__t');
    var pm = pn.querySelector('.pnav__m');
    var hideT = null;
    function openM() { clearTimeout(hideT); pm.style.display = 'block'; pt.setAttribute('aria-expanded', 'true'); }
    function closeM() { pm.style.display = 'none'; pt.setAttribute('aria-expanded', 'false'); }
    pn.addEventListener('mouseenter', openM);
    pn.addEventListener('mouseleave', function () { hideT = setTimeout(closeM, 180); });
    pt.addEventListener('click', function (e) {
      if (pm.style.display === 'none') { e.preventDefault(); openM(); }
    });
    document.addEventListener('click', function (e) {
      if (!pn.contains(e.target)) closeM();
    });
  }

  // Mobile: sostituisci i link prodotto con i due gruppi per edizione
  var mob0 = nav.querySelector('.mobile');
  if (mob0) {
    var prodHrefs = ['/pulse-edit.html', '/pulse-studio.html', '/pulse-color.html'];
    var first = null;
    prodHrefs.forEach(function (h) {
      mob0.querySelectorAll('a[href="' + h + '"]').forEach(function (a) {
        if (!first) first = a;
        else a.remove();
      });
    });
    if (first) {
      var grp = document.createElement('div');
      grp.innerHTML =
        '<p style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;margin:4px 0 2px;opacity:.6;">For DaVinci Resolve Free</p>' +
        '<a href="/pulse-edit.html">Pulse Edit</a>' +
        '<a href="/pulse-color.html">Pulse Color</a>' +
        '<p style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;margin:10px 0 2px;opacity:.6;">For DaVinci Resolve Studio</p>' +
        '<a href="/pulse-studio.html">Pulse Studio</a>' +
        '<a href="/pulse-color.html">Pulse Color</a>';
      first.replaceWith(grp);
      // rimuovi l\'eventuale primo link superstite di altri prodotti
      prodHrefs.forEach(function (h) {
        mob0.querySelectorAll('a[href="' + h + '"]').forEach(function (a) {
          if (!grp.contains(a)) a.remove();
        });
      });
    }
  }

  var burger = nav.querySelector('.nav__burger');
  var mobile = nav.querySelector('.mobile');
  if (burger && mobile) {
    burger.addEventListener('click', function () {
      var open = mobile.classList.toggle('open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('menu-open', open);
    });
    mobile.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a')) {
        mobile.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('menu-open');
      }
    });
  }

  // Download chooser modal (skip if the page ships its own, e.g. pulse-edit.html)
  if (document.getElementById('dl-modal')) return;
  var wrap = document.createElement('div');
  wrap.innerHTML =
    '<div id="dl-modal" style="display:none;position:fixed;inset:0;z-index:999;background:rgba(23,21,15,.55);backdrop-filter:blur(4px);" role="dialog" aria-modal="true" aria-label="Download">' +
    '<div style="max-width:680px;margin:8vh auto 0;background:#f3efe6;color:#17150f;border-radius:16px;padding:28px;box-shadow:0 24px 80px rgba(23,21,15,.35);font-family:\'Hanken Grotesk\',system-ui,sans-serif;position:relative;">' +
    '<button id="dl-close" aria-label="Close" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;cursor:pointer;color:#17150f;">×</button>' +
    '<p style="font-family:\'IBM Plex Mono\',monospace;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 6px;color:#6c6557;">Downloads · one license, both tools</p>' +
    '<h2 style="font-family:\'Bricolage Grotesque\',sans-serif;font-size:26px;margin:0 0 18px;">Pick your tool</h2>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;">' +
    '<div style="border:1px solid rgba(23,21,15,.2);border-radius:12px;padding:18px;">' +
    '<h3 style="margin:0 0 4px;font-size:18px;">Pulse Edit</h3>' +
    '<p style="margin:0 0 12px;font-size:14px;color:#6c6557;">Beat-synced auto-editing. Cuts your footage to the music.</p>' +
    '<a href="https://pulse-edit-mirror.abtools.workers.dev/files/PulseEdit-macOS.dmg" style="display:block;background:#17150f;color:#f3efe6;text-align:center;border-radius:8px;padding:9px 0;text-decoration:none;font-weight:700;margin-bottom:8px;">↓ macOS (Apple Silicon)</a>' +
    '<a href="https://pulse-edit-mirror.abtools.workers.dev/files/PulseEdit-Setup.exe" style="display:block;border:1px solid rgba(23,21,15,.4);color:#17150f;text-align:center;border-radius:8px;padding:9px 0;text-decoration:none;font-weight:700;">↓ Windows</a>' +
    '</div>' +
    '<div style="border:1px solid #e8472b;border-radius:12px;padding:18px;">' +
    '<h3 style="margin:0 0 4px;font-size:18px;">Pulse Color <span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#e8472b;">NEW</span></h3>' +
    '<p style="margin:0 0 12px;font-size:14px;color:#6c6557;">Pro-Mist &amp; halation filters + film looks for 18 log formats.</p>' +
    '<a href="https://pulse-edit-mirror.abtools.workers.dev/files/PulseColor-macOS.dmg" style="display:block;background:#e8472b;color:#f3efe6;text-align:center;border-radius:8px;padding:9px 0;text-decoration:none;font-weight:700;margin-bottom:8px;">↓ macOS (Intel &amp; Apple Silicon)</a>' +
    '<a href="https://pulse-edit-mirror.abtools.workers.dev/files/PulseColor-Setup.exe" style="display:block;border:1px solid rgba(23,21,15,.4);color:#17150f;text-align:center;border-radius:8px;padding:9px 0;text-decoration:none;font-weight:700;">↓ Windows</a>' +
    '</div></div>' +
    '<p style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#9a9384;margin:16px 0 0;">Free to install — both activate with the same Pulse license. macOS builds notarized by Apple, Windows signed.</p>' +
    '</div></div>';
  document.body.appendChild(wrap.firstChild);

  var m = document.getElementById('dl-modal');
  function apri(e) { e.preventDefault(); m.style.display = 'block'; }
  function chiudi() { m.style.display = 'none'; }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (a && /Download/.test(a.textContent || '') && /pulse-edit-mirror/.test(a.href || '') && a.closest('header.nav')) apri(e);
    if (e.target === m) chiudi();
  }, true);
  document.getElementById('dl-close').addEventListener('click', chiudi);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') chiudi(); });
})();
