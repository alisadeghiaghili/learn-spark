"""Wire optimizer, streaming state, and ML pipeline into commands/execute."""
from pathlib import Path

# --- execute.js: run optimizer on explain ---
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\execute.js")
t = p.read_text(encoding="utf-8")
if "optimizer.js" not in t:
    t = t.replace(
        'import { analyzeCodegen } from "./codegen.js";',
        'import { analyzeCodegen } from "./codegen.js";\nimport { optimize, formatPlan, spine as optSpine } from "./optimizer.js";',
    )
    t = t.replace(
        '''  const cg = analyzeCodegen(planSpine(df.plan), settings.udfMode);''',
        '''  const cg = analyzeCodegen(planSpine(df.plan), settings.udfMode);
  const opt = optimize(df.plan, result.columns);
  const optPlanText = formatPlan(opt.plan);
  const optTrace = opt.trace;''',
    )
    t = t.replace(
        '''    codegen: {
      segments: cg.segments.length,
      splits: cg.splits,
      cost: cg.cost,
      generated: cg.generated,
      unfusedOps: cg.unfusedOps,
    },''',
        '''    codegen: {
      segments: cg.segments.length,
      splits: cg.splits,
      cost: cg.cost,
      generated: cg.generated,
      unfusedOps: cg.unfusedOps,
    },
    optimizer: {
      trace: optTrace,
      optimized: optPlanText,
    },''',
    )
    p.write_text(t, encoding="utf-8")
    print("execute optimizer wired")
else:
    print("execute already has optimizer")

# --- commands.js: explain dumps optimizer + codegen; stream uses StreamState; ml pipeline ---
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\commands.js")
t = p.read_text(encoding="utf-8")

if "streaming.js" not in t:
    t = t.replace(
        'import { parseSelect } from "./sql.js";',
        'import { parseSelect } from "./sql.js";\nimport { StreamState, toEvents } from "./streaming.js";\nimport { Pipeline, fitLinreg, predictLinreg, trainTestSplit, regressionMetrics } from "./ml.js";',
    )

# enhance explainText to include optimizer + codegen
old_explain = t[t.find("function explainText(df, result) {"):t.find("function schemaText(result) {")]
new_explain = r'''function explainText(df, result) {
  const lines = planSpine(df.plan).map(function (n) {
    return "  " + n.label + (n.wide ? "  [WIDE/SHUFFLE]" : "");
  });
  const stages = result.stages.map(function (s, i) {
    return "  Stage " + i + ": " + s.ops.join(" -> ") + (s.wide ? "  (post-shuffle)" : "");
  });
  const mem = result.memory || {};
  const cg = result.codegen || {};
  const opt = result.optimizer || { trace: [], optimized: "" };
  const optLines = (opt.trace || []).map(function (x) {
    return "  " + x.rule + ": " + x.detail;
  });
  return "== Parsed Logical Plan ==\n" + lines.join("\n") +
    "\n\n== Optimized Logical Plan ==\n" + String(opt.optimized || "").split("\n").map(function (l) { return "  " + l; }).join("\n") +
    "\n\n== Catalyst Rules Applied ==\n" + (optLines.length ? optLines.join("\n") : "  (none)") +
    "\n\n== Physical Plan (sketch) ==\n  " + String(result.physical || "").split("\n").join("\n  ") +
    "\n\n== Whole-Stage Codegen ==\n  segments=" + (cg.segments || 0) +
    " splits=" + (cg.splits || 0) + " codegenCost=" + (cg.cost || 0) +
    (cg.unfusedOps && cg.unfusedOps.length ? "\n  unfused: " + cg.unfusedOps.join(", ") : "\n  fully fused") +
    "\n\n== Stages ==\n" + stages.join("\n") +
    "\n\n== Memory ==\n  executor=" + (mem.executorMb || "?") + "MB peakKb=" + (mem.peakKb || 0) +
    " spillKb=" + (mem.spillKb || 0) + " spillFiles=" + (mem.spillFiles || 0) +
    (mem.spilled ? " [SPILLED]" : "") +
    " cluster=" + (mem.cluster ? mem.cluster.executors + " executors x " + mem.cluster.slots + " slots" : "?") +
    "\n== Stream ==\n  lateDropped=" + (result.lateDropped || 0) +
    " watermark=" + (getSettings.watermarkLag || "off") +
    " outputMode=" + getSettings.outputMode +
    "\n== Settings ==\n  " + describeSettings();
}

'''
if old_explain:
    t = t.replace(old_explain, new_explain, 1)

