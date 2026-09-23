/**
 * Plan materialization: row ops, aggregates, joins, stages, cache-aware run.
 */

import { getDataset } from "./datasets.js";
import { evalExpr, compareValues } from "./expr.js";
import { planSpine } from "./plan.js";

/**
 * Materialize a plan by walking parents first and applying ops.
 *
 * @param {any} plan
 * @returns {{ rows: Array, columns: string[], partitions: number, stages: Array }}
 */
export function materialize(plan) {
  const spine = planSpine(plan);
  let rows = [];
  let partitions = 2;
  const stages = [{ ops: [], wide: false }];

  for (let i = 0; i < spine.length; i += 1) {
    const node = spine[i];
    if (node.op === "source") {
      const ds = getDataset(node.args.table);
      rows = ds.rows.map(function (r) { return Object.assign({}, r); });
      partitions = Number(node.args.partitions) || 2;
      stages[stages.length - 1].ops.push(node.label);
      continue;
    }

    if (node.wide) {
      stages.push({ ops: [], wide: true });
    }

    rows = applyOp(node, rows);
    if (node.op === "repartition" || node.op === "coalesce") {
      partitions = Number(node.args.n) || partitions;
    }
    stages[stages.length - 1].ops.push(node.label);

    if (node.wide) {
      stages.push({ ops: [], wide: false });
    }
  }

  const columns = rows.length ? Object.keys(rows[0]) : inferColumns(spine);
  return {
    rows: rows,
    columns: columns,
    partitions: partitions,
    stages: stages.filter(function (s) { return s.ops.length > 0; }),
  };
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
 * Apply a single operator to a row bag.
 *
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
  if (node.op === "withColumn") {
    const name = String(node.args.name);
    const expr = String(node.args.expr);
    return rows.map(function (r) {
      const out = Object.assign({}, r);
      out[name] = evalExpr(expr, r);
      return out;
    });
  }
  if (node.op === "limit") {
    return rows.slice(0, Number(node.args.n) || 0);
  }
  if (node.op === "sort") {
    const col = String(node.args.col);
    const desc = Boolean(node.args.desc);
    const sorted = rows.slice().sort(function (a, b) { return compareValues(a[col], b[col]); });
    return desc ? sorted.reverse() : sorted;
  }
  if (node.op === "groupBy") {
    return aggregate(rows, node.args);
  }
  if (node.op === "join") {
    return joinRows(rows, node.args.rightRows, String(node.args.on));
  }
  return rows;
}

/**
 * Aggregate rows by key columns.
 *
 * @param {Array} rows
 * @param {any} args
 * @returns {Array}
 */
function aggregate(rows, args) {
  const keys = args.keys;
  const fn = String(args.fn);
  const col = args.col ? String(args.col) : null;
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
    const values = col
      ? bucket.map(function (r) { return Number(r[col]); })
      : bucket.map(function () { return 1; });
    row[fn + "(" + (col || "*") + ")"] = reduceAgg(fn, values);
    out.push(row);
  }
  return out;
}

/**
 * Reduce a numeric series with an aggregate function.
 *
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
 * Inner-join two row bags on a key column.
 *
 * @param {Array} left
 * @param {Array} right
 * @param {string} on
 * @returns {Array}
 */
function joinRows(left, right, on) {
  const index = new Map();
  for (let i = 0; i < right.length; i += 1) {
    const r = right[i];
    const keyVal = r[on] != null ? r[on] : (r.id != null ? r.id : "");
    const k = String(keyVal);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(r);
  }
  const out = [];
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const k = String(l[on] != null ? l[on] : "");
    const matches = index.get(k) || [];
    for (let j = 0; j < matches.length; j += 1) {
      const r = matches[j];
      out.push(Object.assign({}, r, l));
    }
  }
  return out;
}

/**
 * Execute a frame (action).
 *
 * @param {any} df
 * @returns {{ rows: Array, columns: string[], partitions: number, stages: Array, computeCost: number, fromCache: boolean }}
 */
export function run(df) {
  const result = materialize(df.plan);
  const computeCost = result.stages.length * 10 + result.rows.length;
  const fromCache = Boolean(df.cached && df.cacheKey);
  return {
    rows: result.rows,
    columns: result.columns,
    partitions: result.partitions,
    stages: result.stages,
    computeCost: fromCache ? Math.floor(computeCost * 0.15) : computeCost,
    fromCache: fromCache,
  };
}

/**
 * Split rows into partition buckets for visualization.
 *
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
