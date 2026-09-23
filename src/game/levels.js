/**
 * Level sequences and goal predicates for learnSpark.
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
 *  - notLazierThan: command golf soft cap (informational)
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
      "LearnGitBranching taught git with a living tree.",
      "learnSpark teaches Apache Spark with a living DAG and partitions.",
      "Tables are tiny on purpose. Commands are a teaching subset.",
      "",
      "Your job: load sales, then show it.",
    ].join("\n"),
    hints: [
      "load sales",
      "show",
    ],
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
      "filter is a transformation. It does not run until an action.",
      "Try filtering high-value orders.",
    ].join("\n"),
    hints: [
      "load sales",
      "filter amount > 100",
      "show",
    ],
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
      "select drops columns early — good hygiene before wide ops.",
    ].join("\n"),
    hints: [
      "load sales",
      "select region, amount",
      "show",
    ],
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
      "Transformations only describe work. Nothing executes until an action",
      "(show, count, collect, write).",
      "",
      "Stack filter + select + sort (or limit) and finish with show.",
    ].join("\n"),
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
      "explain prints the logical plan and stage split.",
      "Wide ops (groupBy, join, repartition) start new stages after a shuffle.",
    ].join("\n"),
    hints: [
      "load sales",
      "filter amount > 10",
      "explain",
    ],
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
      "Actions materialize the plan. count is cheap on the simulator;",
      "collect brings rows to the driver.",
    ].join("\n"),
    hints: [
      "load sales",
      "filter amount > 100",
      "count",
      "collect",
    ],
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
      "filter region == west then count.",
    ].join("\n"),
    hints: [
      "load sales",
      "filter region == west",
      "count",
    ],
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
      "groupBy is a wide transformation — it shuffles rows so equal keys meet.",
      "You should see a stage barrier on the DAG.",
    ].join("\n"),
    hints: [
      "load sales",
      "groupBy region sum amount",
      "show",
    ],
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
      "Join is wide: both sides shuffle on the key.",
      "sales.user_id matches users.id.",
    ].join("\n"),
    hints: [
      "load sales",
      "join users on user_id",
      "show",
    ],
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
      "cache avoids recomputing lineage on every action.",
      "After cache, two show/count runs should report lower cost the second time.",
    ].join("\n"),
    hints: [
      "load sales",
      "filter amount > 50",
      "cache",
      "show",
      "count",
    ],
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
      "repartition(n) is wide (full shuffle). coalesce(n) narrows partitions cheaply.",
    ].join("\n"),
    hints: [
      "load sales",
      "repartition 4",
      "show",
    ],
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
      "sparksql maps a tiny SQL subset onto the same plan engine.",
    ].join("\n"),
    hints: [
      'sparksql select region, amount from sales where amount > 100',
    ],
    commandsAllowed: 4,
    goals: [
      { type: "command", label: "Run sparksql", head: "sparksql" },
    ],
  },
  pipeline: {
    id: "pipeline",
    sequence: "advanced",
    title: "Full pipeline",
    difficulty: 4,
    goalText: "Filter -> withColumn -> groupBy -> show.",
    intro: [
      "Mix narrow and wide ops. Keep the DAG honest.",
    ].join("\n"),
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
 * Evaluate goal list against session + level.
 *
 * @param {any} level
 * @param {object} state
 * @returns {{ met: boolean, checks: { label: string, done: boolean, detail: string }[] }}
 */
export function checkGoals(level, state) {
  const goals = level.goals || [];
  const checks = goals.map(function (g) {
    const r = evalGoal(g, state);
    return { label: g.label || g.type, done: r.done, detail: r.detail };
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
