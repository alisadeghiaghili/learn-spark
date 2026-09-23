/**
 * learnSpark app shell: terminal, levels, goals, persistence.
 */

import { execute, createState } from "../engine/commands.js";
import { run } from "../engine/execute.js";
import { SEQUENCES, LEVELS, allLevels, checkGoals } from "../game/levels.js";
import { renderDag, renderPreview } from "./viz.js";

const STORE_KEY = "learnspark.progress.v1";

const els = {
  rail: document.getElementById("level-rail"),
  termOut: document.getElementById("term-out"),
  termIn: document.getElementById("term-in"),
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
};

/** @type {{ mode: 'sandbox'|'level', levelId: string|null, state: any, done: Record<string, boolean>, historyLines: string[] }} */
const game = {
  mode: "sandbox",
  levelId: null,
  state: createState(),
  done: loadProgress(),
  historyLines: [],
};

/**
 * Load solved level ids from localStorage.
 *
 * @returns {Record<string, boolean>}
 */
function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
  } catch (e) {
    return {};
  }
}

/**
 * Persist solved level ids.
 *
 * @returns {void}
 */
function saveProgress() {
  localStorage.setItem(STORE_KEY, JSON.stringify(game.done));
}

/**
 * Append a terminal line.
 *
 * @param {string} text
 * @param {string} [cls]
 * @returns {void}
 */
function print(text, cls) {
  const line = document.createElement("div");
  line.className = "line " + (cls || "info");
  line.textContent = text;
  els.termOut.appendChild(line);
  els.termOut.scrollTop = els.termOut.scrollHeight;
}

/**
 * Render multi-line info block.
 *
 * @param {string} text
 * @param {string} [cls]
 * @returns {void}
 */
function printBlock(text, cls) {
  const parts = String(text).split("\n");
  for (let i = 0; i < parts.length; i += 1) print(parts[i], cls);
}

/**
 * Render a result table into the terminal.
 *
 * @param {any} out
 * @returns {void}
 */
function printTable(out) {
  if (out.text) print(out.text, "info");
  const cols = out.columns || [];
  const rows = out.rows || [];
  if (!cols.length) return;
  print(cols.join(" | "), "sys");
  for (let i = 0; i < rows.length; i += 1) {
    const vals = cols.map(function (c) { return String(rows[i][c]); });
    print(vals.join(" | "), "info");
  }
}

/**
 * Refresh all panels from game state.
 *
 * @param {{ animate?: boolean }} [opts]
 * @returns {void}
 */
function render(opts = {}) {
  renderRail();
  renderChrome();
  renderGoals();
  renderDag(els.dagRoot, game.state.df, { animate: Boolean(opts.animate) });
  renderPreview(els.parts, els.partMeta, game.state);

  els.stCmds.textContent = String((game.state.commandsRun || []).length);
  els.stActions.textContent = String(game.state.actionsRun || 0);
  els.stLazy.textContent = String(game.state.transformsPending || 0);
  els.stCost.textContent = game.state.lastRun ? String(game.state.lastRun.computeCost) : "–";

  if (game.mode === "level" && game.levelId) {
    const level = LEVELS[game.levelId];
    const res = checkGoals(level, game.state);
    if (res.met && !game.done[level.id]) {
      game.done[level.id] = true;
      saveProgress();
      showWin(level);
      render();
    }
  }
}

/**
 * Render left level rail.
 *
 * @returns {void}
 */
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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-item" +
        (game.mode === "level" && game.levelId === id ? " active" : "") +
        (game.done[id] ? " done" : "");
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.textContent = game.done[id] ? "●" : "○";
      btn.appendChild(dot);
      btn.appendChild(document.createTextNode(level.title));
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = "diff " + level.difficulty;
      btn.appendChild(meta);
      btn.addEventListener("click", function () { openLevel(id); });
      els.rail.appendChild(btn);
    }
  }
}

/**
 * Render top chrome / right cards.
 *
 * @returns {void}
 */
