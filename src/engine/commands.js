/**
 * Command parser and executor for the learnSpark REPL.
 */

import {
  cacheFrame,
  coalesce,
  createSource,
  filter,
  groupBy,
  join,
  limit,
  planSpine,
  repartition,
  select,
  sort,
  unpersistFrame,
  withColumn,
} from "./plan.js";
import { materialize, run as runFrame } from "./execute.js";
import { listDatasets } from "./datasets.js";

export { materialize, runFrame as run };

const HELP_TEXT = [
  "learnSpark commands",
  "  load <table>                 source table (" + listDatasets().join(", ") + ")",
  "  filter <expr>                lazy narrow transform (amount > 100)",
  "  select <col, col>            project columns",
  "  withColumn <name> <expr>     add/replace column",
  "  sort <col> [desc]            lazy sort",
  "  limit <n>                    lazy limit",
  "  groupBy <keys> <fn> [col]    wide aggregate (sum|count|avg|min|max)",
  "  join <table> on <key>        wide join",
  "  repartition <n> | coalesce <n>",
  "  cache | unpersist",
  "  show | count | schema | columns | explain | collect | write",
  "  sparksql <select ...>",
  "  levels | goal | hint | undo | reset | clear | help",
].join("\n");

/**
 * Create a fresh session state.
 *
 * @returns {object}
 */
export function createState() {
  return {
    df: null,
    history: [],
    actionsRun: 0,
    transformsPending: 0,
    lastRun: null,
    hintIndex: 0,
    commandsRun: [],
  };
}

/**
 * Count transform ops in the current plan.
 *
 * @param {any} df
 * @returns {number}
 */
function countPending(df) {
  if (!df) return 0;
  return planSpine(df.plan).filter(function (n) { return n.op !== "source"; }).length;
}

/**
 * Execute one REPL line against session state.
 *
 * @param {object} state
 * @param {string} line
 * @param {{ level?: any }} [ctx]
 * @returns {object}
 */
