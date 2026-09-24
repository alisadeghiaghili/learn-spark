/**
 * Level sequences, deep teaching copy, and goal predicates.
 */

import { settings as engineSettings } from "../engine/settings.js";

/**
 * @returns {{ settings: any }}
 */
function requireSettings() {
  return { settings: engineSettings };
}

export const SEQUENCES = [
  { id: "intro", title: "Intro", blurb: "Sources, filter, project", levels: ["welcome", "filter-tour", "project-cols"] },
  { id: "lazy", title: "Lazy evaluation", blurb: "Transforms vs actions", levels: ["lazy-build", "explain-stages"] },
  { id: "actions", title: "Actions", blurb: "show, count, collect, write", levels: ["first-action", "count-cards", "write-sink"] },
  { id: "shuffle", title: "Shuffle & wide ops", blurb: "groupBy, join, partitions", levels: ["group-regions", "join-users", "distinct-wide", "lab-agg-mix"] },
  { id: "optimize", title: "Optimize", blurb: "cache and partitioning", levels: ["cache-it", "tune-parts", "sample-limit", "lab-storage"] },
  { id: "sql", title: "SQL & Catalyst", blurb: "Logical to physical", levels: ["sparksql-tour", "catalyst-plan", "pipeline"] },
  { id: "joins", title: "Join strategies", blurb: "Broadcast, SMJ, outer, skew", levels: ["join-outer", "join-broadcast", "join-sortmerge", "join-skew", "lab-salt", "lab-broadcast"] },
  { id: "analytics", title: "Analytics", blurb: "Window, nested, UDF", levels: ["window-rank", "window-running", "explode-tags", "udf-cost", "lab-udf-modes", "lab-nested", "lab-frame"] },
  { id: "internals", title: "Internals", blurb: "Memory, spill, Tungsten", levels: ["memory-model", "spill-watch", "tungsten-codegen", "aqe-view", "lab-spill", "lab-cluster"] },
  { id: "data", title: "Data sources", blurb: "Formats, schema, writes", levels: ["formats-cost", "schema-strict", "write-partitioned", "lab-formats"] },
  { id: "streaming", title: "Streaming", blurb: "Micro-batches, watermark", levels: ["stream-batch", "stream-watermark", "lab-late", "lab-late-drop"] },
  { id: "mlops", title: "ML pipelines", blurb: "Feature + model stages", levels: ["ml-features", "ml-pipeline", "lab-ml", "lab-linreg"] },
  { id: "ops", title: "Ops & debugging", blurb: "Skew, retries, UI", levels: ["ops-skew-fix", "ops-retry", "lab-retry"] },
];

