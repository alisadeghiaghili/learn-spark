/**
 * Plan builders: lazy transformations and source constructors.
 */

import { getDataset } from "./datasets.js";

let idSeq = 0;

/**
 * Generate a stable node/frame id.
 *
 * @param {string} prefix
 * @returns {string}
 */
function nextId(prefix) {
  idSeq += 1;
  return prefix + "-" + idSeq;
}

/**
 * Clone a plan spine.
 *
 * @param {any} node
 * @returns {any}
 */
function clonePlan(node) {
  if (!node) return node;
  return {
    id: node.id,
    op: node.op,
    label: node.label,
    args: node.args,
    wide: node.wide,
    parent: node.parent ? clonePlan(node.parent) : null,
  };
}

/**
 * Flatten a plan into ordered nodes (source to tip).
 *
 * @param {any} plan
 * @returns {any[]}
 */
export function planSpine(plan) {
  const out = [];
  let cur = plan;
  while (cur) {
    out.push(cur);
    cur = cur.parent;
  }
  return out.reverse();
}

/**
 * Create a source DataFrame from a table name.
 *
 * @param {string} table
 * @param {{ partitions?: number, format?: string }} [opts]
 * @returns {any}
 */
export function createSource(table, opts = {}) {
  const ds = getDataset(table);
  const partitions = opts.partitions != null ? opts.partitions : 2;
  const plan = {
    id: nextId("op"),
    op: "source",
    label: "table(" + ds.name + ")",
    args: {
      table: ds.name,
      partitions: partitions,
      format: opts.format || "parquet",
      bytes: ds.bytes || rowsBytes(ds),
    },
    parent: null,
    wide: false,
  };
  return {
    id: nextId("df"),
    name: ds.name,
    columns: ds.schema.map(function (c) { return c.name; }),
    rows: [],
    partitions: partitions,
    cached: false,
    plan: plan,
    cacheKey: null,
  };
}

/**
 * Rough byte estimate for cost/spill teaching.
 *
 * @param {any} ds
 * @returns {number}
 */
function rowsBytes(ds) {
  return ds.rows.length * 64;
}

/**
 * Append a transformation node and return a new Frame (lazy).
 *
 * @param {any} df
 * @param {string} op
 * @param {string} label
 * @param {Record<string, unknown>} args
 * @param {{ wide?: boolean }} [opts]
 * @returns {any}
 */
export function withOp(df, op, label, args, opts = {}) {
  const node = {
    id: nextId("op"),
    op: op,
    label: label,
    args: args,
    parent: clonePlan(df.plan),
    wide: Boolean(opts.wide),
  };
  return {
    id: nextId("df"),
    name: df.name,
    columns: df.columns,
    rows: [],
    partitions: df.partitions,
    cached: false,
    plan: node,
    cacheKey: null,
  };
}

/**
 * @param {any} df
 * @param {string} expr
 * @returns {any}
 */
export function filter(df, expr) {
  return withOp(df, "filter", "filter(" + expr + ")", { expr: expr });
}

/**
 * @param {any} df
 * @param {string[]} cols
 * @returns {any}
 */
export function select(df, cols) {
  return withOp(df, "select", "select(" + cols.join(", ") + ")", { cols: cols });
}

/**
 * @param {any} df
 * @param {string} name
 * @param {string} expr
 * @returns {any}
 */
export function withColumn(df, name, expr) {
  return withOp(df, "withColumn", "withColumn(" + name + ", " + expr + ")", {
    name: name,
    expr: expr,
  });
}

/**
 * @param {any} df
 * @param {string} col
 * @param {boolean} [desc]
 * @returns {any}
 */
export function sort(df, col, desc) {
  desc = Boolean(desc);
  return withOp(df, "sort", "sort(" + col + (desc ? " desc" : "") + ")", {
    col: col,
    desc: desc,
  });
}

/**
 * @param {any} df
 * @param {number} n
 * @returns {any}
 */
export function limit(df, n) {
  return withOp(df, "limit", "limit(" + n + ")", { n: n });
}

/**
 * @param {any} df
 * @param {string[]} keys
 * @param {string} fn
 * @param {string|null} col
 * @returns {any}
 */
export function groupBy(df, keys, fn, col) {
  return withOp(
    df,
    "groupBy",
    "groupBy(" + keys.join(", ") + ") " + fn + "(" + (col || "*") + ")",
    { keys: keys, fn: fn, col: col },
    { wide: true }
  );
}

