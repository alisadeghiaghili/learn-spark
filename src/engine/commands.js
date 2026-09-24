/**
 * Command parser and executor for the learnSpark REPL.
 */

import {
  cacheFrame,
  coalesce,
  createSource,
  distinct,
  drop,
  explode,
  filter,
  groupBy,
  join,
  limit,
  planSpine,
  repartition,
  sample,
  select,
  sort,
  approxCountDistinct,
  cubeRollup,
  getField,
  groupByMulti,
  injectFailure,
  mapExplode,
  mlLinreg,
  mlOp,
  mlPredictLinreg,
  salt,
  streamOp,
  udf,
  unpersistFrame,
  windowFn,
  withColumn,
} from "./plan.js";
import { applySetting, describeSettings, resetSettings, settings as getSettings } from "./settings.js";
import { parseSelect } from "./sql.js";
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
  "  join <table> on <key> [inner|left|right|full] [broadcast|sort-merge]",
  "  window <fn> [col] over <partCol> <orderBy> [desc]",
  "  explode <col> | drop <col> | distinct | sample <frac>",
  "  udf <upper|double|tax|prefix> <col>",
  "  salt <col> [n] | cube|rollup <keys> <fn> [col] | approx <col>",
  "  get <col> <field> | mapExplode <col>",
  "  ml vectorize <a,b> | ml fit <target> | ml linreg <x> <y> | ml predict",
  "  stream emit | stream watermark <n> | injectFail | set [k v]",
  "  cache [LEVEL] | persist [LEVEL] | window ... frame last4|entire|current",
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
      const raw = parts.slice(1).join(" ").trim();
      if (!raw) throw new Error("usage: groupBy <keys> <sum|count|avg|min|max> [col]");
      const aggFns = ["sum", "count", "avg", "min", "max"];
      const parsed = parseGroupBy(raw, aggFns);
      const nextDf = parsed.aggs.length > 1
        ? groupByMulti(df, parsed.keys, parsed.aggs)
        : groupBy(df, parsed.keys, parsed.aggs[0].fn, parsed.aggs[0].col);
      const wideLabel = parsed.aggs.length > 1 ? "  (wide / multi-agg)" : "  (wide / shuffle)";
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + wideLabel });
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
      if (!on) throw new Error("usage: join <table> on <key> [inner|left|right|full] [broadcast|sort-merge]");
      const extra = parts.slice((onIdx >= 0 ? onIdx + 2 : 3));
      let joinType = "inner";
      let strategy = "auto";
      for (let i = 0; i < extra.length; i += 1) {
        const t = extra[i].toLowerCase();
        if (t === "inner" || t === "left" || t === "right" || t === "full") joinType = t;
        if (t === "broadcast" || t === "sort-merge" || t === "sortmerge") {
          strategy = t === "sortmerge" ? "sort-merge" : t;
        }
      }
      const nextDf = join(df, table, on, joinType, strategy);
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
    if (head === "cache" || head === "persist") {
      const df = requireDf(state);
      const level = parts[1] ? String(parts[1]).toUpperCase().replace(/-/g, "_") : null;
      if (level) applySetting("storage.level", level);
      const nextDf = cacheFrame(df, level || undefined);
      outputs.push({
        kind: "success",
        text: "Cached with " + (nextDf.storageLevel || "MEMORY_AND_DISK") + ". First action fills; later actions reuse.",
      });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "unpersist") {
      const df = requireDf(state);
      const nextDf = unpersistFrame(df);
      outputs.push({ kind: "success", text: "Unpersisted cache flag." });
      return commit(state, command, "transform", nextDf, outputs);
    }

    if (head === "drop") {
      const df = requireDf(state);
      const col = requireArg(parts, 1, "usage: drop <col>");
      const nextDf = drop(df, col);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "distinct") {
      const df = requireDf(state);
      const nextDf = distinct(df);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (wide / shuffle)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "sample") {
      const df = requireDf(state);
      const frac = Number(parts[1] || "0.5");
      const nextDf = sample(df, frac);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "explode") {
      const df = requireDf(state);
      const col = requireArg(parts, 1, "usage: explode <col>");
      const nextDf = explode(df, col);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy, nested -> rows)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "udf") {
      const df = requireDf(state);
      const name = requireArg(parts, 1, "usage: udf <upper|double|tax|prefix> <col>");
      const col = requireArg(parts, 2, "usage: udf <upper|double|tax|prefix> <col>");
      const nextDf = udf(df, name, col);
      outputs.push({
        kind: "success",
        text: "+ " + planTip(nextDf) + "  (lazy UDF — black box to Catalyst)",
      });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "window") {
      const df = requireDf(state);
      // window <fn> [col] over <partCol> <orderBy> [desc]
      const rest = parts.slice(1);
      const overIdx = rest.findIndex(function (p) { return p.toLowerCase() === "over"; });
      if (overIdx < 1) throw new Error("usage: window <fn> [col] over <partCol> <orderBy> [desc]");
      const left = rest.slice(0, overIdx);
      const right = rest.slice(overIdx + 1);
      const fn = left[0];
      const col = left.length > 1 ? left[1] : null;
      if (right.length < 2) throw new Error("usage: window <fn> [col] over <partCol> <orderBy> [desc]");
      const partCol = right[0];
      const orderBy = right[1];
      const desc = (right[2] || "").toLowerCase() === "desc";
      let frame = null;
      // optional: rows between ... — accept shorthand after orderBy: last4|entire|current|rows-unbounded-current
      const maybeFrame = right[3] || right[2];
      if (maybeFrame && /^(rows-|range-|last4|entire|current|unbounded)/i.test(maybeFrame) &&
          maybeFrame.toLowerCase() !== "desc") {
        frame = maybeFrame;
        applySetting("window.frame", frame);
      }
      const nextDf = windowFn(df, fn, col, [partCol], orderBy, desc, frame || undefined);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (narrow window)" });
      return commit(state, command, "transform", nextDf, outputs);
    }

    if (head === "set") {
      if (parts.length === 1) {
        outputs.push({ kind: "info", text: describeSettings() });
        return done(state, command, "meta", outputs);
      }
      const msg = applySetting(parts[1], parts.slice(2).join(" "));
      outputs.push({ kind: "success", text: msg });
      return done(state, command, "meta", outputs);
    }
    if (head === "resetsettings" || head === "unset") {
      resetSettings();
      outputs.push({ kind: "success", text: "Settings reset to defaults." });
      return done(state, command, "meta", outputs);
    }
    if (head === "salt") {
      const df = requireDf(state);
      const col = requireArg(parts, 1, "usage: salt <col> [n]");
      const n = Number(parts[2] || "4");
      const nextDf = salt(df, col, n);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (wide desekew)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "cube" || head === "rollup") {
      const df = requireDf(state);
      const rest = parts.slice(1);
      const aggFns = ["sum", "count", "avg", "min", "max"];
      let fn = "count";
      let col = null;
      let keys = rest;
      if (rest.length >= 3 && aggFns.indexOf(rest[rest.length - 2].toLowerCase()) !== -1) {
        fn = rest[rest.length - 2].toLowerCase();
        col = rest[rest.length - 1] === "*" ? null : rest[rest.length - 1];
        keys = rest.slice(0, -2);
      } else if (rest.length >= 2 && aggFns.indexOf(rest[rest.length - 1].toLowerCase()) !== -1) {
        fn = rest[rest.length - 1].toLowerCase();
        keys = rest.slice(0, -1);
      }
      const keyCols = keys.join(" ").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      const nextDf = cubeRollup(df, keyCols, head, fn, col);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (wide / Expand)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "approx" || head === "approx_count_distinct") {
      const df = requireDf(state);
      const col = requireArg(parts, 1, "usage: approx <col>");
      const nextDf = approxCountDistinct(df, col);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (wide / HLL)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "get") {
      const df = requireDf(state);
      const col = requireArg(parts, 1, "usage: get <col> <field>");
      const field = requireArg(parts, 2, "usage: get <col> <field>");
      const nextDf = getField(df, col, field);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy nested access)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "mapexplode") {
      const df = requireDf(state);
      const col = requireArg(parts, 1, "usage: mapExplode <col>");
      const nextDf = mapExplode(df, col);
      outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (lazy map -> rows)" });
      return commit(state, command, "transform", nextDf, outputs);
    }
    if (head === "ml") {
      const df = requireDf(state);
      const stage = requireArg(parts, 1, "usage: ml vectorize <a,b> | ml fit <target> | ml predict");
      if (stage === "vectorize") {
        const cols = (parts[2] || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        const nextDf = mlOp(df, "vectorize", { cols: cols });
        outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (feature transformer)" });
        return commit(state, command, "transform", nextDf, outputs);
      }
      if (stage === "fit") {
        const target = requireArg(parts, 2, "usage: ml fit <target>");
        const nextDf = mlOp(df, "fit", { target: target });
        outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (estimator.fit -> model)" });
        return commit(state, command, "transform", nextDf, outputs);
      }
      if (stage === "linreg" || stage === "lr") {
        // ml linreg <feature> <target>
        const featureCol = requireArg(parts, 2, "usage: ml linreg <feature> <target>");
        const targetCol = requireArg(parts, 3, "usage: ml linreg <feature> <target>");
        const nextDf = mlLinreg(df, featureCol, targetCol);
        outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (Estimator.fit OLS)" });
        return commit(state, command, "transform", nextDf, outputs);
      }
      if (stage === "predict") {
        // ml predict <feature> <w> <b>   OR generic
        if (parts.length >= 5) {
          const nextDf = mlPredictLinreg(df, parts[2], Number(parts[3]), Number(parts[4]));
          outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (Model.transform)" });
          return commit(state, command, "transform", nextDf, outputs);
        }
        const nextDf = mlOp(df, "predict", { intercept: 1 });
        outputs.push({ kind: "success", text: "+ " + planTip(nextDf) + "  (model.transform)" });
        return commit(state, command, "transform", nextDf, outputs);
      }
      throw new Error("usage: ml vectorize <a,b> | ml fit <target> | ml linreg <feat> <y> | ml predict ...");
    }
    if (head === "stream") {
      const sub = requireArg(parts, 1, "usage: stream emit | stream watermark <n>");
      if (sub === "emit" || sub === "microbatch" || sub === "trigger") {
        const df = requireDf(state);
        // treat as action-ish: materialize current plan as one micro-batch
        const result = runFrame(df);
        outputs.push({
          kind: "table",
          columns: result.columns,
          rows: result.rows.slice(0, 10),
          text: "micro-batch #" + (state.actionsRun + 1) + " -> " + result.rows.length + " rows  (same plan re-run on new data)",
        });
        const next = Object.assign({}, state, {
          actionsRun: state.actionsRun + 1,
          transformsPending: 0,
          lastRun: result,
          history: state.history.concat([{ command: command, kind: "action", df: state.df }]),
          commandsRun: state.commandsRun.concat([command]),
        });
        return { ok: true, outputs: outputs, state: next, command: command, kind: "action" };
      }
      if (sub === "watermark") {
        const df = requireDf(state);
        const lag = requireArg(parts, 2, "usage: stream watermark <n>   e.g. stream watermark 10m");
        const nodeDf = streamOp(df, "watermark", { lag: lag });
        applySetting("outputmode", "append");
        // persist lag on settings
        const st = getSettings;
        st.watermarkLag = lag;
        outputs.push({
          kind: "success",
          text: "watermark(eventTime, " + lag + ") — late rows (ts < max-lag) drop on materialize. outputMode=" + st.outputMode,
        });
        return commit(state, command, "transform", nodeDf, outputs);
      }
      throw new Error("usage: stream emit | stream watermark <n>");
    }
    if (head === "injectfail" || head === "fail") {
      const df = requireDf(state);
      const nextDf = injectFailure(df, Number(parts[1] || "0"));
      outputs.push({
        kind: "success",
        text: "Injected task failure. speculate=" + "see `set speculate on` — retries modeled on next action.",
      });
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
  const ast = parseSelect(sql);
  let frame = createSource(ast.table);
  if (ast.where) frame = filter(frame, ast.where);
  if (ast.groupBy && ast.groupBy.length) {
    const first = ast.aggs[0] || { fn: "count", col: null };
    frame = groupBy(frame, ast.groupBy, first.fn, first.col);
    return frame;
  }
  if (ast.orderBy) frame = sort(frame, ast.orderBy.col, ast.orderBy.desc);
  if (ast.star || !ast.cols.length) return frame;
  const projected = ast.cols.filter(function (c) { return c.indexOf("(") === -1; });
  return projected.length ? select(frame, projected) : frame;
}

function explainText(df, result) {
  const lines = planSpine(df.plan).map(function (n) {
    return "  " + n.label + (n.wide ? "  [WIDE/SHUFFLE]" : "");
  });
  const stages = result.stages.map(function (s, i) {
    return "  Stage " + i + ": " + s.ops.join(" -> ") + (s.wide ? "  (post-shuffle)" : "");
  });
  const mem = result.memory || {};
  return "== Parsed Logical Plan ==\n" + lines.join("\n") +
    "\n\n== Physical Plan (sketch) ==\n  " + String(result.physical || "").split("\n").join("\n  ") +
    "\n\n== Stages ==\n" + stages.join("\n") +
    "\n\n== Memory ==\n  executor=" + (mem.executorMb || "?") + "MB peakKb=" + (mem.peakKb || 0) +
    " spillKb=" + (mem.spillKb || 0) + (mem.spilled ? " [SPILLED]" : "") +
    " cluster=" + (mem.cluster ? mem.cluster.executors + " executors x " + mem.cluster.slots + " slots" : "?") +
    "\n== Stream ==\n  lateDropped=" + (result.lateDropped || 0) + " watermark=" + (getSettings.watermarkLag || "off") + " outputMode=" + getSettings.outputMode +
    "\n== Settings ==\n  " + describeSettings() +
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
 * Parse groupBy arguments into keys + one or more aggregations.
 *
 * @param {string} raw
 * @param {string[]} aggFns
 * @returns {{ keys: string[], aggs: Array<{ fn: string, col: string|null }> }}
 */
function parseGroupBy(raw, aggFns) {
  // Normalize commas used as agg separators: "sum amount, count *"
  const chunks = raw.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  if (chunks.length > 1 && chunks.some(function (c) {
    const t0 = c.split(/\s+/)[0].toLowerCase();
    return aggFns.indexOf(t0) !== -1;
  })) {
    // first chunk: "<keys...> <fn> <col>"
    const first = chunks[0].split(/\s+/);
    let cut = -1;
    for (let i = 0; i < first.length; i += 1) {
      if (aggFns.indexOf(first[i].toLowerCase()) !== -1) {
        cut = i;
        break;
      }
    }
    if (cut < 1) throw new Error("usage: groupBy <keys> <sum|count|avg|min|max> [col]");
    const keys = first.slice(0, cut);
    const aggs = [];
    const fn0 = first[cut].toLowerCase();
    const col0toks = first.slice(cut + 1);
    aggs.push({
      fn: fn0,
      col: !col0toks.length || col0toks[0] === "*" ? null : col0toks.join(" ").replace(/,$/, ""),
    });
    for (let i = 1; i < chunks.length; i += 1) {
      const toks = chunks[i].split(/\s+/);
      const fn = (toks[0] || "").toLowerCase();
      if (aggFns.indexOf(fn) === -1) continue;
      const colTok = toks.slice(1).join(" ");
      aggs.push({ fn: fn, col: !colTok || colTok === "*" ? null : colTok });
    }
    return { keys: keys, aggs: aggs };
  }

  const toks = raw.split(/\s+/);
  let cut = -1;
  for (let i = 0; i < toks.length; i += 1) {
    if (aggFns.indexOf(toks[i].toLowerCase()) !== -1) {
      cut = i;
      break;
    }
  }
  if (cut < 1) throw new Error("usage: groupBy <keys> <sum|count|avg|min|max> [col]");
  const keys = toks.slice(0, cut).join(" ").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  const fn = toks[cut].toLowerCase();
  const colTok = toks.slice(cut + 1).join(" ").replace(/,$/, "");
  return {
    keys: keys,
    aggs: [{ fn: fn, col: !colTok || colTok === "*" ? null : colTok }],
  };
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
