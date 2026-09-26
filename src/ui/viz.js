/**
 * SVG DAG renderer and partition/preview renderers.
 */

import { planSpine } from "../engine/plan.js";
import { partitionRows, run } from "../engine/execute.js";

/**
 * Render the job DAG for a frame (or empty state).
 *
 * @param {SVGElement} rootEl
 * @param {any} df
 * @param {{ animate?: boolean }} [opts]
 * @returns {void}
 */
export function renderDag(rootEl, df, opts = {}) {
  while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);
  const meta = document.getElementById("dag-meta");
  if (!df) {
    rootEl.innerHTML = '<text x="24" y="120" class="dag-label" fill="#7d8b99">No plan yet — load a table</text>';
    if (meta) meta.textContent = "idle";
    return;
  }

  const spine = planSpine(df.plan);
  const result = run(df);
  const stages = result.stages;
  const n = spine.length;
  const nodeW = 120;
  const nodeH = 44;
  const gapX = 28;
  const totalW = n * nodeW + (n - 1) * gapX;
  const startX = Math.max(16, (800 - totalW) / 2);
  const y = 96;

  // stage bands
  let opIndex = 0;
  for (let s = 0; s < stages.length; s += 1) {
    const stage = stages[s];
    const count = stage.ops.length;
    if (!count) continue;
    const x0 = startX + opIndex * (nodeW + gapX) - 8;
    const w = count * nodeW + (count - 1) * gapX + 16;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(x0));
    rect.setAttribute("y", "36");
    rect.setAttribute("width", String(Math.max(w, 40)));
    rect.setAttribute("height", "120");
    rect.setAttribute("rx", "10");
    rect.setAttribute("fill", stage.wide ? "rgba(163,113,247,0.08)" : "rgba(45,212,191,0.05)");
    rect.setAttribute("stroke", stage.wide ? "#a371f7" : "#2a3544");
    rect.setAttribute("stroke-dasharray", stage.wide ? "5 3" : "0");
    rootEl.appendChild(rect);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", String(x0 + 8));
    label.setAttribute("y", "28");
    label.setAttribute("class", "stage-label");
    label.textContent = "Stage " + s + (stage.wide ? " · post-shuffle" : " · narrow");
    rootEl.appendChild(label);
    opIndex += count;
  }

  // nodes + edges
  for (let i = 0; i < n; i += 1) {
    const node = spine[i];
    const x = startX + i * (nodeW + gapX);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.setAttribute("transform", "translate(" + x + "," + y + ")");

    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("width", String(nodeW));
    rect.setAttribute("height", String(nodeH));
    rect.setAttribute("rx", "8");
    rect.setAttribute("class", "dag-node" +
      (node.wide ? " wide" : "") +
      (node.op === "source" ? " source" : "") +
      (df.cached && i === n - 1 ? " cached" : ""));
    g.appendChild(rect);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(nodeW / 2));
    text.setAttribute("y", String(nodeH / 2));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("class", "dag-label");
    text.textContent = truncate(node.label, 18);
    g.appendChild(text);
    rootEl.appendChild(g);

    if (i > 0) {
      const x1 = startX + (i - 1) * (nodeW + gapX) + nodeW;
      const x2 = x;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const mid = (x1 + x2) / 2;
      path.setAttribute("d", "M " + x1 + " " + (y + nodeH / 2) + " C " + mid + " " + (y + nodeH / 2) + ", " + mid + " " + (y + nodeH / 2) + ", " + x2 + " " + (y + nodeH / 2));
      path.setAttribute("class", node.wide ? "dag-edge dag-shuffle" : "dag-edge");
      rootEl.appendChild(path);
    }
  }

  if (meta) {
    meta.textContent = result.rows.length + " rows · " + result.partitions + " parts · " +
      result.stages.length + " stages · cost " + result.computeCost + (result.fromCache ? " · cache" : "");
  }

  if (opts.animate && result.rows.length) {
    animatePackets(rootEl, spine.length, nodeW, gapX, startX, y, nodeH);
  }
}

/**
 * Short label helper.
 *
 * @param {string} s
 * @param {number} n
 * @returns {string}
 */
function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * Animate data packets along the DAG.
 *
 * @param {SVGElement} rootEl
 * @param {number} count
 * @param {number} nodeW
 * @param {number} gapX
 * @param {number} startX
 * @param {number} y
 * @param {number} nodeH
 * @returns {void}
 */
function animatePackets(rootEl, count, nodeW, gapX, startX, y, nodeH) {
  for (let p = 0; p < 3; p += 1) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("r", "3.5");
    dot.setAttribute("class", "pulse");
    rootEl.appendChild(dot);
    const t0 = performance.now() + p * 180;
    function step(now) {
      const t = (now - t0) / 900;
      if (t < 0) {
        requestAnimationFrame(step);
        return;
      }
      if (t > 1) {
        dot.remove();
        return;
      }
      const x = startX + t * ((count - 1) * (nodeW + gapX) + nodeW);
      const yy = y + nodeH / 2 + Math.sin(t * Math.PI * 4) * 8;
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(yy));
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
}

