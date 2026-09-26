/**
 * Materialization: row ops, window, joins, memory/spill model, stages.
 */

import { getDataset } from "./datasets.js";
import { evalExpr, compareValues } from "./expr.js";
import { planSpine } from "./plan.js";
import { settings, clusterShape } from "./settings.js";
import { budgetBytes, hashAggWithSpill, measure, rowBytes, sortWithSpill } from "./memory.js";
import { joinWith } from "./joins.js";
import { place } from "./partitions.js";
import { analyzeCodegen } from "./codegen.js";
import { optimize, formatPlan, spine as optSpine } from "./optimizer.js";

/** Spill counters shared with aggregate() (reset per materialize). */
let groupSpillFiles = 0;
let groupSpilledBytes = 0;
let spilledFlag = false;

/** Simulated executor memory budget (MB) for teaching spill. */
export function executorMemoryMb() {
  return settings.executorMb;
}

/**
 * Materialize a plan.
 *
 * @param {any} plan
 * @returns {{ rows: Array, columns: string[], partitions: number, stages: Array, memory: any, physical: string }}
 */
export function materialize(plan) {
  const spine = planSpine(plan);
  let rows = [];
  let partitions = 2;
  const stages = [{ ops: [], wide: false, strategy: "map" }];
  let peakBytes = 0;
  groupSpillFiles = 0;
  groupSpilledBytes = 0;
  spilledFlag = false;
  let spilled = false;
  let cacheHits = 0;
  let lateDropped = 0;
  let spillFiles = 0;
  let spilledBytes = 0;
  let joinStats = null;
  let distribution = [];
  let skewRatio = 1;

  for (let i = 0; i < spine.length; i += 1) {
    const node = spine[i];
    if (node.op === "source") {
      const ds = getDataset(node.args.table);
      rows = ds.rows.map(function (r) { return Object.assign({}, r); });
      partitions = Number(node.args.partitions) || 2;
      stages[stages.length - 1].ops.push(node.label);
      const srcM = measure(rows);
      peakBytes = Math.max(peakBytes, srcM.bytes);
      if (srcM.bytes > budgetBytes(settings.executorMb)) spilled = true;
      continue;
    }

    const wide = Boolean(node.wide);
    if (wide) {
      const strat = node.op === "join" ? node.args.strategy || "auto" : "shuffle";
      stages.push({ ops: [], wide: true, strategy: strat === "broadcast" ? "broadcast" : "shuffle" });
    }

    if (node.op === "join") {
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
    stages[stages.length - 1].ops.push(node.label);

    const est = measure(rows).bytes;
    peakBytes = Math.max(peakBytes, est);
    if (est > budgetBytes(settings.executorMb)) {
      spilled = true;
    }
    if (node.cachedHint) cacheHits += 1;

    if (wide && node.op !== "join") {
      stages.push({ ops: [], wide: false, strategy: "map" });
    } else if (node.op === "join" && node.args.strategy !== "broadcast") {
      stages.push({ ops: [], wide: false, strategy: "map" });
    }
  }

  // Streaming late-data drop: if watermark set and a sort/ts plan exists, drop rows older than max-ts - lag.
  if (settings.watermarkLag) {
    const tsCol = rows.length && ("ts" in rows[0]) ? "ts" : ("eventTime" in rows[0] ? "eventTime" : null);
    if (tsCol) {
      let maxT = rows[0][tsCol];
      for (let i = 0; i < rows.length; i += 1) {
        if (String(rows[i][tsCol]) > String(maxT)) maxT = rows[i][tsCol];
      }
      const lagDays = parseLagDays(String(settings.watermarkLag));
      const cutoff = shiftDate(String(maxT), -lagDays);
      const before = rows.length;
      rows = rows.filter(function (r) { return String(r[tsCol]) >= cutoff; });
      lateDropped = before - rows.length;
    }
  }

  spilled = spilled || spilledFlag;
  const columns = rows.length ? Object.keys(rows[0]) : inferColumns(spine);
  const memBudget = budgetBytes(settings.executorMb);
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
  };

  return {
    rows: rows,
    columns: columns,
    partitions: partitions,
    stages: stages.filter(function (s) { return s.ops.length > 0; }),
    memory: memory,
    physical: physicalPlan(spine, joinStats),
    join: joinStats,
    lateDropped: lateDropped,
  };
}

