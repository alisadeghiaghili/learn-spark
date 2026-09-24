/**
 * Honest memory accounting: row size, sort buffers, spill files.
 *
 * Budget is settings.executorMb * 1MiB. No magic multipliers.
 */

/**
 * Approximate on-heap row size in bytes (Tungsten-like layout estimate).
 *
 * @param {Record<string, unknown>} row
 * @returns {number}
 */
export function rowBytes(row) {
  let n = 16; // object header + null bitset baseline
  const keys = Object.keys(row);
  n += keys.length; // null bits packed roughly
  for (let i = 0; i < keys.length; i += 1) {
    const v = row[keys[i]];
    n += 8; // field slot
    if (v == null) continue;
    if (typeof v === "number") n += 8;
    else if (typeof v === "boolean") n += 1;
    else if (Array.isArray(v)) {
      n += 16 + v.length * 8;
      for (let j = 0; j < v.length; j += 1) n += primitiveBytes(v[j]);
    } else if (typeof v === "object") {
      n += 24 + rowBytes(v);
    } else {
      n += primitiveBytes(v);
    }
  }
  return n;
}

/**
 * @param {unknown} v
 * @returns {number}
 */
function primitiveBytes(v) {
  if (typeof v === "number") return 8;
  if (typeof v === "boolean") return 1;
  return 16 + String(v).length * 2;
}

/**
 * Bag of rows with live byte size.
 *
 * @param {Array} rows
 * @returns {{ rows: Array, bytes: number }}
 */
export function measure(rows) {
  let bytes = 0;
  for (let i = 0; i < rows.length; i += 1) bytes += rowBytes(rows[i]);
  return { rows: rows, bytes: bytes };
}

/**
 * External-sort style buffer: fill, spill runs, merge.
 * Returns sorted rows + spill stats.
 *
 * @param {Array} rows
 * @param {(a: any, b: any) => number} cmp
 * @param {number} budgetBytes
 * @returns {{ rows: Array, spillFiles: number, spilledBytes: number, peakBytes: number }}
 */
export function sortWithSpill(rows, cmp, budgetBytes) {
  const budget = Math.max(256, budgetBytes);
  /** @type {Array[]} */
  const runs = [];
  let buf = [];
  let bufBytes = 0;
  let peak = 0;
  let spilledBytes = 0;
  let spillFiles = 0;

  function flush() {
    if (!buf.length) return;
    buf.sort(cmp);
    runs.push(buf);
    spillFiles += 1;
    spilledBytes += bufBytes;
    buf = [];
    bufBytes = 0;
  }

  for (let i = 0; i < rows.length; i += 1) {
    const b = rowBytes(rows[i]);
    buf.push(rows[i]);
    bufBytes += b;
    peak = Math.max(peak, bufBytes);
    if (bufBytes >= budget) flush();
  }
  if (buf.length) {
    buf.sort(cmp);
    // keep last run in memory if it is the only one and fits
    if (!runs.length && bufBytes < budget) {
      return { rows: buf, spillFiles: 0, spilledBytes: 0, peakBytes: peak };
    }
    if (!runs.length) {
      return { rows: buf, spillFiles: 0, spilledBytes: 0, peakBytes: peak };
    }
    runs.push(buf);
    spillFiles += 1;
    spilledBytes += bufBytes;
    buf = [];
    bufBytes = 0;
  }

  // k-way merge
  const merged = mergeRuns(runs, cmp);
  return { rows: merged, spillFiles: spillFiles, spilledBytes: spilledBytes, peakBytes: peak };
}

/**
 * @param {Array[]} runs
 * @param {(a: any, b: any) => number} cmp
 * @returns {Array}
 */
function mergeRuns(runs, cmp) {
  const idx = runs.map(function () { return 0; });
  const out = [];
  for (;;) {
    let bestRun = -1;
    let bestRow = null;
    for (let r = 0; r < runs.length; r += 1) {
      if (idx[r] >= runs[r].length) continue;
      const row = runs[r][idx[r]];
      if (bestRun < 0 || cmp(row, bestRow) < 0) {
        bestRun = r;
        bestRow = row;
      }
    }
    if (bestRun < 0) break;
    out.push(bestRow);
    idx[bestRun] += 1;
  }
  return out;
}

/**
 * Hash aggregate with optional spill of the hash map to disk when over budget.
 *
 * @param {Array} rows
 * @param {string[]} keyFn
 * @param {number} budgetBytes
 * @returns {{ groups: Map<any, Array>, spillFiles: number, spilledBytes: number, peakBytes: number }}
 */
export function hashAggWithSpill(rows, keyFn, budgetBytes) {
  const budget = Math.max(256, budgetBytes);
  /** @type {Map<any, Array>} */
  let groups = new Map();
  let used = 0;
  let peak = 0;
  let spillFiles = 0;
  let spilledBytes = 0;
  /** @type {Map<any, Array>[]} */
  const spilled = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const k = keyFn(row);
    const b = rowBytes(row);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
    used += b;
    peak = Math.max(peak, used);
    if (used >= budget) {
      // spill half the map (largest groups) to a run
      const entries = Array.from(groups.entries()).sort(function (a, b) {
        return b[1].length - a[1].length;
      });
      const keep = new Map();
      const dump = new Map();
      let dumped = 0;
      for (let e = 0; e < entries.length; e += 1) {
        if (dumped < used / 2 && e < entries.length - 1) {
          dump.set(entries[e][0], entries[e][1]);
          for (let r = 0; r < entries[e][1].length; r += 1) dumped += rowBytes(entries[e][1][r]);
        } else {
          keep.set(entries[e][0], entries[e][1]);
        }
      }
      spilled.push(dump);
      spillFiles += 1;
      spilledBytes += dumped;
      used -= dumped;
      groups = keep;
    }
  }

  // merge spilled maps back (same keys combine)
  for (let s = 0; s < spilled.length; s += 1) {
    const entries = Array.from(spilled[s].entries());
    for (let e = 0; e < entries.length; e += 1) {
      const k = entries[e][0];
      if (!groups.has(k)) groups.set(k, []);
      const arr = groups.get(k);
      for (let r = 0; r < entries[e][1].length; r += 1) arr.push(entries[e][1][r]);
    }
  }

  return { groups: groups, spillFiles: spillFiles, spilledBytes: spilledBytes, peakBytes: peak };
}

/**
 * Executor memory budget in bytes.
 *
 * @param {number} executorMb
 * @returns {number}
 */
export function budgetBytes(executorMb) {
  return Math.max(256, Math.floor(executorMb * 1024 * 1024));
}
