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
      showView(S.mode === 'idle' ? 'lib' : 'player');
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

  // ---- worklists: imported from a file exported by the Relais app, kept in this browser ----
  const HEX = /^#[0-9a-f]{6}$/i, MAX_S = 999 * 60 + 59;
  const cleanWork = w => {
    if (!w || typeof w !== 'object' || !Array.isArray(w.segments)) return null;
    const segs = w.segments.slice(0, 99).filter(s => s && HEX.test(s.bg) && HEX.test(s.fg) && isFinite(+s.s))
      .map(s => ({ s: Math.max(1, Math.min(MAX_S, Math.round(+s.s))), bg: s.bg.toLowerCase(), fg: s.fg.toLowerCase() }));
    return segs.length ? { name: String(w.name ?? '').slice(0, 60), segments: segs } : null;
  };
  const cleanLib = x => {
    const wls = x && Array.isArray(x.worklists) ? x.worklists : null;
    if (!wls) return null;
    return { worklists: wls.filter(l => l && typeof l === 'object').map(l => ({ name: String(l.name ?? '').slice(0, 60),
             works: (Array.isArray(l.works) ? l.works : []).map(cleanWork).filter(Boolean) })) };
  };
  let lib = null;
  try { lib = cleanLib(JSON.parse(localStorage.getItem('relais.web.library') || 'null')); } catch (e) {}
  if (!lib) lib = { worklists: [] };
  const saveLib = () => { try { localStorage.setItem('relais.web.library', JSON.stringify(lib)); } catch (e) {} };
  // what this page loaded last: worklist index, work index, played as a worklist
  let cur = null;
  try { cur = JSON.parse(sessionStorage.getItem('relais.cur') || 'null'); } catch (e) {}
  const saveCur = () => { try { sessionStorage.setItem('relais.cur', JSON.stringify(cur)); } catch (e) {} };
  const total = w => w.segments.reduce((a, s) => a + s.s, 0);

  function renderLib() {
    const box = $('libList'); box.textContent = '';
    $('libNote').textContent = lib.worklists.length ? 'Importing replaces the worklists below.' : '';
    if (!lib.worklists.length) {
      box.append(h('p', { className: 'empty', textContent: 'No worklists yet. In the Relais app, tap Export at the top of the worklists, then import that file here. The worklists stay in this browser.' }));
      return;
    }
    lib.worklists.forEach((l, li) => {
      const works = h('div', { className: 'works' });
      if (!l.works.length) works.append(h('div', { className: 'small', textContent: 'No works.' }));
      l.works.forEach((w, wi) => {
        const st = h('div', { className: 'strip' }); Relais.strip(st, w);
        const loaded = cur && cur.li === li && cur.i === wi && S && S.mode !== 'idle' && S.work && S.work.name === w.name;
        works.append(h('div', { className: 'work' },
          h('div', { className: 'workbody' + (loaded ? ' loaded' : '') },
            h('div', { className: 'row1' }, h('span', { className: 'wname', textContent: w.name }), h('span', { className: 'total', textContent: Relais.fmtDur(total(w)) })),
            st, h('div', { className: 'durs', textContent: w.segments.map(s => Relais.fmtDur(s.s)).join(' · ') })),
          h('button', { className: 'mini go', textContent: '▶', ariaLabel: `Start ${w.name} alone`, onclick: () => { loadWork(li, wi, false); showView('player'); } })));
      });
      box.append(h('div', { className: 'wl' },
        h('div', { className: 'wlhead' }, h('span', { className: 'nm', textContent: l.name }),
          h('button', { className: 'btn primary', textContent: '▶ Start', disabled: !l.works.length, ariaLabel: `Start the worklist ${l.name}`,
                        onclick: () => { loadWork(li, 0, true); showView('player'); } })),
        works));
    });
  }
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (f.size > 1e6) { toast('File too large.'); return; }
    f.text().then(text => {
      let x = null; try { x = cleanLib(JSON.parse(text)); } catch (err) {}
      if (!x || !x.worklists.length) { toast('This file holds no worklists.'); return; }
      lib = x; cur = null; saveLib(); saveCur(); renderLib();
      toast(`Imported ${x.worklists.length} worklist${x.worklists.length > 1 ? 's' : ''}.`);
    });
  });

  // a work becomes the current one on every display, on its title
  function loadWork(li, i, list, opts = {}) {
    const l = lib.worklists[li]; if (!l || !l.works[i]) return;
    cur = { li, i, list }; saveCur(); pendingSeek = null; clearTimeout(seekTimer);
    send('load', { work: l.works[i], next: list ? (l.works[i + 1] || null) : null, list, wl: l.name,
                   pos: list ? i : 0, count: list ? l.works.length : 1, seek: opts.seek || 0, start: !!opts.start });
  }
  // this page knows the worklist on the displays (for Prev, Next and the following works) only if it loaded it
  const mine = () => cur && S && S.work && lib.worklists[cur.li] && lib.worklists[cur.li].name === S.wl
                     && (cur.list ? S.list && S.pos === cur.i : !S.list);

  // ---- views: worklists or player ----
  let view = 'lib';
  function showView(v) {
    view = v;
    $('lib').hidden = v !== 'lib'; $('player').hidden = v !== 'player';
    $('viewBtn').textContent = v === 'lib' ? 'Player' : 'Worklists';
    if (v === 'lib') renderLib();
    else { fitAll(); }
  }
  $('viewBtn').addEventListener('click', () => showView(view === 'lib' ? 'player' : 'lib'));

  // ---- the two pedals, and the buttons that mirror them ----
  async function mainAction() {
    if (!S) return;
    const v = Relais.view(S);
    if (v.kind === 'title') {
      // a start position still on its way goes first, so the work starts from it
      if (pendingSeek !== null) { clearTimeout(seekTimer); const ms = pendingSeek; await send('seek', { ms }); if (pendingSeek === ms) pendingSeek = null; }
      send('start');
    }
    else if (v.kind === 'next') { if (mine()) loadWork(cur.li, cur.i + 1, true, { start: true }); }
    else if (v.kind === 'run') send(S.until !== null ? 'resume' : 'pause');
    // single work over, end of the worklist, nothing loaded: forward does nothing
  }
  // the left pedal: nothing on a title (a stray press on stage must not change the work)
  function backAction() {
    if (!S) return;
    const v = Relais.view(S);
    if (v.kind === 'run' || v.kind === 'done') send('reset');                       // back to the title, same start position
    else if (v.kind === 'end' && mine()) loadWork(cur.li, lib.worklists[cur.li].works.length - 1, true); // last work
  }
  function backButton() {
    const v = S ? Relais.view(S) : null;
    if (v && v.kind === 'title') { if (mine() && cur.list && cur.i > 0) loadWork(cur.li, cur.i - 1, true); }
    else backAction();
  }
  mainB.addEventListener('click', mainAction);
  $('reset').addEventListener('click', backButton);
  $('nextWork').addEventListener('click', () => {
    const v = S ? Relais.view(S) : null;
    if (!v || !mine() || !cur.list) return;
    if (v.kind === 'title' && cur.i + 1 < lib.worklists[cur.li].works.length) loadWork(cur.li, cur.i + 1, true);
  });

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
    toMain ? mainAction() : backAction();
  }, true);
  document.addEventListener('keyup', e => { if (e.key === ' ' && $('login').hidden && $('prefs').hidden && $('qr').hidden && view === 'player') e.preventDefault(); }, true);

  // ---- seek bar on the title: shown at once here, sent to the displays shortly after ----
  let seekTimer = 0;
  function setSeek(ms) {
    if (!S || S.mode !== 'title') return;
    const tot = Relais.cums(S.work).at(-1);
    S.seek = pendingSeek = Math.max(0, Math.min(tot - 1000, Math.round(ms / 1000) * 1000));
    seekKey = ''; // redraw the bar
    clearTimeout(seekTimer);
    seekTimer = setTimeout(async () => {
      const ms = pendingSeek;
      await send('seek', { ms });
      if (pendingSeek === ms) pendingSeek = null; // confirmed; a newer position keeps waiting
    }, 150);
  }
  $('scrub').addEventListener('pointerdown', e => {
    if (!S || S.mode !== 'title') return;
    $('scrub').setPointerCapture(e.pointerId); setSeek(Relais.seekFromX($('plStrip'), S.work, e.clientX));
  });
  $('scrub').addEventListener('pointermove', e => { if ($('scrub').hasPointerCapture(e.pointerId) && S && S.mode === 'title') setSeek(Relais.seekFromX($('plStrip'), S.work, e.clientX)); });
  function stepper(btn, d) { // one second per tap; held down, it repeats
    let t = 0, iv = 0;
    const stop = () => { clearTimeout(t); clearInterval(iv); };
    btn.addEventListener('pointerdown', e => {
      if (!S || S.mode !== 'title') return;
      e.preventDefault(); setSeek(S.seek + d);
      t = setTimeout(() => { iv = setInterval(() => setSeek(S.seek + d), 70); }, 400);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(k => btn.addEventListener(k, stop));
  }
  stepper($('seekMinus'), -1000); stepper($('seekPlus'), 1000);
  $('seekHome').addEventListener('click', () => setSeek(0));

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
  $('clearBtn').addEventListener('click', () => { send('clear'); cur = null; saveCur(); $('prefs').hidden = true; showView('lib'); });
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
    if (v && (v.kind === 'title' || v.kind === 'next')) Relais.placeHead($('scrub'), $('plStrip'), $('head'), $('past'), v.work, v.seek);
  }
  new ResizeObserver(fitAll).observe($('fit'));
  function frame() {
    const v = S ? Relais.view(S) : { kind: 'idle' };
    body.dataset.kind = v.kind;
    body.classList.toggle('paused', !!v.paused);
    body.classList.toggle('waiting', !!v.waiting);
    const lab = $('label'), wl = mine() ? lib.worklists[cur.li] : null;
    if (v.kind === 'idle') {
      colors('#0d0f10', '#f2a541'); setTitle('No work loaded', false);
      lab.textContent = view === 'lib' ? 'Worklists' : 'Waiting';
      mainB.textContent = 'Start'; mainB.disabled = true; $('reset').textContent = 'Reset'; $('reset').disabled = true;
    } else if (v.kind === 'title' || v.kind === 'next') {
      colors(v.bg, v.fg);
      setTitle(v.work.name, v.kind === 'next' && last.kind === 'run');
      const pos = v.kind === 'next' ? S.pos + 1 : S.pos;
      lab.textContent = S.list ? `${pos + 1}/${S.count} · ${S.wl}` : 'Ready';
      const key = JSON.stringify([v.work.segments, v.seek, v.kind]);
      if (key !== seekKey) {
        seekKey = key;
        Relais.strip($('plStrip'), v.work);
        Relais.placeHead($('scrub'), $('plStrip'), $('head'), $('past'), v.work, v.seek);
        const c = Relais.cums(v.work), t = Relais.segIndex(c, v.seek), tot = c.at(-1);
        $('seekPos').textContent = v.seek ? `From ${Relais.fmtDur(v.seek / 1000)} · ${t + 1}/${v.n} · ${Relais.fmt(Math.ceil((c[t + 1] - v.seek) / 1000))} left` : 'From 0:00';
        $('plDurs').textContent = v.work.segments.map(s => Relais.fmtDur(s.s)).join(' · ') + ' = ' + Relais.fmtDur(tot / 1000);
        const editable = v.kind === 'title';
        $('seekHome').disabled = $('seekMinus').disabled = !editable || v.seek === 0;
        $('seekPlus').disabled = !editable || v.seek >= tot - 1000;
      }
      mainB.textContent = 'Start'; mainB.disabled = v.kind === 'next' && !mine();
      $('reset').textContent = '‹ Prev';
      $('reset').disabled = !(v.kind === 'title' && mine() && cur.list && cur.i > 0);
      $('nextWork').disabled = !(v.kind === 'title' && mine() && cur.list && wl && cur.i + 1 < wl.works.length);
      // the work on the displays is over: this page makes the next one the current one, so that every
      // further command (start, seek, previous) applies to it. The displays already show its title.
      if (v.kind === 'next' && mine() && advancing !== S.rev) { advancing = S.rev; loadWork(cur.li, cur.i + 1, true); }
    } else if (v.kind === 'end') {
      colors(v.bg, v.fg); setTitle('End', last.kind === 'run');
      lab.textContent = `End · ${S.wl}`;
      mainB.textContent = 'End'; mainB.disabled = true; $('reset').textContent = '‹ Back'; $('reset').disabled = !mine();
    } else { // run, done
      colors(v.bg, v.fg);
      Relais.draw($('digits'), $('fit'), v.text, v.fg, v.lit);
      lab.textContent = v.kind === 'done' ? `End · ${v.work.name}` : S.until !== null ? `Paused · ${v.i + 1}/${v.n}`
                      : v.waiting ? 'Starting…' : `${v.i + 1}/${v.n} · ${v.work.name}`;
      mainB.textContent = v.kind === 'done' ? 'End' : S.until !== null ? 'Resume' : 'Pause';
      mainB.disabled = v.kind === 'done';
      $('reset').textContent = 'Reset'; $('reset').disabled = false;
    }
    if (v.kind !== last.kind) fitAll();
    last.kind = v.kind; last.i = v.i ?? -1;
    requestAnimationFrame(frame);
  }

  renderLib();
  if (token) { $('login').hidden = true; api('state').then(() => showView(S.mode === 'idle' ? 'lib' : 'player')).catch(() => {}); }
  else $('pw').focus();
  poll();
  requestAnimationFrame(frame);
})();
