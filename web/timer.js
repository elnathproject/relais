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
  const cums = w => { const c = [0]; w.segments.forEach(s => c.push(c[c.length - 1] + s.s * 1000)); return c; };
  const segIndex = (c, el) => { let i = 0; while (i < c.length - 2 && el >= c[i + 1]) i++; return i; };

  // ---- Seek bar: the coloured sections of a work, a head at the start position ----
  // Each section takes the digit colour of its countdown. Time and position are mapped on the
  // sections themselves, not on the whole bar, so the gaps never shift the head off the colours.
  function strip(box, w) {
    box.textContent = '';
    w.segments.forEach(s => { const sp = document.createElement('span'); sp.style.flex = `${s.s} 1 0`; sp.style.background = s.fg; box.append(sp); });
  }
  function placeHead(bar, stripBox, head, past, w, seek) {
    const spans = stripBox.children, c = cums(w);
    if (!spans.length) return;
    const i = Math.min(segIndex(c, seek), spans.length - 1);
    const b = bar.getBoundingClientRect(), r = spans[i].getBoundingClientRect();
    const x = r.left - b.left + (seek - c[i]) / (c[i + 1] - c[i]) * r.width;
    head.style.left = x + 'px'; if (past) past.style.width = (seek ? x : 0) + 'px';
  }
  function seekFromX(stripBox, w, clientX) {
    const spans = [...stripBox.children], c = cums(w);
    const i = spans.findIndex(sp => clientX < sp.getBoundingClientRect().right);
    if (i < 0) return c[c.length - 1];
    const r = spans[i].getBoundingClientRect();
    return c[i] + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (c[i + 1] - c[i]);
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
  // elapsed in the work = seek + acc + time run since `since`, stopped at `until` if paused.
  // Kinds: idle, title (of the loaded work), run, next (title of the next work, the current one
  // being over), done (single work over: 00:00), end (worklist over).
  // Blinking in time, as in the app: for the first three seconds of a new countdown the digits are
  // lit in the first 550 ms of every second. The countdown the run starts from never blinks.
  const BLINK_BEATS = 3, BLINK_ON = 550;
  const blinkLit = since => !(since >= 0 && since < BLINK_BEATS * 1000 && since % 1000 >= BLINK_ON);
  function view(s, t = now()) {
    if (!s || s.mode === 'idle' || !s.work) return { kind: 'idle' };
    const w = s.work, c = cums(w), n = w.segments.length, tot = c[n];
    if (s.mode === 'title') { const i = segIndex(c, s.seek); return { kind: 'title', work: w, seek: s.seek, i, n, bg: w.segments[i].bg, fg: w.segments[i].fg }; }
    const waiting = s.since !== null && t < s.since && s.acc === 0;
    const run = s.since === null ? 0 : Math.max(0, Math.min(t, s.until ?? Infinity) - s.since);
    const el = s.seek + s.acc + run;
    const paused = s.until !== null && t >= s.until;
    if (el < tot) {
      const i = segIndex(c, el), start = segIndex(c, s.seek), g = w.segments[i];
      return { kind: 'run', work: w, i, n, el, paused, waiting, text: fmt(Math.ceil((c[i + 1] - el) / 1000)),
               bg: g.bg, fg: g.fg, lit: i > start ? blinkLit(el - c[i]) : true };
    }
    if (s.list && s.next) { const g = s.next.segments[0]; return { kind: 'next', work: s.next, seek: 0, i: 0, n: s.next.segments.length, bg: g.bg, fg: g.fg, endedAt: t - (el - tot) }; }
    if (s.list) return { kind: 'end', bg: '#0d0f10', fg: '#f2a541' };
    const g = w.segments[n - 1];
    return { kind: 'done', work: w, i: n - 1, n, text: fmt(0), bg: g.bg, fg: g.fg, lit: blinkLit(el - tot) };
  }

  return { draw, fitTitle, ink, fmt, fmtDur, cums, segIndex, strip, placeHead, seekFromX, sample, now, view };
})();