/**
 * Physical plan sketch for explain --extended.
 *
 * @param {any[]} spine
 * @returns {string}
 */
function physicalPlan(spine, joinStats) {
  const lines = [];
  for (let i = 0; i < spine.length; i += 1) {
    const n = spine[i];
    if (n.op === "join") {
      const chosen = joinStats ? joinStats.algorithm : "SortMergeJoin";
      lines.push(
        chosen + " " + n.label +
        "  [strategy=" + (n.args.strategy || "auto") +
        " shuffleBytes=" + (joinStats ? joinStats.shuffleBytes : 0) +
        " buildBytes=" + (joinStats ? joinStats.buildBytes : 0) +
        " sort=" + (joinStats ? joinStats.sorted : false) + "]"
      );
    } else if (n.op === "groupBy") {
      lines.push("HashAggregate(keys=" + n.args.keys.join(",") + ") " + n.label);
    } else if (n.op === "window") {
      lines.push("Window " + n.label);
    } else if (n.op === "udf") {
      const mode = settings.udfMode;
      const tag = mode === "native"
        ? "codegen"
        : mode === "pandas"
          ? "pandas-vectorized [semi-native]"
          : mode === "python"
            ? "python-udf [pickle+process hop]"
            : "jvm-udf [non-native]";
      lines.push("MapElements udf=" + n.args.name + " mode=" + mode + " [" + tag + "]");
    } else if (n.op === "source") {
      const fmt = n.args.format || settings.format || "parquet";
      const hint = fmt === "parquet" || fmt === "orc"
        ? "columnar prune+pushdown"
        : fmt === "delta" || fmt === "iceberg" || fmt === "hudi"
          ? "columnar ACID+stats"
          : "text parse, no prune";
      lines.push("FileScan " + fmt + " " + n.label + "  (" + hint + ")");
    } else if (n.op === "salt") {
      lines.push("AddSaltKey " + n.label);
    } else if (n.op === "cube") {
      lines.push("Expand+HashAggregate " + n.label);
    } else if (n.op === "approx_count_distinct") {
      lines.push("HLL_approx_count_distinct " + n.label);
    } else if (n.op === "ml") {
      lines.push("ML_" + n.args.stage + " " + n.label);
    } else if (n.op === "stream") {
      lines.push("Stream_" + n.args.phase + " " + n.label + " outputMode=" + settings.outputMode + (settings.watermarkLag ? " watermark=" + settings.watermarkLag : ""));
    } else if (n.op === "mlLinreg") {
      lines.push("LinearRegression(fit) " + n.label + "  [NormalEquation]");
    } else if (n.op === "mlPredict") {
      lines.push("LinearRegressionModel.transform " + n.label);
    } else if (n.op === "fail") {
      lines.push("TaskFailureInjector " + n.label);
    } else if (n.op === "sort") {
      lines.push("Sort " + n.label);
    } else if (n.op === "distinct") {
      lines.push("HashAggregate(keys=distinct) " + n.label);
    } else {
      lines.push(n.label);
    }
  }
  return lines.join("\\n");
}

/**
 * Best-effort column inference for empty results.
 *
 * @param {any[]} spine
 * @returns {string[]}
 */
function inferColumns(spine) {
  for (let i = spine.length - 1; i >= 0; i -= 1) {
    const n = spine[i];
    if (n.op === "select" && Array.isArray(n.args.cols)) return n.args.cols.slice();
    if (n.op === "window" && n.args.outCol) return [n.args.outCol].concat(n.args.partitionBy || []);
    if (n.op === "source") {
      try {
        return getDataset(n.args.table).schema.map(function (c) { return c.name; });
      } catch (e) {
        return [];
      }
    }
  }
  return [];
}

/**
 * @param {any} node
 * @param {Array} rows
 * @returns {Array}
 */
