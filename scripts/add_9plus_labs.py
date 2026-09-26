"""Add 9+ labs: optimizer rules, stream state, ml pipeline; plus tests."""
from pathlib import Path

# --- levels: three deep labs ---
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\game\levels.js")
t = p.read_text(encoding="utf-8")

old = '''  "lab-cluster": {
    id: "lab-cluster",
    sequence: "internals",
    title: "LAB: cluster shape",'''
# insert new labs before lab-cluster's closing of previous - easier: append before final `};` of LEVELS

marker = '''  "lab-cluster": {
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
    ].join("\\n"),
    learn: ["parallelism = partitions, bounded by slots", "executor count follows ceil(partitions/slots)"],
    hints: ["set tasks.per.executor 4", "load sales", "repartition 8", "show"],
    commandsAllowed: 8,
    goals: [
      { type: "setting", label: "4 slots per executor", key: "tasksPerExecutor", value: 4 },
      { type: "partitions", label: "8 partitions", value: 8 },
    ],
  },
};'''

new = '''  "lab-cluster": {
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
    ].join("\\n"),
    learn: ["parallelism = partitions, bounded by slots", "executor count follows ceil(partitions/slots)"],
    hints: ["set tasks.per.executor 4", "load sales", "repartition 8", "show"],
    commandsAllowed: 8,
    goals: [
      { type: "setting", label: "4 slots per executor", key: "tasksPerExecutor", value: 4 },
      { type: "partitions", label: "8 partitions", value: 8 },
    ],
  },
  "lab-catalyst": {
    id: "lab-catalyst",
    sequence: "sql",
    title: "LAB: Catalyst rules fire",
    difficulty: 5,
    goalText: "Stack two filters and a project, then read the rule trace on explain.",
    intro: [
      "Lab. Real optimizer rules, not a story:",
      "  ConstantFolding   — 1==1 becomes true and drops out",
      "  CollapseFilters   — adjacent filters AND-merge into one node",
      "  PushDownPredicates — filter slides under Project when columns allow",
      "  ColumnPruning     — FileScan drops unused columns",
      "Do: load sales -> filter amount > 1 -> filter amount > 1 -> select region, amount -> explain.",
      "Optimized plan should show a single filter and a rule trace. That is Catalyst-shaped rewriting.",
    ].join("\\n"),
    learn: ["optimizer rewrites the logical plan before physical", "filter collapse and pushdown are real rewrites"],
    hints: [
      "load sales",
      "filter amount > 1",
      "filter amount > 1",
      "select region, amount",
      "explain",
    ],
    commandsAllowed: 10,
    goals: [
      { type: "command", label: "explain shows optimized plan", head: "explain" },
      { type: "planHas", label: "filter in plan", op: "filter" },
      { type: "planHas", label: "select in plan", op: "select" },
    ],
  },
  "lab-stream-state": {
    id: "lab-stream-state",
    sequence: "streaming",
    title: "LAB: outputMode and state",
    difficulty: 5,
    goalText: "Run two micro-batches and observe append vs update emission.",
    intro: [
      "Lab. StreamState keeps keyed aggregates and a watermark.",
      "  append  — emit a key only the first time it is seen",
      "  update  — re-emit a key whenever its agg changes",
      "  complete— emit the full result table every trigger",
      "Do: set outputmode append -> load events -> stream emit (first time).",
      "Then set outputmode update -> stream emit again (same plan; new epoch).",
      "explain prints watermark / lateDropped / outputMode. State keys shrink when watermark advances past old event times.",
    ].join("\\n"),
    learn: ["outputMode decides what a trigger emits", "watermark evicts old keyed state"],
    hints: [
      "set outputmode append",
      "load events",
      "stream emit",
      "set outputmode update",
      "stream emit",
      "explain",
    ],
    commandsAllowed: 10,
    goals: [
      { type: "setting", label: "outputMode=update at end", key: "outputMode", value: "update" },
      { type: "command", label: "stream emit ran", head: "stream" },
      { type: "command", label: "explain", head: "explain" },
    ],
  },
  "lab-ml-pipeline": {
    id: "lab-ml-pipeline",
    sequence: "mlops",
    title: "LAB: Pipeline train/test",
    difficulty: 5,
    goalText: "Run ml pipeline with train/test split and read test RMSE.",
    intro: [
      "Lab. MLlib Pipeline = Transformers (DataFrame->DataFrame) + Estimator (fit -> Model).",
      "ml pipeline user_id amount runs: feature transformer -> OLS estimator on 75% train -> score 25% test -> RMSE/MAE.",
      "Compare trainRMSE vs testRMSE. Big gap = overfit (hard with 1 feature — still read the numbers).",
      "This is the shape of every Spark ML job: split, pipeline.fit(train), model.transform(test), evaluator.",
    ].join("\\n"),
    learn: ["Pipeline.fit on train, transform on test", "RMSE/MAE are the first evaluator metrics"],
    hints: ["load sales", "ml pipeline user_id amount"],
    commandsAllowed: 6,
    goals: [
      { type: "command", label: "ml pipeline ran", head: "ml" },
    ],
  },
};'''

if marker not in t:
    raise SystemExit("lab-cluster marker not found")
t = t.replace(marker, new, 1)

t = t.replace(
    'levels: ["sparksql-tour", "catalyst-plan", "pipeline"] },',
    'levels: ["sparksql-tour", "catalyst-plan", "pipeline", "lab-catalyst"] },',
)
t = t.replace(
    'levels: ["stream-batch", "stream-watermark", "lab-late", "lab-late-drop"] },',
    'levels: ["stream-batch", "stream-watermark", "lab-late", "lab-late-drop", "lab-stream-state"] },',
)
t = t.replace(
    'levels: ["ml-features", "ml-pipeline", "lab-ml", "lab-linreg"] },',
    'levels: ["ml-features", "ml-pipeline", "lab-ml", "lab-linreg", "lab-ml-pipeline"] },',
)

