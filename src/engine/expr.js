/**
 * Mini expression language for filter / withColumn.
 *
 * Supports comparisons, && / ||, and + - * / on column refs and literals.
 */

/**
 * Evaluate a mini expression against a row.
 *
 * @param {string} expr
 * @param {Record<string, unknown>} row
 * @returns {unknown}
 */
export function evalExpr(expr, row) {
  const src = String(expr).trim();
  if (!src) throw new Error('empty expression');

  const orParts = src.split('||').map(function (s) { return s.trim(); });
  if (orParts.length > 1) {
    return orParts.some(function (p) { return Boolean(evalExpr(p, row)); });
  }
  const andParts = src.split('&&').map(function (s) { return s.trim(); });
  if (andParts.length > 1) {
    return andParts.every(function (p) { return Boolean(evalExpr(p, row)); });
  }

  const cmp = src.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (cmp) {
    const left = evalValue(cmp[1].trim(), row);
    const op = cmp[2];
    const right = evalValue(cmp[3].trim(), row);
    if (op === '==') return looseEq(left, right);
    if (op === '!=') return !looseEq(left, right);
    if (op === '>') return Number(left) > Number(right);
    if (op === '>=') return Number(left) >= Number(right);
    if (op === '<') return Number(left) < Number(right);
    if (op === '<=') return Number(left) <= Number(right);
    throw new Error('bad operator ' + op);
  }

  return evalValue(src, row);
}

/**
 * Loose equality with numeric coercion.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function looseEq(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}

/**
 * Evaluate an arithmetic / literal / column value expression.
 *
 * @param {string} expr
 * @param {Record<string, unknown>} row
 * @returns {unknown}
 */
function evalValue(expr, row) {
  const src = String(expr).trim().replace(/^["']|["']$/g, '');
  const add = splitOps(src, ['+', '-']);
  if (add) {
    let acc = Number(evalValue(add.left, row));
    for (let i = 0; i < add.ops.length; i += 1) {
      const v = Number(evalValue(add.values[i], row));
      acc = add.ops[i] === '+' ? acc + v : acc - v;
    }
    return acc;
  }
  const mul = splitOps(src, ['*', '/']);
  if (mul) {
    let acc = Number(evalValue(mul.left, row));
    for (let i = 0; i < mul.ops.length; i += 1) {
      const v = Number(evalValue(mul.values[i], row));
      acc = mul.ops[i] === '*' ? acc * v : acc / v;
    }
    return acc;
  }
  if (/^-?\d+(\.\d+)?$/.test(src)) return Number(src);
  if (Object.prototype.hasOwnProperty.call(row, src)) return row[src];
  return src;
}

/**
 * Split an expression on binary operators (unary minus allowed at start).
 *
 * @param {string} src
 * @param {string[]} ops
 * @returns {{ left: string, ops: string[], values: string[] } | null}
 */
function splitOps(src, ops) {
  const parts = [];
  const found = [];
  let buf = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : '';
    const isOp = ops.indexOf(ch) !== -1;
    const unary = ch === '-' && (i === 0 || ops.indexOf(prev) !== -1);
    if (isOp && !unary && prev !== 'e' && prev !== 'E') {
      parts.push(buf.trim());
      found.push(ch);
      buf = '';
    } else {
      buf += ch;
    }
  }
  parts.push(buf.trim());
  if (found.length === 0) return null;
  return {
    left: parts[0],
    ops: found,
    values: parts.slice(1),
  };
}

/**
 * Compare two cell values for sorting.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
export function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
