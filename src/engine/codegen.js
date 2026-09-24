/**
 * Whole-stage codegen fusion model (honest cost, not a label).
 *
 * Native operators fuse into one loop. UDFs / non-codegen ops split the loop.
 * Cost ≈ fused segments * setup + per-row * rows + boundary tax per split.
 */

const NATIVE = {
  source: 1,
  filter: 1,
  select: 1,
  withColumn: 1,
  drop: 1,
  sort: 0.5,
  limit: 1,
  groupBy: 0.8,
  window: 0.4,
  cube: 0.4,
  join: 0.3,
  repartition: 0,
  coalesce: 0,
  distinct: 0.5,
  sample: 1,
  salt: 1,
  explode: 1,
  mapExplode: 1,
  getField: 1,
  approx_count_distinct: 0.3,
  cache: 0,
  stream: 0,
  fail: 0,
  ml: 0.2,
  mlLinreg: 0.2,
  mlPredict: 1,
};

/**
 * @param {any[]} spine
 * @param {string} udfMode
 * @returns {{ segments: any[][], splits: number, generated: string, cost: number, unfusedOps: string[] }}
 */
export function analyzeCodegen(spine, udfMode) {
  /** @type {any[][]} */
  const segments = [];
  let cur = [];
  const unfusedOps = [];
  const generated = [];

  function pushOp(node, fuse) {
    if (!fuse) {
      if (cur.length) segments.push(cur);
      cur = [];
      segments.push([node]);
      unfusedOps.push(node.op);
      generated.push("// boundary: " + node.label + " (no codegen)");
      generated.push("for (row in partition) {");
      generated.push("  out = " + node.label + "(row); // black box");
      generated.push("}");
      return;
    }
    cur.push(node);
    generated.push("// fuse " + node.label);
    generated.push("out = " + node.label + "(out);");
  }

  for (let i = 0; i < spine.length; i += 1) {
    const n = spine[i];
    if (n.op === "udf") {
      const mode = udfMode || "jvm";
      if (mode === "native") {
        pushOp(n, true);
      } else if (mode === "pandas") {
        pushOp(n, false);
      } else if (mode === "python") {
        pushOp(n, false);
        generated.push("// pickle -> python worker -> unpickle");
      } else {
        pushOp(n, false);
      }
      continue;
    }
    const fuse = (NATIVEScore(n.op));
    pushOp(n, fuse);
  }
  if (cur.length) segments.push(cur);

  const splits = Math.max(0, segments.length - 1);
  let cost = segments.length * 2; // loop setup per fused segment
  cost += splits * 15; // boundary tax
  for (let i = 0; i < spine.length; i += 1) {
    cost += (1 - (NATIVEScore(spine[i].op) || 0)) * 8;
  }
  if (udfMode === "python") cost += 40;
  else if (udfMode === "jvm") cost += 18;
  else if (udfMode === "pandas") cost += 6;

  return {
    segments: segments,
    splits: splits,
    generated: generated.join("\n"),
    cost: cost,
    unfusedOps: unfusedOps,
  };
}

/**
 * @param {string} op
 * @returns {number}
 */
function NATIVEScore(op) {
  return NATIVE[op] != null ? NATIVE[op] : 0.5;
}
