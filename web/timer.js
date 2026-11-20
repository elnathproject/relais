/*
 * Relais for ensembles: code shared by the conductor's page and the displays.
 * Copyright (c) 2026 Elnath Project (Alessandro Ciccarelli)
 * Released under the MIT License: see the LICENSE file.
 */
'use strict';
const Relais = (() => {
  // ---- Seven-segment digits, the same drawing as the Android app ----
  const SEG = { 0:'abcdef', 1:'bc', 2:'abged', 3:'abgcd', 4:'fgbc', 5:'afgcd', 6:'afgedc', 7:'abc', 8:'abcdefg', 9:'abcdfg' };
  const DW = 0.58, GAP = 0.13, CW = 0.30, ROWGAP = 0.16, SKEW = 0.07; // proportions of the digit height
  const rowUnits = s => [...s].reduce((u, ch, i) => u + (ch === ':' ? CW : DW) + (i ? GAP : 0), 0) + SKEW;
  // unlit segments: the digit colour, faint, so they show on dark and light backgrounds alike
  const ghost = hex => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},0.07)`; };
  function ink(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5 ? '#111111' : '#f5f5f5';
  }
  function drawDigit(ctx, x, y, h, d, on, off) {
    const w = DW * h, t = 0.13 * h, g = t * 0.14;
    const L = x + t / 2, R = x + w - t / 2, T = y + t / 2, M = y + h / 2, B = y + h - t / 2;
    const hz = (x0, x1, yy) => [[x0 + g, yy], [x0 + g + t / 2, yy - t / 2], [x1 - g - t / 2, yy - t / 2], [x1 - g, yy], [x1 - g - t / 2, yy + t / 2], [x0 + g + t / 2, yy + t / 2]];
    const vt = (xx, y0, y1) => [[xx, y0 + g], [xx + t / 2, y0 + g + t / 2], [xx + t / 2, y1 - g - t / 2], [xx, y1 - g], [xx - t / 2, y1 - g - t / 2], [xx - t / 2, y0 + g + t / 2]];
    const segs = { a: hz(L, R, T), g: hz(L, R, M), d: hz(L, R, B), f: vt(L, T, M), b: vt(R, T, M), e: vt(L, M, B), c: vt(R, M, B) };
    const lit = SEG[d] || '';
    for (const k in segs) {
      ctx.fillStyle = lit.includes(k) ? on : off;
      ctx.beginPath();
      segs[k].forEach(([px, py], i) => { const sx = px + (y + h - py) * SKEW; i ? ctx.lineTo(sx, py) : ctx.moveTo(sx, py); });
      ctx.closePath(); ctx.fill();
    }
  }
  function drawColon(ctx, x, y, h, on) {
    const s = 0.13 * h, cx = x + CW * h / 2 - s / 2;
    ctx.fillStyle = on;
    [0.3, 0.7].forEach(p => { const py = y + h * p - s / 2; ctx.fillRect(cx + (y + h - py - s / 2) * SKEW, py, s, s); });
  }
  // Draws text ("12:34") as large as the box allows: one row, or minutes above seconds if that
  // gives bigger digits (portrait screens). lit = false: the lit segments go dark (blinking).
  function draw(canvas, box, text, color, lit = true) {
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const MINSX = 0.55;
    const layout = rows => {
      const n = rows.length, u = Math.max(...rows.map(rowUnits));
      let hh = H * 0.96 / (n + (n - 1) * ROWGAP), sx = Math.min(1, W * 0.97 / (u * hh));
      if (sx < MINSX) { sx = MINSX; hh = W * 0.97 / (u * MINSX); }
      return { rows, h: hh, sx, score: hh * Math.sqrt(sx) };
    };
    const A = layout([text]), Bl = layout(text.split(':').length === 2 ? text.split(':') : [text]);
    const { rows, h: hh, sx } = Bl.score > A.score * 1.1 ? Bl : A;
    const off = ghost(color), on = lit ? color : off;
    let y = (H - (rows.length * hh + (rows.length - 1) * ROWGAP * hh)) / 2;
    for (const r of rows) {
      ctx.save(); ctx.translate((W - rowUnits(r) * hh * sx) / 2, 0); ctx.scale(sx, 1);
      let x = 0;
      [...r].forEach((ch, i) => {
        if (i) x += GAP * hh;
        if (ch === ':') { drawColon(ctx, x, y, hh, on); x += CW * hh; } else { drawDigit(ctx, x, y, hh, +ch, on, off); x += DW * hh; }
      });
      ctx.restore(); y += hh * (1 + ROWGAP);
    }
    canvas.setAttribute('aria-label', text);
  }
  // the title as large as its box allows, on more lines if needed; a word is never split
  function fitTitle(el, box) {
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H || !el.textContent) return;
    let lo = 10, hi = Math.max(10, Math.min(W, H) * 1.2);
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2; el.style.fontSize = mid + 'px';
      if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= H * 0.9) lo = mid; else hi = mid;
    }
    el.style.fontSize = Math.floor(lo) + 'px';
  }

  // ---- Time formats ----
  const p2 = n => String(n).padStart(2, '0');
  const fmt = t => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return h ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`; };
  const fmtDur = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60; return h ? `${h}:${p2(m)}:${p2(r)}` : `${m}:${p2(r)}`; };

  // ---- Sections: a countdown {s, bg, fg} or a timer {t: 'timer', bg, fg}, which counts up and has no end of its own ----
  const isTimer = g => g.t === 'timer';
  const secLen = (w, k) => isTimer(w.segments[k]) ? 0 : w.segments[k].s * 1000;
  const total = w => w.segments.reduce((a, g) => a + (isTimer(g) ? 0 : g.s), 0); // seconds of the countdowns
  const hasTimer = w => w.segments.some(isTimer);
  const durText = g => isTimer(g) ? '∞' : fmtDur(g.s);
  const totalText = w => fmtDur(total(w)) + (hasTimer(w) ? ' + ∞' : '');
  const timerWeight = w => Math.max(20, Math.round(total(w) * 0.12)); // width of a timer in the bars, in seconds

  // ---- Start position {k: section, ms: into it}; a timer always starts from its beginning ----
  function clampSeek(w, pos) {
    const n = w.segments.length, k = Math.max(0, Math.min(n - 1, (pos && pos.k) | 0)), L = secLen(w, k);
    return { k, ms: L ? Math.max(0, Math.min(L - 1000, Math.round(((pos && pos.ms) || 0) / 1000) * 1000)) : 0 };
  }
  const lastSeek = w => { const n = w.segments.length, L = secLen(w, n - 1); return { k: n - 1, ms: L ? L - 1000 : 0 }; };
  function stepSeek(w, pos, d) { // one second earlier or later; across sections a timer counts as one position
    let { k, ms } = pos;
    if (d > 0) { if (secLen(w, k) && ms + 1000 < secLen(w, k)) ms += 1000; else if (k + 1 < w.segments.length) { k++; ms = 0; } }
    else { if (ms >= 1000) ms -= 1000; else if (k > 0) { k--; ms = secLen(w, k) ? secLen(w, k) - 1000 : 0; } }
    return { k, ms };
  }
  // the absolute time is given only when no timer comes before: after a timer it is not known
  function seekText(w, pos) {
    const n = w.segments.length, { k, ms } = pos, g = w.segments[k];
    if (k === 0 && ms === 0) return 'From the beginning';
    const before = w.segments.slice(0, k), what = isTimer(g) ? 'timer' : `${fmt(Math.ceil((secLen(w, k) - ms) / 1000))} left`;
    return before.some(isTimer) ? `From ${k + 1}/${n} · ${what}` : `From ${fmtDur((before.reduce((a, x) => a + x.s, 0) * 1000 + ms) / 1000)} · ${k + 1}/${n} · ${what}`;
  }

  // ---- Coloured bars: one section per countdown, proportional to its length, in the digit colour;
  // a timer is striped. Time and position are mapped on the sections themselves, not on the whole
  // bar, so the gaps never shift the head off the colours. ----
  function strip(box, w) {
    box.textContent = '';
    const tw = timerWeight(w);
    w.segments.forEach(g => {
      const sp = document.createElement('span');
      sp.style.flex = `${isTimer(g) ? tw : g.s} 1 0`;
      sp.style.background = isTimer(g) ? `repeating-linear-gradient(135deg, ${g.fg} 0 3px, rgba(0,0,0,.45) 3px 7px)` : g.fg;
      if (isTimer(g)) sp.className = 'timer';
      box.append(sp);
    });
  }
  function placeHead(bar, stripBox, head, past, w, pos) {
    const sp = stripBox.children[pos.k];
    if (!sp) return;
    const b = bar.getBoundingClientRect(), r = sp.getBoundingClientRect(), L = secLen(w, pos.k);
    const x = r.left - b.left + (L ? pos.ms / L : 0) * r.width;
    head.style.left = x + 'px'; if (past) past.style.width = (pos.k || pos.ms ? x : 0) + 'px';
  }
  function seekFromX(stripBox, w, clientX) {
    const spans = [...stripBox.children];
    const k = spans.findIndex(sp => clientX < sp.getBoundingClientRect().right);
    if (k < 0) return lastSeek(w);
    const r = spans[k].getBoundingClientRect();
    return clampSeek(w, { k, ms: Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * secLen(w, k) });
  }

  // ---- Clock: offset from the server, from the sample with the shortest round trip ----
  const samples = [];
  let skew = 0;
  function sample(t0, serverNow, t1) {
    if (!serverNow) return;
    samples.push({ rtt: t1 - t0, skew: serverNow - (t0 + t1) / 2 });
    if (samples.length > 20) samples.shift();
    skew = samples.reduce((a, b) => b.rtt < a.rtt ? b : a).skew;
  }
  const now = () => Date.now() + skew; // server time

  // ---- State → what to show at server time t ----
  // A run is a chain of sections that follow one another by themselves: it starts at section `base`,
  // `off` ms into it, and goes on through the countdowns until it meets a timer, where it stays until
  // the conductor moves on (a new chain at the next section). Time run in the chain = acc + time
  // since `since`, stopped at `until` if paused.
  // Kinds: idle, title (of the loaded piece), run (a countdown or a timer), next (title of the next
  // piece, the current one being over), done (single piece over: 00:00), end (setlist over).
  // Blinking in time, as in the app: for the first three seconds of a new section the digits are lit
  // in the first 550 ms of every second. The section a run starts from with Start never blinks.
  const BLINK_BEATS = 3, BLINK_ON = 550;
  const blinkLit = since => !(since >= 0 && since < BLINK_BEATS * 1000 && since % 1000 >= BLINK_ON);
  function chainAt(w, base, off, el) {
    const n = w.segments.length;
    let k = base, ms = el + off;
    while (k < n) {
      if (isTimer(w.segments[k])) return { k, ms };
      const L = secLen(w, k);
      if (ms < L) return { k, ms };
      ms -= L; k++;
    }
    return { k: n, over: true, ms };
  }
  function view(s, t = now()) {
    if (!s || s.mode === 'idle' || !s.piece) return { kind: 'idle' };
    const w = s.piece, n = w.segments.length;
    if (s.mode === 'title') { const g = w.segments[s.seek.k]; return { kind: 'title', piece: w, seek: s.seek, n, bg: g.bg, fg: g.fg }; }
    const waiting = s.since !== null && t < s.since && s.acc === 0;
    const run = s.since === null ? 0 : Math.max(0, Math.min(t, s.until ?? Infinity) - s.since);
    const paused = s.until !== null && t >= s.until;
    const c = chainAt(w, s.base, s.off, s.acc + run);
    if (!c.over) {
      const g = w.segments[c.k], timer = isTimer(g);
      return { kind: 'run', piece: w, i: c.k, n, timer, paused, waiting, bg: g.bg, fg: g.fg,
               text: timer ? fmt(Math.floor(c.ms / 1000)) : fmt(Math.ceil((secLen(w, c.k) - c.ms) / 1000)),
               lit: (c.k > s.base || s.fresh) ? blinkLit(c.ms - (c.k === s.base ? s.off : 0)) : true };
    }
    if (s.list && s.next) { const g = s.next.segments[0]; return { kind: 'next', piece: s.next, seek: { k: 0, ms: 0 }, n: s.next.segments.length, bg: g.bg, fg: g.fg }; }
    if (s.list) return { kind: 'end', bg: '#0d0f10', fg: '#f2a541' };
    const g = w.segments[n - 1];
    return { kind: 'done', piece: w, i: n - 1, n, text: fmt(0), bg: g.bg, fg: g.fg, lit: blinkLit(c.ms) };
  }

  return { draw, fitTitle, ink, fmt, fmtDur, isTimer, total, hasTimer, durText, totalText, clampSeek, stepSeek, seekText,
           strip, placeHead, seekFromX, sample, now, view };
})();
