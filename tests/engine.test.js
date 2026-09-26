/**
 * Engine tests for learnSpark plan execution and commands.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createSource, filter, select, groupBy, join, limit, cacheFrame, planSpine } from "../src/engine/plan.js";
import { run, materialize } from "../src/engine/execute.js";
import { evalExpr } from "../src/engine/expr.js";
import { execute, createState, tokenize } from "../src/engine/commands.js";
import { checkGoals, LEVELS } from "../src/game/levels.js";

test("evalExpr comparisons and logic", () => {
  const row = { amount: 120.5, region: "west" };
  assert.equal(evalExpr("amount > 100", row), true);
  assert.equal(evalExpr("amount < 100", row), false);
  assert.equal(evalExpr("region == west", row), true);
  assert.equal(evalExpr("amount > 100 && region == west", row), true);
  assert.equal(evalExpr("amount > 200 || region == west", row), true);
  assert.equal(evalExpr("amount + 10", row), 130.5);
});

test("lazy transforms do not change history until action", () => {
  let state = createState();
  state = execute(state, "load sales").state;
  const afterLoad = state.actionsRun;
  state = execute(state, "filter amount > 100").state;
  assert.equal(state.actionsRun, afterLoad);
  assert.ok(state.transformsPending >= 1);
  const res = execute(state, "count");
  assert.equal(res.kind, "action");
  assert.equal(res.state.lastRun.rows.length, 6);
});

test("filter + groupBy materialize expected aggregates", () => {
  let df = createSource("sales");
  df = filter(df, "amount > 20");
  df = groupBy(df, ["region"], "sum", "amount");
  const result = run(df);
  assert.equal(result.rows.length, 4);
  const west = result.rows.find((r) => r.region === "west");
  assert.ok(west["sum(amount)"] > 0);
  assert.ok(result.stages.length >= 2, "wide op should split stages");
});

test("join sales with users on user_id", () => {
  let df = createSource("sales");
  df = join(df, "users", "user_id");
  const result = run(df);
  assert.equal(result.rows.length, 12);
  assert.ok(result.columns.indexOf("name") !== -1);
});

test("select projects columns", () => {
  let df = createSource("sales");
  df = select(df, ["region", "amount"]);
  df = limit(df, 3);
  const result = run(df);
  assert.deepEqual(result.columns, ["region", "amount"]);
  assert.equal(result.rows.length, 3);
});

test("cache reduces computeCost", () => {
  let df = createSource("sales");
  df = filter(df, "amount > 10");
  const cold = run(df);
  const hot = run(cacheFrame(df));
  assert.ok(hot.computeCost < cold.computeCost);
  assert.equal(hot.fromCache, true);
});

test("commands: load/show/help/unknown", () => {
  let state = createState();
  let r = execute(state, "load sales");
  assert.equal(r.ok, true);
  state = r.state;
  r = execute(state, "show");
  assert.equal(r.kind, "action");
  assert.equal(r.state.lastRun.rows.length, 12);
  r = execute(state, "help");
  assert.equal(r.ok, true);
  r = execute(state, "frobnicate");
  assert.equal(r.ok, false);
});

test("tokenize keeps quoted phrases", () => {
  assert.deepEqual(tokenize("filter name == 'ada lovelace'"), ["filter", "name", "==", "ada lovelace"]);
});

test("welcome level is solvable in par", () => {
  const level = LEVELS.welcome;
  let state = createState();
  state = execute(state, "load sales").state;
  state = execute(state, "show").state;
  const res = checkGoals(level, state);
  assert.equal(res.met, true);
});

test("planSpine is source-to-tip", () => {
  let df = createSource("sales");
  df = filter(df, "amount > 1");
  const spine = planSpine(df.plan);
  assert.equal(spine[0].op, "source");
  assert.equal(spine[spine.length - 1].op, "filter");
  assert.equal(materialize(df.plan).rows.length > 0, true);
});


test("window rank keeps row grain", async () => {
  const { windowFn } = await import("../src/engine/plan.js");
  let df = createSource("sales");
  df = windowFn(df, "rank", "amount", ["region"], "amount", true);
  const result = run(df);
  assert.equal(result.rows.length, 12);
  assert.ok(result.columns.some((c) => c.indexOf("rank_over_region") === 0));
});

test("explode expands comma tags", async () => {
  const { explode } = await import("../src/engine/plan.js");
  let df = createSource("events");
  df = explode(df, "tags");
  const result = run(df);
  assert.ok(result.rows.length > 6);
  assert.ok(result.rows.some((r) => r.tags === "mobile"));
});

test("join left keeps unmatched left rows", async () => {
  let df = createSource("campaigns");
  df = join(df, "users", "user_id", "left", "sort-merge");
  const result = run(df);
  assert.equal(result.rows.length, 4);
  const orphan = result.rows.find((r) => r.user_id === 99);
  assert.ok(orphan);
});

test("broadcast join marks physical plan", async () => {
  let df = createSource("sales");
  df = join(df, "users", "user_id", "inner", "broadcast");
  const result = run(df);
  assert.ok(result.physical.indexOf("BroadcastHashJoin") !== -1);
  assert.ok(result.stages.length >= 1);
});

test("udf adds column and flags non-native cost", async () => {
  const { udf } = await import("../src/engine/plan.js");
  let df = createSource("sales");
  df = udf(df, "upper", "region");
  const result = run(df);
  assert.ok(result.physical.indexOf("non-native") !== -1);
  assert.ok(result.rows[0].region_upper === "WEST" || result.rows[0].region_upper === "EAST");
});

test("memory block is present on run", () => {
  const result = run(createSource("sales"));
  assert.ok(result.memory);
  assert.ok(typeof result.memory.executorMb === "number");
  assert.ok(result.physical.indexOf("FileScan") !== -1);
});


test("settings control spill and broadcast choice", async () => {
  const { applySetting, resetSettings, settings } = await import("../src/engine/settings.js");
  const { groupBy } = await import("../src/engine/plan.js");
  resetSettings();
  applySetting("executor.mb", "0.001");
  let df = createSource("sales");
  df = groupBy(df, ["region"], "sum", "amount");
  const spilled = run(df);
  assert.equal(spilled.memory.spilled, true);

  resetSettings();
  applySetting("executor.mb", "32");
  const ok = run(df);
  assert.equal(ok.memory.spilled, false);

  applySetting("broadcast.threshold", "10");
  let j = createSource("sales");
  j = join(j, "users", "user_id", "inner", "auto");
  assert.ok(run(j).physical.indexOf("BroadcastHashJoin") !== -1);

  applySetting("broadcast.threshold", "0");
  applySetting("autobroadcast", "off");
  j = createSource("sales");
  j = join(j, "users", "user_id", "inner", "auto");
  assert.ok(run(j).physical.indexOf("SortMergeJoin") !== -1);
  resetSettings();
});

test("multi-agg and cube produce grouping sets", async () => {
  const { groupByMulti, cubeRollup, salt, mapExplode, mlOp } = await import("../src/engine/plan.js");
  let df = createSource("sales");
  df = groupByMulti(df, ["region"], [
    { fn: "sum", col: "amount" },
    { fn: "count", col: null },
  ]);
  const multi = run(df);
  assert.equal(multi.rows.length, 4);
  assert.ok(multi.rows[0]["count(*)"] === 1 || multi.rows[0]["count(*)"] > 0);

  let c = createSource("sales");
  c = cubeRollup(c, ["region"], "cube", "sum", "amount");
  const cube = run(c);
  assert.ok(cube.rows.length > 4);

  let s = createSource("sales");
  s = salt(s, "user_id", 4);
  assert.ok(run(s).physical.indexOf("AddSaltKey") !== -1);

  let e = createSource("events");
  e = mapExplode(e, "tags");
  assert.ok(run(e).rows.some((r) => r.map_key === "mobile"));

  let m = createSource("sales");
  m = mlOp(m, "fit", { target: "amount" });
  const fit = run(m);
  assert.ok(fit.rows[0].prediction > 0);
});

test("udf modes change cost and physical tags", async () => {
  const { applySetting, resetSettings } = await import("../src/engine/settings.js");
  const { udf } = await import("../src/engine/plan.js");
  resetSettings();
  let df = createSource("sales");
  df = udf(df, "tax", "amount");
  applySetting("udf.mode", "python");
  const py = run(df);
  assert.ok(py.physical.indexOf("python-udf") !== -1);
  applySetting("udf.mode", "jvm");
  const jvm = run(df);
  assert.ok(jvm.computeCost < py.computeCost);
  resetSettings();
});

test("injectFail records retries; speculate reduces them", async () => {
  const { applySetting, resetSettings } = await import("../src/engine/settings.js");
  const { injectFailure } = await import("../src/engine/plan.js");
  resetSettings();
  let df = createSource("sales");
  df = injectFailure(df, 0);
  const a = run(df);
  assert.equal(a.retries, 2);
  applySetting("speculate", "on");
  let df2 = createSource("sales");
  df2 = injectFailure(df2, 0);
  assert.equal(run(df2).retries, 1);
  resetSettings();
});


test("window frame changes running sum", async () => {
  const { windowFn } = await import("../src/engine/plan.js");
  const { resetSettings } = await import("../src/engine/settings.js");
  resetSettings();
  let a = createSource("sales");
  a = windowFn(a, "sum", "amount", ["region"], "ts", false, "rows-unbounded-current");
  let b = createSource("sales");
  b = windowFn(b, "sum", "amount", ["region"], "ts", false, "rows-current-only");
  const ra = run(a);
  const rb = run(b);
  const col = Object.keys(ra.rows[0]).find((k) => k.indexOf("sum_over_") === 0);
  // match rows by id — frames are compared per event, not per emission order
  const byId = new Map(rb.rows.map((r) => [r.id, r]));
  assert.ok(ra.rows.some((r) => r[col] !== byId.get(r.id)[col]));
});

test("watermark drops late rows", async () => {
  const { streamOp } = await import("../src/engine/plan.js");
  const { settings, resetSettings, applySetting } = await import("../src/engine/settings.js");
  resetSettings();
  let df = createSource("events");
  df = streamOp(df, "watermark", { lag: "1d" });
  settings.watermarkLag = "1d";
  const result = run(df);
  assert.ok(result.lateDropped >= 1, "lateDropped=" + result.lateDropped);
  resetSettings();
  let df2 = createSource("events");
  assert.equal(run(df2).lateDropped, 0);
});

test("linreg fit learns slope and intercept", async () => {
  const { mlLinreg, mlPredictLinreg } = await import("../src/engine/plan.js");
  let df = createSource("sales");
  df = mlLinreg(df, "user_id", "amount");
  const fit = run(df);
  assert.ok(typeof fit.rows[0].model_w === "number");
  assert.ok(typeof fit.rows[0].model_rmse === "number");
  const w = fit.rows[0].model_w;
  const b = fit.rows[0].model_b;
  let p = createSource("sales");
  p = mlPredictLinreg(p, "user_id", w, b);
  const pred = run(p);
  assert.ok(pred.rows.every((r) => typeof r.prediction === "number"));
});

test("cache storage levels change cost", async () => {
  const { cacheFrame, filter, createSource: src } = await import("../src/engine/plan.js");
  // re-import createSource already in test scope
  let df = createSource("sales");
  df = filter(df, "amount > 1");
  const disk = run(cacheFrame(df, "DISK_ONLY"));
  const mem = run(cacheFrame(df, "MEMORY_AND_DISK"));
  assert.ok(disk.computeCost >= mem.computeCost);
});

test("cluster shape scales with slots", async () => {
  const { applySetting, resetSettings, clusterShape } = await import("../src/engine/settings.js");
  resetSettings();
  applySetting("tasks.per.executor", "4");
  assert.deepEqual(clusterShape(8), { executors: 2, slots: 4 });
  resetSettings();
});


test("join algorithms differ in shuffle and sort behavior", async () => {
  const { joinWith } = await import("../src/engine/joins.js");
  const { getDataset } = await import("../src/engine/datasets.js");
  const left = getDataset("sales").rows;
  const right = getDataset("users").rows;
  const b = joinWith(left, right, "user_id", "inner", "broadcast", 4, 32);
  const s = joinWith(left, right, "user_id", "inner", "sort-merge", 4, 32);
  const h = joinWith(left, right, "user_id", "inner", "shuffled-hash", 4, 32);
  assert.equal(b.algorithm, "BroadcastHashJoin");
  assert.equal(b.shuffleBytes, 0);
  assert.equal(b.sorted, false);
  assert.ok(b.buildBytes > 0);
  assert.equal(s.algorithm, "SortMergeJoin");
  assert.ok(s.shuffleBytes > 0);
  assert.equal(s.sorted, true);
  assert.equal(h.algorithm, "ShuffledHashJoin");
  assert.ok(h.shuffleBytes > 0);
  assert.ok(h.probed > 0);
  assert.equal(b.rows.length, s.rows.length);
  assert.equal(s.rows.length, h.rows.length);
});

test("hash partitioner and salt change distribution", async () => {
  const { place, partitionOf } = await import("../src/engine/partitions.js");
  const rows = [];
  for (let i = 0; i < 40; i += 1) rows.push({ user_id: 1, amount: i });
  const hot = place(rows, 4, "user_id");
  assert.ok(hot.skewRatio > 2, "hot key should skew: " + hot.skewRatio);
  const salted = rows.map(function (r, i) {
    return { user_id: 1, user_id_salt: "1_" + (i % 4), amount: i };
  });
  const spread = place(salted, 4, "user_id_salt");
  assert.ok(spread.skewRatio < 1.5, "salt should desekew: " + spread.skewRatio);
  assert.equal(partitionOf("a", 4), partitionOf("a", 4));
});

test("codegen splits on udf and fuses native ops", async () => {
  const { analyzeCodegen } = await import("../src/engine/codegen.js");
  const { createSource, filter, select, udf, planSpine } = await import("../src/engine/plan.js");
  let df = createSource("sales");
  df = filter(df, "amount > 1");
  df = select(df, ["amount"]);
  const native = analyzeCodegen(planSpine(df.plan), "native");
  assert.equal(native.splits, 0);
  let u = createSource("sales");
  u = udf(u, "tax", "amount");
  u = filter(u, "amount > 1");
  const jvm = analyzeCodegen(planSpine(u.plan), "jvm");
  assert.ok(jvm.splits >= 1);
  assert.ok(jvm.cost > native.cost);
});

test("sql parser builds real AST", async () => {
  const { parseSelect } = await import("../src/engine/sql.js");
  const ast = parseSelect("select region, sum(amount) from sales where amount > 10 group by region order by region desc");
  assert.equal(ast.table, "sales");
  assert.deepEqual(ast.groupBy, ["region"]);
  assert.ok(ast.where.indexOf("amount") !== -1);
  assert.equal(ast.aggs[0].fn, "sum");
  assert.equal(ast.orderBy.desc, true);
  assert.throws(function () { parseSelect("select from"); });
});


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