export function execute(state, line, ctx = {}) {
  const command = String(line || "").trim();
  if (!command || command.startsWith("#")) {
    return { ok: true, outputs: [], state: state, command: command, kind: "meta" };
  }

  const parts = tokenize(command);
  const head = parts[0].toLowerCase();
  const outputs = [];
  let kind = "meta";

  try {
    if (head === "help") {
      outputs.push({ kind: "info", text: HELP_TEXT });
      return done(state, command, kind, outputs);
    }
    if (head === "clear") {
      return { ok: true, outputs: [{ kind: "clear" }], state: state, command: command, kind: "meta" };
    }
    if (head === "levels") {
      outputs.push({ kind: "info", text: "Use the left rail to pick a level, or type next." });
      return done(state, command, kind, outputs);
    }
    if (head === "goal") {
      const text = ctx.level ? describeGoals(ctx.level) : "Sandbox: explore freely. Try load sales then show.";
      outputs.push({ kind: "info", text: text });
      return done(state, command, kind, outputs);
    }
    if (head === "hint") {
      const hints = (ctx.level && ctx.level.hints) || [];
      const idx = Math.min(state.hintIndex, Math.max(0, hints.length - 1));
      if (!hints.length) {
        outputs.push({ kind: "info", text: "No hints in sandbox. Open a level." });
      } else {
        outputs.push({ kind: "info", text: "Hint " + (idx + 1) + "/" + hints.length + ": " + hints[idx] });
      }
      const next = Object.assign({}, state, { hintIndex: state.hintIndex + 1 });
      return { ok: true, outputs: outputs, state: next, command: command, kind: "meta" };
    }
    if (head === "undo") {
      const hist = state.history.slice(0, -1);
      const prev = hist[hist.length - 1];
      const next = Object.assign({}, state, {
        history: hist,
        df: prev ? prev.df : null,
        transformsPending: countPending(prev ? prev.df : null),
        commandsRun: state.commandsRun.slice(0, -1),
      });
      outputs.push({ kind: "success", text: "Undid last command." });
      return { ok: true, outputs: outputs, state: next, command: command, kind: "meta" };
    }
    if (head === "reset") {
      const next = createState();
      outputs.push({ kind: "success", text: "Session reset. load sales to begin." });
      return { ok: true, outputs: outputs, state: next, command: command, kind: "meta" };
    }

    // --- lazy transforms ---
    if (head === "load") {
      const table = requireArg(parts, 1, "usage: load <table>");
      const df = createSource(table);
      outputs.push({
        kind: "success",
        text: "Loaded table '" + df.name + "' (" + df.columns.length + " cols). Lazy — run show.",
      });
      return commit(state, command, "transform", df, outputs);
    }
    if (head === "filter") {
      const df = requireDf(state);
      const expr = parts.slice(1).join(" ");
      if (!expr) throw new Error("usage: filter <expr>   e.g. filter amount > 100");
      const nextDf = filter(df, expr);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "select") {
      const df = requireDf(state);
      const cols = parts.slice(1).join(" ").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!cols.length) throw new Error("usage: select <col, col>");
      const nextDf = select(df, cols);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "withcolumn") {
      const df = requireDf(state);
      if (parts.length < 3) throw new Error("usage: withColumn <name> <expr>");
      const name = parts[1];
      const expr = parts.slice(2).join(" ");
      const nextDf = withColumn(df, name, expr);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "sort") {
      const df = requireDf(state);
      const col = requireArg(parts, 1, "usage: sort <col> [desc]");
      const desc = (parts[2] || "").toLowerCase() === "desc";
      const nextDf = sort(df, col, desc);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "limit") {
      const df = requireDf(state);
      const n = Number(parts[1]);
      if (!Number.isFinite(n)) throw new Error("usage: limit <n>");
      const nextDf = limit(df, n);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "groupby") {
      const df = requireDf(state);
      const rest = parts.slice(1);
      if (rest.length < 2) throw new Error("usage: groupBy <keys> <sum|count|avg|min|max> [col]");
      const aggFns = ["sum", "count", "avg", "min", "max"];
      let fn = "";
      let col = null;
      let keys = rest;
      const maybeFn = rest[rest.length - 1].toLowerCase();
      if (aggFns.indexOf(maybeFn) !== -1) {
        fn = maybeFn;
        keys = rest.slice(0, -1);
      } else if (rest.length >= 3) {
        fn = rest[rest.length - 2].toLowerCase();
        col = rest[rest.length - 1];
        keys = rest.slice(0, -2);
        if (aggFns.indexOf(fn) === -1) throw new Error("unknown aggregate '" + fn + "'");
      } else {
        throw new Error("usage: groupBy <keys> <sum|count|avg|min|max> [col]");
      }
      const keyCols = keys.join(" ").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!keyCols.length) throw new Error("groupBy needs at least one key");
      const nextDf = groupBy(df, keyCols, fn, col);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (wide / shuffle)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "join") {
      const df = requireDf(state);
      const table = requireArg(parts, 1, "usage: join <table> on <key>");
      let onIdx = -1;
      for (let i = 0; i < parts.length; i += 1) {
        if (parts[i].toLowerCase() === "on") onIdx = i;
      }
      const on = onIdx >= 0 ? parts[onIdx + 1] : parts[2];
      if (!on) throw new Error("usage: join <table> on <key>");
      const nextDf = join(df, table, on);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (wide / shuffle)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "repartition") {
      const df = requireDf(state);
      const n = Number(parts[1]);
      if (!Number.isFinite(n) || n < 1) throw new Error("usage: repartition <n>");
      const nextDf = repartition(df, n);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (wide)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "coalesce") {
      const df = requireDf(state);
      const n = Number(parts[1]);
      if (!Number.isFinite(n) || n < 1) throw new Error("usage: coalesce <n>");
      const nextDf = coalesce(df, n);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (partition meta)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "cache") {
      const df = requireDf(state);
      const nextDf = cacheFrame(df);
      outputs.push({ kind: "success", text: "Marked DataFrame as cached. Next actions reuse this result." });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "unpersist") {
      const df = requireDf(state);
      const nextDf = unpersistFrame(df);
      outputs.push({ kind: "success", text: "Unpersisted cache flag." });
      return commit(state, command, "transform", nextDf, outputs);
    }

    // --- actions ---
    if (head === "show" || head === "count" || head === "collect" || head === "schema" ||
        head === "columns" || head === "explain" || head === "write" || head === "sparksql") {
      if (head === "sparksql") {
        const sql = parts.slice(1).join(" ");
        const mapped = sqlToOps(sql);
        const sqlResult = runFrame(mapped);
        outputs.push({
          kind: "table",
          columns: sqlResult.columns,
          rows: sqlResult.rows.slice(0, 20),
          text: "sparksql -> " + sqlResult.rows.length + " rows  cost=" + sqlResult.computeCost,
        });
        const nextSql = Object.assign({}, state, {
          df: mapped,
          actionsRun: state.actionsRun + 1,
          transformsPending: 0,
          lastRun: sqlResult,
          history: state.history.concat([{ command: command, kind: "action", df: state.df }]),
          commandsRun: state.commandsRun.concat([command]),
        });
        return { ok: true, outputs: outputs, state: nextSql, command: command, kind: "action" };
      }

      const df = requireDf(state);
      const result = runFrame(df);
      if (head === "explain") {
        outputs.push({ kind: "plan", plan: planSpine(df.plan), text: explainText(df, result) });
      } else if (head === "schema") {
        outputs.push({ kind: "info", text: schemaText(result) });
      } else if (head === "columns") {
        outputs.push({ kind: "info", text: result.columns.join(", ") });
      } else if (head === "count") {
        outputs.push({ kind: "info", text: String(result.rows.length) });
      } else if (head === "collect" || head === "write") {
        outputs.push({
          kind: "table",
          columns: result.columns,
          rows: result.rows.slice(0, 20),
          text: (head === "write"
            ? "Wrote " + result.rows.length + " rows (simulated)."
            : "Collected " + result.rows.length + " rows.") +
            " cost=" + result.computeCost + (result.fromCache ? " [from cache]" : ""),
        });
      } else {
        outputs.push({
          kind: "table",
          columns: result.columns,
          rows: result.rows.slice(0, 10),
          text: "show -> " + result.rows.length + " rows (top 10). cost=" + result.computeCost +
            (result.fromCache ? " [from cache]" : ""),
        });
      }

      const next = Object.assign({}, state, {
        actionsRun: state.actionsRun + 1,
        transformsPending: 0,
        lastRun: result,
        history: state.history.concat([{ command: command, kind: "action", df: state.df }]),
        commandsRun: state.commandsRun.concat([command]),
      });
      return { ok: true, outputs: outputs, state: next, command: command, kind: "action" };
    }

    throw new Error("unknown command '" + head + "'. type help");
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    return {
      ok: false,
      outputs: [{ kind: "error", text: message }],
      state: state,
      command: command,
      kind: "error",
    };
  }
}