export const LEVELS = {
  welcome: {
    id: "welcome",
    sequence: "intro",
    title: "Welcome to learnSpark",
    difficulty: 1,
    goalText: "Load the sales table and show its rows.",
    intro: [
      "Spark is a distributed data engine. Driver builds a plan; executors run tasks over partitions.",
      "",
      "Surfaces here:",
      "  1. Job DAG - logical plan and stage boundaries",
      "  2. Partitions - where rows live across executors",
      "  3. Terminal - the commands you would type in a shell/notebook",
      "",
      "Architecture in one breath: ClusterManager allocates executors. Driver compiles DataFrame ops into stages of tasks. Each task processes one partition. Shuffle (wide) ops force a network barrier between stages.",
      "",
      "Your job: load sales, then show it.",
    ].join("\n"),
    learn: [
      "driver / executor / partition mental model",
      "show materializes a table into rows",
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
      "filter is a transformation. It extends the plan only - no scan yet.",
      "Narrow dependency: each output partition depends on exactly one input partition. That is why filter can fuse with neighbors into one stage (whole-stage codegen later).",
      "",
      "If transforms ran eagerly you would pay cluster cost per keystroke. Lazy plans let Catalyst fuse and prune before any task starts.",
    ].join("\n"),
    learn: [
      "filter is a narrow lazy transform",
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
      "Column pruning is not cosmetic. Every retained column is bytes scanned, shuffled, cached, and serialized (Kryo/Java).",
      "Push select early - before join/groupBy - so wide ops move fewer bytes.",
    ].join("\n"),
    learn: [
      "select prunes the schema",
      "early projection cuts shuffle and cache cost",
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
      "Transformations = what. Actions = when.",
      "DataFrame is a query handle, not a local array. Until show/count/collect/write, executors idle.",
      "",
      "Stack filter + select + sort, finish with one show. Watch the DAG grow while partitions stay cold.",
    ].join("\n"),
    learn: [
      "transforms chain into one logical plan",
      "actions launch stages and tasks",
    ],
    hints: ["load sales", "filter amount > 50", "select region, amount", "sort amount desc", "show"],
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
      "explain prints logical ops, a physical sketch, stage split, and memory.",
      "",
      "Narrow (filter/select/map) fuses into the current stage - no network.",
      "Wide (groupBy/join/repartition/distinct) forces shuffle and a new stage.",
      "The network boundary is where production jobs usually die.",
    ].join("\n"),
    learn: [
      "explain shows logical + physical + stages",
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
      "count - scalar, driver stays light.",
      "collect - ships all rows to the driver (OOM risk on real data).",
      "show - limited collect for debugging.",
      "write - sink (partitioned files, table, JDBC).",
      "",
      "Same lineage, different costs. Prefer count/agg when you only need a scalar.",
    ].join("\n"),
    learn: ["count vs collect cost profiles", "collect brings rows to the driver"],
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
      "filter region == west then count.",
      "Scalar actions avoid building a driver-side table. This is the default for health checks and tests.",
    ].join("\n"),
    learn: ["string equality filter (region == west)", "count is a cheap scalar action"],
    hints: ["load sales", "filter region == west", "count"],
    commandsAllowed: 5,
    goals: [
      { type: "command", label: "Run count", head: "count" },
      { type: "rows", label: "West has 4 sales", value: 4 },
    ],
  },
  "write-sink": {
    id: "write-sink",
    sequence: "actions",
    title: "Write sink",
    difficulty: 2,
    goalText: "Write filtered rows (simulated sink).",
    intro: [
      "write is an action that commits a job and produces files/table rows.",
      "Modes matter in real Spark: errorifexists / overwrite / append / ignore.",
      "Partitioning by a low-cardinality key (e.g. region) makes later reads prunable.",
    ].join("\n"),
    learn: ["write is an action with side effects", "write modes and partition pruning"],
    hints: ["load sales", "filter amount > 50", "write"],
    commandsAllowed: 5,
    goals: [
      { type: "command", label: "Run write", head: "write" },
      { type: "planHas", label: "Filtered before write", op: "filter" },
    ],
  },
  "group-regions": {
    id: "group-regions",
    sequence: "shuffle",
    title: "groupBy regions",
    difficulty: 3,
    goalText: "Sum amount by region and show the aggregate.",
    intro: [
      "groupBy is wide. Equal keys must meet on one reducer: map-side partition by hash(key) then write shuffle files, transfer, reduce-side merge.",
      "That is a stage boundary on the DAG and the number one wall-time item in big jobs.",
      "",
      "sales has 4 regions - expect 4 output rows after sum(amount).",
    ].join("\n"),
    learn: ["groupBy shuffles by key into a new stage", "sum(amount) per region yields 4 groups"],
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
      "Join is wide by default: both sides shuffle on the key.",
      "sales.user_id matches users.id. Output rows carry user attributes (name, tier, city).",
      "",
      "Skewed keys create stragglers - one reducer owns the hot key and finishes last. Demo data hides this; production does not.",
    ].join("\n"),
    learn: ["equi-join shuffles both sides on the key", "sales.user_id joins to users.id"],
    hints: ["load sales", "join users on user_id", "show"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "Plan contains join", op: "join" },
      { type: "command", label: "Materialize join", head: "show" },
    ],
  },
  "distinct-wide": {
    id: "distinct-wide",
    sequence: "shuffle",
    title: "distinct is wide",
    difficulty: 2,
    goalText: "Get distinct regions from sales.",
    intro: [
      "distinct looks innocent. Internally it is a shuffle on the full row (or selected keys) so duplicates land together.",
      "Prefer approximate strategies only when the product allows - exact distinct is a wide job.",
    ].join("\n"),
    learn: ["distinct is a wide dependency", "dedupe requires co-locating equal rows"],
    hints: ["load sales", "select region", "distinct", "show"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "distinct in plan", op: "distinct" },
      { type: "command", label: "show result", head: "show" },
      { type: "rows", label: "4 unique regions", value: 4 },
    ],
  },
  "cache-it": {
    id: "cache-it",
    sequence: "optimize",
    title: "Cache a hot DataFrame",
    difficulty: 3,
    goalText: "Cache a filtered frame and run two actions.",
    intro: [
      "Reuse of the same lineage without cache recomputes from source every action.",
      "cache/persist stores partitions (MEMORY_AND_DISK by default) and short-circuits later stages.",
      "",
      "First action after cache still pays full compute to fill it. Subsequent actions should report lower cost here.",
      "Unpersist when the DataFrame dies - cached blocks otherwise evict useful data.",
    ].join("\n"),
    learn: ["cache trades memory for recompute", "first action fills the cache"],
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
      "Partition count = parallelism. Too few under-use executors; too many = tiny tasks and scheduler tax.",
      "Rule of thumb: about 128MB per partition on object stores / 256MB Parquet targets.",
      "repartition(n) full shuffle. coalesce(n) merges partitions without full shuffle when shrinking.",
    ].join("\n"),
    learn: ["partition count sets task parallelism", "repartition is wide; coalesce is cheaper to shrink"],
    hints: ["load sales", "repartition 4", "show"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "Plan contains repartition", op: "repartition" },
      { type: "partitions", label: "4 partitions", value: 4 },
    ],
  },
  "sample-limit": {
    id: "sample-limit",
    sequence: "optimize",
    title: "Sample then limit",
    difficulty: 2,
    goalText: "Sample 50% of sales and take 3 rows.",
    intro: [
      "sample is for exploration and approximate stats - not for correctness-critical counts.",
      "limit without order is nondeterministic across runs (any partition can win).",
      "Together they are the cheap way to peek at big data in notebooks.",
    ].join("\n"),
    learn: ["sample is approximate", "limit is nondeterministic without sort"],
    hints: ["load sales", "sample 0.5", "limit 3", "show"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "sample present", op: "sample" },
      { type: "planHas", label: "limit present", op: "limit" },
      { type: "command", label: "show", head: "show" },
    ],
  },

  "sparksql-tour": {
    id: "sparksql-tour",
    sequence: "sql",
    title: "Spark SQL",
    difficulty: 3,
    goalText: "Run a sparksql SELECT with WHERE.",
    intro: [
      "Spark SQL is a front-end on the same Catalyst optimizer as the DataFrame API.",
      "WHERE becomes Filter. SELECT becomes Project. GROUP BY becomes Aggregate. There is no second engine.",
      "",
      "Example: select region, amount from sales where amount > 100",
    ].join("\n"),
    learn: ["SQL and DataFrames share Catalyst", "WHERE maps to Filter; SELECT to Project"],
    hints: ["sparksql select region, amount from sales where amount > 100"],
    commandsAllowed: 4,
    goals: [{ type: "command", label: "Run sparksql", head: "sparksql" }],
  },
  "catalyst-plan": {
    id: "catalyst-plan",
    sequence: "sql",
    title: "Catalyst: logical to physical",
    difficulty: 4,
    goalText: "explain a mixed plan and read the physical sketch.",
    intro: [
      "Pipeline: Parsed -> Analyzed -> Optimized (logical) -> Physical -> Codegen.",
      "",
      "Optimizer rules you should know: predicate pushdown, projection pruning, constant folding, join reordering, filter collapse.",
      "Physical sketch here shows FileScan, HashAggregate, SortMergeJoin / BroadcastHashJoin, Window.",
      "Whole-stage codegen (Tungsten) fuses operators into one tight loop over unsafe rows - that is why Spark beats naive row-at-a-time JVM code.",
    ].join("\n"),
    learn: ["Catalyst phases: parse, analyze, optimize, physical", "codegen fuses operators for CPU efficiency"],
    hints: ["load sales", "filter amount > 10", "groupBy region sum amount", "explain"],
    commandsAllowed: 7,
    goals: [
      { type: "command", label: "Run explain", head: "explain" },
      { type: "planHas", label: "groupBy in plan", op: "groupBy" },
    ],
  },
  pipeline: {
    id: "pipeline",
    sequence: "sql",
    title: "Full pipeline",
    difficulty: 4,
    goalText: "Filter then withColumn then groupBy then show.",
    intro: [
      "narrow (filter, withColumn) fuse; wide (groupBy) starts the next stage after shuffle.",
      "withColumn tipped amount * 1.1 derives a column without leaving the stage.",
      "Read the DAG: source -> filter -> withColumn || shuffle || groupBy -> show.",
    ].join("\n"),
    learn: ["withColumn derives without shuffle", "mixed narrow+wide pipelines split stages"],
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
  "join-outer": {
    id: "join-outer",
    sequence: "joins",
    title: "Outer joins",
    difficulty: 4,
    goalText: "Left-join campaigns to users and inspect unmatched keys.",
    intro: [
      "inner keeps matches only. left keeps every left row (nulls on the right). right mirrors that. full keeps both unmatched sides.",
      "",
      "Why it matters: anti-join patterns (left + is null) find missing dimension rows - a daily data-quality tool.",
      "Unmatched key user_id=99 in campaigns is the teaching hook.",
    ].join("\n"),
    learn: ["inner vs left/right/full semantics", "outer join surfaces unmatched keys as nulls"],
    hints: ["load campaigns", "join users on user_id left", "show"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "join in plan", op: "join" },
      { type: "command", label: "show", head: "show" },
      { type: "rows", label: "left join keeps campaigns", value: 4 },
    ],
  },
  "join-broadcast": {
    id: "join-broadcast",
    sequence: "joins",
    title: "Broadcast join",
    difficulty: 5,
    goalText: "Force a broadcast join and explain it.",
    intro: [
      "If one side fits in executor memory (spark.sql.autoBroadcastJoinThreshold default 10MB), Spark broadcasts it and builds a hash table on every executor - no shuffle of the big side.",
      "",
      "join users on user_id broadcast - then explain should show BroadcastHashJoin and fewer shuffle stages.",
      "When to force: small dimension tables (users, geo, currency). When not: large fact x large fact, or OOM risk.",
    ].join("\n"),
    learn: ["broadcast avoids shuffling the large side", "physical operator: BroadcastHashJoin"],
    hints: ["load sales", "join users on user_id broadcast", "explain"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "join present", op: "join" },
      { type: "command", label: "explain physical plan", head: "explain" },
    ],
  },
  "join-sortmerge": {
    id: "join-sortmerge",
    sequence: "joins",
    title: "Sort-merge join",
    difficulty: 5,
    goalText: "Force sort-merge join on two large sides.",
    intro: [
      "SortMergeJoin (SMJ) shuffles both sides by key, sorts partitions, then merges. Default for large joins when broadcast is off.",
      "Cost: two shuffles + sorts. Benefit: stable memory profile, works at any size.",
      "",
      "join campaigns on id sort-merge then explain. Compare with broadcast: SMJ shows shuffle stages on both inputs.",
    ].join("\n"),
    learn: ["SMJ = shuffle both sides + sort + merge", "force sort-merge for large x large joins"],
    hints: ["load users", "join campaigns on id sort-merge", "explain"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "join present", op: "join" },
      { type: "command", label: "explain", head: "explain" },
    ],
  },
  "join-skew": {
    id: "join-skew",
    sequence: "joins",
    title: "Skew diagnosis",
    difficulty: 5,
    goalText: "Build a skewed join plan and explain the risk.",
    intro: [
      "Skew: one key holds 50% of rows. One reducer becomes a straggler; stage time = that reducer.",
      "Symptoms: one task 10x longer, high GC, spill on one executor.",
      "",
      "Mitigations: salting the key, skew join hints (AQE), pre-aggregating, broadcasting a side, splitting hot keys.",
      "Here: groupBy on region (west is hot in some sets) then explain - read the physical sketch for HashAggregate + shuffle.",
    ].join("\n"),
    learn: ["skew = hot key = straggler reducer", "salt / AQE skew join / pre-agg are fixes"],
    hints: ["load sales", "groupBy region sum amount", "explain"],
    commandsAllowed: 6,
    goals: [
      { type: "command", label: "explain after aggregate", head: "explain" },
      { type: "planHas", label: "groupBy wide op", op: "groupBy" },
    ],
  },

  "window-rank": {
    id: "window-rank",
    sequence: "analytics",
    title: "Window rank",
    difficulty: 5,
    goalText: "Rank sales by amount inside each region.",
    intro: [
      "Window functions compute per-partition-of-rows without collapsing to one row per group.",
      "row_number / rank / dense_rank give positions; sum/avg/min/max give running or partition aggregates.",
      "",
      "window rank amount over region amount desc - each region gets 1..n by amount.",
      "Unlike groupBy, the grain stays at the row. That is top-N-per-key, sessionization, and deltas.",
    ].join("\n"),
    learn: ["window keeps row grain (unlike groupBy)", "rank over region order by amount desc"],
    hints: ["load sales", "window rank amount over region amount desc", "show"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "window present", op: "window" },
      { type: "command", label: "show", head: "show" },
    ],
  },
  "window-running": {
    id: "window-running",
    sequence: "analytics",
    title: "Running totals",
    difficulty: 5,
    goalText: "Compute a running sum of amount per region ordered by ts.",
    intro: [
      "window sum amount over region ts - cumulative sum within each region as time advances.",
      "This is the standard shape for running balances, funnel steps, and SLA clocks.",
      "lag/lead compare to the previous/next row in the window (session gaps, wow deltas).",
    ].join("\n"),
    learn: ["running aggregates via window sum", "order inside the window defines the cumulative axis"],
    hints: ["load sales", "window sum amount over region ts", "show"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "window present", op: "window" },
      { type: "command", label: "show", head: "show" },
    ],
  },
  "explode-tags": {
    id: "explode-tags",
    sequence: "analytics",
    title: "Explode nested lists",
    difficulty: 4,
    goalText: "Explode event tags into one row per tag.",
    intro: [
      "events.tags is a comma-list (stand-in for array of strings). explode turns one row into n rows - one per element.",
      "Nested types (struct/array/map) are first-class in Spark SQL. Explode is how you normalize arrays for groupBy/join.",
      "",
      "After explode, tags becomes a scalar and you can count by tag.",
    ].join("\n"),
    learn: ["explode densifies array columns into rows", "normalize nested lists before aggregation"],
    hints: ["load events", "explode tags", "groupBy tags count *", "show"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "explode present", op: "explode" },
      { type: "command", label: "show", head: "show" },
    ],
  },
  "udf-cost": {
    id: "udf-cost",
    sequence: "analytics",
    title: "UDF cost",
    difficulty: 4,
    goalText: "Run a UDF and explain why it blocks codegen.",
    intro: [
      "Native Column expressions compile into Tungsten codegen. A JVM/Python UDF is a black box: serialize row, call, deserialize. Codegen stops at the UDF boundary.",
      "Python UDFs are worse: pickling + process hop. Prefer pandas UDFs (vectorized) or native functions.",
      "",
      "udf upper region then explain - physical sketch marks non-native and cost rises.",
    ].join("\n"),
    learn: ["UDFs break whole-stage codegen", "prefer native expressions over UDFs"],
    hints: ["load sales", "udf upper region", "explain"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "udf present", op: "udf" },
      { type: "command", label: "explain", head: "explain" },
    ],
  },
  "memory-model": {
    id: "memory-model",
    sequence: "internals",
    title: "Unified memory",
    difficulty: 5,
    goalText: "Force explain and read the memory block.",
    intro: [
      "Executor memory splits: execution (shuffle/sort/join) + storage (cache/broadcast). Unified memory manager borrows across the boundary.",
      "When execution needs room it can evict cached blocks; when cache is full it can drop to disk (MEMORY_AND_DISK).",
      "",
      "explain prints peak and spill in the Memory block. Tiny demo rarely spills; know the shape for real jobs.",
    ].join("\n"),
    learn: ["execution vs storage memory share a pool", "cache can be evicted under execution pressure"],
    hints: ["load sales", "filter amount > 1", "groupBy region sum amount", "explain"],
    commandsAllowed: 7,
    goals: [{ type: "command", label: "explain with memory block", head: "explain" }],
  },
  "spill-watch": {
    id: "spill-watch",
    sequence: "internals",
    title: "Spill signals",
    difficulty: 5,
    goalText: "Create a wide plan and inspect spill flags on explain.",
    intro: [
      "Spill = write sorted/aggregated data to local disk because the in-memory sorter/agg buffer is full.",
      "Spill is not fatal but it turns RAM work into disk I/O. Fix: more partitions (smaller tasks), better partitioning, less skew, more executor memory, or pre-aggregation.",
      "",
      "repartition + groupBy + explain - check Memory for SPILLED.",
    ].join("\n"),
    learn: ["spill is memory pressure on sort/agg/join", "fixes: repartition, desekew, pre-aggregate"],
    hints: ["load sales", "repartition 2", "groupBy region sum amount", "explain"],
    commandsAllowed: 7,
    goals: [{ type: "command", label: "explain after wide plan", head: "explain" }],
  },
  "tungsten-codegen": {
    id: "tungsten-codegen",
    sequence: "internals",
    title: "Tungsten and codegen",
    difficulty: 5,
    goalText: "Contrast native ops vs UDF in explain.",
    intro: [
      "Tungsten: compact binary rows (UnsafeRow), off-heap friendly, whole-stage codegen generating one Java loop for many operators.",
      "Native filter/project/agg stay inside the fused loop. A UDF splits the pipeline (row to JVM object to row).",
      "",
      "Run filter + explain (native), then udf + explain (non-native) and compare cost / physical lines.",
    ].join("\n"),
    learn: ["whole-stage codegen fuses operators", "UDFs puncture the fused pipeline"],
    hints: ["load sales", "udf tax amount", "explain"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "udf present", op: "udf" },
      { type: "command", label: "explain", head: "explain" },
    ],
  },
  "aqe-view": {
    id: "aqe-view",
    sequence: "internals",
    title: "Adaptive execution",
    difficulty: 4,
    goalText: "Explain a shuffle plan and note where AQE would kick in.",
    intro: [
      "AQE (spark.sql.adaptive.enabled=true by default since 3.2) re-optimizes at stage boundaries using runtime stats.",
      "It can: coalesce small shuffle partitions, convert sort-merge to broadcast, split skewed joins.",
      "",
      "You cannot toggle real AQE here - read the physical sketch and name which rule would fire on this plan (SMJ to BHJ when one side is tiny).",
    ].join("\n"),
    learn: ["AQE re-plans at stage boundaries", "auto SMJ to broadcast and partition coalescing"],
    hints: ["load users", "join campaigns on id", "explain"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "join present", op: "join" },
      { type: "command", label: "explain", head: "explain" },
    ],
  },
  "formats-cost": {
    id: "formats-cost",
    sequence: "data",
    title: "File format cost",
    difficulty: 4,
    goalText: "Load a table and explain the FileScan.",
    intro: [
      "CSV/JSON: text parse, no column prune, no stats. Parquet/ORC: columnar, compressed, min/max stats so predicate pushdown reaches the scan.",
      "Delta/Iceberg/Hudi add ACID, time travel, Z-ordering on top of Parquet.",
      "",
      "Physical sketch starts with FileScan parquet - that is the cheapest scan. Prefer columnar for analytics.",
    ].join("\n"),
    learn: ["columnar formats enable prune + pushdown", "FileScan shows the source format"],
    hints: ["load sales", "explain"],
    commandsAllowed: 4,
    goals: [{ type: "command", label: "explain FileScan", head: "explain" }],
  },
  "schema-strict": {
    id: "schema-strict",
    sequence: "data",
    title: "Schema discipline",
    difficulty: 3,
    goalText: "Project a strict schema early.",
    intro: [
      "schema() prints the inferred/declared types. Production pipelines should declare schemas (not infer) to avoid silent type drift and per-job inference cost.",
      "select a narrow set of columns immediately after read - that is projection pushdown in action.",
    ].join("\n"),
    learn: ["declare schemas in production", "projection pushdown starts at the scan"],
    hints: ["load sales", "schema", "select region, amount", "show"],
    commandsAllowed: 6,
    goals: [
      { type: "command", label: "schema", head: "schema" },
      { type: "planHas", label: "select present", op: "select" },
    ],
  },
  "write-partitioned": {
    id: "write-partitioned",
    sequence: "data",
    title: "Partitioned writes",
    difficulty: 4,
    goalText: "Prepare a narrow frame and write it.",
    intro: [
      "Write partitioning (by region/dt) makes later reads cheap: partition pruning skips whole directories.",
      "Too many distinct keys = small-file explosion. Too few = heavy scans. Aim for balanced directories.",
      "Modes: errorifexists (default), overwrite, append, ignore - pick explicitly in production.",
    ].join("\n"),
    learn: ["partitioned writes enable read pruning", "balance directory count vs query patterns"],
    hints: ["load sales", "select region, amount", "write"],
    commandsAllowed: 5,
    goals: [
      { type: "command", label: "write", head: "write" },
      { type: "planHas", label: "select present", op: "select" },
    ],
  },

  "stream-batch": {
    id: "stream-batch",
    sequence: "streaming",
    title: "Micro-batch model",
    difficulty: 5,
    goalText: "Build the same DataFrame plan streaming would run per batch.",
    intro: [
      "Structured Streaming: treat a stream as an unbounded table. Each trigger (micro-batch) runs the same DataFrame plan on new rows.",
      "Source then streaming DF then sink with outputMode (append/update/complete) + checkpoint for exactly-once.",
      "",
      "Practical move here: build the batch plan (filter to groupBy). That plan is exactly one micro-batch body. Streaming does not invent new operators - it re-executes this plan.",
    ].join("\n"),
    learn: [
      "streaming = repeated batch plans on unbounded input",
      "checkpoint + outputMode define delivery semantics",
    ],
    hints: ["load events", "filter event == purchase", "groupBy event count *", "explain"],
    commandsAllowed: 7,
    goals: [
      { type: "planHas", label: "filter", op: "filter" },
      { type: "planHas", label: "groupBy (agg per batch)", op: "groupBy" },
      { type: "command", label: "explain the batch plan", head: "explain" },
    ],
  },
  "stream-watermark": {
    id: "stream-watermark",
    sequence: "streaming",
    title: "Watermarks",
    difficulty: 5,
    goalText: "Order events by time and explain late-data handling.",
    intro: [
      "withWatermark(eventTime, 10 minutes) tells the engine: ignore rows later than max(eventTime)-delay for stateful ops.",
      "Without watermark, state grows forever on keys. With it, state is bounded and late data is dropped (or written to a side output).",
      "",
      "sort events by ts then explain - time is the watermark axis in real streaming aggregations.",
    ].join("\n"),
    learn: ["watermark bounds state and drops very late rows", "event-time order is the correctness axis"],
    hints: ["load events", "sort ts", "explain"],
    commandsAllowed: 5,
    goals: [
      { type: "planHas", label: "sort by time", op: "sort" },
      { type: "command", label: "explain", head: "explain" },
    ],
  },
  "ml-features": {
    id: "ml-features",
    sequence: "mlops",
    title: "Feature stage",
    difficulty: 4,
    goalText: "Build feature columns with withColumn + select.",
    intro: [
      "ML pipelines are Spark jobs. Feature transformers are DataFrame ops: withColumn, select, explode, UDF (when unavoidable).",
      "Keep features deterministic and versioned - a training/serving skew is a plan diff, not a mystery.",
      "",
      "withColumn tipped amount * 1.1 then select region, tipped - that is your feature frame.",
    ].join("\n"),
    learn: ["features are DataFrame transforms", "deterministic features prevent train/serve skew"],
    hints: ["load sales", "withColumn tipped amount * 1.1", "select region, tipped", "show"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "withColumn feature", op: "withColumn" },
      { type: "planHas", label: "select feature frame", op: "select" },
      { type: "command", label: "show", head: "show" },
    ],
  },
  "ml-pipeline": {
    id: "ml-pipeline",
    sequence: "mlops",
    title: "Pipeline mental model",
    difficulty: 5,
    goalText: "Assemble transform + aggregate as a reusable pipeline plan.",
    intro: [
      "MLlib Pipeline: Transformers (DataFrame to DataFrame) + Estimators (fit then Model). CrossValidator/TrainValidationSplit wrap estimators.",
      "The same code path runs in training and batch scoring. Streaming scoring reuses the transform stage per micro-batch.",
      "",
      "filter to withColumn to groupBy is a miniature pipeline. In production each of these would be a named stage with params in params.yaml / MLflow.",
    ].join("\n"),
    learn: ["Pipeline = chained Transformers + Estimator", "train/serve share one transform plan"],
    hints: ["load sales", "filter amount > 20", "withColumn tipped amount * 1.1", "groupBy region sum tipped", "show"],
    commandsAllowed: 8,
    goals: [
      { type: "planHas", label: "transform", op: "filter" },
      { type: "planHas", label: "feature", op: "withColumn" },
      { type: "planHas", label: "aggregate", op: "groupBy" },
      { type: "command", label: "show", head: "show" },
    ],
  },
  "ops-skew-fix": {
    id: "ops-skew-fix",
    sequence: "ops",
    title: "Mitigate skew",
    difficulty: 5,
    goalText: "Repartition before aggregate and explain the new stage shape.",
    intro: [
      "Concrete skew playbook: (1) detect via Spark UI task time distribution (2) repartition on a salted key or a finer key (3) pre-aggregate partial sums (4) broadcast a shrunk dimension (5) enable AQE skew join.",
      "repartition 4 then groupBy - more reducers shorten the straggler. explain shows the extra stage - that is the cost of desekewing.",
    ].join("\n"),
    learn: [
      "detect skew in the UI, fix via salt/pre-agg/repartition",
      "desekew costs an extra stage - worth it when stragglers dominate",
    ],
    hints: ["load sales", "repartition 4", "groupBy region sum amount", "explain"],
    commandsAllowed: 7,
    goals: [
      { type: "planHas", label: "repartition", op: "repartition" },
      { type: "planHas", label: "groupBy", op: "groupBy" },
      { type: "command", label: "explain", head: "explain" },
    ],
  },
  "ops-retry": {
    id: "ops-retry",
    sequence: "ops",
    title: "Retries and debugging",
    difficulty: 4,
    goalText: "Use explain as the first debugging tool on a failing shape.",
    intro: [
      "Executor loss leads to stage retry (unless output was committed). Speculative execution reruns stragglers on idle executors.",
      "Debug order: (1) explain plan (2) Spark UI stages/tasks (3) storage tab for cache (4) SQL tab for AQE decisions (5) event log history.",
      "",
      "Build any non-trivial plan and explain - treat explain as the first line of production debug.",
    ].join("\n"),
    learn: ["stage retries and speculation cover flakiness", "debug order starts at explain + UI"],
    hints: ["load sales", "join users on user_id", "explain"],
    commandsAllowed: 5,
    goals: [{ type: "command", label: "explain as debug tool", head: "explain" }],
  },
  "lab-spill": {
    id: "lab-spill",
    sequence: "internals",
    title: "LAB: force a spill",
    difficulty: 5,
    goalText: "Shrink executor memory, run a wide plan, and catch SPILLED on explain.",
    intro: [
      "Lab. You control the memory budget with `set executor.mb`.",
      "Steps: set executor.mb 1 -> load sales -> groupBy region sum amount -> explain.",
      "When peak work exceeds ~15% of the budget the simulator flags SPILLED and raises cost.",
      "Then `set executor.mb 32` and explain again - spill disappears. That is the production lever (more memory or smaller tasks).",
    ].join("\n"),
    learn: ["spill is a memory-budget signal", "smaller tasks or more memory removes spill"],
    hints: ["set executor.mb 1", "load sales", "groupBy region sum amount", "explain"],
    commandsAllowed: 8,
    goals: [
      { type: "setting", label: "executor.mb is tiny", key: "executorMb", value: 1 },
      { type: "command", label: "explain", head: "explain" },
      { type: "spilled", label: "SPILLED flag on", value: true },
    ],
  },
  "lab-salt": {
    id: "lab-salt",
    sequence: "joins",
    title: "LAB: salt a hot key",
    difficulty: 5,
    goalText: "Apply salt to desekew, then aggregate and explain.",
    intro: [
      "Lab. Hot key `user_id=1` would own a giant reducer. `salt user_id 4` appends a bucket suffix so the key splits across reducers.",
      "After partial aggregates on salted keys you typically re-aggregate on the raw key (map-side combine + final reduce).",
      "Run: load sales -> salt user_id 4 -> groupBy region sum amount -> explain.",
      "Physical sketch gains AddSaltKey before HashAggregate. That is the standard skew fix shape.",
    ].join("\n"),
    learn: ["salt splits hot keys across reducers", "two-phase agg restores correct totals"],
    hints: ["load sales", "salt user_id 4", "groupBy region sum amount", "explain"],
    commandsAllowed: 8,
    goals: [
      { type: "planHas", label: "salt present", op: "salt" },
      { type: "planHas", label: "groupBy present", op: "groupBy" },
      { type: "command", label: "explain", head: "explain" },
      { type: "physical", label: "AddSaltKey in physical", value: "AddSaltKey" },
    ],
  },
  "lab-broadcast": {
    id: "lab-broadcast",
    sequence: "joins",
    title: "LAB: broadcast threshold",
    difficulty: 5,
    goalText: "Tune broadcast.threshold and catch BroadcastHashJoin in physical plan.",
    intro: [
      "Lab. `set broadcast.threshold 10` keeps auto-broadcast on for small dims. Force `join users on user_id broadcast` and explain.",
      "Then `set broadcast.threshold 0` and `join users on user_id` (auto) - explain should pick SortMergeJoin.",
      "Goal: see BroadcastHashJoin in the physical sketch with an explicit broadcast join.",
    ].join("\n"),
    learn: ["threshold decides BHJ vs SMJ", "forcing broadcast is a hint, not a promise in real Spark"],
    hints: ["set broadcast.threshold 10", "load sales", "join users on user_id broadcast", "explain"],
    commandsAllowed: 8,
    goals: [
      { type: "planHas", label: "join present", op: "join" },
      { type: "physical", label: "BroadcastHashJoin chosen", value: "BroadcastHashJoin" },
    ],
  },
  "lab-udf-modes": {
    id: "lab-udf-modes",
    sequence: "analytics",
    title: "LAB: UDF cost modes",
    difficulty: 5,
    goalText: "Switch udf.mode to python and explain the cost hit.",
    intro: [
      "Lab. Same UDF, three price tags:",
      "  native  - fused codegen (cheapest)",
      "  jvm     - MapElements black box (medium)",
      "  pandas  - vectorized batches (good compromise)",
      "  python  - pickle + process hop (expensive)",
      "set udf.mode python -> load sales -> udf upper region -> explain.",
      "Physical sketch should mark python-udf and cost rises sharply.",
    ].join("\n"),
    learn: ["python UDFs pay pickle + process hop", "pandas UDFs are the vectorized middle ground"],
    hints: ["set udf.mode python", "load sales", "udf upper region", "explain"],
    commandsAllowed: 8,
    goals: [
      { type: "setting", label: "udf.mode=python", key: "udfMode", value: "python" },
      { type: "planHas", label: "udf present", op: "udf" },
      { type: "physical", label: "python-udf marked", value: "python-udf" },
    ],
  },
  "lab-late": {
    id: "lab-late",
    sequence: "streaming",
    title: "LAB: watermark drops late rows",
    difficulty: 5,
    goalText: "Set a watermark and run a micro-batch over time-ordered events.",
    intro: [
      "Lab. Streaming aggregation without a watermark keeps state forever. `stream watermark 10m` bounds it.",
      "Late rows (ts << max(eventTime) - lag) would be dropped in a real engine.",
      "Do: load events -> sort ts -> stream watermark 10m -> stream emit.",
      "emit materializes one micro-batch with the same plan - that is Structured Streaming's core trick.",
    ].join("\n"),
    learn: ["watermark bounds state and drops late data", "micro-batch reuses the batch plan"],
    hints: ["load events", "sort ts", "stream watermark 10m", "stream emit"],
    commandsAllowed: 8,
    goals: [
      { type: "planHas", label: "sort by time", op: "sort" },
      { type: "planHas", label: "watermark set", op: "stream" },
      { type: "command", label: "stream emit (micro-batch)", head: "stream" },
    ],
  },
  "lab-ml": {
    id: "lab-ml",
    sequence: "mlops",
    title: "LAB: fit then predict",
    difficulty: 5,
    goalText: "Vectorize features, fit on amount, then predict.",
    intro: [
      "Lab. MLlib Pipeline stages are DataFrame ops:",
      "  ml vectorize amount,user_id  - Transformer",
      "  ml fit amount                - Estimator.fit -> Model (learns mean here)",
      "  ml predict                   - Model.transform",
      "Train and score share the same feature transforms - that is how you avoid train/serve skew.",
    ].join("\n"),
    learn: ["Transformer vs Estimator vs Model", "shared feature plan prevents skew"],
    hints: ["load sales", "ml vectorize amount,user_id", "ml fit amount", "ml predict", "show"],
    commandsAllowed: 10,
    goals: [
      { type: "planHas", label: "vectorize", op: "ml" },
      { type: "command", label: "show predictions", head: "show" },
    ],
  },
  "lab-retry": {
    id: "lab-retry",
    sequence: "ops",
    title: "LAB: fail a task and retry",
    difficulty: 5,
    goalText: "Inject a task failure, enable speculation, and run an action.",
    intro: [
      "Lab. `injectFail` marks a stage as flaky. Next action models retries (2 without speculation, 1 with).",
      "set speculate on -> load sales -> injectFail 0 -> show.",
      "Cost penalty shrinks with speculation because a backup task can win the race. In the Spark UI you would see task attempts.",
    ].join("\n"),
    learn: ["stage retries absorb executor loss", "speculation races stragglers"],
    hints: ["set speculate on", "load sales", "injectFail 0", "show"],
    commandsAllowed: 8,
    goals: [
      { type: "setting", label: "speculation on", key: "speculate", value: true },
      { type: "planHas", label: "failure injected", op: "fail" },
      { type: "retries", label: "retries recorded", value: 1 },
    ],
  },
  "lab-formats": {
    id: "lab-formats",
    sequence: "data",
    title: "LAB: CSV vs Parquet cost",
    difficulty: 4,
    goalText: "Compare text vs columnar FileScan in explain.",
    intro: [
      "Lab. set format csv -> load sales -> explain (text parse, no prune).",
      "set format parquet -> load sales -> explain (columnar prune+pushdown).",
      "Physical sketch labels the scan. Columnar wins on analytics because of projection + predicate pushdown + compression.",
    ].join("\n"),
    learn: ["text formats pay parse and lose pushdown", "columnar formats enable prune + stats"],
    hints: ["set format csv", "load sales", "explain", "set format parquet", "load sales", "explain"],
    commandsAllowed: 10,
    goals: [
      { type: "command", label: "explain under a format", head: "explain" },
    ],
  },
  "lab-agg-mix": {
    id: "lab-agg-mix",
    sequence: "shuffle",
    title: "LAB: multi-agg and cube",
    difficulty: 5,
    goalText: "Run multi-agg groupBy and cube grouping sets.",
    intro: [
      "Lab. One shuffle, many aggregates: `groupBy region sum amount, count *`.",
      "Grouping sets (cube/rollup) expand rows before aggregate so you get subtotals without multiple jobs.",
      "Try: load sales -> groupBy region sum amount, count * -> show, then cube region sum amount -> show.",
    ].join("\n"),
    learn: ["multi-agg amortizes one shuffle", "cube emits grouping-set subtotals"],
    hints: ["load sales", "groupBy region sum amount, count *", "show"],
    commandsAllowed: 8,
    goals: [
      { type: "planHas", label: "groupBy multi-agg", op: "groupBy" },
      { type: "command", label: "show", head: "show" },
      { type: "rows", label: "4 regions", value: 4 },
    ],
  },
  "lab-nested": {
    id: "lab-nested",
    sequence: "analytics",
    title: "LAB: mapExplode + getField",
    difficulty: 5,
    goalText: "Explode a map-like column and pull a field.",
    intro: [
      "Lab. events.tags is a map-like `k=v,k=v` string. `mapExplode tags` yields map_key/map_value rows - same as explode(map).",
      "`get tags mobile` pulls one field like col.field on a struct.",
      "Nested access is first-class in Spark SQL; prefer it over string splits in production schemas.",
    ].join("\n"),
    learn: ["mapExplode densifies maps into key/value rows", "getField is struct/map field access"],
    hints: ["load events", "mapExplode tags", "show"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "mapExplode present", op: "mapExplode" },
      { type: "command", label: "show", head: "show" },
    ],
  },
  "lab-storage": {
    id: "lab-storage",
    sequence: "optimize",
    title: "LAB: storage levels",
    difficulty: 5,
    goalText: "Cache with DISK_ONLY and compare cost to MEMORY_AND_DISK.",
    intro: [
      "Lab. persist(storageLevel) chooses the cache contract:",
      "  MEMORY_ONLY        - evict and recompute on pressure (fastest when it fits)",
      "  MEMORY_ONLY_SER    - serialized, denser, CPU to decode",
      "  MEMORY_AND_DISK    - spill partitions to local disk instead of recompute (default)",
      "  DISK_ONLY          - always disk (safe, slow)",
      "cache DISK_ONLY -> show; then cache MEMORY_AND_DISK -> show. Cost line should differ.",
      "Unpersist (`unpersist`) frees blocks so execution memory can reclaim them.",
    ].join("\n"),
    learn: ["storage levels trade memory vs recompute vs disk", "DISK_ONLY is safe but pays I/O every hit"],
    hints: ["load sales", "filter amount > 20", "cache DISK_ONLY", "show", "cache MEMORY_AND_DISK", "show"],
    commandsAllowed: 10,
    goals: [
      { type: "setting", label: "storage.level=DISK_ONLY", key: "storageLevel", value: "DISK_ONLY" },
      { type: "cached", label: "frame is cached", value: true },
      { type: "command", label: "show after cache", head: "show" },
    ],
  },
  "lab-frame": {
    id: "lab-frame",
    sequence: "analytics",
    title: "LAB: window frame clause",
    difficulty: 5,
    goalText: "Compare running total vs last-4 frame.",
    intro: [
      "Lab. Window frame decides which rows join the aggregate for the current row.",
      "  rows-unbounded-current  (default running sum)",
      "  last4                   (rows-3-preceding-current)",
      "  entire                  (unbounded preceding and following)",
      "  current                 (current row only)",
      "window sum amount over region ts  then  window sum amount over region ts last4.",
      "Same function, different frame, different numbers. That is RANGE vs ROWS in one move.",
    ].join("\n"),
    learn: ["frame clause bounds the aggregate window", "running total = unbounded preceding"],
    hints: ["load sales", "set window.frame last4", "window sum amount over region ts last4", "show"],
    commandsAllowed: 10,
    goals: [
      { type: "planHas", label: "window present", op: "window" },
      { type: "command", label: "show", head: "show" },
    ],
  },
  "lab-late-drop": {
    id: "lab-late-drop",
    sequence: "streaming",
    title: "LAB: late rows are dropped",
    difficulty: 5,
    goalText: "Set a short watermark and watch lateDropped > 0 on explain.",
    intro: [
      "Lab. events has a row from 2023-01-01 among 2024 rows. With watermark 1d, that row is late and dropped.",
      "Do: load events -> stream watermark 1d -> explain (lateDropped >= 1).",
      "Then `set` without watermark (restart level) and explain again - lateDropped=0. State would grow forever in a real job.",
    ].join("\n"),
    learn: ["watermark drops rows older than max(eventTime)-lag", "unbounded state is the streaming footgun"],
    hints: ["load events", "stream watermark 1d", "explain"],
    commandsAllowed: 6,
    goals: [
      { type: "planHas", label: "watermark set", op: "stream" },
      { type: "command", label: "explain shows lateDropped", head: "explain" },
    ],
  },
  "lab-linreg": {
    id: "lab-linreg",
    sequence: "mlops",
    title: "LAB: fit linear regression",
    difficulty: 5,
    goalText: "Fit amount ~ user_id with OLS and predict.",
    intro: [
      "Lab. `ml linreg user_id amount` runs closed-form OLS (Normal Equation) on the whole partition bag.",
      "Model columns: model_w, model_b, model_rmse. Then `ml predict user_id <w> <b> show` to score.",
      "In MLlib this is LinearRegression via L-BFGS; the API shape is the same: Estimator.fit -> Model.transform.",
      "Read model_rmse on explain/show - that is your first eval metric, before any CrossValidator.",
    ].join("\n"),
    learn: ["Estimator.fit learns parameters", "Model.transform scores new rows"],
    hints: ["load sales", "ml linreg user_id amount", "show"],
    commandsAllowed: 8,
    goals: [
      { type: "planHas", label: "linreg fit", op: "mlLinreg" },
      { type: "command", label: "show model columns", head: "show" },
    ],
  },
  "lab-cluster": {
    id: "lab-cluster",
    sequence: "internals",
    title: "LAB: cluster shape",
    difficulty: 5,
    goalText: "Change tasks.per.executor and watch the cluster panel.",
    intro: [
      "Lab. Slots = cores per executor. tasks = partitions. executors needed = ceil(partitions/slots).",
      "set tasks.per.executor 4 -> load sales -> repartition 8 -> show.",
      "Cluster panel: 8 partitions / 4 slots = 2 executors. Too few slots under-use the cluster; too many oversubscribe memory.",
      "spark.executor.cores and spark.executor.instances are the real knobs these stand for.",
    ].join("\n"),
    learn: ["parallelism = partitions, bounded by slots", "executor count follows ceil(partitions/slots)"],
    hints: ["set tasks.per.executor 4", "load sales", "repartition 8", "show"],
    commandsAllowed: 8,
    goals: [
      { type: "setting", label: "4 slots per executor", key: "tasksPerExecutor", value: 4 },
      { type: "partitions", label: "8 partitions", value: 8 },
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
      if (LEVELS[seq.levels[j]]) out.push(LEVELS[seq.levels[j]]);
    }
  }
  return out;
}

/**
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
 * @param {any} level
 * @param {object} state
 * @returns {{ met: boolean, checks: any[] }}
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
  if (g.type === "physical") {
    const phy = state.lastRun ? String(state.lastRun.physical || "") : "";
    const done = phy.indexOf(g.value) !== -1;
    return { done: done, detail: done ? "physical hit" : "missing: " + g.value };
  }
  if (g.type === "spilled") {
    const done = Boolean(state.lastRun && state.lastRun.memory && state.lastRun.memory.spilled);
    return { done: done, detail: done ? "SPILLED" : "no spill yet" };
  }
  if (g.type === "setting") {
    const actual = engineSettings[g.key];
    const done = actual === g.value || String(actual) === String(g.value);
    return { done: done, detail: g.key + "=" + actual };
  }
  if (g.type === "retries") {
    const n = state.lastRun ? state.lastRun.retries || 0 : 0;
    const done = n >= (g.value || 1);
    return { done: done, detail: "retries=" + n };
  }
  return { done: false, detail: "unknown goal type" };
}

/**
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