/**
 * Join with explicit type and physical strategy hint.
 *
 * @param {any} df
 * @param {string} table
 * @param {string} on
 * @param {string} [joinType]
 * @param {string} [strategy]
 * @returns {any}
 */
export function join(df, table, on, joinType, strategy) {
  const right = getDataset(table);
  const type = joinType || "inner";
  const strat = strategy || "auto";
  return withOp(
    df,
    "join",
    "join(" + table + " on " + on + ", " + type + ")",
    {
      table: table,
      on: on,
      joinType: type,
      strategy: strat,
      rightRows: right.rows.map(function (r) { return Object.assign({}, r); }),
      rightBytes: right.rows.length * 64,
    },
    { wide: strat !== "broadcast" }
  );
}

/**
 * @param {any} df
 * @param {number} n
 * @returns {any}
 */
export function repartition(df, n) {
  return withOp(df, "repartition", "repartition(" + n + ")", { n: n }, { wide: true });
}

/**
 * @param {any} df
 * @param {number} n
 * @returns {any}
 */
export function coalesce(df, n) {
  return withOp(df, "coalesce", "coalesce(" + n + ")", { n: n });
}

/**
 * @param {any} df
 * @param {string} col
 * @returns {any}
 */
export function drop(df, col) {
  return withOp(df, "drop", "drop(" + col + ")", { col: col });
}

/**
 * @param {any} df
 * @returns {any}
 */
export function distinct(df) {
  return withOp(df, "distinct", "distinct()", {}, { wide: true });
}

/**
 * @param {any} df
 * @param {number} [frac]
 * @returns {any}
 */
export function sample(df, frac) {
  return withOp(df, "sample", "sample(" + (frac || 0.5) + ")", {
    frac: frac || 0.5,
  });
}

/**
 * Window aggregate (teaching subset).
 *
 * @param {any} df
 * @param {string} fn row_number|rank|dense_rank|sum|avg|min|max|lag|lead
 * @param {string|null} col
 * @param {string[]} partitionBy
 * @param {string} orderBy
 * @param {boolean} [desc]
 * @returns {any}
 */
export function windowFn(df, fn, col, partitionBy, orderBy, desc, frame) {
  const outCol = fn + "_over_" + (partitionBy.join("_") || "all");
  const frameSpec = frame || "rows-unbounded-current";
  return withOp(
    df,
    "window",
    "window(" + fn + "(" + (col || "*") + ") over " + (partitionBy.join(",") || "all") + " order " + orderBy + " frame " + frameSpec + ")",
    {
      fn: fn,
      col: col,
      partitionBy: partitionBy || [],
      orderBy: orderBy,
      desc: Boolean(desc),
      outCol: outCol,
      frame: frameSpec,
    }
  );
}

/**
 * Explode an array-like column into rows (nested demo: tags).
 *
 * @param {any} df
 * @param {string} col
 * @returns {any}
 */
export function explode(df, col) {
  return withOp(df, "explode", "explode(" + col + ")", { col: col });
}

/**
 * Built-in teaching UDF (deterministic, typed).
 *
 * @param {any} df
 * @param {string} name upper|double|tax|prefix
 * @param {string} col
 * @returns {any}
 */
export function udf(df, name, col) {
  return withOp(df, "udf", "udf:" + name + "(" + col + ")", {
    name: name,
    col: col,
  });
}

/**
 * Mark a frame as cached.
 *
 * @param {any} df
 * @returns {any}
 */
export function cacheFrame(df, storageLevel) {
  return Object.assign({}, df, {
    id: nextId("df"),
    plan: clonePlan(df.plan),
    cached: true,
    cacheKey: df.id,
    storageLevel: storageLevel || "MEMORY_AND_DISK",
  });
}

/**
 * @param {any} df
 * @returns {any}
 */
export function unpersistFrame(df) {
  return Object.assign({}, df, {
    id: nextId("df"),
    plan: clonePlan(df.plan),
    cached: false,
    cacheKey: null,
  });
}

export { nextId, clonePlan, rowsBytes };


/**
 * Salt a key column to desekew (adds _salt suffix key).
 *
 * @param {any} df
 * @param {string} col
 * @param {number} [n]
 * @returns {any}
 */
