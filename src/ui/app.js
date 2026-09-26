/**
 * learnSpark app shell: terminal, levels, goals, celebrate + share, persistence.
 */

import { execute, createState } from "../engine/commands.js";
import { run } from "../engine/execute.js";
import { SEQUENCES, LEVELS, allLevels, checkGoals, getNextLevel } from "../game/levels.js";
import { renderDag, renderPreview, renderCluster, renderTimeline } from "./viz.js";
import { TerminalView } from "./terminal.js";
import {
  loadProgress,
  saveProgress,
  summarizeCurriculum,
  resumeLine,
} from "./progress.js";
import { buildShareTargets, shareWithClipboard, LIVE_URL } from "./share.js";
import { launchConfetti, playFanfare } from "./confetti.js";
import { describeSettings, resetSettings, settings, clusterShape } from "../engine/settings.js";

const els = {
  rail: document.getElementById("level-rail"),
  goals: document.getElementById("goals"),
  parts: document.getElementById("parts"),
  partMeta: document.getElementById("part-meta"),
  dagRoot: document.getElementById("dag-root"),
  dagMeta: document.getElementById("dag-meta"),
  modePill: document.getElementById("mode-pill"),
  levelTitle: document.getElementById("level-title"),
  progress: document.getElementById("progress"),
  cardTitle: document.getElementById("card-title"),
  cardBody: document.getElementById("card-body"),
  stCmds: document.getElementById("st-cmds"),
  stActions: document.getElementById("st-actions"),
  stLazy: document.getElementById("st-lazy"),
  stCost: document.getElementById("st-cost"),
  cmdHelp: document.getElementById("cmd-help"),
  modal: document.getElementById("modal"),
  modalBox: document.getElementById("modal-box"),
  modalTitle: document.getElementById("modal-title"),
  modalBody: document.getElementById("modal-body"),
  modalPrimary: document.getElementById("modal-primary"),
  modalSecondary: document.getElementById("modal-secondary"),
  termRoot: document.getElementById("term-root"),
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const game = {
  mode: "sandbox",
  levelId: null,
  state: createState(),
  done: loadProgress(),
  offered: false,
};

const terminal = new TerminalView(els.termRoot, function (line) {
  submit(line);
});

/**
 * @param {string} text
 * @param {string} [cls]
 */
function print(text, cls) {
  terminal.push(cls || "info", text);
}

/**
 * @param {string} text
 * @param {string} [cls]
 */
function printBlock(text, cls) {
  String(text).split("\n").forEach(function (part) {
    print(part, cls);
  });
}

/**
 * @param {any} out
 */
function printTable(out) {
  if (out.text) print(out.text, "info");
  const cols = out.columns || [];
  const rows = out.rows || [];
  if (!cols.length) return;
  print(cols.join(" | "), "sys");
  for (let i = 0; i < rows.length; i += 1) {
    print(
      cols.map(function (c) { return String(rows[i][c]); }).join(" | "),
      "info"
    );
  }
}

/**
 * @param {{ animate?: boolean }} [opts]
 */
function render(opts) {
  opts = opts || {};
  renderRail();
  renderChrome();
  renderGoals();
  renderDag(els.dagRoot, game.state.df, { animate: Boolean(opts.animate) });
  renderPreview(els.parts, els.partMeta, game.state);
  renderCluster(document.getElementById("cluster-panel"), game.state);
  renderTimeline(document.getElementById("timeline-panel"), game.state);

  els.stCmds.textContent = String((game.state.commandsRun || []).length);
  els.stActions.textContent = String(game.state.actionsRun || 0);
  els.stLazy.textContent = String(game.state.transformsPending || 0);
  els.stCost.textContent = game.state.lastRun ? String(game.state.lastRun.computeCost) : "–";
  const clusterEl = document.getElementById("cluster-meta");
  if (clusterEl) {
    const parts = game.state.lastRun
      ? game.state.lastRun.partitions
      : (game.state.df ? game.state.df.partitions : 2);
    const shape = clusterShape(parts);
    const mem = game.state.lastRun && game.state.lastRun.memory;
    clusterEl.textContent =
      shape.executors + " exec × " + shape.slots + " slots · " +
      settings.executorMb + "MB · " +
      (mem && mem.spilled ? "SPILL" : "ok") +
      (game.state.lastRun && game.state.lastRun.retries ? " · retry " + game.state.lastRun.retries : "");
  }
  const setEl = document.getElementById("settings-line");
  if (setEl) setEl.textContent = describeSettings();

  if (game.mode === "level" && game.levelId) {
    const level = LEVELS[game.levelId];
    const res = checkGoals(level, game.state);
    if (res.met && !(game.done[level.id] && game.done[level.id].solved)) {
      markSolved(level, (game.state.commandsRun || []).length);
      showCelebrate(level);
    }
    terminal.setHint(res.met ? null : suggestNext(level, res));
  } else {
    terminal.setHint(null);
  }
}

/**
 * @param {any} level
 * @param {number} used
 */
function markSolved(level, used) {
  const prev = game.done[level.id] || {};
  const best =
    prev.bestCommands === undefined ? used : Math.min(prev.bestCommands, used);
  game.done[level.id] = { solved: true, bestCommands: best };
  saveProgress(game.done);
}

/**
 * @param {any} level
 * @param {any} res
 * @returns {string|null}
 */
function suggestNext(level, res) {
  for (let i = 0; i < res.checks.length; i += 1) {
    if (!res.checks[i].done) {
      const g = (level.goals || [])[i];
      if (g && g.head) return String(g.head);
      if (g && g.op) return String(g.op);
      return level.hints && level.hints[Math.min(game.state.hintIndex || 0, level.hints.length - 1)];
    }
  }
  return (level.hints && level.hints[0]) || null;
}

function renderRail() {
  els.rail.innerHTML = "";
  for (let s = 0; s < SEQUENCES.length; s += 1) {
    const seq = SEQUENCES[s];
    const t = document.createElement("div");
    t.className = "seq-title";
    t.textContent = seq.title;
    els.rail.appendChild(t);
    for (let i = 0; i < seq.levels.length; i += 1) {
      const id = seq.levels[i];
      const level = LEVELS[id];
      const solved = Boolean(game.done[id] && game.done[id].solved);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "level-item" +
        (game.mode === "level" && game.levelId === id ? " active" : "") +
        (solved ? " done" : "");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.textContent = solved ? "●" : "○";
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(level.title));
      const meta = document.createElement("span");
      meta.className = "meta";
      const best = game.done[id] && game.done[id].bestCommands;
      meta.textContent =
        "diff " +
        level.difficulty +
        (best !== undefined ? " · par " + best + "/" + (level.commandsAllowed || "?") : "");
      btn.appendChild(meta);
      btn.addEventListener("click", function () {
        openLevel(id);
      });
      els.rail.appendChild(btn);
    }
  }
}