/**
 * Finish a meta command without state change (except history of command golf).
 *
 * @param {object} state
 * @param {string} command
 * @param {string} kind
 * @param {Array} outputs
 * @returns {object}
 */
function done(state, command, kind, outputs) {
  return {
    ok: true,
    outputs: outputs,
    state: Object.assign({}, state, { commandsRun: state.commandsRun.concat([command]) }),
    command: command,
    kind: kind,
  };
}

/**
 * Minimal SQL subset mapped onto plan builders.
 *
 * @param {string} sql
 * @returns {any}
 */
function sqlToOps(sql) {
  const s = sql.trim().replace(/;$/, "");
  const re = /^select\s+(.+?)\s+from\s+([a-zA-Z0-9_]+)(?:\s+where\s+(.+?))?(?:\s+group\s+by\s+(.+?))?(?:\s+order\s+by\s+(.+))?$/i;
  const m = s.match(re);
  if (!m) {
    throw new Error("sparksql supports: SELECT cols FROM table [WHERE expr] [GROUP BY cols] [ORDER BY col]");
  }
  const cols = m[1].split(",").map(function (x) { return x.trim(); });
  const table = m[2];
  let frame = createSource(table);
  if (m[3]) frame = filter(frame, m[3]);
  if (m[4]) {
    const keys = m[4].split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    let aggCol = null;
    for (let i = 0; i < cols.length; i += 1) {
      if (cols[i].indexOf("(") !== -1) aggCol = cols[i];
    }
    if (aggCol) {
      const am = aggCol.match(/(sum|count|avg|min|max)\((.+)\)/i);
      if (am) frame = groupBy(frame, keys, am[1].toLowerCase(), am[2] === "*" ? null : am[2]);
      else frame = groupBy(frame, keys, "count", null);
    } else {
      frame = groupBy(frame, keys, "count", null);
    }
    return frame;
  }
  if (cols.length === 1 && cols[0] === "*") return frame;
  const projected = [];
  for (let i = 0; i < cols.length; i += 1) {
    const c = cols[i];
    if (c.indexOf("(") === -1) projected.push(c);
  }
  return select(frame, projected);
}

