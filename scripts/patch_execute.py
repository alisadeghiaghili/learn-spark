"""Apply honest-engine patches to execute.js."""
from pathlib import Path

p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\execute.js")
t = p.read_text(encoding="utf-8")

t = t.replace(
    '''import { getDataset } from "./datasets.js";
import { evalExpr, compareValues } from "./expr.js";
import { planSpine, rowsBytes } from "./plan.js";
import { settings, clusterShape } from "./settings.js";''',
    '''import { getDataset } from "./datasets.js";
import { evalExpr, compareValues } from "./expr.js";
import { planSpine } from "./plan.js";
import { settings, clusterShape } from "./settings.js";
import { budgetBytes, hashAggWithSpill, measure, rowBytes, sortWithSpill } from "./memory.js";
import { joinWith } from "./joins.js";
import { place } from "./partitions.js";
import { analyzeCodegen } from "./codegen.js";''',
)

t = t.replace(
    '''  if (node.op === "join") {
    return joinRows(rows, node.args.rightRows, String(node.args.on), String(node.args.joinType || "inner"));
  }
  return rows;
}''',
    '''  if (node.op === "join") {
    return rows;
  }
  return rows;
}''',
)

t = t.replace(
    '''    rows = applyOp(node, rows);
    if (node.op === "repartition" || node.op === "coalesce") {
      partitions = Number(node.args.n) || partitions;
    }
    if (node.op === "join" && node.args.strategy === "broadcast") {
      partitions = Math.max(partitions, 1);
    }
    stages[stages.length - 1].ops.push(node.label);''',
    '''    if (node.op === "join") {
      let strategy = node.args.strategy || "auto";
      const rightRows = node.args.rightRows || [];
      let rightBytes = 0;
      for (let ri = 0; ri < rightRows.length; ri += 1) rightBytes += rowBytes(rightRows[ri]);
      const rightMb = rightBytes / (1024 * 1024);
      if (strategy === "auto") {
        strategy = settings.autoBroadcast && rightMb <= settings.broadcastThresholdMb
          ? "broadcast"
          : "sort-merge";
        if (settings.aqe && strategy === "sort-merge" && rightMb * 4 <= settings.broadcastThresholdMb) {
          strategy = "broadcast";
        }
      }
      const j = joinWith(
        rows,
        rightRows,
        String(node.args.on),
        String(node.args.joinType || "inner"),
        strategy,
        settings.shufflePartitions,
        settings.executorMb
      );
      rows = j.rows;
      joinStats = j;
      spillFiles += j.spillFiles;
      spilledBytes += j.spilledBytes;
      if (j.spillFiles) spilled = true;
    } else {
      rows = applyOp(node, rows);
    }
    if (node.op === "repartition" || node.op === "coalesce") {
      partitions = Number(node.args.n) || partitions;
    }
    if (node.op === "repartition") {
      const placed = place(rows, partitions, null);
      rows = [];
      for (let bi = 0; bi < placed.buckets.length; bi += 1) {
        for (let ri = 0; ri < placed.buckets[bi].length; ri += 1) rows.push(placed.buckets[bi][ri]);
      }
      distribution = placed.distribution;
      skewRatio = placed.skewRatio;
    }
    if (node.op === "salt") {
      const placed = place(rows, partitions, String(node.args.col) + "_salt");
      rows = [];
      for (let bi = 0; bi < placed.buckets.length; bi += 1) {
        for (let ri = 0; ri < placed.buckets[bi].length; ri += 1) rows.push(placed.buckets[bi][ri]);
      }
      distribution = placed.distribution;
      skewRatio = placed.skewRatio;
    }
    stages[stages.length - 1].ops.push(node.label);''',
)

t = t.replace(
    "  let spilled = false;\n  let cacheHits = 0;\n  let lateDropped = 0;",
    "  let spilled = false;\n  let cacheHits = 0;\n  let lateDropped = 0;\n  let spillFiles = 0;\n  let spilledBytes = 0;\n  let joinStats = null;\n  let distribution = [];\n  let skewRatio = 1;\n  let groupSpillFiles = 0;\n  let groupSpilledBytes = 0;",
)

t = t.replace(
    '''  if (node.op === "sort") {
    const col = String(node.args.col);
    const desc = Boolean(node.args.desc);
    const sorted = rows.slice().sort(function (a, b) { return compareValues(a[col], b[col]); });
    return desc ? sorted.reverse() : sorted;
  }''',
    '''  if (node.op === "sort") {
    const col = String(node.args.col);
    const desc = Boolean(node.args.desc);
    const cmp = function (a, b) {
      const c = compareValues(a[col], b[col]);
      return desc ? -c : c;
    };
    const sr = sortWithSpill(rows, cmp, budgetBytes(settings.executorMb));
    return sr.rows;
  }''',
)

t = t.replace(
    '''function aggregate(rows, args) {
  const keys = args.keys;
  const aggs = args.multi && args.aggs
    ? args.aggs
    : [{ fn: String(args.fn), col: args.col && args.col !== "*" ? String(args.col) : null }];
  const groups = new Map();''',
    '''function aggregate(rows, args) {
  const keys = args.keys;
  const aggs = args.multi && args.aggs
    ? args.aggs
    : [{ fn: String(args.fn), col: args.col && args.col !== "*" ? String(args.col) : null }];
  const packed = hashAggWithSpill(
    rows,
    function (r) { return keys.map(function (k) { return String(r[k]); }).join("|"); },
    budgetBytes(settings.executorMb) / 2
  );
  groupSpillFiles += packed.spillFiles;
  groupSpilledBytes += packed.spilledBytes;
  if (packed.spillFiles) spilled = true;
  const groups = packed.groups;''',
)

