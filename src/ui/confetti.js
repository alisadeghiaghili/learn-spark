/**
 * Confetti burst for level celebrations.
 */

const COLORS = ["#E25A1C", "#FF8A4C", "#2DD4BF", "#3FB950", "#A371F7", "#E8EEF4", "#D29922"];

/**
 * Launch confetti; returns a handle with stop().
 *
 * @param {number} [durationMs]
 * @returns {{ stop: () => void }|null}
 */
export function launchConfetti(durationMs = 4200) {
  if (typeof document === "undefined") return null;
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    const layer = document.createElement("div");
    layer.className = "confetti-static";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    return { stop: function () { layer.remove(); } };
  }

  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);
  document.body.appendChild(canvas);

  const pieces = [];
  function spawn(count, fromSides) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < count; i += 1) {
      const r = Math.random();
      const shape = r < 0.35 ? "ribbon" : r < 0.5 ? "tri" : "rect";
      pieces.push({
        x: fromSides ? (Math.random() < 0.5 ? -20 : w + 20) : w * 0.2 + Math.random() * w * 0.6,
        y: fromSides ? h * 0.35 + Math.random() * h * 0.3 : -20 - Math.random() * h * 0.35,
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 10,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        vx: fromSides ? (Math.random() < 0.5 ? 2.4 : -2.4) + (Math.random() - 0.5) : (Math.random() - 0.5) * 2.4,
        vy: 2 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.25,
        shape: shape,
      });
    }
  }

  spawn(70, false);
  spawn(40, true);

  const started = performance.now();
  let raf = 0;
  let stopped = false;

  function frame(now) {
    if (stopped) return;
    const t = now - started;
    if (t < durationMs && t % 400 < 20) spawn(6, Math.random() < 0.5);

    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (let i = 0; i < pieces.length; i += 1) {
      const p = pieces[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === "tri") {
        ctx.beginPath();
        ctx.moveTo(0, -p.h / 2);
        ctx.lineTo(p.w / 2, p.h / 2);
        ctx.lineTo(-p.w / 2, p.h / 2);
        ctx.closePath();
        ctx.fill();
      } else if (p.shape === "ribbon") {
        ctx.fillRect(-p.w / 2, -2, p.w, 3);
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      if (pieces[i].y > window.innerHeight + 40) pieces.splice(i, 1);
    }
    if (t < durationMs || pieces.length) {
      raf = requestAnimationFrame(frame);
    } else {
      cleanup();
    }
  }

  function cleanup() {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    canvas.remove();
  }

  raf = requestAnimationFrame(frame);
  return { stop: cleanup };
}

/**
 * Tiny WebAudio fanfare (best-effort, silent on failure).
 *
 * @returns {void}
 */
export function playFanfare() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach(function (f, i) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(ac.destination);
      const t0 = ac.currentTime + i * 0.08;
      o.start(t0);
      o.stop(t0 + 0.18);
    });
    setTimeout(function () { ac.close(); }, 1200);
  } catch (e) {
    // ignore autoplay blocks
  }
}