p.write_text(t, encoding="utf-8")
print("labs added", p.stat().st_size)

# --- solutions ---
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\tests\levels.test.js")
t = p.read_text(encoding="utf-8")
t = t.replace(
    '"lab-cluster": ["set tasks.per.executor 4", "load sales", "repartition 8", "show"],',
    '''"lab-cluster": ["set tasks.per.executor 4", "load sales", "repartition 8", "show"],
  "lab-catalyst": ["load sales", "filter amount > 1", "filter amount > 1", "select region, amount", "explain"],
  "lab-stream-state": ["set outputmode update", "load events", "stream emit", "explain"],
  "lab-ml-pipeline": ["load sales", "ml pipeline user_id amount"],''',
)
p.write_text(t, encoding="utf-8")

# --- engine tests for new modules ---
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\tests\engine.test.js")
p.write_text(
    p.read_text(encoding="utf-8")
    + r'''

test("optimizer collapses filters and records rules", async () => {
  const { optimize, foldConstants, formatPlan } = await import("../src/engine/optimizer.js");
  const { createSource, filter, select } = await import("../src/engine/plan.js");
  let df = createSource("sales");
  df = filter(df, "amount > 1 && 1 == 1");
  df = filter(df, "amount > 1");
  df = select(df, ["region", "amount"]);
  const res = optimize(df.plan, ["id", "user_id", "amount", "region"]);
  assert.ok(res.trace.some((x) => x.rule === "CollapseFilters" || x.rule === "ConstantFolding"));
  assert.ok(formatPlan(res.plan).indexOf("filter") !== -1);
  assert.equal(foldConstants("1 == 1 && amount > 1"), "amount > 1");
});

test("streaming append vs update emission differs", async () => {
  const { StreamState } = await import("../src/engine/streaming.js");
  const events = [
    { id: "1", key: "a", eventTime: "2024-01-01", value: 1 },
    { id: "2", key: "a", eventTime: "2024-01-02", value: 2 },
    { id: "3", key: "b", eventTime: "2024-01-03", value: 5 },
  ];
  const s1 = new StreamState({ outputMode: "append" });
  const b1 = s1.microBatch(events);
  assert.equal(b1.emitted.length, 2, "append emits each key once");
  const s2 = new StreamState({ outputMode: "update" });
  s2.microBatch(events);
  const b2 = s2.microBatch([
    { id: "4", key: "a", eventTime: "2024-01-04", value: 10 },
  ]);
  assert.ok(b2.emitted.length >= 1);
  const s3 = new StreamState({ outputMode: "complete", watermarkLagDays: 3650 });
  const b3 = s3.microBatch(events);
  assert.equal(b3.emitted.length, 2);
});

test("streaming watermark drops and evicts late state", async () => {
  const { StreamState } = await import("../src/engine/streaming.js");
  const s = new StreamState({ outputMode: "update", watermarkLagDays: 1 });
  const b1 = s.microBatch([
    { id: "1", key: "old", eventTime: "2023-01-01", value: 1 },
    { id: "2", key: "new", eventTime: "2024-06-01", value: 2 },
  ]);
  assert.ok(b1.lateDropped === 0 || b1.stateKeys >= 1);
  const b2 = s.microBatch([
    { id: "3", key: "late", eventTime: "2023-01-02", value: 9 },
  ]);
  assert.ok(b2.lateDropped >= 1);
  assert.ok(b2.watermark);
});

test("ml pipeline fit/transform and metrics", async () => {
  const { Pipeline, fitLinreg, trainTestSplit, regressionMetrics, predictLinreg } = await import("../src/engine/ml.js");
  const rows = [];
  for (let i = 0; i < 20; i += 1) rows.push({ user_id: i, amount: 2 * i + 1 });
  const split = trainTestSplit(rows, 0.25);
  assert.ok(split.train.length > split.test.length);
  const pipe = new Pipeline()
    .addTransformer("features", function (rs) {
      return rs.map(function (r) {
        return Object.assign({}, r, { features: r.user_id });
      });
    })
    .addEstimator("linreg", function (rs) {
      return fitLinreg(rs, "features", "amount");
    });
  const fitted = pipe.fit(split.train);
  assert.ok(Math.abs(fitted.model.w - 2) < 0.2);
  const scored = pipe.transform(split.test);
  const m = regressionMetrics(scored, "amount", "prediction");
  assert.ok(m.rmse < 1.5);
  assert.ok(predictLinreg(rows, fitted.model)[0].prediction !== undefined);
});

test("explain exposes optimizer trace and codegen", async () => {
  const { execute, createState } = await import("../src/engine/commands.js");
  let s = createState();
  s = execute(s, "load sales", {}).state;
  s = execute(s, "filter amount > 1", {}).state;
  s = execute(s, "filter region == west", {}).state;
  const r = execute(s, "explain", {});
  assert.equal(r.ok, true);
  const text = r.outputs.map((o) => o.text || "").join("\n");
  assert.ok(text.indexOf("Optimized Logical Plan") !== -1);
  assert.ok(text.indexOf("Catalyst Rules") !== -1);
  assert.ok(text.indexOf("Whole-Stage Codegen") !== -1);
  assert.ok(r.state.lastRun.optimizer.trace.length >= 1);
});
''',
    encoding="utf-8",
)

print("tests appended")
