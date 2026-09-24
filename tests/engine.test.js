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
  applySetting("executor.mb", "1");
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