# stream emit -> StreamState microBatch
t = t.replace(
    '''      if (sub === "emit" || sub === "microbatch" || sub === "trigger") {
        const df = requireDf(state);
        // treat as action-ish: materialize current plan as one micro-batch
        const result = runFrame(df);
        outputs.push({
          kind: "table",
          columns: result.columns,
          rows: result.rows.slice(0, 10),
          text: "micro-batch #" + (state.actionsRun + 1) + " -> " + result.rows.length + " rows  (same plan re-run on new data)",
        });''',
    '''      if (sub === "emit" || sub === "microbatch" || sub === "trigger") {
        const df = requireDf(state);
        const result = runFrame(df);
        // Stateful streaming over materialized rows (key=user_id|region, time=ts)
        const events = toEvents(result.rows, "user_id" in result.rows[0] ? "user_id" : "region", "ts" in result.rows[0] ? "ts" : "id", "amount" in result.rows[0] ? "amount" : "id");
        if (!state.stream) {
          state.stream = new StreamState({
            watermarkLagDays: getSettings.watermarkLag ? lagToDays(getSettings.watermarkLag) : 0,
            outputMode: getSettings.outputMode,
          });
        } else {
          state.stream.setOutputMode(getSettings.outputMode);
          if (getSettings.watermarkLag) state.stream.setWatermarkDays(lagToDays(getSettings.watermarkLag));
        }
        const sb = state.stream.microBatch(events);
        outputs.push({
          kind: "table",
          columns: ["key", "sum", "count", "epoch"],
          rows: sb.emitted.slice(0, 12),
          text:
            "micro-batch epoch=" + sb.epoch +
            " emitted=" + sb.emitted.length +
            " stateKeys=" + sb.stateKeys +
            " lateDropped=" + sb.lateDropped +
            " watermark=" + (sb.watermark || "off") +
            " outputMode=" + state.stream.outputMode,
        });''',
)

# helper lagToDays at end
if "function lagToDays" not in t:
    t = t.replace(
        "export function tokenize(line) {",
        '''/**
 * @param {string} lag
 * @returns {number}
 */
function lagToDays(lag) {
  const m = String(lag).match(/^(\\d+(?:\\.\\d+)?)([smhd])$/i);
  if (!m) return Number(lag) || 0;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === "s") return n / 86400;
  if (u === "m") return n / 1440;
  if (u === "h") return n / 24;
  return n;
}

/**
 * Tokenize a command line (supports quoted strings).''',
    )

# ml pipeline command
t = t.replace(
    '''      if (stage === "linreg" || stage === "lr") {''',
    '''      if (stage === "pipeline") {
        // ml pipeline  — fit on train split, score test, report metrics
        const df = requireDf(state);
        const result = runFrame(df);
        const rows = result.rows;
        const xCol = parts[2] || "user_id";
        const yCol = parts[3] || "amount";
        const split = trainTestSplit(rows, 0.25);
        const pipe = new Pipeline()
          .addTransformer("features", function (rs) {
            return rs.map(function (r) {
              return Object.assign({}, r, { features: Number(r[xCol]) || 0 });
            });
          })
          .addEstimator("linreg", function (rs) {
            return fitLinreg(rs, "features", yCol);
          });
        const fitted = pipe.fit(split.train);
        const scored = pipe.transform(split.test);
        const m = regressionMetrics(scored, yCol, "prediction");
        outputs.push({
          kind: "table",
          columns: ["stage"],
          rows: fitted.trace.map(function (s) { return { stage: s }; }),
          text:
            "Pipeline fit on " + split.train.length + " train / " + split.test.length + " test. " +
            "w=" + fitted.model.w.toFixed(4) + " b=" + fitted.model.b.toFixed(4) +
            " trainRMSE=" + fitted.model.rmse.toFixed(4) +
            " testRMSE=" + m.rmse.toFixed(4) + " testMAE=" + m.mae.toFixed(4),
        });
        const next = Object.assign({}, state, {
          actionsRun: state.actionsRun + 1,
          lastRun: result,
          history: state.history.concat([{ command: command, kind: "action", df: state.df }]),
          commandsRun: state.commandsRun.concat([command]),
        });
        return { ok: true, outputs: outputs, state: next, command: command, kind: "action" };
      }
      if (stage === "linreg" || stage === "lr") {''',
)

p.write_text(t, encoding="utf-8")
print("commands optimizer/stream/ml wired", p.stat().st_size)
