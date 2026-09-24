/**
 * Hash partitioner + distribution stats (for skew honesty).
 */

/**
 * Stable 32-bit hash of a key.
 *
 * @param {unknown} key
 * @returns {number}
 */
export function hash32(key) {
  const s = String(key);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Partition id for a key.
 *
 * @param {unknown} key
 * @param {number} parts
 * @returns {number}
 */
export function partitionOf(key, parts) {
  const n = Math.max(1, parts | 0);
  return hash32(key) % n;
}

/**
 * Place rows into hash partitions on a key column (or round-robin if no key).
 *
 * @param {Array} rows
 * @param {number} parts
 * @param {string|null} keyCol
 * @returns {{ buckets: Array[], distribution: number[], skewRatio: number }}
 */
export function place(rows, parts, keyCol) {
  const n = Math.max(1, parts | 0);
  const buckets = [];
  for (let i = 0; i < n; i += 1) buckets.push([]);
  for (let i = 0; i < rows.length; i += 1) {
    const p = keyCol ? partitionOf(rows[i][keyCol], n) : i % n;
    buckets[p].push(rows[i]);
  }
  const distribution = buckets.map(function (b) { return b.length; });
  const max = distribution.reduce(function (a, b) { return Math.max(a, b); }, 0);
  const avg = rows.length / n || 1;
  return { buckets: buckets, distribution: distribution, skewRatio: Math.round((max / avg) * 100) / 100 };
}

/**
 * Hash-partition two sides on the join key for SMJ / SHJ.
 *
 * @param {Array} left
 * @param {Array} right
 * @param {string} on
 * @param {number} parts
 * @returns {{ left: Array[], right: Array[] }}
 */
export function coPartition(left, right, on, parts) {
  const n = Math.max(1, parts | 0);
  const L = [];
  const R = [];
  for (let i = 0; i < n; i += 1) {
    L.push([]);
    R.push([]);
  }
  for (let i = 0; i < left.length; i += 1) {
    const p = partitionOf(left[i][on] != null ? left[i][on] : left[i].id, n);
    L[p].push(left[i]);
  }
  for (let i = 0; i < right.length; i += 1) {
    const r = right[i];
    const key = r[on] != null ? r[on] : (r.user_id != null ? r.user_id : r.id);
    const p = partitionOf(key, n);
    R[p].push(r);
  }
  return { left: L, right: R };
}