export function salt(df, col, n) {
  return withOp(df, "salt", "salt(" + col + " x" + (n || 4) + ")", {
    col: col,
    n: n || 4,
  }, { wide: true });
}

/**
 * Multi-aggregate groupBy: several agg expressions.
 *
 * @param {any} df
 * @param {string[]} keys
 * @param {Array<{ fn: string, col: string|null }>} aggs
 * @returns {any}
 */
export function groupByMulti(df, keys, aggs) {
  const label = "groupBy(" + keys.join(", ") + ") " + aggs.map(function (a) {
    return a.fn + "(" + (a.col || "*") + ")";
  }).join(", ");
  return withOp(df, "groupBy", label, {
    keys: keys,
    fn: aggs[0] && aggs[0].fn,
    col: aggs[0] && aggs[0].col,
    aggs: aggs,
    multi: true,
  }, { wide: true });
}

/**
 * Cube / rollup grouping sets.
 *
 * @param {any} df
 * @param {string[]} keys
 * @param {string} kind cube|rollup
 * @param {string} fn
 * @param {string|null} col
 * @returns {any}
 */
export function cubeRollup(df, keys, kind, fn, col) {
  return withOp(df, "cube", kind + "(" + keys.join(", ") + ") " + fn + "(" + (col || "*") + ")", {
    keys: keys,
    kind: kind,
    fn: fn,
    col: col,
  }, { wide: true });
}

/**
 * Approximate distinct count.
 *
 * @param {any} df
 * @param {string} col
 * @returns {any}
 */
export function approxCountDistinct(df, col) {
  return withOp(df, "approx_count_distinct", "approx_count_distinct(" + col + ")", { col: col }, { wide: true });
}

/**
 * Field access on nested/map-like column: get(col, field).
 *
 * @param {any} df
 * @param {string} col
 * @param {string} field
 * @returns {any}
 */
export function getField(df, col, field) {
  return withOp(df, "getField", "get(" + col + "." + field + ")", { col: col, field: field });
}

/**
 * Map explode: one row per key=value.
 *
 * @param {any} df
 * @param {string} col
 * @returns {any}
 */
export function mapExplode(df, col) {
  return withOp(df, "mapExplode", "explode(map:" + col + ")", { col: col });
}

/**
 * Machine learning feature + model stages (simulated estimators).
 *
 * @param {any} df
 * @param {string} stage fit|predict|vectorize
 * @param {Record<string, unknown>} args
 * @returns {any}
 */
export function mlOp(df, stage, args) {
  return withOp(df, "ml", "ml:" + stage, Object.assign({ stage: stage }, args), {
    wide: stage === "fit",
  });
}

/**
 * Streaming control marker (not a row transform).
 *
 * @param {any} df
 * @param {string} phase open|emit|trigger|watermark
 * @param {Record<string, unknown>} args
 * @returns {any}
 */
export function streamOp(df, phase, args) {
  return withOp(df, "stream", "stream:" + phase, Object.assign({ phase: phase }, args), {
    wide: false,
  });
}

/**
 * Mark a simulated task failure injection.
 *
 * @param {any} df
 * @param {number} [taskIndex]
 * @returns {any}
 */
export function injectFailure(df, taskIndex) {
  return withOp(df, "fail", "injectFail(task=" + (taskIndex || 0) + ")", {
    taskIndex: taskIndex || 0,
  });
}


/**
 * Linear regression Estimator: fit on feature col, predict target.
 *
 * @param {any} df
 * @param {string} featureCol
 * @param {string} targetCol
 * @returns {any}
 */
export function mlLinreg(df, featureCol, targetCol) {
  return withOp(df, "mlLinreg", "ml:linreg(" + featureCol + " -> " + targetCol + ")", {
    featureCol: featureCol,
    targetCol: targetCol,
    stage: "fit",
  }, { wide: true });
}

/**
 * Apply a fitted linear model (Model.transform).
 *
 * @param {any} df
 * @param {string} featureCol
 * @param {number} w
 * @param {number} b
 * @returns {any}
 */
export function mlPredictLinreg(df, featureCol, w, b) {
  return withOp(df, "mlPredict", "ml:predict(" + featureCol + ")", {
    featureCol: featureCol,
    w: w,
    b: b,
    stage: "predict",
  });
}