function renderChrome() {
  const total = allLevels().length;
  const doneCount = Object.keys(game.done).filter(function (k) { return game.done[k]; }).length;
  els.progress.textContent = doneCount + "/" + total + " levels";

  if (game.mode === "sandbox") {
    els.modePill.textContent = "SANDBOX";
    els.modePill.classList.add("on");
    els.levelTitle.textContent = "free play";
    els.cardTitle.textContent = "Sandbox";
    els.cardBody.textContent = "Play freely. Tables: sales, users, products, logs.\n\nload sales\nfilter amount > 100\nexplain\nshow";
  } else {
    const level = LEVELS[game.levelId];
    els.modePill.textContent = "LEVEL";
    els.modePill.classList.remove("on");
    els.levelTitle.textContent = level.sequence + " / " + level.title;
    els.cardTitle.textContent = level.title;
    els.cardBody.textContent = level.intro + "\n\nGoal: " + level.goalText;
  }
}

/**
 * Render goal checklist.
 *
 * @returns {void}
 */
function renderGoals() {
  els.goals.innerHTML = "";
  if (game.mode !== "level" || !game.levelId) {
    els.goals.innerHTML = '<div class="line info">Sandbox has no goals. Open a level from the left rail.</div>';
    return;
  }
  const level = LEVELS[game.levelId];
  const res = checkGoals(level, game.state);
  for (let i = 0; i < res.checks.length; i += 1) {
    const c = res.checks[i];
    const row = document.createElement("div");
    row.className = "goal" + (c.done ? " done" : "");
    row.innerHTML = '<span class="mark">' + (c.done ? "✓" : "·") + "</span><span>" +
      escapeHtml(c.label) + '<span class="detail">' + escapeHtml(c.detail) + "</span></span>";
    els.goals.appendChild(row);
  }
  const golf = document.createElement("div");
  golf.className = "goal";
  golf.innerHTML = '<span class="mark">#</span><span>command golf<span class="detail">' +
    (game.state.commandsRun || []).length + " used" +
    (level.commandsAllowed ? " / par " + level.commandsAllowed : "") + "</span></span>";
  els.goals.appendChild(golf);
}

/**
 * Escape HTML text.
 *
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Submit one command line.
 *
 * @param {string} raw
 * @returns {void}
 */
function submit(raw) {
  const line = String(raw || "").trim();
  if (!line) return;
  print("spark> " + line, "cmd");
  game.historyLines.push(line);

  if (line.toLowerCase() === "next") {
    goNextLevel();
    return;
  }
  if (line.toLowerCase() === "levels") {
    openLevelsModal();
    return;
  }
  if (line.toLowerCase() === "sandbox") {
    openSandbox();
    return;
  }

  const ctx = { level: game.levelId ? LEVELS[game.levelId] : null };
  const result = execute(game.state, line, ctx);
  game.state = result.state;

  for (let i = 0; i < result.outputs.length; i += 1) {
    const out = result.outputs[i];
    if (out.kind === "clear") {
      els.termOut.innerHTML = "";
    } else if (out.kind === "table") {
      printTable(out);
    } else if (out.kind === "plan") {
      printBlock(out.text || "", "sys");
    } else if (out.text) {
      printBlock(out.text, out.kind);
    }
  }

  render({ animate: result.kind === "action" && result.ok });
}

/**
 * Open a level (fresh state).
 *
 * @param {string} id
 * @returns {void}
 */
function openLevel(id) {
  game.mode = "level";
  game.levelId = id;
  game.state = createState();
  const level = LEVELS[id];
  els.termOut.innerHTML = "";
  print("— level: " + level.title + " —", "sys");
  printBlock(level.intro, "info");
  print("Goal: " + level.goalText, "success");
  print("Type hint if stuck. type next when solved.", "info");
  closeModal();
  render();
  els.termIn.focus();
}

/**
 * Switch to sandbox.
 *
 * @returns {void}
 */
function openSandbox() {
  game.mode = "sandbox";
  game.levelId = null;
  game.state = createState();
  els.termOut.innerHTML = "";
  print("Sandbox mode. Tables: sales, users, products, logs.", "sys");
  print("Try: load sales / filter amount > 100 / show", "info");
  closeModal();
  render();
  els.termIn.focus();
}

/**
 * Advance to the next unfinished level.
 *
 * @returns {void}
 */
function goNextLevel() {
  const list = allLevels();
  for (let i = 0; i < list.length; i += 1) {
    if (!game.done[list[i].id]) {
      openLevel(list[i].id);
      return;
    }
  }
  print("All levels solved. Sandbox is open.", "success");
  openSandbox();
}