function applyOp(node, rows) {
  if (node.op === "filter") {
    return rows.filter(function (r) { return Boolean(evalExpr(String(node.args.expr), r)); });
  }
  if (node.op === "select") {
    const cols = node.args.cols;
    return rows.map(function (r) {
      const out = {};
      for (let i = 0; i < cols.length; i += 1) out[cols[i]] = r[cols[i]];
      return out;
    });
  }
  if (node.op === "drop") {
    const col = String(node.args.col);
    return rows.map(function (r) {
      const out = Object.assign({}, r);
      delete out[col];
      return out;
    });
  }
  if (node.op === "withColumn") {
    const name = String(node.args.name);
    const expr = String(node.args.expr);
    return rows.map(function (r) {
      const out = Object.assign({}, r);
      out[name] = evalExpr(expr, r);
      return out;
    });
  }
  if (node.op === "udf") {
    const name = String(node.args.name);
    const col = String(node.args.col);
    return rows.map(function (r) {
      const out = Object.assign({}, r);
      out[col + "_" + name] = applyUdf(name, r[col], r);
      return out;
    });
  }
  if (node.op === "limit") {
    return rows.slice(0, Number(node.args.n) || 0);
  }
  if (node.op === "sample") {
    const frac = Number(node.args.frac) || 0.5;
    return rows.filter(function (_r, i) { return (i * 17 % 100) / 100 < frac; });
  }
  if (node.op === "sort") {
    const col = String(node.args.col);
    const desc = Boolean(node.args.desc);
    const cmp = function (a, b) {
      const c = compareValues(a[col], b[col]);
      return desc ? -c : c;
    };
    const sr = sortWithSpill(rows, cmp, budgetBytes(settings.executorMb));
    return sr.rows;
  }
  if (node.op === "distinct") {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const key = JSON.stringify(rows[i]);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(rows[i]);
      }
    }
    return out;
  }
  if (node.op === "groupBy") {
    return aggregate(rows, node.args);
  }
  if (node.op === "cube") {
    return cubeRows(rows, node.args);
  }
  if (node.op === "approx_count_distinct") {
    const col = String(node.args.col);
    const set = new Set(rows.map(function (r) { return String(r[col]); }));
    return [{ approx_count_distinct: Math.round(set.size * 0.97), col: col }];
  }
  if (node.op === "salt") {
    const col = String(node.args.col);
    const n = Number(node.args.n) || 4;
    return rows.map(function (r, i) {
      const out = Object.assign({}, r);
      out[col + "_salt"] = String(r[col]) + "_" + (i % n);
      return out;
    });
  }
  if (node.op === "getField") {
    const col = String(node.args.col);
    const field = String(node.args.field);
    return rows.map(function (r) {
      const src = r[col];
      let val = null;
      if (Array.isArray(src) && field === "size") val = src.length;
      else if (src && typeof src === "object") val = src[field];
      else if (typeof src === "string" && src.indexOf("=") !== -1) {
        const parts = src.split(",");
        for (let i = 0; i < parts.length; i += 1) {
          const kv = parts[i].split("=");
          if (kv[0].trim() === field) val = kv.slice(1).join("=").trim();
        }
      }
      const out = Object.assign({}, r);
      out[col + "." + field] = val;
      return out;
    });
  }
  if (node.op === "mapExplode") {
    const col = String(node.args.col);
    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const src = r[col];
      let pairs = [];
      if (Array.isArray(src)) {
        pairs = src.map(function (v) { return { key: String(v), value: v }; });
      } else if (src && typeof src === "object") {
        pairs = Object.keys(src).map(function (k) { return { key: k, value: src[k] }; });
      } else if (typeof src === "string") {
        pairs = src.split(",").map(function (s) {
          const kv = s.split("=");
          return { key: (kv[0] || "").trim(), value: kv.slice(1).join("=").trim() };
        }).filter(function (p) { return p.key; });
      }
      for (let j = 0; j < pairs.length; j += 1) {
        const copy = Object.assign({}, r);
        copy.map_key = pairs[j].key;
        copy.map_value = pairs[j].value;
        out.push(copy);
      }
    }
    return out;
  }
  if (node.op === "ml") {
    return applyMl(rows, node.args);
  }
  if (node.op === "mlLinreg") {
    // fit stores model on rows as columns; real fit is on full bag
    const model = fitLinreg(rows, node.args);
    return rows.map(function (r) {
      const out = Object.assign({}, r);
      out.model_w = model.w;
      out.model_b = model.b;
      out.model_rmse = model.rmse;
      return out;
    });
  }
  if (node.op === "mlPredict") {
    return predictLinreg(rows, node.args);
  }
  if (node.op === "stream") {
    return rows;
  }
  if (node.op === "fail") {
    // failure is modeled in run() retry stats, not row shape
    return rows;
  }
  if (node.op === "window") {
    return applyWindow(rows, node.args);
  }
  if (node.op === "explode") {
    return applyExplode(rows, String(node.args.col));
  }
  if (node.op === "join") {
    return rows;
  }
  return rows;
}

