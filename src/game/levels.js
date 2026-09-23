/**
 * Level sequences, teaching copy, and goal predicates.
 *
 * Goal types:
 *  - command: at least one command whose head matches
 *  - planHas: plan contains an op name
 *  - rows: materialized row count equals value
 *  - columns: result columns include names
 *  - cached: current df is cached
 *  - actionRan: at least N actions executed
 *  - partitions: current partitions equal value
 *  - stages: last run has at least N stages
 */

export const SEQUENCES = [
  {
    id: "intro",
    title: "Intro",
    blurb: "Load tables and look around",
    levels: ["welcome", "filter-tour", "project-cols"],
  },
  {
    id: "lazy",
    title: "Lazy evaluation",
    blurb: "Transformations vs actions",
    levels: ["lazy-build", "explain-stages"],
  },
  {
    id: "actions",
    title: "Actions",
    blurb: "show, count, collect",
    levels: ["first-action", "count-cards"],
  },
  {
    id: "shuffle",
    title: "Shuffle & wide ops",
    blurb: "groupBy, join, partitions",
    levels: ["group-regions", "join-users"],
  },
  {
    id: "optimize",
    title: "Optimize",
    blurb: "cache and partitioning",
    levels: ["cache-it", "tune-parts"],
  },
  {
    id: "advanced",
    title: "Advanced",
    blurb: "SQL and multi-stage plans",
    levels: ["sparksql-tour", "pipeline"],
  },
];

