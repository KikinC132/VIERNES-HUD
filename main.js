/* ============================================================
   HALO OS — live mission-control HUD
   Signature technique: an SVG + canvas heads-up display —
   a projected orbit diagram (planet + craft on an inclined
   ellipse), concentric rotating dial rings, a sweeping radar
   arc, a small starfield, gauges, a data-stream, and telemetry
   that ticks on a timer. One rAF loop drives every canvas.
   Deterministic drift (layered sines) — never any error spam.
   ============================================================ */
(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const doc = document;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAU = Math.PI * 2;
  const CYAN = '77,232,255';
  const AMBER = '255,176,32';

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const rgba = (c, a) => `rgba(${c},${a})`;
  /* deterministic layered oscillator — smooth, bounded, no randomness at runtime */
  const osc = (t, base, amp, freq, ph) =>
    base + amp * Math.sin(t * freq + ph) + amp * 0.34 * Math.sin(t * freq * 2.7 + ph * 1.6);

  /* mulberry32 — seed the one-time starfield layout */
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const canvasOK = !!doc.createElement('canvas').getContext;

  /* ---------- canvas fitter (dpr-capped) ---------- */
  function fit(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    let w = 0, h = 0, dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = canvas.clientWidth || 1;
      h = canvas.clientHeight || 1;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    return { ctx, get w() { return w; }, get h() { return h; }, resize };
  }

  /* ============================================================
     THE HUD — orbit + rings + radar + starfield
     ============================================================ */
  function buildHUD() {
    const canvas = doc.getElementById('hud');
    if (!canvas || !canvasOK) return null;
    const f = fit(canvas);
    if (!f) return null;
    const { ctx } = f;

    /* one-time seeded starfield */
    const rng = mulberry32(0x4de8ff);
    const STARS = Array.from({ length: 96 }, () => ({
      x: rng(), y: rng(),
      r: 0.4 + rng() * 1.3,
      tw: 0.6 + rng() * 2.4,
      ph: rng() * TAU,
      amber: rng() < 0.08
    }));
    /* radar contacts (angle around dial, normalized radius) */
    const BLIPS = Array.from({ length: 6 }, (_, i) => ({
      ang: rng() * TAU,
      rad: 0.34 + rng() * 0.56,
      amber: i === 2
    }));

    const TILT = -0.36;                // orbital plane inclination

    function ring(cx, cy, r, rot, n, longEvery, col, alpha, len) {
      ctx.strokeStyle = rgba(col, alpha);
      ctx.lineWidth = 1;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rot;
        const long = i % longEvery === 0;
        const r0 = r - (long ? len * 2 : len);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
    }

    function draw(t) {
      const w = f.w, h = f.h;
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2;
      const intro = easeOut(t / 1.6);
      ctx.clearRect(0, 0, w, h);

      /* backdrop glow */
      let bg = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R);
      bg.addColorStop(0, rgba(CYAN, 0.10));
      bg.addColorStop(0.55, rgba(CYAN, 0.03));
      bg.addColorStop(1, 'rgba(4,7,13,0)');
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.98, 0, TAU); ctx.fill();

      /* starfield */
      for (const s of STARS) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph));
        ctx.fillStyle = rgba(s.amber ? AMBER : CYAN, tw * 0.5 * intro);
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, TAU);
        ctx.fill();
      }

      /* ---- dial rings ---- */
      ctx.save();
      ctx.globalAlpha = intro;
      // outer ring + rotating ticks
      ctx.strokeStyle = rgba(CYAN, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, 0, TAU); ctx.stroke();
      ring(cx, cy, R * 0.9, t * 0.06, 120, 10, CYAN, 0.4, R * 0.028);
      // mid ring — dashed segments, counter-rotating, with one amber arc
      const rotB = -t * 0.09;
      ctx.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a0 = rotB + i * (TAU / 6);
        const amberSeg = i === 1;
        ctx.strokeStyle = rgba(amberSeg ? AMBER : CYAN, amberSeg ? 0.85 : 0.5);
        if (amberSeg) { ctx.shadowColor = rgba(AMBER, 0.7); ctx.shadowBlur = 8; }
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.7, a0, a0 + TAU / 9); ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // inner fine ticks
      ring(cx, cy, R * 0.5, t * 0.14, 72, 6, CYAN, 0.32, R * 0.02);
      ctx.strokeStyle = rgba(CYAN, 0.14);
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, TAU); ctx.stroke();
      ctx.restore();

      /* ---- radar sweep ---- */
      const sweep = t * 0.9;
      const wedge = 1.15;              // trailing angular width
      const slices = 16;
      ctx.save();
      for (let i = 0; i < slices; i++) {
        const a1 = sweep - (i / slices) * wedge;
        const a2 = sweep - ((i + 1) / slices) * wedge;
        const al = (1 - i / slices) * 0.16 * intro;
        ctx.fillStyle = rgba(CYAN, al);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R * 0.9, a2, a1);
        ctx.closePath(); ctx.fill();
      }
      // leading edge
      ctx.strokeStyle = rgba(CYAN, 0.85 * intro);
      ctx.lineWidth = 1.4;
      ctx.shadowColor = rgba(CYAN, 0.8); ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(sweep) * R * 0.9, cy + Math.sin(sweep) * R * 0.9);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      /* radar contacts — light up as the sweep passes, then fade */
      for (const b of BLIPS) {
        let d = (sweep - b.ang) % TAU; if (d < 0) d += TAU;
        const bright = clamp(1 - d / (TAU * 0.4), 0, 1) * intro;
        if (bright <= 0.02) continue;
        const bx = cx + Math.cos(b.ang) * R * b.rad;
        const by = cy + Math.sin(b.ang) * R * b.rad;
        const col = b.amber ? AMBER : CYAN;
        ctx.fillStyle = rgba(col, bright);
        ctx.shadowColor = rgba(col, bright); ctx.shadowBlur = 8 * bright;
        ctx.beginPath(); ctx.arc(bx, by, 2.4 + bright * 1.5, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = rgba(col, bright * 0.4);
        ctx.beginPath(); ctx.arc(bx, by, 6 + (1 - bright) * 10, 0, TAU); ctx.stroke();
      }

      /* ============ ORBIT DIAGRAM ============ */
      const a = R * 0.62, bb = R * 0.34;   // ellipse semi-axes
      const prec = TILT + t * 0.02;         // slow precession
      const cosP = Math.cos(prec), sinP = Math.sin(prec);
      const project = (lx, ly) => [cx + lx * cosP - ly * sinP, cy + lx * sinP + ly * cosP];

      // orbit path
      ctx.save();
      ctx.globalAlpha = intro;
      ctx.strokeStyle = rgba(CYAN, 0.4);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const th = (i / 96) * TAU;
        const [px, py] = project(a * Math.cos(th), bb * Math.sin(th));
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.stroke();

      // planet
      const rp = R * 0.155;
      const pg = ctx.createRadialGradient(cx - rp * 0.35, cy - rp * 0.4, rp * 0.1, cx, cy, rp);
      pg.addColorStop(0, rgba(CYAN, 0.42));
      pg.addColorStop(0.6, rgba(CYAN, 0.12));
      pg.addColorStop(1, 'rgba(6,12,20,0.95)');
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(cx, cy, rp, 0, TAU); ctx.fill();
      // limb
      ctx.strokeStyle = rgba(CYAN, 0.8);
      ctx.lineWidth = 1.4;
      ctx.shadowColor = rgba(CYAN, 0.7); ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(cx, cy, rp, 0, TAU); ctx.stroke();
      ctx.shadowBlur = 0;
      // planet latitude lines
      ctx.strokeStyle = rgba(CYAN, 0.22);
      ctx.lineWidth = 1;
      for (let k = -2; k <= 2; k++) {
        const yy = cy + (k / 3) * rp;
        const half = Math.sqrt(Math.max(0, rp * rp - (yy - cy) * (yy - cy)));
        ctx.beginPath(); ctx.moveTo(cx - half, yy); ctx.lineTo(cx + half, yy); ctx.stroke();
      }
      // planet ring
      ctx.strokeStyle = rgba(CYAN, 0.3);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rp * 1.5, rp * 0.42, prec, 0, TAU);
      ctx.stroke();

      // craft on the ellipse
      const cA = t * 0.35;
      const near = Math.abs(Math.sin(cA));           // amber pulse near a node
      const craftCol = near < 0.12 ? AMBER : CYAN;
      // trail
      for (let i = 1; i <= 12; i++) {
        const th = cA - i * 0.05;
        const [px, py] = project(a * Math.cos(th), bb * Math.sin(th));
        ctx.fillStyle = rgba(CYAN, (1 - i / 12) * 0.35 * intro);
        ctx.beginPath(); ctx.arc(px, py, 1.6, 0, TAU); ctx.fill();
      }
      const [qx, qy] = project(a * Math.cos(cA), bb * Math.sin(cA));
      // craft marker (diamond) + glow
      ctx.save();
      ctx.translate(qx, qy);
      ctx.rotate(cA);
      ctx.fillStyle = rgba(craftCol, 1);
      ctx.shadowColor = rgba(craftCol, 0.9); ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(0, -4.6); ctx.lineTo(3.6, 0); ctx.lineTo(0, 4.6); ctx.lineTo(-3.6, 0);
      ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.shadowBlur = 0;
      // tracking bracket around craft
      ctx.strokeStyle = rgba(craftCol, 0.8);
      ctx.lineWidth = 1.2;
      const br = 9;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(qx + sx * br, qy + sy * br - sy * 4);
        ctx.lineTo(qx + sx * br, qy + sy * br);
        ctx.lineTo(qx + sx * br - sx * 4, qy + sy * br);
        ctx.stroke();
      });
      ctx.restore();
    }

    return { draw, resize: f.resize };
  }

  /* ============================================================
     DATA-STREAM bars
     ============================================================ */
  function buildStream() {
    const canvas = doc.getElementById('stream');
    if (!canvas || !canvasOK) return null;
    const f = fit(canvas);
    if (!f) return null;
    const { ctx } = f;
    const N = 30;
    function draw(t) {
      const w = f.w, h = f.h;
      ctx.clearRect(0, 0, w, h);
      const bw = w / N;
      const intro = easeOut(t / 1.2);
      for (let i = 0; i < N; i++) {
        const v = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 0.55) * Math.sin(t * 0.7 + i * 0.2 + 1);
        const bh = (0.12 + Math.abs(v) * 0.85) * h * intro;
        const peak = bh > h * 0.78;
        ctx.fillStyle = rgba(peak ? AMBER : CYAN, peak ? 0.9 : 0.55);
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
      }
      // baseline
      ctx.fillStyle = rgba(CYAN, 0.25);
      ctx.fillRect(0, h - 1, w, 1);
    }
    return { draw, resize: f.resize };
  }

  /* ============================================================
     SUBSYSTEM gauges
     ============================================================ */
  function buildGauges() {
    const cfg = {
      nav:  { label: 'LOCK',   base: 0.93, amp: 0.03, ph: 0.0, col: CYAN },
      life: { label: 'AIR',    base: 0.84, amp: 0.05, ph: 1.2, col: CYAN },
      prop: { label: 'THRUST', base: 0.06, amp: 0.05, ph: 2.4, col: AMBER },
      comm: { label: 'LINK',   base: 0.88, amp: 0.05, ph: 3.6, col: CYAN }
    };
    const gauges = [];
    doc.querySelectorAll('.sub').forEach((sub) => {
      const canvas = sub.querySelector('.gauge');
      const c = cfg[sub.getAttribute('data-sys')];
      if (!canvas || !c || !canvasOK) return;
      const f = fit(canvas);
      if (!f) return;
      const { ctx } = f;
      const A0 = Math.PI * 0.75, SPAN = Math.PI * 1.5;   // 270° arc, bottom-open
      function draw(t) {
        const w = f.w, h = f.h;
        const cx = w / 2, cy = h * 0.56, R = Math.min(w, h * 1.1) / 2 - 8;
        const intro = easeOut(t / 1.4);
        const frac = clamp(osc(t, c.base, c.amp, 0.5, c.ph), 0, 1) * intro;
        ctx.clearRect(0, 0, w, h);
        // track
        ctx.strokeStyle = rgba(CYAN, 0.12);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, R, A0, A0 + SPAN); ctx.stroke();
        // ticks
        for (let i = 0; i <= 30; i++) {
          const a = A0 + (i / 30) * SPAN;
          const on = i / 30 <= frac;
          const r0 = R - (i % 5 === 0 ? 9 : 5);
          ctx.strokeStyle = rgba(on ? c.col : CYAN, on ? 0.75 : 0.14);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
          ctx.stroke();
        }
        // value arc
        ctx.strokeStyle = rgba(c.col, 0.9);
        ctx.lineWidth = 3;
        ctx.shadowColor = rgba(c.col, 0.7); ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(cx, cy, R, A0, A0 + SPAN * frac); ctx.stroke();
        ctx.shadowBlur = 0;
        // needle
        const na = A0 + SPAN * frac;
        ctx.strokeStyle = rgba(c.col, 0.95);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(na) * R * 0.82, cy + Math.sin(na) * R * 0.82);
        ctx.stroke();
        // hub
        ctx.fillStyle = rgba(c.col, 0.9);
        ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.fill();
        // center readout
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = rgba(c.col, 0.95);
        ctx.font = `600 ${Math.round(R * 0.42)}px "Chakra Petch", sans-serif`;
        ctx.fillText(Math.round(frac * 100) + '%', cx, cy - R * 0.14);
        ctx.fillStyle = rgba(CYAN, 0.45);
        ctx.font = `500 ${Math.round(R * 0.16)}px "JetBrains Mono", monospace`;
        ctx.fillText(c.label, cx, cy + R * 0.02);
      }
      gauges.push({ draw, resize: f.resize });
    });
    return gauges;
  }

  /* ============================================================
     TELEMETRY — ticking DOM readouts (deterministic drift)
     ============================================================ */
  const setText = (id, v) => { const el = doc.getElementById(id); if (el) el.textContent = v; };
  const setBar = (id, pct) => { const el = doc.getElementById(id); if (el) el.style.width = clamp(pct, 3, 100) + '%'; };
  const setRead = (key, v) => { const el = doc.querySelector(`[data-read="${key}"]`); if (el) el.textContent = v; };

  function sampleTelemetry(t) {
    const alt = osc(t, 412.6, 3.4, 0.10, 0.4);
    const vel = osc(t, 7.662, 0.018, 0.10, 3.1);
    const o2  = osc(t, 98.4, 0.5, 0.16, 1.1);
    const dv  = osc(t, 1240, 11, 0.05, 2.2);
    const att = osc(t, 0, 2.6, 0.22, 0.9);
    const pwr = osc(t, 6.8, 0.55, 0.14, 2.7);
    const sig = osc(t, 12, 1.6, 0.19, 0.3);
    const rate = osc(t, 8.4, 0.35, 0.24, 1.9);

    setText('m-alt', alt.toFixed(1));  setBar('bar-alt', (alt - 405) / (420 - 405) * 100);
    setText('m-vel', vel.toFixed(3));  setBar('bar-vel', (vel - 7.60) / (7.72 - 7.60) * 100);
    setText('m-o2',  o2.toFixed(1));   setBar('bar-o2', (o2 - 90) / (100 - 90) * 100);
    setText('m-dv',  Math.round(dv));  setBar('bar-dv', (dv - 1150) / (1320 - 1150) * 100);
    setText('m-att', (att >= 0 ? '+' : '−') + Math.abs(att).toFixed(1) + '°');
    setText('m-pwr', pwr.toFixed(1) + ' kW');
    setText('m-sig', Math.round(sig) + ' dB');
    setText('m-rate', rate.toFixed(1));
    setText('tag-vel', vel.toFixed(2));

    setRead('nav-a', (0.004 + Math.abs(att) * 0.0004).toFixed(3) + '°');
    setRead('nav-b', osc(t, 0.9, 0.15, 0.2, 1).toFixed(1) + ' arcs/hr');
    setRead('life-a', Math.round(osc(t, 1013, 2.4, 0.12, 0.5)) + ' hPa');
    setRead('life-b', osc(t, 2.1, 0.12, 0.18, 2).toFixed(1) + ' mmHg');
    setRead('prop-a', '0.0 bar');
    setRead('prop-b', osc(t, 18.4, 0.25, 0.09, 1.4).toFixed(1) + ' bar');
    setRead('comm-a', osc(t, 12.4, 0.6, 0.21, 0.8).toFixed(1) + ' dB');
    setRead('comm-b', rate.toFixed(1) + ' Gbps');
  }

  /* ============================================================
     CLOCKS + MISSION LOG
     ============================================================ */
  const pad = (n, l = 2) => String(Math.floor(n)).padStart(l, '0');
  const fmtMET = (s) => `${pad(s / 3600, 3)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
  let metSec = 41 * 3600 + 12 * 60 + 7;

  function tickClocks() {
    const d = new Date();
    setText('utc', `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`);
    setText('met', fmtMET(metSec));
  }

  const LOG = [
    { tag: 'NAV',  msg: 'star-tracker fix converged · residual <b>0.004°</b>' },
    { tag: 'COMM', msg: 'downlink locked · DSN Canberra · <b>8.4 Gbps</b>' },
    { tag: 'LIFE', msg: 'CO₂ scrubber bed A regenerated · cabin <b>2.1 mmHg</b>' },
    { tag: 'PROP', lv: 'warn', msg: 'oxidizer tank pressure below soft limit · <b>18.4 bar</b>' },
    { tag: 'GNC',  msg: 'reaction-wheel desaturation complete · momentum nulled' },
    { tag: 'PWR',  msg: 'array sun-pointing · bus <b>28.1 V</b> · charge nominal' },
    { tag: 'THRM', msg: 'radiator loop B at setpoint · <b>+4.2 °C</b>' },
    { tag: 'NAV',  msg: 'state-vector uplink accepted · epoch stepped' },
    { tag: 'COMM', msg: 'forward-link ack · command count <b>2048</b>' },
    { tag: 'GNC',  msg: 'attitude hold · pointing error <b>0.02°</b>' },
    { tag: 'PROP', msg: 'RCS quad C leak-check passed' },
    { tag: 'LIFE', msg: 'potable-water reserve topped · <b>412 L</b>' },
    { tag: 'PWR',  msg: 'entering eclipse · switching to battery draw' },
    { tag: 'DATA', msg: 'telemetry frame CRC ok · <b>0</b> dropped packets' },
    { tag: 'COMM', lv: 'warn', msg: 'ground handover in <b>00:04:11</b> · brief signal gap expected' },
    { tag: 'NAV',  msg: 'periapsis crossing · altitude <b>408.9 km</b>' },
    { tag: 'PWR',  msg: 'exiting eclipse · array back online' },
    { tag: 'GNC',  msg: 'slew to nadir complete · imaging window open' }
  ];
  let logIdx = 0;
  const logList = doc.getElementById('logList');

  function makeRow(entry, sec, fresh) {
    const li = doc.createElement('li');
    li.className = 'log-row' + (fresh ? ' fresh' : '');
    li.innerHTML =
      `<span class="log-t">T+ ${fmtMET(sec)}</span>` +
      `<span class="log-tag"${entry.lv ? ' data-lv="warn"' : ''}>${entry.tag}</span>` +
      `<span class="log-msg">${entry.msg}</span>`;
    return li;
  }

  function seedLog() {
    if (!logList) return;
    let sec = metSec;
    const rows = [];
    for (let i = 0; i < 13; i++) {
      const entry = LOG[(logIdx++) % LOG.length];
      rows.push(makeRow(entry, sec, false));
      sec -= 47 + ((i * 53) % 120);   // deterministic descending stamps
    }
    rows.forEach((r) => logList.appendChild(r));
  }

  function pushLog() {
    if (!logList) return;
    const entry = LOG[(logIdx++) % LOG.length];
    const row = makeRow(entry, metSec, true);
    logList.insertBefore(row, logList.firstChild);
    while (logList.children.length > 40) logList.removeChild(logList.lastChild);
  }

  /* ============================================================
     BOOT
     ============================================================ */
  const hud = buildHUD();
  const stream = buildStream();
  const gauges = buildGauges();

  let t0 = performance.now();
  function frame(now) {
    const t = (now - t0) / 1000;
    if (hud) hud.draw(t);
    if (stream) stream.draw(t);
    for (const g of gauges) g.draw(t);
    raf = requestAnimationFrame(frame);
  }
  let raf = 0;

  // initial paint + values so nothing is ever blank
  tickClocks();
  sampleTelemetry(reduce ? 2 : 0.001);
  seedLog();

  if (reduce) {
    // static frame at a pleasant phase; no loops, no ticking
    if (hud) hud.draw(2.2);
    if (stream) stream.draw(2.2);
    for (const g of gauges) g.draw(2.2);
  } else {
    raf = requestAnimationFrame(frame);
    // telemetry ticks discretely (feels like real polled data)
    setInterval(() => sampleTelemetry((performance.now() - t0) / 1000), 560);
    setInterval(() => { metSec += 1; tickClocks(); }, 1000);
    setInterval(pushLog, 2600);
  }

  /* ---------- resize (debounced) ---------- */
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (hud) hud.resize();
      if (stream) stream.resize();
      for (const g of gauges) g.resize();
      if (reduce) {
        if (hud) hud.draw(2.2);
        if (stream) stream.draw(2.2);
        for (const g of gauges) g.draw(2.2);
      }
    }, 180);
  }, { passive: true });

  /* ---------- hero intro (compositor-driven) ---------- */
  const hero = doc.querySelector('.hero');
  if (hero) {
    requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add('loaded')));
    setTimeout(() => hero.classList.add('loaded'), 400);   // failsafe
  }

  /* ---------- scroll reveals ---------- */
  const reveals = doc.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  }

  /* ---------- nav backdrop ---------- */
  const nav = doc.querySelector('.nav');
  if (nav) {
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
})();
