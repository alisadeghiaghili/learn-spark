"""Add stage/task timeline UI and wire into app."""
from pathlib import Path

viz = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\ui\viz.js")
t = viz.read_text(encoding="utf-8")
if "renderTimeline" not in t:
    t += r'''

/**
 * Stage/task timeline (Spark UI Jobs tab shape).
 *
 * @param {HTMLElement} root
 * @param {any} state
 * @returns {void}
 */
export function renderTimeline(root, state) {
  if (!root) return;
  root.innerHTML = "";
  const result = state.lastRun;
  if (!result) {
    root.innerHTML = '<div class="par-note">No job yet — run an action.</div>';
    return;
  }
  const stages = result.stages || [];
  const retries = result.retries || 0;
  const cg = result.codegen || {};
  const opt = (result.optimizer && result.optimizer.trace) || [];

  const head = document.createElement("div");
  head.className = "par-note";
  head.textContent =
    "stages=" + stages.length +
    " · codegen segments=" + (cg.segments || 0) + " splits=" + (cg.splits || 0) +
    " · retries=" + retries +
    (result.speculative ? " · speculation" : "") +
    " · optimizer rules=" + opt.length;
  root.appendChild(head);

  const wrap = document.createElement("div");
  wrap.className = "timeline";
  for (let i = 0; i < stages.length; i += 1) {
    const s = stages[i];
    const row = document.createElement("div");
    row.className = "timeline-row" + (s.wide ? " wide" : "");
    const label = document.createElement("div");
    label.className = "timeline-label";
    label.textContent = "Stage " + i + (s.wide ? " shuffle" : " map");
    const bar = document.createElement("div");
    bar.className = "timeline-bar";
    bar.style.width = Math.min(100, 12 + s.ops.length * 18) + "%";
    if (retries && i === stages.length - 1) {
      bar.classList.add("retry");
      bar.textContent = retries + " attempt" + (retries > 1 ? "s" : "");
    }
    const ops = document.createElement("div");
    ops.className = "par-note";
    ops.textContent = s.ops.join(" → ");
    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(ops);
    wrap.appendChild(row);
  }
  root.appendChild(wrap);

  if (opt.length) {
    const rules = document.createElement("div");
    rules.className = "par-note";
    rules.textContent = opt.map(function (x) { return x.rule; }).join(", ");
    root.appendChild(rules);
  }
}
'''
    viz.write_text(t, encoding="utf-8")
    print("timeline added")

css = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\assets\css\main.css")
t = css.read_text(encoding="utf-8")
if ".timeline" not in t:
    t += r'''

/* Stage timeline */
.timeline { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.timeline-row {
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 8px;
}
.timeline-row.wide { border-color: var(--stage); }
.timeline-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--muted);
}
.timeline-bar {
  height: 8px;
  margin: 4px 0;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--partition), var(--accent));
  min-width: 12px;
}
.timeline-bar.retry {
  background: repeating-linear-gradient(
    135deg,
    var(--danger),
    var(--danger) 6px,
    #7a2b28 6px,
    #7a2b28 12px
  );
  color: var(--ink);
  font-family: var(--mono);
  font-size: 9px;
  line-height: 8px;
}
'''
    css.write_text(t, encoding="utf-8")
    print("timeline css")

idx = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\index.html")
t = idx.read_text(encoding="utf-8")
if "timeline-panel" not in t:
    t = t.replace(
        '<div class="cluster-panel" id="cluster-panel"></div>',
        '<div class="cluster-panel" id="cluster-panel"></div>\n        <div class="timeline-panel" id="timeline-panel"></div>',
    )
    idx.write_text(t, encoding="utf-8")
    print("timeline host")

app = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\ui\app.js")
t = app.read_text(encoding="utf-8")
t = t.replace(
    'import { renderDag, renderPreview, renderCluster } from "./viz.js";',
    'import { renderDag, renderPreview, renderCluster, renderTimeline } from "./viz.js";',
)
t = t.replace(
    'renderCluster(document.getElementById("cluster-panel"), game.state);',
    'renderCluster(document.getElementById("cluster-panel"), game.state);\n  renderTimeline(document.getElementById("timeline-panel"), game.state);',
)
app.write_text(t, encoding="utf-8")
print("timeline wired")