/**
 * @param {string} name
 * @param {unknown} value
 * @param {any} row
 * @returns {unknown}
 */
function applyUdf(name, value, row) {
  if (name === "upper") return String(value == null ? "" : value).toUpperCase();
  if (name === "double") return Number(value) * 2;
  if (name === "tax") return Number(value) * 1.1;
  if (name === "prefix") return "u:" + String(value == null ? "" : value);
  if (name === "isNull") return value == null;
  void row;
  throw new Error("unknown udf: " + name + " (use upper|double|tax|prefix|isNull)");
}

/**
 * @param {Array} rows
 * @param {string} col
 * @returns {Array}
 */
function applyExplode(rows, col) {
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const v = r[col];
    let arr;
    if (Array.isArray(v)) arr = v;
    else if (v && typeof v === "object") arr = Object.keys(v);
    else if (typeof v === "string") arr = v.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    else arr = v == null ? [] : [v];
    for (let j = 0; j < arr.length; j += 1) {
      const copy = Object.assign({}, r);
      copy[col] = arr[j];
      out.push(copy);
    }
  }
  return out;
}

/**
 * @param {Array} rows
 * @param {any} args
 * @returns {Array}
 */
function applyWindow(rows, args) {
  const fn = String(args.fn);
  const col = args.col && args.col !== "*" ? String(args.col) : null;
  const partitionBy = args.partitionBy || [];
  const orderBy = String(args.orderBy);
  const desc = Boolean(args.desc);
  const outCol = String(args.outCol);

  const groups = new Map();
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const key = partitionBy.map(function (p) { return String(r[p]); }).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(Object.assign({}, r));
  }

  const out = [];
  const buckets = Array.from(groups.values());
  for (let g = 0; g < buckets.length; g += 1) {
    const bucket = buckets[g].slice().sort(function (a, b) {
      const c = compareValues(a[orderBy], b[orderBy]);
      return desc ? -c : c;
    });
    const values = bucket.map(function (r) {
      return col ? Number(r[col]) : 1;
    });
    for (let i = 0; i < bucket.length; i += 1) {
      const row = Object.assign({}, bucket[i]);
      row[outCol] = windowValue(fn, i, values, bucket[i], col, args.frame);
      out.push(row);
    }
  }
  return out;
}

/**
 * @param {string} fn
 * @param {number} idx
 * @param {number[]} values
 * @param {any} row
 * @param {string|null} col
 * @returns {unknown}
 */
/**
 * Resolve frame window indices.
 *
 * @param {string} frame
 * @param {number} idx
 * @param {number} len
 * @returns {number[]}
 */
function frameSlice(frame, idx, len) {
  const f = String(frame || "rows-unbounded-current");
  if (f === "rows-unbounded-current" || f === "unbounded") {
    return Array.from({ length: idx + 1 }, function (_v, i) { return i; });
  }
  if (f === "rows-unbounded-following" || f === "entire") {
    return Array.from({ length: len }, function (_v, i) { return i; });
  }
  if (f === "rows-3-preceding-current" || f === "last4") {
    const start = Math.max(0, idx - 3);
    const out = [];
    for (let i = start; i <= idx; i += 1) out.push(i);
    return out;
  }
  if (f === "rows-current-only" || f === "current") {
    return [idx];
  }
  if (f === "range-unbounded-current") {
    return Array.from({ length: idx + 1 }, function (_v, i) { return i; });
  }
  return Array.from({ length: idx + 1 }, function (_v, i) { return i; });
}

