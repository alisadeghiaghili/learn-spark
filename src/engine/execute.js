/**
 * Materialization: row ops, window, joins, memory/spill model, stages.
 */

import { getDataset } from "./datasets.js";
import { evalExpr, compareValues } from "./expr.js";
import { planSpine, rowsBytes } from "./plan.js";
import { settings, clusterShape } from "./settings.js";

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
  let spilled = false;
  let cacheHits = 0;

  for (let i = 0; i < spine.length; i += 1) {
    const node = spine[i];
    if (node.op === "source") {
      const ds = getDataset(node.args.table);
      rows = ds.rows.map(function (r) { return Object.assign({}, r); });
      partitions = Number(node.args.partitions) || 2;
      stages[stages.length - 1].ops.push(node.label);
      peakBytes = Math.max(peakBytes, rowsBytes({ rows: rows }));
      if (rowsBytes({ rows: rows }) >= settings.executorMb * 256) spilled = true;
      continue;
    }

    const wide = Boolean(node.wide);
    if (wide) {
      const strat = node.op === "join" ? node.args.strategy || "auto" : "shuffle";
      stages.push({ ops: [], wide: true, strategy: strat === "broadcast" ? "broadcast" : "shuffle" });
    }

    rows = applyOp(node, rows);
    if (node.op === "repartition" || node.op === "coalesce") {
      partitions = Number(node.args.n) || partitions;
    }
    if (node.op === "join" && node.args.strategy === "broadcast") {
      partitions = Math.max(partitions, 1);
    }
    stages[stages.length - 1].ops.push(node.label);

    const est = rowsBytes({ rows: rows });
    peakBytes = Math.max(peakBytes, est);
    // Teaching scale: tiny demos must still spill when executor.mb is shrunk.
    const budget = settings.executorMb * 256;
    if (est >= budget) {
      spilled = true;
    }
    if (node.cachedHint) cacheHits += 1;

    if (wide && node.op !== "join") {
      stages.push({ ops: [], wide: false, strategy: "map" });
    } else if (node.op === "join" && node.args.strategy !== "broadcast") {
      stages.push({ ops: [], wide: false, strategy: "map" });
    }
  }

  const columns = rows.length ? Object.keys(rows[0]) : inferColumns(spine);
  const memBudget = settings.executorMb * 1024 * 1024;
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
  };

  return {
    rows: rows,
    columns: columns,
    partitions: partitions,
    stages: stages.filter(function (s) { return s.ops.length > 0; }),
    memory: memory,
    physical: physicalPlan(spine),
  };
}

/**
 * Physical plan sketch for explain --extended.
 *
 * @param {any[]} spine
 * @returns {string}
 */
function physicalPlan(spine) {
  const lines = [];
  for (let i = 0; i < spine.length; i += 1) {
    const n = spine[i];
    if (n.op === "join") {
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
      lines.push("Stream_" + n.args.phase + " " + n.label);
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
    const sorted = rows.slice().sort(function (a, b) { return compareValues(a[col], b[col]); });
    return desc ? sorted.reverse() : sorted;
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
      if (src && typeof src === "object") val = src[field];
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
      if (src && typeof src === "object") {
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
    return joinRows(rows, node.args.rightRows, String(node.args.on), String(node.args.joinType || "inner"));
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
      row[outCol] = windowValue(fn, i, values, bucket[i], col);
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
function windowValue(fn, idx, values, row, col) {
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
    for (let i = 0; i <= idx; i += 1) s += values[i];
    return s;
  }
  if (fn === "avg") {
    let s = 0;
    for (let i = 0; i <= idx; i += 1) s += values[i];
    return s / (idx + 1);
  }
  if (fn === "min" || fn === "max") {
    const slice = values.slice(0, idx + 1);
    return fn === "min" ? Math.min.apply(null, slice) : Math.max.apply(null, slice);
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
  const groups = new Map();
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
  let udfPenalty = 0;
  if (result.physical.indexOf("python-udf") !== -1) udfPenalty = 80;
  else if (result.physical.indexOf("jvm-udf") !== -1) udfPenalty = 35;
  else if (result.physical.indexOf("pandas") !== -1) udfPenalty = 12;
  let fmtPenalty = 0;
  if (result.physical.indexOf("text parse") !== -1) fmtPenalty = 25;
  else if (result.physical.indexOf("ACID") !== -1) fmtPenalty = 2;
  const failPenalty = result.physical.indexOf("TaskFailureInjector") !== -1
    ? (settings.speculate ? 15 : 55)
    : 0;
  const computeCost =
    result.stages.length * 10 +
    result.rows.length +
    (result.memory.spilled ? 40 : 0) +
    udfPenalty +
    fmtPenalty +
    failPenalty;
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
    cluster: result.memory.cluster,
    retries: retries,
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