export const LEVELS = {
  welcome: {
    id: "welcome",
    sequence: "intro",
    title: "Welcome to learnSpark",
    difficulty: 1,
    goalText: "Load the sales table and show its rows.",
    intro: [
      "Spark is a distributed data engine. Your code builds a *plan*; a cluster of executors later turns that plan into work on *partitions* of data.",
      "",
      "This sandbox shows three surfaces at once:",
      "  1. the Job DAG (logical plan and stages)",
      "  2. partition buckets (where rows live)",
      "  3. a terminal (commands you would type in a notebook shell)",
      "",
      "Tables here are tiny on purpose so every row is inspectable.",
      "",
      "Your job: load sales, then show it.",
    ].join("\n"),
    learn: [
      "Spark work starts from a named table/source",
      "show is an action that materializes rows",
    ],
    hints: ["load sales", "show"],
    commandsAllowed: 4,
    goals: [
      { type: "command", label: "Run load sales", head: "load" },
      { type: "command", label: "Run show (an action)", head: "show" },
      { type: "rows", label: "See 12 sales rows", value: 12 },
    ],
  },
  "filter-tour": {
    id: "filter-tour",
    sequence: "intro",
    title: "Narrow filter",
    difficulty: 1,
    goalText: "Keep only sales with amount > 100, then show.",
    intro: [
      "filter is a *transformation*. It does not scan data when you type it — it only extends the plan.",
      "Nothing is computed until an action (show, count, collect, write) runs.",
      "",
      "Why this matters: real Spark jobs chain dozens of transforms. If each one executed immediately you would pay cluster cost on every keystroke. Lazy plans let the optimizer fuse narrow ops into one pass.",
      "",
      "Watch the DAG grow a filter node, then force execution with show.",
    ].join("\n"),
    learn: [
      "filter is lazy — plan only",
      "amount > 100 keeps high-value rows",
    ],
    hints: ["load sales", "filter amount > 100", "show"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "Plan contains filter", op: "filter" },
      { type: "command", label: "Materialize with show", head: "show" },
      { type: "rows", label: "Exactly 6 high-value rows", value: 6 },
    ],
  },
  "project-cols": {
    id: "project-cols",
    sequence: "intro",
    title: "Project columns",
    difficulty: 1,
    goalText: "Select region and amount only, then show.",
    intro: [
      "select drops columns early. In Spark this is not cosmetic: every column you keep is bytes shuffled, spilled, and cached.",
      "",
      "Column pruning is one of the cheapest wins before a wide op. Keep the schema narrow as soon as you know what you need.",
    ].join("\n"),
    learn: [
      "select projects a narrow schema",
      "early projection cuts shuffle cost later",
    ],
    hints: ["load sales", "select region, amount", "show"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "Plan contains select", op: "select" },
      { type: "command", label: "Run show", head: "show" },
      { type: "columns", label: "Only region and amount", value: ["region", "amount"] },
    ],
  },
  "lazy-build": {
    id: "lazy-build",
    sequence: "lazy",
    title: "Build a long lazy plan",
    difficulty: 2,
    goalText: "Chain 3+ transformations, then run exactly one action.",
    intro: [
      "Transformations describe *what* to compute. Actions decide *when* to compute.",
      "",
      "Stack filter + select + sort (or limit) and finish with a single show.",
      "While you type transforms, the DAG grows but partitions stay idle. The first action launches stages.",
      "",
      "Mental model: DataFrame = query plan handle, not a local array of rows.",
    ].join("\n"),
    learn: [
      "transforms chain into one logical plan",
      "actions trigger execution and stages",
    ],
    hints: [
      "load sales",
      "filter amount > 50",
      "select region, amount",
      "sort amount desc",
      "show",
    ],
    commandsAllowed: 8,
    goals: [
      { type: "planOpsMin", label: "At least 3 transforms in plan", value: 3 },
      { type: "actionRan", label: "At least one action", value: 1 },
      { type: "command", label: "Finished with an action", head: "show" },
    ],
  },
  "explain-stages": {
    id: "explain-stages",
    sequence: "lazy",
    title: "Read the plan",
    difficulty: 2,
    goalText: "Use explain to inspect plan and stages.",
    intro: [
      "explain prints the logical plan and how it splits into stages.",
      "",
      "Narrow ops (filter, select, map) fuse into the current stage — no network.",
      "Wide ops (groupBy, join, repartition) force a shuffle and start a new stage.",
      "",
      "Read the output as: what Spark *intends* to do, and where the network boundary sits. That boundary is where jobs usually get slow.",
    ].join("\n"),
    learn: [
      "explain shows plan and stage split",
      "wide ops introduce shuffle boundaries",
    ],
    hints: ["load sales", "filter amount > 10", "explain"],
    commandsAllowed: 6,
    goals: [
      { type: "command", label: "Run explain", head: "explain" },
      { type: "planHas", label: "Plan has at least one transform", op: "filter" },
    ],
  },
  "first-action": {
    id: "first-action",
    sequence: "actions",
    title: "Action catalog",
    difficulty: 2,
    goalText: "Run both count and collect on filtered sales.",
    intro: [
      "Actions materialize the plan. Different actions have different costs and side effects:",
      "  count  — returns a number; driver stays light",
      "  collect — ships rows to the driver (dangerous on big data)",
      "  show   — limited collect for debugging",
      "  write  — sinks results (here: simulated)",
      "",
      "Run count and collect on the same filter. Both execute the lineage; collect is the one that moves data to you.",
    ].join("\n"),
    learn: [
      "count vs collect have different costs",
      "collect brings rows to the driver",
    ],
    hints: ["load sales", "filter amount > 100", "count", "collect"],
    commandsAllowed: 7,
    goals: [
      { type: "command", label: "Run count", head: "count" },
      { type: "command", label: "Run collect", head: "collect" },
      { type: "planHas", label: "Filter in plan", op: "filter" },
    ],
  },
  "count-cards": {
    id: "count-cards",
    sequence: "actions",
    title: "Count only",
    difficulty: 1,
    goalText: "Count west-region sales without selecting columns.",
    intro: [
      "Sometimes you only need cardinality. filter region == west then count.",
      "Spark can answer count without building a full result table in the driver — keep actions minimal when the answer is a scalar.",
    ].join("\n"),
    learn: [
      "filter on string equality (region == west)",
      "count is a cheap scalar action",
    ],
    hints: ["load sales", "filter region == west", "count"],
    commandsAllowed: 5,
    goals: [
      { type: "command", label: "Run count", head: "count" },
      { type: "rows", label: "West has 4 sales", value: 4 },
    ],
  },
  "group-regions": {
    id: "group-regions",
    sequence: "shuffle",
    title: "groupBy regions",
    difficulty: 3,
    goalText: "Sum amount by region and show the aggregate.",
    intro: [
      "groupBy is a *wide* transformation. Equal keys must meet on the same executor, so Spark shuffles rows across the network — that is a stage boundary on the DAG.",
      "",
      "What shuffle actually does: map-side partitions are re-partitioned by key hash, written, transferred, and merged on reduce-side. That is why groupBy/join dominate job wall-time.",
      "",
      "groupBy region sum amount should produce one row per region (4 regions in sales).",
    ].join("\n"),
    learn: [
      "groupBy is wide and shuffles by key",
      "sum(amount) per region yields 4 groups",
    ],
    hints: ["load sales", "groupBy region sum amount", "show"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "Plan contains groupBy", op: "groupBy" },
      { type: "stages", label: "Shuffle split stages", value: 2 },
      { type: "rows", label: "4 regions", value: 4 },
    ],
  },
  "join-users": {
    id: "join-users",
    sequence: "shuffle",
    title: "Join users",
    difficulty: 3,
    goalText: "Join sales with users on user_id / id, then show.",
    intro: [
      "Join is wide: both sides shuffle on the key so matching rows land together.",
      "sales.user_id matches users.id. After the join each sales row carries user attributes (name, tier, city).",
      "",
      "Skewed keys make some reducers finish last (stragglers). Small demo data hides this — production jobs do not.",
    ].join("\n"),
    learn: [
      "join shuffles both sides on the key",
      "sales.user_id joins to users.id",
    ],
    hints: ["load sales", "join users on user_id", "show"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "Plan contains join", op: "join" },
      { type: "command", label: "Materialize join", head: "show" },
    ],
  },
  "cache-it": {
    id: "cache-it",
    sequence: "optimize",
    title: "Cache a hot DataFrame",
    difficulty: 3,
    goalText: "Cache a filtered frame and run two actions.",
    intro: [
      "If the same lineage feeds several actions, each action recomputes from the source unless you cache.",
      "cache/persist stores the computed partitions (memory and/or disk) and short-circuits later stages.",
      "",
      "Here cost is simulated: the second action after cache reports a much lower compute cost. In real Spark you see this as fewer stages / missing source scans in the UI.",
      "",
      "Cache is an *intent* to reuse — the first action still pays full compute to fill the cache.",
    ].join("\n"),
    learn: [
      "cache avoids recomputing lineage",
      "first action after cache still fills it",
    ],
    hints: ["load sales", "filter amount > 50", "cache", "show", "count"],
    commandsAllowed: 8,
    goals: [
      { type: "cached", label: "DataFrame is cached", value: true },
      { type: "actionRan", label: "Two actions after cache path", value: 2 },
    ],
  },
  "tune-parts": {
    id: "tune-parts",
    sequence: "optimize",
    title: "Repartition",
    difficulty: 3,
    goalText: "Repartition sales to 4 partitions and show.",
    intro: [
      "Partition count sets parallelism. Too few partitions under-use executors; too many add scheduler overhead and tiny tasks.",
      "",
      "repartition(n) reshuffles all data (wide). coalesce(n) merges partitions without a full shuffle when shrinking.",
      "Watch the partition strip after repartition 4 — rows spread across p0..p3.",
    ].join("\n"),
    learn: [
      "partition count controls parallelism",
      "repartition is wide; coalesce is cheaper to shrink",
    ],
    hints: ["load sales", "repartition 4", "show"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "Plan contains repartition", op: "repartition" },
      { type: "partitions", label: "4 partitions", value: 4 },
    ],
  },
  "sparksql-tour": {
    id: "sparksql-tour",
    sequence: "advanced",
    title: "Spark SQL",
    difficulty: 3,
    goalText: "Run a sparksql SELECT with WHERE.",
    intro: [
      "Spark SQL compiles to the same physical plan as the DataFrame API. SQL is not a separate engine — it is another front-end on Catalyst.",
      "",
      "Example: select region, amount from sales where amount > 100",
      "The WHERE clause becomes a filter node; SELECT becomes projection. Same lazy rules apply until the SQL result is materialized.",
    ].join("\n"),
    learn: [
      "Spark SQL shares the DataFrame plan engine",
      "WHERE maps to filter; SELECT to projection",
    ],
    hints: ["sparksql select region, amount from sales where amount > 100"],
    commandsAllowed: 4,
    goals: [{ type: "command", label: "Run sparksql", head: "sparksql" }],
  },
  pipeline: {
    id: "pipeline",
    sequence: "advanced",
    title: "Full pipeline",
    difficulty: 4,
    goalText: "Filter -> withColumn -> groupBy -> show.",
    intro: [
      "A realistic job mixes narrow and wide ops:",
      "  filter / withColumn — narrow, fuse into one stage",
      "  groupBy — wide, starts the next stage after shuffle",
      "",
      "withColumn tipped amount * 1.1 derives a column without leaving the stage.",
      "Then groupBy region sum tipped aggregates after the shuffle boundary.",
      "",
      "Read the DAG left-to-right: source → filter → withColumn || shuffle || groupBy → show.",
    ].join("\n"),
    learn: [
      "withColumn derives columns without shuffle",
      "mixed narrow+wide pipelines split stages",
    ],
    hints: [
      "load sales",
      "filter amount > 20",
      "withColumn tipped amount * 1.1",
      "groupBy region sum tipped",
      "show",
    ],
    commandsAllowed: 10,
    goals: [
      { type: "planHas", label: "withColumn present", op: "withColumn" },
      { type: "planHas", label: "groupBy present", op: "groupBy" },
      { type: "command", label: "show", head: "show" },
      { type: "rows", label: "Aggregated regions", value: 4 },
    ],
  },
};

