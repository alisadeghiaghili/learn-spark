/**
 * Distinct join algorithms with honest cost / memory behavior.
 *
 *  broadcast      — hash table on small side, probe large (no large-side shuffle)
 *  sort-merge     — co-partition, sort both runs (spill-aware), merge
 *  shuffled-hash  — co-partition, build hash per partition, probe
 */

import { hashAggWithSpill, rowBytes, sortWithSpill, budgetBytes } from "./memory.js";
import { coPartition } from "./partitions.js";
import { compareValues } from "./expr.js";

/**
 * @param {Array} left
 * @param {Array} right
 * @param {string} on
 * @param {string} joinType
 * @param {string} strategy
 * @param {number} parts
 * @param {number} executorMb
 * @returns {{ rows: Array, algorithm: string, shuffleBytes: number, buildBytes: number, spillFiles: number, spilledBytes: number, sorted: boolean, probed: number }}
 */
export function joinWith(left, right, on, joinType, strategy, parts, executorMb) {
  const budget = budgetBytes(executorMb);
  const type = joinType || "inner";

  // resolve key getter for right side (users.id vs sales.user_id)
  function rkey(r) {
    if (r[on] != null) return r[on];
    if (r.user_id != null) return r.user_id;
    return r.id;
  }
  function lkey(l) {
    return l[on] != null ? l[on] : l.id;
  }

  if (strategy === "broadcast") {
    return broadcastJoin(left, right, lkey, rkey, type, budget);
  }
  if (strategy === "sort-merge") {
    return sortMergeJoin(left, right, lkey, rkey, type, parts, budget);
  }
  if (strategy === "shuffled-hash") {
    return shuffledHashJoin(left, right, lkey, rkey, type, parts, budget);
  }
  // auto: broadcast if right fits in 60% of budget, else sort-merge
  let rightBytes = 0;
  for (let i = 0; i < right.length; i += 1) rightBytes += rowBytes(right[i]);
  if (rightBytes <= budget * 0.6) {
    return broadcastJoin(left, right, lkey, rkey, type, budget);
  }
  return sortMergeJoin(left, right, lkey, rkey, type, parts, budget);
}

/**
 * Build-side hash table + probe. Large side is never shuffled.
 *
 * @returns {any}
 */
function broadcastJoin(left, right, lkey, rkey, type, budget) {
  const build = new Map();
  let buildBytes = 0;
  for (let i = 0; i < right.length; i += 1) {
    const k = String(rkey(right[i]));
    if (!build.has(k)) build.set(k, []);
    build.get(k).push(right[i]);
    buildBytes += rowBytes(right[i]);
  }
  const spillFiles = buildBytes > budget ? 1 : 0;
  const spilledBytes = buildBytes > budget ? Math.floor(buildBytes * 0.2) : 0;

  const rows = [];
  const matched = new Set();
  let probed = 0;
  for (let i = 0; i < left.length; i += 1) {
    probed += 1;
    const l = left[i];
    const k = String(lkey(l));
    const hits = build.get(k) || [];
    if (!hits.length) {
      if (type === "left" || type === "full") rows.push(pad(l, right));
      continue;
    }
    for (let j = 0; j < hits.length; j += 1) {
      matched.add(hits[j]);
      rows.push(Object.assign({}, hits[j], l));
    }
  }
  if (type === "right" || type === "full") {
    for (let i = 0; i < right.length; i += 1) {
      if (!matched.has(right[i])) rows.push(Object.assign({}, pad(right[i], left), right[i]));
    }
  }
  return {
    rows: rows,
    algorithm: "BroadcastHashJoin",
    shuffleBytes: 0,
    buildBytes: buildBytes,
    spillFiles: spillFiles,
    spilledBytes: spilledBytes,
    sorted: false,
    probed: probed,
  };
}

/**
 * Co-partition, external sort both sides, linear merge.
 *
 * @returns {any}
 */