function renderChrome() {
  const summary = summarizeCurriculum(game.done);
  els.progress.textContent = summary.solvedCount + "/" + summary.total + " levels";

  if (game.mode === "sandbox") {
    els.modePill.textContent = "SANDBOX";
    els.modePill.classList.add("on");
    els.levelTitle.textContent = "free play";
    els.cardTitle.textContent = "Sandbox";
    els.cardBody.textContent =
      "Play freely. Tables: sales, users, products, logs.\n\nload sales\nfilter amount > 100\nexplain\nshow\n\n↑↓ history · Tab word complete";
  } else {
    const level = LEVELS[game.levelId];
    els.modePill.textContent = "LEVEL";
    els.modePill.classList.remove("on");
    els.levelTitle.textContent = level.sequence + " / " + level.title;
    els.cardTitle.textContent = level.title;
    els.cardBody.textContent = level.intro + "\n\nGoal: " + level.goalText;
  }
}

function renderGoals() {
  els.goals.innerHTML = "";
  if (game.mode !== "level" || !game.levelId) {
    els.goals.innerHTML =
      '<div class="line info">Sandbox has no goals. Open a level from the left rail.</div>';
    return;
  }
  const level = LEVELS[game.levelId];
  const res = checkGoals(level, game.state);
  for (let i = 0; i < res.checks.length; i += 1) {
    const c = res.checks[i];
    const row = document.createElement("div");
    row.className =
      "goal" + (c.done ? " done" : "") + (c.active ? " goal-active neon" : "");
    row.innerHTML =
      '<span class="mark">' +
      (c.done ? "✓" : "→") +
      "</span><span>" +
      escapeHtml(c.label) +
      '<span class="detail">' +
      escapeHtml(c.detail) +
      "</span></span>";
    els.goals.appendChild(row);
  }
  const used = (game.state.commandsRun || []).length;
  const golf = document.createElement("div");
  golf.className = "goal";
  golf.innerHTML =
    '<span class="mark">#</span><span>command golf<span class="detail">' +
    used +
    " used" +
    (level.commandsAllowed ? " / par " + level.commandsAllowed : "") +
    "</span></span>";
  els.goals.appendChild(golf);
}