/**
 * Flatten levels in sequence order.
 *
 * @returns {any[]}
 */
export function allLevels() {
  const out = [];
  for (let i = 0; i < SEQUENCES.length; i += 1) {
    const seq = SEQUENCES[i];
    for (let j = 0; j < seq.levels.length; j += 1) {
      out.push(LEVELS[seq.levels[j]]);
    }
  }
  return out;
}

/**
 * Next unsolved-friendly level after id.
 *
 * @param {string} id
 * @returns {any|null}
 */
export function getNextLevel(id) {
  const list = allLevels();
  for (let i = 0; i < list.length; i += 1) {
    if (list[i].id === id) return list[i + 1] || null;
  }
  return list[0] || null;
}

/**
 * Evaluate goal list against session + level.
 *
 * @param {any} level
 * @param {object} state
 * @returns {{ met: boolean, checks: { label: string, done: boolean, detail: string, pending: boolean }[] }}
 */
export function checkGoals(level, state) {
  const goals = level.goals || [];
  const checks = goals.map(function (g, index) {
    const r = evalGoal(g, state);
    return {
      label: g.label || g.type,
      done: r.done,
      detail: r.detail,
      pending: !r.done,
      index: index,
    };
  });
  const firstPending = checks.find(function (c) { return c.pending; });
  checks.forEach(function (c) {
    c.active = Boolean(firstPending && c.index === firstPending.index);
  });
  return {
    met: checks.every(function (c) { return c.done; }),
    checks: checks,
  };
}

