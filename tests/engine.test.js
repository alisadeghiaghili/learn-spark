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