function windowValue(fn, idx, values, row, col, frame) {
  const win = frameSlice(frame, idx, values.length);
  const inFrame = win.map(function (i) { return values[i]; });
  if (fn === "row_number") return idx + 1;
  if (fn === "rank") {
    const v = values[idx];
    let rank = 1;
    for (let i = 0; i < idx; i += 1) if (values[i] < v) rank = i + 2;
    return rank;
  }
  if (fn === "dense_rank") {
    const uniq = [];
    for (let i = 0; i <= idx; i += 1) if (uniq.indexOf(values[i]) === -1) uniq.push(values[i]);
    return uniq.length;
  }
  if (fn === "sum") {
    let s = 0;
    for (let i = 0; i < inFrame.length; i += 1) s += inFrame[i];
    return s;
  }
  if (fn === "avg") {
    if (!inFrame.length) return null;
    let s = 0;
    for (let i = 0; i < inFrame.length; i += 1) s += inFrame[i];
    return s / inFrame.length;
  }
  if (fn === "min" || fn === "max") {
    if (!inFrame.length) return null;
    return fn === "min" ? Math.min.apply(null, inFrame) : Math.max.apply(null, inFrame);
  }
  if (fn === "lag" || fn === "lead") {
    const at = fn === "lag" ? idx - 1 : idx + 1;
    if (at < 0 || at >= values.length) return null;
    return values[at];
  }
  void row;
  void col;
  throw new Error("unknown window fn: " + fn);
}

/**
 * @param {Array} left
 * @param {Array} right
 * @param {string} on
 * @param {string} joinType
 * @returns {Array}
 */
function joinRows(left, right, on, joinType) {
  const index = new Map();
  for (let i = 0; i < right.length; i += 1) {
    const r = right[i];
    const keyVal = r[on] != null ? r[on] : (r.id != null ? r.id : "");
    const k = String(keyVal);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(r);
  }
  const out = [];
  const matchedRight = new Set();
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const k = String(l[on] != null ? l[on] : "");
    const matches = index.get(k) || [];
    if (!matches.length) {
      if (joinType === "left" || joinType === "full") {
        out.push(padRight(Object.assign({}, l), right[0] ? Object.keys(right[0]) : [on]));
      }
      continue;
    }
    for (let j = 0; j < matches.length; j += 1) {
      const r = matches[j];
      matchedRight.add(r);
      out.push(Object.assign({}, r, l));
    }
  }
  if (joinType === "right" || joinType === "full") {
    for (let i = 0; i < right.length; i += 1) {
      if (!matchedRight.has(right[i])) {
        out.push(Object.assign({}, padLeft(right[i], left[0] ? Object.keys(left[0]) : [on]), right[i]));
      }
    }
  }
  return out;
}

/**
 * @param {any} row
 * @param {string[]} cols
 * @returns {any}
 */
function padRight(row, cols) {
  const out = Object.assign({}, row);
  for (let i = 0; i < cols.length; i += 1) {
    if (!(cols[i] in out)) out[cols[i]] = null;
  }
  return out;
}

/**
 * @param {any} row
 * @param {string[]} cols
 * @returns {any}
 */
function padLeft(row, cols) {
  const out = {};
  for (let i = 0; i < cols.length; i += 1) out[cols[i]] = row[cols[i]] != null ? row[cols[i]] : null;
  return Object.assign({}, out, row);
}

/**
 * @param {Array} rows
 * @param {any} args
 * @returns {Array}
 */
function aggregate(rows, args) {
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
  if (packed.spillFiles) spilledFlag = true;
  const groups = packed.groups;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const k = keys.map(function (key) { return String(r[key]); }).join("|");
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const out = [];
  const buckets = Array.from(groups.values());
  for (let i = 0; i < buckets.length; i += 1) {
    const bucket = buckets[i];
    const row = {};
    for (let j = 0; j < keys.length; j += 1) row[keys[j]] = bucket[0][keys[j]];
    for (let a = 0; a < aggs.length; a += 1) {
      const fn = String(aggs[a].fn);
      const col = aggs[a].col && aggs[a].col !== "*" ? String(aggs[a].col) : null;
      const values = col
        ? bucket.map(function (r) { return Number(r[col]); })
        : bucket.map(function () { return 1; });
      row[fn + "(" + (col || "*") + ")"] = reduceAgg(fn, values);
    }
    out.push(row);
  }
  return out;
}