/**
 * Evaluate one goal predicate.
 *
 * @param {any} g
 * @param {object} state
 * @returns {{ done: boolean, detail: string }}
 */
function evalGoal(g, state) {
  if (g.type === "command") {
    const head = String(g.head).toLowerCase();
    const hit = (state.commandsRun || []).some(function (c) {
      return c.trim().toLowerCase().indexOf(head) === 0;
    });
    return { done: hit, detail: hit ? "ok" : "missing command: " + g.head };
  }
  if (g.type === "actionRan") {
    const n = state.actionsRun || 0;
    const done = n >= (g.value || 1);
    return { done: done, detail: "actions=" + n };
  }
  if (g.type === "cached") {
    const done = Boolean(state.df && state.df.cached);
    return { done: done, detail: done ? "cached" : "not cached" };
  }
  if (g.type === "planHas") {
    const spine = state.df ? planOps(state.df) : [];
    const done = spine.indexOf(g.op) !== -1;
    return { done: done, detail: done ? "op present" : "missing op: " + g.op };
  }
  if (g.type === "planOpsMin") {
    const spine = state.df ? planOps(state.df) : [];
    const done = spine.length >= (g.value || 0);
    return { done: done, detail: spine.length + " transforms" };
  }
  if (g.type === "rows") {
    const n = state.lastRun ? state.lastRun.rows.length : null;
    const done = n === g.value;
    return { done: done, detail: "rows=" + n };
  }
  if (g.type === "columns") {
    const cols = state.lastRun ? state.lastRun.columns : [];
    const need = g.value || [];
    const done = need.every(function (c) { return cols.indexOf(c) !== -1; }) && cols.length === need.length;
    return { done: done, detail: cols.join(",") };
  }
  if (g.type === "partitions") {
    const n = state.lastRun ? state.lastRun.partitions : (state.df ? state.df.partitions : null);
    const done = n === g.value;
    return { done: done, detail: "partitions=" + n };
  }
  if (g.type === "stages") {
    const n = state.lastRun ? state.lastRun.stages.length : 0;
    const done = n >= (g.value || 0);
    return { done: done, detail: "stages=" + n };
  }
  return { done: false, detail: "unknown goal type" };
}

/**
 * List op names on the plan (excluding source).
 *
 * @param {any} df
 * @returns {string[]}
 */
function planOps(df) {
  const out = [];
  let cur = df.plan;
  while (cur) {
    if (cur.op !== "source") out.push(cur.op);
    cur = cur.parent;
  }
  return out.reverse();
}