t = t.replace(
    '''  const memBudget = settings.executorMb * 1024 * 1024;
  const spilledBytes = spilled ? Math.max(1, Math.floor(peakBytes * 0.15)) : 0;
  const memory = {
    executorMb: settings.executorMb,
    peakMb: Math.round(peakBytes / (1024 * 1024) * 100) / 100 / 100,
    peakKb: Math.round(peakBytes / 1024),
    budgetKb: Math.round(memBudget / 1024),
    spillMb: Math.round(spilledBytes / (1024 * 1024) * 100) / 100,
    spillKb: Math.round(spilledBytes / 1024),
    spilled: spilled,
    cacheHits: cacheHits,
    evictedCache: spilled && cacheHits >= 0,
    cluster: clusterShape(partitions),
  };''',
    '''  const memBudget = budgetBytes(settings.executorMb);
  const totalSpill = spilledBytes + groupSpilledBytes;
  const memory = {
    executorMb: settings.executorMb,
    peakKb: Math.round(peakBytes / 1024),
    budgetKb: Math.round(memBudget / 1024),
    spillKb: Math.round(totalSpill / 1024),
    spillFiles: spillFiles + groupSpillFiles,
    spilled: spilled,
    cacheHits: cacheHits,
    cluster: clusterShape(partitions),
    distribution: distribution,
    skewRatio: skewRatio,
  };''',
)

t = t.replace(
    "peakBytes = Math.max(peakBytes, rowsBytes({ rows: rows }));\n      if (rowsBytes({ rows: rows }) >= settings.executorMb * 256) spilled = true;",
    "const srcM = measure(rows);\n      peakBytes = Math.max(peakBytes, srcM.bytes);\n      if (srcM.bytes > budgetBytes(settings.executorMb)) spilled = true;",
)

t = t.replace(
    '''    const est = rowsBytes({ rows: rows });
    peakBytes = Math.max(peakBytes, est);
    // Teaching scale: tiny demos must still spill when executor.mb is shrunk.
    const budget = settings.executorMb * 256;
    if (est >= budget) {
      spilled = true;
    }''',
    '''    const est = measure(rows).bytes;
    peakBytes = Math.max(peakBytes, est);
    if (est > budgetBytes(settings.executorMb)) {
      spilled = true;
    }''',
)

t = t.replace(
    "physical: physicalPlan(spine),",
    "physical: physicalPlan(spine, joinStats),",
)
t = t.replace(
    "function physicalPlan(spine) {",
    "function physicalPlan(spine, joinStats) {",
)

old_join_physical = '''    if (n.op === "join") {
      const rightMb = (n.args.rightBytes || 0) / (1024 * 1024);
      let chosen = n.args.strategy || "auto";
      if (chosen === "auto") {
        chosen = settings.autoBroadcast && rightMb <= settings.broadcastThresholdMb
          ? "broadcast"
          : "sort-merge";
        if (settings.aqe && chosen === "sort-merge" && rightMb * 4 <= settings.broadcastThresholdMb) {
          chosen = "broadcast";
          lines.push("AQE: SortMergeJoin -> BroadcastHashJoin");
        }
      }
      const strat = chosen === "broadcast"
        ? "BroadcastHashJoin"
        : chosen === "sort-merge"
          ? "SortMergeJoin"
          : "ShuffledHashJoin";
      lines.push(strat + " " + n.label + "  [auto=" + (n.args.strategy || "auto") + " right~" + rightMb.toFixed(3) + "MB]");
    }'''
new_join_physical = '''    if (n.op === "join") {
      const chosen = joinStats ? joinStats.algorithm : "SortMergeJoin";
      lines.push(
        chosen + " " + n.label +
        "  [strategy=" + (n.args.strategy || "auto") +
        " shuffleBytes=" + (joinStats ? joinStats.shuffleBytes : 0) +
        " buildBytes=" + (joinStats ? joinStats.buildBytes : 0) +
        " sort=" + (joinStats ? joinStats.sorted : false) + "]"
      );
    }'''
if old_join_physical not in t:
    raise SystemExit("join physical block not found")
t = t.replace(old_join_physical, new_join_physical, 1)

needle = "  let udfPenalty = 0;"
insert = "  const cg = analyzeCodegen(planSpine(df.plan), settings.udfMode);\n  let udfPenalty = 0;"
if needle not in t:
    raise SystemExit("udfPenalty not found")
t = t.replace(needle, insert, 1)

t = t.replace(
    '''    physical: result.physical,
    cluster: result.memory.cluster,''',
    '''    physical: result.physical,
    codegen: {
      segments: cg.segments.length,
      splits: cg.splits,
      cost: cg.cost,
      generated: cg.generated,
      unfusedOps: cg.unfusedOps,
    },
    join: result.join || null,
    cluster: result.memory.cluster,''',
)

t = t.replace(
    '''    memory: memory,
    physical: physicalPlan(spine, joinStats),
    lateDropped: lateDropped,
  };''',
    '''    memory: memory,
    physical: physicalPlan(spine, joinStats),
    join: joinStats,
    lateDropped: lateDropped,
  };''',
)

t = t.replace(
    '''      if (src && typeof src === "object") val = src[field];''',
    '''      if (Array.isArray(src) && field === "size") val = src.length;
      else if (src && typeof src === "object") val = src[field];''',
)

t = t.replace(
    '''    if (Array.isArray(v)) arr = v;
    else if (typeof v === "string") arr = v.split(",").map(function (s) { return s.trim(); }).filter(Boolean);''',
    '''    if (Array.isArray(v)) arr = v;
    else if (v && typeof v === "object") arr = Object.keys(v);
    else if (typeof v === "string") arr = v.split(",").map(function (s) { return s.trim(); }).filter(Boolean);''',
)

p.write_text(t, encoding="utf-8")
print("execute patched", p.stat().st_size)