function sortMergeJoin(left, right, lkey, rkey, type, parts, budget) {
  const cp = coPartition(
    left.map(function (l) { return Object.assign({}, l, { __k: lkey(l) }); }),
    right.map(function (r) { return Object.assign({}, r, { __k: rkey(r) }); }),
    "__k",
    parts
  );
  let shuffleBytes = 0;
  let spillFiles = 0;
  let spilledBytes = 0;
  let sorted = false;
  const rows = [];
  let probed = 0;
  const matched = new Set();

  for (let p = 0; p < cp.left.length; p += 1) {
    const L = cp.left[p];
    const R = cp.right[p];
    for (let i = 0; i < L.length; i += 1) shuffleBytes += rowBytes(L[i]);
    for (let i = 0; i < R.length; i += 1) shuffleBytes += rowBytes(R[i]);

    function cmp(a, b) {
      return compareValues(a.__k, b.__k);
    }
    const sl = sortWithSpill(L, cmp, budget / 2);
    const sr = sortWithSpill(R, cmp, budget / 2);
    spillFiles += sl.spillFiles + sr.spillFiles;
    spilledBytes += sl.spilledBytes + sr.spilledBytes;
    sorted = true;

    let i = 0;
    let j = 0;
    while (i < sl.rows.length || j < sr.rows.length) {
      if (i >= sl.rows.length) {
        if (type === "right" || type === "full") rows.push(strip(pad(sr.rows[j], left)));
        j += 1;
        continue;
      }
      if (j >= sr.rows.length) {
        if (type === "left" || type === "full") rows.push(strip(pad(sl.rows[i], right)));
        i += 1;
        continue;
      }
      const c = compareValues(sl.rows[i].__k, sr.rows[j].__k);
      if (c < 0) {
        if (type === "left" || type === "full") rows.push(strip(pad(sl.rows[i], right)));
        i += 1;
      } else if (c > 0) {
        if (type === "right" || type === "full") rows.push(strip(pad(sr.rows[j], left)));
        j += 1;
      } else {
        // equal key run
        const k = sl.rows[i].__k;
        const lrun = [];
        const rrun = [];
        while (i < sl.rows.length && compareValues(sl.rows[i].__k, k) === 0) {
          lrun.push(sl.rows[i]);
          i += 1;
        }
        while (j < sr.rows.length && compareValues(sr.rows[j].__k, k) === 0) {
          rrun.push(sr.rows[j]);
          j += 1;
        }
        for (let a = 0; a < lrun.length; a += 1) {
          probed += 1;
          for (let b = 0; b < rrun.length; b += 1) {
            matched.add(rrun[b]);
            rows.push(strip(Object.assign({}, rrun[b], lrun[a])));
          }
          if (!rrun.length && (type === "left" || type === "full")) {
            rows.push(strip(pad(lrun[a], right)));
          }
        }
        for (let b = 0; b < rrun.length; b += 1) {
          if (!lrun.length && (type === "right" || type === "full")) {
            rows.push(strip(pad(rrun[b], left)));
          }
        }
      }
    }
  }
  return {
    rows: rows,
    algorithm: "SortMergeJoin",
    shuffleBytes: shuffleBytes,
    buildBytes: 0,
    spillFiles: spillFiles,
    spilledBytes: spilledBytes,
    sorted: sorted,
    probed: probed,
  };
}

/**
 * Co-partition then per-partition hash join (build side = right).
 *
 * @returns {any}
 */
function shuffledHashJoin(left, right, lkey, rkey, type, parts, budget) {
  const cp = coPartition(
    left.map(function (l) { return Object.assign({}, l, { __k: lkey(l) }); }),
    right.map(function (r) { return Object.assign({}, r, { __k: rkey(r) }); }),
    "__k",
    parts
  );
  let shuffleBytes = 0;
  const rows = [];
  let probed = 0;
  let buildBytes = 0;
  let spillFiles = 0;
  let spilledBytes = 0;
  const matched = new Set();

  for (let p = 0; p < cp.left.length; p += 1) {
    const L = cp.left[p];
    const R = cp.right[p];
    for (let i = 0; i < L.length; i += 1) shuffleBytes += rowBytes(L[i]);
    for (let i = 0; i < R.length; i += 1) shuffleBytes += rowBytes(R[i]);

    // build hash on right partition with spill if over budget
    const agg = hashAggWithSpill(R, function (r) { return String(r.__k); }, budget / 2);
    spillFiles += agg.spillFiles;
    spilledBytes += agg.spilledBytes;
    buildBytes += agg.peakBytes;
    const build = agg.groups;

    for (let i = 0; i < L.length; i += 1) {
      probed += 1;
      const l = L[i];
      const hits = build.get(String(l.__k)) || [];
      if (!hits.length) {
        if (type === "left" || type === "full") rows.push(strip(pad(l, right)));
        continue;
      }
      for (let j = 0; j < hits.length; j += 1) {
        matched.add(hits[j]);
        rows.push(strip(Object.assign({}, hits[j], l)));
      }
    }
    if (type === "right" || type === "full") {
      const keys = Array.from(build.keys());
      for (let k = 0; k < keys.length; k += 1) {
        const bucket = build.get(keys[k]);
        for (let b = 0; b < bucket.length; b += 1) {
          if (!matched.has(bucket[b])) rows.push(strip(pad(bucket[b], left)));
        }
      }
    }
  }
  return {
    rows: rows,
    algorithm: "ShuffledHashJoin",
    shuffleBytes: shuffleBytes,
    buildBytes: buildBytes,
    spillFiles: spillFiles,
    spilledBytes: spilledBytes,
    sorted: false,
    probed: probed,
  };
}

/**
 * @param {any} row
 * @param {Array} other
 * @returns {any}
 */
function pad(row, other) {
  const out = Object.assign({}, row);
  const cols = other.length ? Object.keys(other[0]) : [];
  for (let i = 0; i < cols.length; i += 1) {
    const c = cols[i];
    if (c.indexOf("__") === 0) continue;
    if (!(c in out)) out[c] = null;
  }
  return out;
}

/**
 * @param {any} row
 * @returns {any}
 */
function strip(row) {
  const out = Object.assign({}, row);
  delete out.__k;
  return out;
}