/**
 * Render partition buckets + table preview.
 *
 * @param {HTMLElement} partsEl
 * @param {HTMLElement} metaEl
 * @param {any} state
 * @returns {void}
 */
export function renderPreview(partsEl, metaEl, state) {
  partsEl.innerHTML = "";
  if (!state.df) {
    if (metaEl) metaEl.textContent = "no data";
    partsEl.innerHTML = '<div class="line info">Load a table to see partitions.</div>';
    return;
  }

  const result = state.lastRun || run(state.df);
  const buckets = partitionRows(result.rows, result.partitions);
  if (metaEl) {
    metaEl.textContent = result.rows.length + " rows across " + buckets.length + " partitions";
  }

  for (let i = 0; i < buckets.length; i += 1) {
    const part = document.createElement("div");
    part.className = "part";
    const h = document.createElement("h4");
    h.textContent = "p" + i + " · " + buckets[i].length + " rows";
    part.appendChild(h);

    const table = document.createElement("table");
    const cols = result.columns.slice(0, 4);
    // header
    const thead = document.createElement("tr");
    for (let c = 0; c < cols.length; c += 1) {
      const td = document.createElement("td");
      td.className = "dim";
      td.textContent = cols[c];
      thead.appendChild(td);
    }
    table.appendChild(thead);

    const sample = buckets[i].slice(0, 5);
    for (let r = 0; r < sample.length; r += 1) {
      const tr = document.createElement("tr");
      for (let c = 0; c < cols.length; c += 1) {
        const td = document.createElement("td");
        td.textContent = String(sample[r][cols[c]]);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    if (!sample.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "dim";
      td.textContent = "(empty)";
      td.colSpan = Math.max(cols.length, 1);
      tr.appendChild(td);
      table.appendChild(tr);
    }
    part.appendChild(table);
    partsEl.appendChild(part);
  }

  // full preview table under partitions when small
  if (result.rows.length && result.rows.length <= 12) {
    const wrap = document.createElement("div");
    wrap.style.marginTop = "10px";
    const grid = document.createElement("table");
    grid.className = "grid";
    const head = document.createElement("tr");
    for (let c = 0; c < result.columns.length; c += 1) {
      const th = document.createElement("th");
      th.textContent = result.columns[c];
      head.appendChild(th);
    }
    grid.appendChild(head);
    for (let r = 0; r < result.rows.length; r += 1) {
      const tr = document.createElement("tr");
      for (let c = 0; c < result.columns.length; c += 1) {
        const td = document.createElement("td");
        td.textContent = String(result.rows[r][result.columns[c]]);
        tr.appendChild(td);
      }
      grid.appendChild(tr);
    }
    wrap.appendChild(grid);
    partsEl.appendChild(wrap);
  }
}


/**
 * Render driver + executors + task slots.
 *
 * @param {HTMLElement} root
 * @param {any} state
 * @returns {void}
 */
export function renderCluster(root, state) {
  if (!root) return;
  const result = state.lastRun;
  const parts = result ? result.partitions : (state.df ? state.df.partitions : 2);
  const shape = result && result.cluster ? result.cluster : { executors: 1, slots: 2 };
  const mem = result ? result.memory : null;
  const retries = result ? result.retries || 0 : 0;

  root.innerHTML = "";
  const row = document.createElement("div");
  row.className = "cluster-row";

  const driver = document.createElement("div");
  driver.className = "cluster-node driver";
  driver.innerHTML = "<h4>Driver</h4><div>plan → stages → tasks</div>";
  row.appendChild(driver);

  for (let e = 0; e < shape.executors; e += 1) {
    const ex = document.createElement("div");
    ex.className = "cluster-node executor" + (mem && mem.spilled ? " spill" : "");
    let slots = "";
    for (let s = 0; s < shape.slots; s += 1) {
      const busy = state.df ? "busy" : "idle";
      slots += '<span class="slot ' + busy + '">task</span>';
    }
    ex.innerHTML =
      "<h4>Executor " + e + "</h4><div>" + slots + "</div>" +
      "<div class='par-note'>" + (mem ? mem.executorMb + "MB" : "–") +
      (mem && mem.spilled ? " · SPILL " + mem.spillKb + "KB" : "") +
      (retries ? " · retry" : "") + "</div>";
    row.appendChild(ex);
  }
  root.appendChild(row);

  const meta = document.createElement("div");
  meta.className = "par-note";
  meta.textContent =
    parts + " partitions · " + shape.executors + " executors × " + shape.slots + " slots" +
    (result && result.fromCache ? " · cache hit" : "") +
    (result && result.lateDropped ? " · late dropped " + result.lateDropped : "");
  root.appendChild(meta);
}


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
