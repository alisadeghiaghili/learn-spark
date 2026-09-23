/**
 * Operators and plan helpers for the learnSpark row engine.
 *
 * Teaching simulator of Spark's execution model — not a Spark port.
 */

import { getDataset } from './datasets.js';

let idSeq = 0;

/**
 * Generate a stable node/frame id.
 *
 * @param {string} prefix
 * @returns {string}
 */
function nextId(prefix) {
  idSeq += 1;
  return prefix + '-' + idSeq;
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
 * @param {{ partitions?: number }} [opts]
 * @returns {any}
 */
export function createSource(table, opts = {}) {
  const ds = getDataset(table);
  const partitions = opts.partitions != null ? opts.partitions : 2;
  const plan = {
    id: nextId('op'),
    op: 'source',
    label: 'table(' + ds.name + ')',
    args: { table: ds.name, partitions: partitions },
    parent: null,
    wide: false,
  };
  return {
    id: nextId('df'),
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
    id: nextId('op'),
    op: op,
    label: label,
    args: args,
    parent: clonePlan(df.plan),
    wide: Boolean(opts.wide),
  };
  return {
    id: nextId('df'),
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
 * Build a filter frame.
 *
 * @param {any} df
 * @param {string} expr
 * @returns {any}
 */
export function filter(df, expr) {
  return withOp(df, 'filter', 'filter(' + expr + ')', { expr: expr });
}

/**
 * Build a projection frame.
 *
 * @param {any} df
 * @param {string[]} cols
 * @returns {any}
 */
export function select(df, cols) {
  return withOp(df, 'select', 'select(' + cols.join(', ') + ')', { cols: cols });
}

/**
 * Build a withColumn frame.
 *
 * @param {any} df
 * @param {string} name
 * @param {string} expr
 * @returns {any}
 */
export function withColumn(df, name, expr) {
  return withOp(df, 'withColumn', 'withColumn(' + name + ', ' + expr + ')', { name: name, expr: expr });
}

/**
 * Build a sort frame.
 *
 * @param {any} df
 * @param {string} col
 * @param {boolean} desc
 * @returns {any}
 */
export function sort(df, col, desc = false) {
  return withOp(df, 'sort', 'sort(' + col + (desc ? ' desc' : '') + ')', { col: col, desc: desc });
}

/**
 * Build a limit frame.
 *
 * @param {any} df
 * @param {number} n
 * @returns {any}
 */
export function limit(df, n) {
  return withOp(df, 'limit', 'limit(' + n + ')', { n: n });
}

/**
 * Build a groupBy aggregate frame (wide).
 *
 * @param {any} df
 * @param {string[]} keys
 * @param {string} fn
 * @param {string|null} col
 * @returns {any}
 */
export function groupBy(df, keys, fn, col) {
  return withOp(
    df,
    'groupBy',
    'groupBy(' + keys.join(', ') + ') ' + fn + '(' + (col || '*') + ')',
    { keys: keys, fn: fn, col: col },
    { wide: true }
  );
}

/**
 * Build a join frame against another table (wide).
 *
 * @param {any} df
 * @param {string} table
 * @param {string} on
 * @returns {any}
 */
export function join(df, table, on) {
  const right = getDataset(table);
  return withOp(
    df,
    'join',
    'join(' + table + ' on ' + on + ')',
    { table: table, on: on, rightRows: right.rows.map(function (r) { return Object.assign({}, r); }) },
    { wide: true }
  );
}

/**
 * Build a repartition frame (wide).
 *
 * @param {any} df
 * @param {number} n
 * @returns {any}
 */
export function repartition(df, n) {
  return withOp(df, 'repartition', 'repartition(' + n + ')', { n: n }, { wide: true });
}

/**
 * Build a coalesce frame.
 *
 * @param {any} df
 * @param {number} n
 * @returns {any}
 */
export function coalesce(df, n) {
  return withOp(df, 'coalesce', 'coalesce(' + n + ')', { n: n });
}

/**
 * Mark a frame as cached.
 *
 * @param {any} df
 * @returns {any}
 */
export function cacheFrame(df) {
  return Object.assign({}, df, {
    id: nextId('df'),
    plan: clonePlan(df.plan),
    cached: true,
    cacheKey: df.id,
  });
}

/**
 * Drop cache flags from a frame.
 *
 * @param {any} df
 * @returns {any}
 */
export function unpersistFrame(df) {
  return Object.assign({}, df, {
    id: nextId('df'),
    plan: clonePlan(df.plan),
    cached: false,
    cacheKey: null,
  });
}

export { nextId, clonePlan };