/**
 * Modal helper.
 *
 * @param {{ title: string, body: string, primary: string, secondary?: string, onPrimary?: () => void, win?: boolean }} opts
 * @returns {void}
 */
function showModal(opts) {
  els.modalTitle.textContent = opts.title;
  els.modalBody.textContent = opts.body;
  els.modalPrimary.textContent = opts.primary;
  els.modalSecondary.textContent = opts.secondary || "Close";
  els.modalBox.classList.toggle("win", Boolean(opts.win));
  els.modal.classList.add("open");
  els.modalPrimary.onclick = function () {
    closeModal();
    if (opts.onPrimary) opts.onPrimary();
  };
  els.modalSecondary.onclick = closeModal;
}

/**
 * Close modal.
 *
 * @returns {void}
 */
function closeModal() {
  els.modal.classList.remove("open");
  els.modalBox.classList.remove("win");
}

/**
 * Win dialog with golf score.
 *
 * @param {any} level
 * @returns {void}
 */
function showWin(level) {
  const used = (game.state.commandsRun || []).length;
  const par = level.commandsAllowed || used;
  print("LEVEL SOLVED: " + level.title + "  (" + used + " commands, par " + par + ")", "success");
  showModal({
    title: "Level solved — " + level.title,
    body: level.goalText + "\n\nCommands used: " + used + "\nPar: " + par +
      (used <= par ? "\nOn par or better." : "\nOver par — try a tighter sequence."),
    primary: "Next level",
    secondary: "Stay",
    win: true,
    onPrimary: goNextLevel,
  });
}

/**
 * Levels browser modal.
 *
 * @returns {void}
 */
function openLevelsModal() {
  const list = allLevels();
  const lines = [];
  for (let i = 0; i < list.length; i += 1) {
    const lv = list[i];
    const mark = game.done[lv.id] ? "[x]" : "[ ]";
    lines.push(mark + " " + lv.id + " — " + lv.title + "  (par " + (lv.commandsAllowed || "?") + ")");
  }
  showModal({
    title: "Levels",
    body: lines.join("\n"),
    primary: "OK",
  });
}

/**
 * Boot UI bindings.
 *
 * @returns {void}
 */
function boot() {
  els.cmdHelp.textContent = [
    "load sales | users | products | logs",
    "filter <expr> | select a, b | withColumn n e",
    "sort c [desc] | limit n | groupBy k sum col",
    "join t on key | repartition n | coalesce n",
    "cache | unpersist | show | count | collect",
    "schema | columns | explain | write | sparksql ...",
    "levels | goal | hint | undo | reset | clear | next",
  ].join("\n");

  els.termIn.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter") {
      const v = els.termIn.value;
      els.termIn.value = "";
      submit(v);
    }
  });

  document.getElementById("btn-levels").addEventListener("click", openLevelsModal);
  document.getElementById("btn-sandbox").addEventListener("click", openSandbox);
  document.getElementById("btn-reset").addEventListener("click", function () {
    submit("reset");
  });

  // URL params: ?level=id&command=a;b
  const params = new URLSearchParams(window.location.search);
  if (params.get("NODEMO") !== "1" && !params.get("command")) {
    showModal({
      title: "learnSpark",
      body: [
        "Interactive Apache Spark visualization and tutorial.",
        "Modeled on LearnGitBranching: sandbox + levels + command golf.",
        "",
        "The DAG shows lazy plans and stage boundaries (shuffles).",
        "Partitions show how rows sit on executors.",
        "",
        "Start with a level, or drop into sandbox.",
      ].join("\n"),
      primary: "Start intro level",
      secondary: "Sandbox",
      onPrimary: function () { openLevel("welcome"); },
    });
    els.modalSecondary.onclick = function () {
      closeModal();
      openSandbox();
    };
  }

  const levelParam = params.get("level");
  if (levelParam && LEVELS[levelParam]) {
    openLevel(levelParam);
  } else if (params.get("NODEMO") === "1" || params.get("command")) {
    openSandbox();
  } else {
    // stay in modal until choice
    render();
  }

  const cmdParam = params.get("command");
  if (cmdParam) {
    const parts = cmdParam.split(";");
    for (let i = 0; i < parts.length; i += 1) submit(parts[i]);
  }
}

boot();