/**
 * Cube/rollup via grouping-set expand then aggregate.
 *
 * @param {Array} rows
 * @param {any} args
 * @returns {Array}
 */
function cubeRows(rows, args) {
  const keys = args.keys;
  const kind = String(args.kind || "cube");
  const fn = String(args.fn);
  const col = args.col && args.col !== "*" ? String(args.col) : null;
  const sets = [];
  if (kind === "cube") {
    // all subsets of keys
    const n = keys.length;
    for (let mask = 0; mask < (1 << n); mask += 1) {
      const subset = [];
      for (let i = 0; i < n; i += 1) if (mask & (1 << i)) subset.push(keys[i]);
      sets.push(subset);
    }
  } else {
    // rollup: suffixes
    sets.push(keys.slice());
    for (let i = keys.length - 1; i >= 0; i -= 1) sets.push(keys.slice(0, i));
  }
  const out = [];
  for (let s = 0; s < sets.length; s += 1) {
    const subset = sets[s];
    const grouped = aggregate(rows, {
      keys: subset,
      fn: fn,
      col: col,
      multi: false,
      aggs: [{ fn: fn, col: col }],
    });
    for (let i = 0; i < grouped.length; i += 1) {
      const row = {};
      for (let k = 0; k < keys.length; k += 1) {
        row[keys[k]] = subset.indexOf(keys[k]) === -1 ? null : grouped[i][keys[k]];
      }
      const aggKeys = Object.keys(grouped[i]).filter(function (k) { return keys.indexOf(k) === -1; });
      for (let a = 0; a < aggKeys.length; a += 1) row[aggKeys[a]] = grouped[i][aggKeys[a]];
      out.push(row);
    }
  }
  return out;
}

/**
 * Simulated ML stages: vectorize / fit / predict.
 *
 * @param {Array} rows
 * @param {any} args
 * @returns {Array}
 */
function applyMl(rows, args) {
  const stage = String(args.stage);
  if (stage === "vectorize") {
    const cols = args.cols || [];
    return rows.map(function (r) {
      const out = Object.assign({}, r);
      out.features = cols.map(function (c) { return Number(r[c]) || 0; }).join("|");
      return out;
    });
  }
  if (stage === "fit") {
    // closed-form demo: mean of target as "model intercept"
    const target = String(args.target || "amount");
    let sum = 0;
    for (let i = 0; i < rows.length; i += 1) sum += Number(rows[i][target]) || 0;
    const mean = rows.length ? sum / rows.length : 0;
    return rows.map(function (r) {
      const out = Object.assign({}, r);
      out.prediction = mean;
      out.model_intercept = mean;
      return out;
    });
  }
  if (stage === "predict") {
    const intercept = Number(args.intercept) || 0;
    return rows.map(function (r) {
      const out = Object.assign({}, r);
      out.prediction = intercept * 1.1;
      return out;
    });
  }
  throw new Error("unknown ml stage: " + stage);
}

/**
 * Ordinary least squares on one feature (closed form).
 *
 * @param {Array} rows
 * @param {any} args
 * @returns {Array}
 */