/**
 * @param {string} raw
 */
function submit(raw) {
  const line = String(raw || "");
  const trimmed = line.trim();
  if (!trimmed) return;
  terminal.pushHistory(trimmed);
  print("spark> " + trimmed, "cmd");

  const lower = trimmed.toLowerCase();
  if (lower === "next") {
    goNextLevel();
    terminal.focus();
    return;
  }
  if (lower === "levels") {
    openLevelsModal();
    terminal.focus();
    return;
  }
  if (lower === "sandbox") {
    openSandbox();
    terminal.focus();
    return;
  }

  const ctx = { level: game.levelId ? LEVELS[game.levelId] : null };
  const result = execute(game.state, trimmed, ctx);
  game.state = result.state;

  for (let i = 0; i < result.outputs.length; i += 1) {
    const out = result.outputs[i];
    if (out.kind === "clear") {
      terminal.clear();
    } else if (out.kind === "table") {
      printTable(out);
    } else if (out.kind === "plan") {
      printBlock(out.text || "", "sys");
    } else if (out.text) {
      printBlock(out.text, out.kind);
    }
  }

  render({ animate: result.kind === "action" && result.ok });
  // Keep caret in the box after every command.
  terminal.focus();
}

/**
 * @param {string} id
 */
function openLevel(id) {
  game.mode = "level";
  game.levelId = id;
  game.state = createState();
  resetSettings();
  game.offered = false;
  const level = LEVELS[id];
  terminal.clear();
  print("— level: " + level.title + " —", "sys");
  printBlock(level.intro, "info");
  print("Goal: " + level.goalText, "success");
  if (level.learn && level.learn.length) {
    print("You will learn:", "sys");
    level.learn.forEach(function (l) {
      print("  • " + l, "info");
    });
  }
  print("Type hint if stuck. Type next when solved. ↑↓ history, Tab completes words.", "info");
  closeModal();
  render();
  terminal.focus();
}

function openSandbox() {
  game.mode = "sandbox";
  game.levelId = null;
  game.state = createState();
  resetSettings();
  game.offered = false;
  terminal.clear();
  print("Sandbox mode. Tables: sales, users, products, logs.", "sys");
  print("Try: load sales / filter amount > 100 / show", "info");
  const summary = summarizeCurriculum(game.done);
  if (summary.solvedCount) printBlock(resumeLine(summary), "info");
  closeModal();
  render();
  terminal.focus();
}

function goNextLevel() {
  const list = allLevels();
  for (let i = 0; i < list.length; i += 1) {
    const st = game.done[list[i].id];
    if (!(st && st.solved)) {
      openLevel(list[i].id);
      return;
    }
  }
  if (game.levelId) {
    const next = getNextLevel(game.levelId);
    if (next) {
      openLevel(next.id);
      return;
    }
  }
  print("All levels solved. Sandbox is open.", "success");
  openSandbox();
}

/**
 * @param {{ title: string, body: string, primary: string, secondary?: string, onPrimary?: () => void, onSecondary?: () => void, win?: boolean, bodyHtml?: string }} opts
 */
function showModal(opts) {
  els.modalTitle.textContent = opts.title;
  if (opts.bodyHtml) {
    els.modalBody.innerHTML = opts.bodyHtml;
  } else {
    els.modalBody.textContent = opts.body;
  }
  els.modalPrimary.textContent = opts.primary;
  els.modalSecondary.textContent = opts.secondary || "Close";
  els.modalBox.classList.toggle("win", Boolean(opts.win));
  els.modal.classList.add("open");
  els.modalPrimary.onclick = function () {
    closeModal();
    if (opts.onPrimary) opts.onPrimary();
  };
  els.modalSecondary.onclick = function () {
    closeModal();
    if (opts.onSecondary) opts.onSecondary();
    terminal.focus();
  };
}

