/*
 * Relais for ensembles: the conductor's page.
 * Copyright (c) 2026 Elnath Project (Alessandro Ciccarelli)
 * Released under the MIT License: see the LICENSE file.
 */
'use strict';
(() => {
  // never inside another site's frame: clicks could be steered onto Start or Reset
  if (window.top !== window.self) { document.body.textContent = ''; return; }

  const $ = id => document.getElementById(id);
  const body = document.body, mainB = $('main');
  const h = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); kids.flat().forEach(c => e.append(c)); return e; };
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }

  // ---- session ----
  // The browser keeps a session token, never the password: in this tab only, or on this
  // computer if "remember" is ticked. The server forgets it at Log out or when it expires.
  const ss = { get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch (e) { return null; } },
               set(k, v, keep) { try { sessionStorage.setItem(k, v); if (keep) localStorage.setItem(k, v); } catch (e) {} },
               del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch (e) {} } };
  let token = ss.get('relais.token');
  let S = null, busy = false, pendingSeek = null;

  async function call(a, bodyObj) {
    const t0 = Date.now();
    const r = await fetch('api.php?a=' + a, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify(bodyObj) });
    const j = await r.json();
    if (j.error === 'https') { // the server answers only over HTTPS
      if (location.protocol === 'http:') location.replace('https:' + location.href.slice(5));
      else $('httpWarn').textContent = 'The server does not recognise this connection as HTTPS: see FORCE_HTTPS in config.php.';
      throw new Error('https');
    }
    if (j.type === 'state') {
      Relais.sample(t0, j.now, Date.now()); S = j;
      // a start position chosen here and not yet confirmed by the server is not undone by a poll
      if (pendingSeek !== null && S.mode === 'title') S.seek = pendingSeek;
      update();
    }
    return j;
  }
  async function api(a, extra = {}) {
    const j = await call(a, { token, ...extra });
    if (j.type !== 'state') { showLogin(token ? 'Session expired: enter the password again.' : ''); throw new Error(j.type || 'error'); }
    return j;
  }
  function showLogin(msg) {
    token = null; ss.del('relais.token');
    $('login').hidden = false; $('loginMsg').textContent = msg;
    $('pw').focus();
  }
  const LOGIN_ERR = {
    denied: 'Wrong password.',
    'default-password': 'The password is still "changeme": change it in config.php on the server.',
    'no-password': 'No password is set in config.php on the server.',
  };
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const remember = $('remember').checked;
    try {
      const j = await call('login', { key: $('pw').value, remember });
      if (j.type !== 'state' || !j.token) {
        $('loginMsg').textContent = j.type === 'blocked' ? `Too many wrong passwords: try again in ${j.minutes} minutes.` : (LOGIN_ERR[j.type] || 'Access failed.');
        return;
      }
      token = j.token; ss.set('relais.token', token, remember);
      $('login').hidden = true; $('pw').value = ''; $('loginMsg').textContent = '';
      pickUp();
    } catch (err) { if (err.message !== 'https') $('loginMsg').textContent = 'The server does not answer.'; }
  });
  $('logout').addEventListener('click', async () => {
    try { if (token) await call('logout', { token }); } catch (e) {}
    showLogin('');
  });
  // the password must not travel unprotected
  if (location.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))
    $('httpWarn').textContent = 'This page is not on HTTPS: the password would travel unprotected. Open the https:// address.';

  // ---- polling: other devices may control the same timer ----
  async function poll() {
    for (;;) {
      if (token && !busy) { try { await api('state'); } catch (e) {} }
      await new Promise(r => setTimeout(r, 600));
    }
  }
  async function send(a, extra) {
    if (!token) return;
    // a seek or a load is never lost (it waits, and the caller can wait for it); a pedal press while busy is
    if (busy) { if (a === 'seek' || a === 'load') return new Promise(r => setTimeout(() => r(send(a, extra)), 200)); return; }
    busy = true;
    try { await api(a, extra); } catch (e) {} finally { busy = false; }
  }

  // ---- setlists: imported from a file exported by the Relais app, kept in this browser ----
  const HEX = /^#[0-9a-f]{6}$/i, MAX_S = 999 * 60 + 59;
  const cleanPiece = w => {
    if (!w || typeof w !== 'object' || !Array.isArray(w.segments)) return null;
    const segs = w.segments.slice(0, 99).filter(s => s && HEX.test(s.bg) && HEX.test(s.fg) && (s.t === 'timer' || isFinite(+s.s)))
      .map(s => s.t === 'timer' ? { t: 'timer', bg: s.bg.toLowerCase(), fg: s.fg.toLowerCase() }
                                : { s: Math.max(1, Math.min(MAX_S, Math.round(+s.s))), bg: s.bg.toLowerCase(), fg: s.fg.toLowerCase() });
    return segs.length ? { name: String(w.name ?? '').slice(0, 60), segments: segs } : null;
  };
  const cleanLib = x => {
    const wls = x && Array.isArray(x.setlists) ? x.setlists : null;
    if (!wls) return null;
    return { setlists: wls.filter(l => l && typeof l === 'object').map(l => ({ name: String(l.name ?? '').slice(0, 60),
             pieces: (Array.isArray(l.pieces) ? l.pieces : []).map(cleanPiece).filter(Boolean) })) };
  };
  // The setlists are those of the editor (app/index.html, the same page as the Android app), kept in
  // this browser under the key the app uses; read again whenever they may have changed.
  const readLib = () => { try { return cleanLib(JSON.parse(localStorage.getItem('relais-library-v1') || 'null')) || { setlists: [] }; } catch (e) { return { setlists: [] }; } };
  let lib = readLib();
  window.addEventListener('storage', e => { if (e.key === 'relais-library-v1') lib = readLib(); });
  // what this page loaded last: setlist index, piece index, played as a setlist
  let cur = null;
  try { cur = JSON.parse(sessionStorage.getItem('relais.cur') || 'null'); } catch (e) {}
  const saveCur = () => { try { sessionStorage.setItem('relais.cur', JSON.stringify(cur)); } catch (e) {} };
  // ▶ or Start pressed in the editor: the piece handed over comes to the displays (within ten minutes)
  function pickUp() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem('relais.conductor.play') || 'null'); localStorage.removeItem('relais.conductor.play'); } catch (e) {}
    if (!r || !(Date.now() - r.at < 600000)) return;
    lib = readLib();
    loadPiece(r.li | 0, r.i | 0, !!r.list);
  }

  // a piece becomes the current one on every display, on its title
  function loadPiece(li, i, list, opts = {}) {
    const l = lib.setlists[li]; if (!l || !l.pieces[i]) return;
    cur = { li, i, list }; saveCur(); pendingSeek = null; clearTimeout(seekTimer);
    send('load', { piece: l.pieces[i], next: list ? (l.pieces[i + 1] || null) : null, list, setlist: l.name,
                   pos: list ? i : 0, count: list ? l.pieces.length : 1, seek: { k: 0, ms: 0 }, start: !!opts.start });
  }
  // this page knows the setlist on the displays (for Prev, Next and the following pieces) only if it loaded it
  const mine = () => cur && S && S.piece && lib.setlists[cur.li] && lib.setlists[cur.li].name === S.setlist
                     && (cur.list ? S.list && S.pos === cur.i : !S.list);

  // ---- Setlists: the editor of the app, in this same browser tab ----
  const view = 'player';
  $('viewBtn').addEventListener('click', () => { location.href = 'app/index.html?conductor'; });

  // ---- the two pedals, and the buttons that mirror them ----
  async function mainAction() {
    if (!S) return;
    const v = Relais.view(S);
    if (v.kind === 'title') {
      // a start position still on its way goes first, so the piece starts from it
      if (pendingSeek !== null) { clearTimeout(seekTimer); const pos = pendingSeek; await send('seek', pos); if (pendingSeek === pos) pendingSeek = null; }
      send('start');
    }
    else if (v.kind === 'next') { if (mine()) loadPiece(cur.li, cur.i + 1, true, { start: true }); }
    else if (v.kind === 'run') send(S.until !== null ? 'resume' : 'pause');
    // single piece over, end of the setlist, nothing loaded: forward does nothing
  }
  // the left pedal: nothing on a title (a stray press on stage must not change the piece)
  function backAction() {
    if (!S) return;
    const v = Relais.view(S);
    if (v.kind === 'run' || v.kind === 'done') send('reset');                       // back to the title, same start position
    else if (v.kind === 'end' && mine()) loadPiece(cur.li, lib.setlists[cur.li].pieces.length - 1, true); // last piece
  }
  function backButton() {
    const v = S ? Relais.view(S) : null;
    if (v && v.kind === 'title') { if (mine() && cur.list && cur.i > 0) loadPiece(cur.li, cur.i - 1, true); }
    else backAction();
  }
  mainB.addEventListener('click', mainAction);
  $('reset').addEventListener('click', backButton);
  // moving on from the timer the run is on: every display goes to the next section together
  function advance() {
    const v = S ? Relais.view(S) : null;
    if (v && v.kind === 'run' && v.timer) send('advance', { k: v.i });
  }
  // Next ›: on a title, the next piece of the setlist; on a timer, the next section
  $('nextPiece').addEventListener('click', () => {
    const v = S ? Relais.view(S) : null;
    if (!v) return;
    if (v.kind === 'run' && v.timer) { advance(); return; }
    if (!mine() || !cur.list) return;
    if (v.kind === 'title' && cur.i + 1 < lib.setlists[cur.li].pieces.length) loadPiece(cur.li, cur.i + 1, true);
  });

  // ---- right pedal held on a timer: the next section after HOLD_MS, a ring filling meanwhile ----
  // On a timer the right pedal acts when released (Pause / Resume), or after HOLD_MS if still held
  // (next section), so a hold never pauses first. Elsewhere it acts at once.
  const HOLD_MS = 2000;
  let hold = null;
  const inTimer = () => { const v = S ? Relais.view(S) : null; return !!(v && v.kind === 'run' && v.timer); };
  function holdStart() {
    holdCancel();
    const ring = $('hold'); ring.removeAttribute('hidden'); ring.classList.remove('fill'); ring.getBoundingClientRect(); ring.classList.add('fill');
    hold = { done: false, t: setTimeout(() => { hold.done = true; ring.setAttribute('hidden', ''); advance(); }, HOLD_MS) };
  }
  function holdCancel() { if (hold) clearTimeout(hold.t); hold = null; $('hold').setAttribute('hidden', ''); $('hold').classList.remove('fill'); }

  // Bluetooth page-turner pedal or keyboard, as in the app
  const PEDAL_MAIN = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'];
  const PEDAL_BACK = ['ArrowLeft', 'ArrowUp', 'PageUp'];
  document.addEventListener('keydown', e => {
    if (!$('qr').hidden) { if (e.key === 'Escape') $('qr').hidden = true; return; } // QR on screen: the pedal does nothing
    if (!$('login').hidden || !$('prefs').hidden || view !== 'player') return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const toMain = PEDAL_MAIN.includes(e.key), toBack = PEDAL_BACK.includes(e.key);
    if (!toMain && !toBack) return;
    e.preventDefault();
    if (e.repeat) return;
    if (document.activeElement && document.activeElement !== body) document.activeElement.blur();
    if (toMain && inTimer()) { holdStart(); return; }
    toMain ? mainAction() : backAction();
  }, true);
  document.addEventListener('keyup', e => {
    if (!($('login').hidden && $('prefs').hidden && $('qr').hidden && view === 'player')) return;
    if (e.key === ' ') e.preventDefault();
    if (PEDAL_MAIN.includes(e.key) && hold) { const done = hold.done; holdCancel(); if (!done) mainAction(); }
  }, true);

  // ---- seek bar on the title: shown at once here, sent to the displays shortly after ----
  let seekTimer = 0;
  // the start position is {k: section, ms: into it}, as in the app
  function setSeek(pos) {
    if (!S || S.mode !== 'title') return;
    S.seek = pendingSeek = Relais.clampSeek(S.piece, pos);
    seekKey = ''; // redraw the bar
    clearTimeout(seekTimer);
    seekTimer = setTimeout(async () => {
      const p = pendingSeek;
      await send('seek', p);
      if (pendingSeek === p) pendingSeek = null; // confirmed; a newer position keeps waiting
    }, 150);
  }
  $('scrub').addEventListener('pointerdown', e => {
    if (!S || S.mode !== 'title') return;
    $('scrub').setPointerCapture(e.pointerId); setSeek(Relais.seekFromX($('plStrip'), S.piece, e.clientX));
  });
  $('scrub').addEventListener('pointermove', e => { if ($('scrub').hasPointerCapture(e.pointerId) && S && S.mode === 'title') setSeek(Relais.seekFromX($('plStrip'), S.piece, e.clientX)); });
  function stepper(btn, d) { // one second per tap; held down, it repeats
    let t = 0, iv = 0;
    const stop = () => { clearTimeout(t); clearInterval(iv); };
    btn.addEventListener('pointerdown', e => {
      if (!S || S.mode !== 'title') return;
      e.preventDefault(); setSeek(Relais.stepSeek(S.piece, S.seek, d));
      t = setTimeout(() => { iv = setInterval(() => setSeek(Relais.stepSeek(S.piece, S.seek, d)), 70); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(k => btn.addEventListener(k, stop));
  }
  stepper($('seekMinus'), -1); stepper($('seekPlus'), 1);
  $('seekHome').addEventListener('click', () => setSeek({ k: 0, ms: 0 }));

  // ---- settings: vibration, address, QR code ----
  function displayAddress() {
    const u = new URL('./', location.href);
    if (S && S.codeRequired) u.searchParams.set('code', S.code);
    return u.href;
  }
  // QR code of the address for the performers, as large as the window allows: black on white, with the
  // quiet zone scanners need. Drawn here with qrcode.js (Kazuhiko Arase, MIT licence): nothing leaves the page.
  function showQr() {
    const text = displayAddress(), q = qrcode(0, 'M');
    q.addData(text); q.make();
    const n = q.getModuleCount(), quiet = 4, dpr = window.devicePixelRatio || 1;
    const side = Math.max(160, Math.min(window.innerWidth - 80, window.innerHeight - 190));
    const cell = Math.max(1, Math.floor(side * dpr / (n + 2 * quiet))), px = cell * (n + 2 * quiet);
    const cv = $('qrCanvas'); cv.width = cv.height = px; cv.style.width = cv.style.height = (px / dpr) + 'px';
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, px, px); g.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    $('qrAddr').textContent = text;
    $('qr').hidden = false;
  }
  $('qrBtn').addEventListener('click', e => { e.currentTarget.blur(); if (S) showQr(); });
  $('qr').addEventListener('click', () => { $('qr').hidden = true; });
  $('prefsBtn').addEventListener('click', () => { $('prefs').hidden = false; sig = ''; update(); $('prefsClose').focus(); });
  $('prefsClose').addEventListener('click', () => { $('prefs').hidden = true; });
  $('prefs').addEventListener('click', e => { if (e.target.id === 'prefs') $('prefs').hidden = true; });
  $('vibrate').addEventListener('change', e => send('look', { vibrate: e.target.checked }));
  $('clearBtn').addEventListener('click', () => { send('clear'); cur = null; saveCur(); $('prefs').hidden = true; });
  $('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(displayAddress()); $('copy').textContent = 'Copied'; }
    catch (e) { $('copy').textContent = 'Select and copy'; }
    setTimeout(() => { $('copy').textContent = 'Copy'; }, 2000);
  });

  // ---- what changes with the state ----
  let sig = '';
  function update() {
    if (!S) return;
    $('online').textContent = S.online === 1 ? '1 display' : `${S.online} displays`;
    $('warnings').textContent = '';
    S.warnings.forEach(w => $('warnings').append(h('div', { className: 'warn', textContent: w })));
    const s = JSON.stringify([S.vibrate, S.code, S.codeRequired, S.closeAfter]);
    if (s !== sig) { // redrawn only when something changes, not at every poll
      sig = s;
      $('vibrate').checked = S.vibrate;
      $('addr').textContent = displayAddress();
      $('addrNote').textContent = S.codeRequired ? 'Includes the ensemble code.' : 'Anyone with this address can watch the timer while it is open.';
      const hh = S.closeAfter >= 120 && S.closeAfter % 60 === 0 ? `${S.closeAfter / 60} hours` : `${S.closeAfter} minutes`;
      $('openNote').textContent = `The performers see the timer only while you are logged in: Log out closes it. If this page loses the connection, the timer stays visible for ${hh}.`;
    }
  }

  // ---- player: drawn every frame from the state and the clock ----
  let last = { kind: null, i: -1 }, seekKey = '', advancing = null;
  function colors(bg, fg) {
    const st = document.documentElement.style;
    st.setProperty('--seg-bg', bg); st.setProperty('--seg-fg', fg); st.setProperty('--seg-ink', Relais.ink(bg));
  }
  function setTitle(text, blink) {
    const el = $('ttl');
    if (el.textContent !== text) { el.textContent = text; Relais.fitTitle(el, $('ttlBox')); }
    if (blink) { el.classList.remove('blink'); void el.offsetWidth; el.classList.add('blink'); }
  }
  function fitAll() {
    Relais.fitTitle($('ttl'), $('ttlBox'));
    const v = S ? Relais.view(S) : null;
    if (v && (v.kind === 'title' || v.kind === 'next')) Relais.placeHead($('scrub'), $('plStrip'), $('head'), $('past'), v.piece, v.seek);
  }
  new ResizeObserver(fitAll).observe($('fit'));
  function frame() {
    const v = S ? Relais.view(S) : { kind: 'idle' };
    body.dataset.kind = v.kind;
    body.classList.toggle('paused', !!v.paused);
    body.classList.toggle('waiting', !!v.waiting);
    body.classList.toggle('timer', !!(v.kind === 'run' && v.timer));
    if (hold && !(v.kind === 'run' && v.timer)) holdCancel(); // the timer is over: nothing to hold for
    const lab = $('label'), sl = mine() ? lib.setlists[cur.li] : null;
    if (v.kind === 'idle') {
      colors('#0d0f10', '#f2a541'); setTitle('No piece loaded', false);
      lab.textContent = 'No piece loaded';
      mainB.textContent = 'Start'; mainB.disabled = true; $('reset').textContent = 'Reset'; $('reset').disabled = true;
    } else if (v.kind === 'title' || v.kind === 'next') {
      colors(v.bg, v.fg);
      setTitle(v.piece.name, v.kind === 'next' && last.kind === 'run');
      const pos = v.kind === 'next' ? S.pos + 1 : S.pos;
      lab.textContent = S.list ? `${pos + 1}/${S.count} · ${S.setlist}` : 'Ready';
      const key = JSON.stringify([v.piece.segments, v.seek, v.kind]);
      if (key !== seekKey) {
        seekKey = key;
        Relais.strip($('plStrip'), v.piece);
        Relais.placeHead($('scrub'), $('plStrip'), $('head'), $('past'), v.piece, v.seek);
        $('seekPos').textContent = Relais.seekText(v.piece, v.seek);
        $('plDurs').textContent = v.piece.segments.map(Relais.durText).join(' · ') + ' = ' + Relais.totalText(v.piece);
        const editable = v.kind === 'title', atStart = v.seek.k === 0 && v.seek.ms === 0, nx = Relais.stepSeek(v.piece, v.seek, 1);
        $('seekHome').disabled = $('seekMinus').disabled = !editable || atStart;
        $('seekPlus').disabled = !editable || (nx.k === v.seek.k && nx.ms === v.seek.ms);
      }
      mainB.textContent = 'Start'; mainB.disabled = v.kind === 'next' && !mine();
      $('reset').textContent = '‹ Prev';
      $('reset').disabled = !(v.kind === 'title' && mine() && cur.list && cur.i > 0);
      $('nextPiece').textContent = 'Next ›';
      $('nextPiece').disabled = !(v.kind === 'title' && mine() && cur.list && sl && cur.i + 1 < sl.pieces.length);
      // the piece on the displays is over: this page makes the next one the current one, so that every
      // further command (start, seek, previous) applies to it. The displays already show its title.
      if (v.kind === 'next' && mine() && advancing !== S.rev) { advancing = S.rev; loadPiece(cur.li, cur.i + 1, true); }
    } else if (v.kind === 'end') {
      colors(v.bg, v.fg); setTitle('End', last.kind === 'run');
      lab.textContent = `End · ${S.setlist}`;
      mainB.textContent = 'End'; mainB.disabled = true; $('reset').textContent = '‹ Back'; $('reset').disabled = !mine();
    } else { // run, done
      colors(v.bg, v.fg);
      Relais.draw($('digits'), $('fit'), v.text, v.fg, v.lit);
      lab.textContent = v.kind === 'done' ? `End · ${v.piece.name}` : S.until !== null ? `Paused · ${v.i + 1}/${v.n}`
                      : v.waiting ? 'Starting…' : `${v.i + 1}/${v.n} · ${v.piece.name}${v.timer ? ' · timer' : ''}`;
      $('nextPiece').disabled = !(v.kind === 'run' && v.timer);
      mainB.textContent = v.kind === 'done' ? 'End' : S.until !== null ? 'Resume' : 'Pause';
      mainB.disabled = v.kind === 'done';
      $('reset').textContent = 'Reset'; $('reset').disabled = false;
    }
    if (v.kind !== last.kind) fitAll();
    last.kind = v.kind; last.i = v.i ?? -1;
    requestAnimationFrame(frame);
  }

  if (token) { $('login').hidden = true; api('state').then(pickUp).catch(() => {}); }
  else $('pw').focus();
  poll();
  requestAnimationFrame(frame);
})();