export function fitLinreg(rows, args) {
  const xCol = String(args.featureCol);
  const yCol = String(args.targetCol);
  const n = rows.length;
  if (!n) return { w: 0, b: 0, rmse: 0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const x = Number(rows[i][xCol]) || 0;
    const y = Number(rows[i][yCol]) || 0;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const w = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const b = (sy - w * sx) / n;
  let se = 0;
  for (let i = 0; i < n; i += 1) {
    const x = Number(rows[i][xCol]) || 0;
    const y = Number(rows[i][yCol]) || 0;
    const err = y - (w * x + b);
    se += err * err;
  }
  return { w: w, b: b, rmse: Math.sqrt(se / n), featureCol: xCol, targetCol: yCol };
}

/**
 * Apply fitted linear model.
 *
 * @param {Array} rows
 * @param {any} args
 * @returns {Array}
 */
export function predictLinreg(rows, args) {
  const xCol = String(args.featureCol);
  const w = Number(args.w);
  const b = Number(args.b);
  return rows.map(function (r) {
    const out = Object.assign({}, r);
    const x = Number(r[xCol]) || 0;
    out.prediction = w * x + b;
    out.residual = Number(r[args.targetCol] || 0) - out.prediction;
    return out;
  });
}

/**
 * @param {string} fn
 * @param {number[]} values
 * @returns {number}
 */
function reduceAgg(fn, values) {
  if (!values.length) return 0;
  if (fn === "sum") return values.reduce(function (a, b) { return a + b; }, 0);
  if (fn === "count") return values.length;
  if (fn === "avg") return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
  if (fn === "min") return Math.min.apply(null, values);
  if (fn === "max") return Math.max.apply(null, values);
  throw new Error("unsupported aggregate: " + fn);
}

/**
 * Execute a frame (action).
 *
 * @param {any} df
 * @returns {any}
 */
export function run(df) {
  const result = materialize(df.plan);
  const cg = analyzeCodegen(planSpine(df.plan), settings.udfMode);
  const opt = optimize(df.plan, result.columns);
  const optPlanText = formatPlan(opt.plan);
  const optTrace = opt.trace;
  let udfPenalty = 0;
  if (result.physical.indexOf("python-udf") !== -1) udfPenalty = 80;
  else if (result.physical.indexOf("jvm-udf") !== -1) udfPenalty = 35;
  else if (result.physical.indexOf("pandas") !== -1) udfPenalty = 12;
  let fmtPenalty = 0;
  if (result.physical.indexOf("text parse") !== -1) fmtPenalty = 25;
  else if (result.physical.indexOf("ACID") !== -1) fmtPenalty = 2;
  let storagePenalty = 0;
  const sl = String(df.storageLevel || settings.storageLevel || "MEMORY_AND_DISK");
  if (df.cached && sl === "DISK_ONLY") storagePenalty = 20;
  else if (df.cached && sl === "MEMORY_ONLY_SER") storagePenalty = 8;
  else if (df.cached && sl === "MEMORY_ONLY") storagePenalty = 3;
  else if (df.cached) storagePenalty = 1;
  const failPenalty = result.physical.indexOf("TaskFailureInjector") !== -1
    ? (settings.speculate ? 15 : 55)
    : 0;
  const computeCost =
    result.stages.length * 10 +
    result.rows.length +
    (result.memory.spilled ? 40 : 0) +
    udfPenalty +
    fmtPenalty +
    failPenalty +
    storagePenalty;
  const fromCache = Boolean(df.cached && df.cacheKey);
  const failed = result.physical.indexOf("TaskFailureInjector") !== -1;
  const retries = failed ? (settings.speculate ? 1 : 2) : 0;
  return {
    rows: result.rows,
    columns: result.columns,
    partitions: result.partitions,
    stages: result.stages,
    memory: result.memory,
    physical: result.physical,
    codegen: {
      segments: cg.segments.length,
      splits: cg.splits,
      cost: cg.cost,
      generated: cg.generated,
      unfusedOps: cg.unfusedOps,
    },
    optimizer: {
      trace: optTrace,
      optimized: optPlanText,
    },
    join: result.join || null,
    cluster: result.memory.cluster,
    retries: retries,
    lateDropped: result.lateDropped || 0,
    storageLevel: String(df.storageLevel || settings.storageLevel || "MEMORY_AND_DISK"),
    speculative: settings.speculate,
    computeCost: fromCache ? Math.floor(computeCost * 0.15) : computeCost,
    fromCache: fromCache,
  };
}

/**
 * @param {Array} rows
 * @param {number} partitions
 * @returns {Array[]}
 */
export function partitionRows(rows, partitions) {
  const n = Math.max(1, partitions);
  const buckets = [];
  for (let i = 0; i < n; i += 1) buckets.push([]);
  for (let i = 0; i < rows.length; i += 1) buckets[i % n].push(rows[i]);
  return buckets;
}


/**
 * Parse lag like 10m / 2h / 1d to days (fractional).
 *
 * @param {string} lag
 * @returns {number}
 */
function parseLagDays(lag) {
  const m = String(lag).match(/^(\d+(?:\.\d+)?)([smhd])$/i);
  if (!m) return Number(lag) || 0;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (u === "s") return n / 86400;
  if (u === "m") return n / 1440;
  if (u === "h") return n / 24;
  return n;
}

/**
 * Shift ISO date by (possibly fractional) days.
 *
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
function shiftDate(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