function closeModal() {
  els.modal.classList.remove("open");
  els.modalBox.classList.remove("win");
  game.offered = false;
  terminal.focus();
}

const CHEERS = [
  "Clean run. The DAG tells the truth.",
  "That is how stages actually split.",
  "Nice — lazy plan, sharp action.",
  "Partition strip updated. Keep going.",
];

/**
 * Celebrate modal with curriculum share (LinkedIn / X / Facebook / copy).
 *
 * @param {any} level
 */
function showCelebrate(level) {
  if (game.offered) return;
  game.offered = true;

  const used = (game.state.commandsRun || []).length;
  const par = level.commandsAllowed || used;
  const curriculum = summarizeCurriculum(game.done);
  const share = buildShareTargets({
    levelName: level.title,
    levelId: level.id,
    commands: used,
    par: par,
    curriculum: curriculum,
  });
  const next = getNextLevel(level.id);
  const underPar = used <= par;
  const golfLine =
    "**" +
    used +
    "** command" +
    (used === 1 ? "" : "s") +
    ". Ideal is " +
    par +
    (underPar ? " — on par or better." : ". Still counts — you got there.");
  const cheer = CHEERS[Math.floor(Math.random() * CHEERS.length)];
  const learnedPreview = curriculum.learned
    .map(function (l) {
      return "<li>" + escapeHtml(l.seriesTitle) + ": " + escapeHtml(l.name) + "</li>";
    })
    .join("");

  const bodyHtml = [
    '<div class="celebrate" aria-live="polite">',
    '  <div class="celebrate-visual" aria-hidden="true"><div class="celebrate-ring"></div><div class="celebrate-star">★</div></div>',
    '  <div class="celebrate-badge">LEVEL CLEARED</div>',
    '  <h3 class="celebrate-title">' + escapeHtml(level.title) + "</h3>",
    '  <p class="celebrate-sub">' +
      escapeHtml(String(level.sequence || "").toUpperCase()) +
      ' · <code>' +
      escapeHtml(level.id) +
      "</code></p>",
    '  <p class="celebrate-cheer">' + escapeHtml(cheer) + "</p>",
    '  <div class="celebrate-stats"><p>' + golfLine + "</p></div>",
    '  <div class="celebrate-progress">',
    '    <div class="prog-track"><div class="prog-fill" style="width:' + curriculum.percent + '%"></div></div>',
    '    <div class="par-note">' +
      curriculum.solvedCount +
      " / " +
      curriculum.total +
      " levels solved · progress saved in this browser</div>",
    "  </div>",
    '  <div class="share-block">',
    '    <div class="share-title">Share what you learned (with your curriculum)</div>',
    '    <div class="learned-preview"><div class="par-note">Included in the post:</div><ul>' +
      (learnedPreview || "<li>Solve more levels to grow the list</li>") +
      "</ul></div>",
    '    <div class="share-row" role="group" aria-label="Share">',
    '      <button type="button" class="share-btn linkedin" data-share="linkedin">LinkedIn</button>',
    '      <button type="button" class="share-btn x" data-share="x">X / Twitter</button>',
    '      <button type="button" class="share-btn facebook" data-share="facebook">Facebook</button>',
    '      <button type="button" class="share-btn copy" data-share="copy">Copy post</button>',
    "    </div>",
    '    <div class="share-status" data-share-status hidden></div>',
    "  </div>",
    '  <div class="celebrate-next">' +
      (next
        ? "Next up: <strong>" + escapeHtml(next.title) + "</strong> (" + escapeHtml(next.id) + ")"
        : "You cleared the full curriculum.") +
      "</div>",
    "</div>",
  ].join("\n");

  print("LEVEL SOLVED: " + level.title + "  (" + used + " commands, par " + par + ")", "success");

  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const confetti = launchConfetti(4800);
  playFanfare();

  const actions = [
    {
      label: "Stay here",
      onPrimary: function () {
        game.offered = false;
        terminal.focus();
      },
    },
    {
      label: next ? "Next: " + next.title : "Browse levels",
      onSecondary: function () {
        game.offered = false;
        if (next) openLevel(next.id);
        else openLevelsModal();
      },
    },
  ];

  // primary = stay (celebrate), secondary = next — map to modal buttons
  showModal({
    title: "Level complete — " + level.title,
    bodyHtml: bodyHtml,
    win: true,
    primary: actions[0].label,
    secondary: actions[1].label,
    onPrimary: function () {
      confetti && confetti.stop();
      actions[0].onPrimary();
    },
    onSecondary: function () {
      confetti && confetti.stop();
      actions[1].onSecondary();
    },
  });

  els.modalBox.classList.add("modal-celebrate");

  els.modalBody.querySelectorAll("[data-share]").forEach(function (btn) {
    btn.addEventListener("click", async function (ev) {
      ev.preventDefault();
      const kind = btn.getAttribute("data-share") || "copy";
      const status = els.modalBody.querySelector("[data-share-status]");
      const result = await shareWithClipboard(kind, share);
      if (!status) return;
      status.hidden = false;
      if (kind === "copy") {
        status.textContent = result.copied
          ? "Post copied to clipboard."
          : "Copy failed — select the text above.";
        return;
      }
      status.textContent = result.copied
        ? "Share window opened. Text also copied (networks often drop prefilled posts)."
        : "Share window opened.";
    });
  });
}