/**
 * Pretty explain text.
 *
 * @param {any} df
 * @param {any} result
 * @returns {string}
 */
function explainText(df, result) {
  const lines = planSpine(df.plan).map(function (n) {
    return "  " + n.label + (n.wide ? "  [WIDE/SHUFFLE]" : "");
  });
  const stages = result.stages.map(function (s, i) {
    return "  Stage " + i + ": " + s.ops.join(" -> ") + (s.wide ? "  (post-shuffle)" : "");
  });
  return "== Parsed Logical Plan ==\n" + lines.join("\n") +
    "\n\n== Stages ==\n" + stages.join("\n") +
    "\n\nrows=" + result.rows.length + " partitions=" + result.partitions + " cost=" + result.computeCost;
}

/**
 * Schema text for current result.
 *
 * @param {any} result
 * @returns {string}
 */
function schemaText(result) {
  const cols = result.columns.map(function (c) { return " |-- " + c + ": string"; });
  return "root\n" + cols.join("\n") + "\n-- " + result.rows.length + " rows";
}

/**
 * Human goal description helper for goal command.
 *
 * @param {any} level
 * @returns {string}
 */
function describeGoals(level) {
  if (level.goalText) return level.goalText;
  if (level.goals && level.goals.length) {
    return level.goals.map(function (g, i) {
      return (i + 1) + ". " + (g.label || String(g));
    }).join("\n");
  }
  return "Complete the level goals shown in the right panel.";
}

/**
 * Tip of plan label.
 *
 * @param {any} df
 * @returns {string}
 */
function planTip(df) {
  const spine = planSpine(df.plan);
  return spine[spine.length - 1].label;
}

/**
 * Require a DataFrame.
 *
 * @param {object} state
 * @returns {any}
 */
function requireDf(state) {
  if (!state.df) throw new Error("no DataFrame. run load sales first");
  return state.df;
}

/**
 * Require positional argument.
 *
 * @param {string[]} parts
 * @param {number} idx
 * @param {string} usage
 * @returns {string}
 */
function requireArg(parts, idx, usage) {
  if (!parts[idx]) throw new Error(usage);
  return parts[idx];
}

/**
 * Commit a new DataFrame state with history.
 *
 * @param {object} state
 * @param {string} command
 * @param {string} kind
 * @param {any} df
 * @param {Array} outputs
 * @returns {object}
 */
function commit(state, command, kind, df, outputs) {
  const next = {
    df: df,
    history: state.history.concat([{ command: command, kind: kind, df: df }]),
    actionsRun: state.actionsRun,
    transformsPending: countPending(df),
    lastRun: state.lastRun,
    hintIndex: state.hintIndex,
    commandsRun: state.commandsRun.concat([command]),
  };
  return { ok: true, outputs: outputs, state: next, command: command, kind: kind };
}

/**
 * Tokenize a command line (supports quoted strings).
 *
 * @param {string} line
 * @returns {string[]}
 */
export function tokenize(line) {
  const out = [];
  let buf = "";
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}
