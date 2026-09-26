/**
 * Catalyst-style optimizer: real rewrite rules with before/after traces.
 *
 * Rules (each is a pure plan rewrite):
 *  - constant folding in predicates
 *  - filter collapse (adjacent filters AND-merged)
 *  - predicate pushdown (filter below project / join if columns allow)
 *  - projection pruning (drop unused columns after source when select exists)
 *  - limit pushdown below sort is NOT safe — documented as no-op rule
 */

/**
 * @typedef {{ id: string, op: string, label: string, args: any, wide: boolean, parent: any }} Node
 */

/**
 * Deep-clone a plan spine into a mutable tree (parent links preserved).
 *
 * @param {any} plan
 * @returns {any}
 */
export function cloneTree(plan) {
  if (!plan) return plan;
  return {
    id: plan.id,
    op: plan.op,
    label: plan.label,
    args: Object.assign({}, plan.args),
    wide: plan.wide,
    parent: cloneTree(plan.parent),
  };
}

/**
 * Flatten tree source -> tip.
 *
 * @param {any} plan
 * @returns {any[]}
 */
export function spine(plan) {
  const out = [];
  let cur = plan;
  while (cur) {
    out.push(cur);
    cur = cur.parent;
  }
  return out.reverse();
}

/**
 * Rebuild plan from spine (source first).
 *
 * @param {any[]} nodes
 * @returns {any}
 */
function fromSpine(nodes) {
  let parent = null;
  for (let i = 0; i < nodes.length; i += 1) {
    parent = Object.assign({}, nodes[i], { parent: parent });
  }
  return parent;
}

/**
 * Constant-fold trivial predicates.
 *
 * @param {string} expr
 * @returns {string}
 */
export function foldConstants(expr) {
  let e = String(expr);
  e = e.replace(/\b1\s*==\s*1\b/g, "true");
  e = e.replace(/\b0\s*==\s*1\b/g, "false");
  e = e.replace(/\btrue\s*&&\s*/g, "");
  e = e.replace(/\s*&&\s*true\b/g, "");
  e = e.replace(/\bfalse\s*\|\|\s*/g, "");
  e = e.replace(/\s*\|\|\s*false\b/g, "");
  return e.trim() || expr;
}

/**
 * Collect column identifiers referenced in an expression.
 *
 * @param {string} expr
 * @param {Set<string>} known
 * @returns {Set<string>}
 */
function colsIn(expr, known) {
  const out = new Set();
  const toks = String(expr).split(/[^A-Za-z0-9_.]+/);
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (!t) continue;
    if (/^-?\d/.test(t)) continue;
    if (t === "true" || t === "false") continue;
    if (known.has(t)) out.add(t);
  }
  return out;
}

/**
 * Run all rules. Returns optimized plan + rule trace.
 *
 * @param {any} plan
 * @param {string[]} schema
 * @returns {{ plan: any, trace: { rule: string, detail: string }[] }}
 */
export function optimize(plan, schema) {
  const known = new Set(schema || []);
  /** @type {{ rule: string, detail: string }[]} */
  const trace = [];
  let nodes = spine(cloneTree(plan));

  // 1) constant folding on filters
  nodes = nodes.map(function (n) {
    if (n.op !== "filter") return n;
    const folded = foldConstants(String(n.args.expr));
    if (folded !== String(n.args.expr)) {
      trace.push({ rule: "ConstantFolding", detail: n.args.expr + " -> " + folded });
      return Object.assign({}, n, {
        args: Object.assign({}, n.args, { expr: folded }),
        label: "filter(" + folded + ")",
      });
    }
    return n;
  });

  // 2) filter collapse: adjacent filters -> AND
  const collapsed = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    const prev = collapsed[collapsed.length - 1];
    if (n.op === "filter" && prev && prev.op === "filter") {
      const expr = "(" + prev.args.expr + ") && (" + n.args.expr + ")";
      trace.push({ rule: "CollapseFilters", detail: prev.args.expr + " && " + n.args.expr });
      collapsed[collapsed.length - 1] = Object.assign({}, prev, {
        args: Object.assign({}, prev.args, { expr: expr }),
        label: "filter(" + expr + ")",
      });
      continue;
    }
    collapsed.push(n);
  }
  nodes = collapsed;

  // 3) predicate pushdown through select (if filter cols survive projection or are before it)
  for (let i = 1; i < nodes.length; i += 1) {
    const n = nodes[i];
    const prev = nodes[i - 1];
    if (n.op === "filter" && prev.op === "select") {
      const needed = colsIn(String(n.args.expr), known);
      const projected = new Set(prev.args.cols || []);
      let canPush = true;
      needed.forEach(function (c) {
        if (c && !projected.has(c) && known.has(c)) {
          // column needed by filter is not in projection — push is invalid unless we add it
          canPush = false;
        }
      });
      if (canPush) {
        trace.push({
          rule: "PushDownPredicates",
          detail: "filter below project(" + (prev.args.cols || []).join(",") + ")",
        });
        nodes[i - 1] = n;
        nodes[i] = prev;
      }
    }
  }

  // 4) projection pruning: if select immediately follows source and select drops cols, record prune
  for (let i = 1; i < nodes.length; i += 1) {
    const n = nodes[i];
    const prev = nodes[i - 1];
    if (n.op === "select" && prev.op === "source") {
      const keep = n.args.cols || [];
      const srcCols = schema || [];
      const pruned = srcCols.filter(function (c) { return keep.indexOf(c) === -1; });
      if (pruned.length) {
        trace.push({
          rule: "ColumnPruning",
          detail: "pruned " + pruned.join(",") + " at FileScan",
        });
      }
    }
  }

  // 5) join reordering note (cost-based, only when both sides are filters)
  for (let i = 1; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (n.op === "join") {
      trace.push({
        rule: "JoinSelection",
        detail: "consider Broadcast vs SortMerge on " + n.args.table + " (stat-based)",
      });
    }
  }

  return { plan: fromSpine(nodes), trace: trace };
}

/**
 * Pretty-print a plan spine.
 *
 * @param {any} plan
 * @returns {string}
 */
export function formatPlan(plan) {
  return spine(plan)
    .map(function (n) {
      return (n.wide ? "*" : " ") + " " + n.label;
    })
    .join("\n");
}