function openLevelsModal() {
  const list = allLevels();
  const lines = list.map(function (lv) {
    const st = game.done[lv.id];
    const mark = st && st.solved ? "[x]" : "[ ]";
    const best = st && st.bestCommands !== undefined ? " best " + st.bestCommands : "";
    return mark + " " + lv.id + " — " + lv.title + "  (par " + (lv.commandsAllowed || "?") + ")" + best;
  });
  const summary = summarizeCurriculum(game.done);
  showModal({
    title: "Levels",
    body:
      lines.join("\n") +
      "\n\n" +
      summary.solvedCount +
      "/" +
      summary.total +
      " solved (" +
      summary.percent +
      "%). Progress saved in this browser.",
    primary: "OK",
  });
}

function boot() {
  els.cmdHelp.textContent = [
    "load sales | users | products | logs",
    "filter <expr> | select a, b | withColumn n e",
    "sort c [desc] | limit n | groupBy k sum col",
    "join t on key | repartition n | coalesce n",
    "cache | unpersist | show | count | collect",
    "schema | columns | explain | write | sparksql ...",
    "levels | goal | hint | undo | reset | clear | next",
    "set k v | salt | cube | approx | get | mapExplode",
    "ml vectorize|fit|predict | stream emit|watermark | injectFail",
    "",
    "↑↓ history · Tab word complete · Esc clear",
  ].join("\n");

  document.getElementById("btn-levels").addEventListener("click", openLevelsModal);
  document.getElementById("btn-sandbox").addEventListener("click", openSandbox);
  document.getElementById("btn-reset").addEventListener("click", function () {
    submit("reset");
    terminal.focus();
  });

  const params = new URLSearchParams(window.location.search);
  const levelParam = params.get("level");
  const cmdParam = params.get("command");
  const noDemo = params.get("NODEMO") === "1";

  if (levelParam && LEVELS[levelParam]) {
    openLevel(levelParam);
  } else if (noDemo || cmdParam) {
    openSandbox();
  } else {
    const summary = summarizeCurriculum(game.done);
    const resume = summary.solvedCount ? resumeLine(summary) : null;
    showModal({
      title: "learnSpark",
      bodyHtml:
        "<p>Interactive Apache Spark visualization and tutorial.</p>" +
        "<p>The Job DAG shows lazy plans and stage boundaries (shuffles). Partitions show how rows sit on executors.</p>" +
        (resume ? "<p class='par-note'>" + escapeHtml(resume).replace(/\n/g, "<br/>") + "</p>" : "") +
        "<p>Start with a level, or drop into sandbox.</p>",
      primary: summary.next ? "Continue: " + summary.next.name : "Start intro level",
      secondary: "Sandbox",
      onPrimary: function () {
        if (summary.next) openLevel(summary.next.id);
        else openLevel("welcome");
      },
      onSecondary: function () {
        openSandbox();
      },
    });
    render();
    terminal.focus();
  }

  if (cmdParam) {
    cmdParam.split(";").forEach(function (part) {
      submit(part);
    });
    terminal.focus();
  }
}

boot();
