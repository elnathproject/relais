/*
 * Relais for ensembles: the display seen by the performers.
 * Copyright (c) 2026 Elnath Project (Alessandro Ciccarelli)
 * Released under the MIT License: see the LICENSE file.
 */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
                  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  // anonymous id: lets the conductor see how many displays are connected
  let id = store.get('relais.display');
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)); store.set('relais.display', id); }
  const code = new URLSearchParams(location.search).get('code') || '';

  let S = null, wake = null;

  // ---- polling: the whole state only when it has changed (rev), otherwise the clock alone ----
  const POLL_MS = 600, CLOSED_POLL_MS = 3000; // while closed, the page asks less often
  let closed = false;
  async function poll() {
    for (;;) {
      try {
        const t0 = Date.now();
        const rev = S ? `&rev=${S.rev}` : '';
        const r = await fetch(`api.php?a=poll&id=${encodeURIComponent(id)}&code=${encodeURIComponent(code)}${rev}`, { cache: 'no-store' });
        const j = await r.json();
        if (j.error === 'https') return needHttps();
        if (j.error === 'code') return refused('This address needs the ensemble code.', 'Ask the conductor for the full address.');
        Relais.sample(t0, j.now, Date.now());
        closed = !!j.closed;
        $('closed').hidden = !closed;
        if (closed) S = null; // nothing is known while the timer is closed
        else { $('dot').classList.add('on'); if (!j.same) S = j; }
      } catch (e) { $('dot').classList.remove('on'); }
      await new Promise(r => setTimeout(r, closed ? CLOSED_POLL_MS : POLL_MS));
    }
  }
  function refused(what, hint) {
    $('gate').hidden = false;
    const msg = $('gateMsg'), err = document.createElement('span');
    err.className = 'err'; err.textContent = what;
    msg.textContent = '';
    msg.append(err, document.createElement('br'), hint);
    $('gateTap').hidden = true;
  }
  // the server answers only over HTTPS
  function needHttps() {
    if (location.protocol === 'http:') location.replace('https:' + location.href.slice(5));
    else refused('The server does not recognise this connection as HTTPS.', 'Tell the conductor: see FORCE_HTTPS in config.php.');
  }

  // ---- drawing: every frame, from the clock ----
  let last = { kind: null, i: -1, title: '', seekKey: '' };
  function colors(bg, fg) {
    const st = $('stage').style;
    st.setProperty('--seg-bg', bg); st.setProperty('--seg-fg', fg); st.setProperty('--seg-ink', Relais.ink(bg));
  }
  function setTitle(text, blink) {
    const el = $('ttl');
    if (el.textContent !== text) { el.textContent = text; Relais.fitTitle(el, $('ttlBox')); }
    if (blink) { el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); }
  }
  function vibrate() { if (S && S.vibrate) try { navigator.vibrate && navigator.vibrate([200, 80, 200]); } catch (e) {} }
  function frame() {
    const v = S ? Relais.view(S) : { kind: 'idle' };
    document.body.dataset.kind = v.kind;
    document.body.classList.toggle('paused', !!v.paused);
    document.body.classList.toggle('waiting', !!v.waiting);
    const label = $('label');
    if (v.kind === 'idle') { colors('#0d0f10', '#f2a541'); setTitle('Relais', false); label.textContent = 'Waiting for the conductor'; }
    else if (v.kind === 'title' || v.kind === 'next') {
      colors(v.bg, v.fg);
      // the next title appears while watching: it blinks, as in the app
      setTitle(v.piece.name, v.kind === 'next' && last.kind === 'run');
      if (v.kind === 'next' && last.kind === 'run') vibrate();
      const pos = v.kind === 'next' ? S.pos + 1 : S.pos;
      label.textContent = S.list ? `${pos + 1}/${S.count} · ${S.setlist}` : 'Ready';
      const key = JSON.stringify([v.piece.segments, v.seek]);
      if (key !== last.seekKey) {
        last.seekKey = key;
        Relais.strip($('strip'), v.piece);
        Relais.placeHead($('scrub'), $('strip'), $('head'), $('past'), v.piece, v.seek);
        $('pos').textContent = Relais.seekText(v.piece, v.seek);
      }
    } else if (v.kind === 'end') {
      colors(v.bg, v.fg); setTitle('End', last.kind === 'run');
      if (last.kind === 'run') vibrate();
      label.textContent = `End · ${S.setlist}`;
    } else { // run, done
      colors(v.bg, v.fg);
      if (v.kind === 'run' && last.kind === 'run' && v.i > last.i) vibrate();
      if (v.kind === 'done' && last.kind === 'run') vibrate();
      Relais.draw($('digits'), $('fit'), v.text, v.fg, v.lit);
      label.textContent = v.kind === 'done' ? `End · ${v.piece.name}` : v.paused ? `Paused · ${v.i + 1}/${v.n}`
                        : v.waiting ? 'Starting' : `${v.i + 1}/${v.n} · ${v.piece.name}${v.timer ? ' · timer' : ''}`;
    }
    // a title box hidden until now has no size: fit it again whenever the kind of screen changes
    if (v.kind !== last.kind) Relais.fitTitle($('ttl'), $('ttlBox'));
    last.kind = v.kind; last.i = v.i ?? -1;
    requestAnimationFrame(frame);
  }
  new ResizeObserver(() => {
    Relais.fitTitle($('ttl'), $('ttlBox'));
    const v = S ? Relais.view(S) : null;
    if (v && (v.kind === 'title' || v.kind === 'next')) Relais.placeHead($('scrub'), $('strip'), $('head'), $('past'), v.piece, v.seek);
  }).observe($('fit'));

  // ---- first tap: full screen and screen kept on ----
  async function keepAwake() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('gate').hidden) keepAwake(); });
  $('gate').addEventListener('click', () => {
    if ($('gateTap').hidden) return;
    $('gate').hidden = true;
    try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen({ navigationUI: 'hide' }); p && p.catch && p.catch(() => {}); } catch (e) {}
    keepAwake();
  });

  poll();
  requestAnimationFrame(frame);
})();
