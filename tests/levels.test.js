/**
 * Level solvability checks for the full curriculum.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execute, createState } from "../src/engine/commands.js";
import { LEVELS, allLevels, checkGoals } from "../src/game/levels.js";

/**
 * @param {string[]} script
 * @returns {object}
 */
function runScript(script) {
  let state = createState();
  for (const line of script) {
    state = execute(state, line, { level: null }).state;
  }
  return state;
}

const SOLUTIONS = {
  welcome: ["load sales", "show"],
  "filter-tour": ["load sales", "filter amount > 100", "show"],
  "project-cols": ["load sales", "select region, amount", "show"],
  "lazy-build": ["load sales", "filter amount > 50", "select region, amount", "sort amount desc", "show"],
  "explain-stages": ["load sales", "filter amount > 10", "explain"],
  "first-action": ["load sales", "filter amount > 100", "count", "collect"],
  "count-cards": ["load sales", "filter region == west", "count"],
  "write-sink": ["load sales", "filter amount > 50", "write"],
  "group-regions": ["load sales", "groupBy region sum amount", "show"],
  "join-users": ["load sales", "join users on user_id", "show"],
  "distinct-wide": ["load sales", "select region", "distinct", "show"],
  "cache-it": ["load sales", "filter amount > 50", "cache", "show", "count"],
  "tune-parts": ["load sales", "repartition 4", "show"],
  "sample-limit": ["load sales", "sample 0.5", "limit 3", "show"],
  "sparksql-tour": ["sparksql select region, amount from sales where amount > 100"],
  "catalyst-plan": ["load sales", "filter amount > 10", "groupBy region sum amount", "explain"],
  pipeline: ["load sales", "filter amount > 20", "withColumn tipped amount * 1.1", "groupBy region sum tipped", "show"],
  "join-outer": ["load campaigns", "join users on user_id left", "show"],
  "join-broadcast": ["load sales", "join users on user_id broadcast", "explain"],
  "join-sortmerge": ["load users", "join campaigns on id sort-merge", "explain"],
  "join-skew": ["load sales", "groupBy region sum amount", "explain"],
  "window-rank": ["load sales", "window rank amount over region amount desc", "show"],
  "window-running": ["load sales", "window sum amount over region ts", "show"],
  "explode-tags": ["load events", "explode tags", "groupBy tags count *", "show"],
  "udf-cost": ["load sales", "udf upper region", "explain"],
  "memory-model": ["load sales", "filter amount > 1", "groupBy region sum amount", "explain"],
  "spill-watch": ["load sales", "repartition 2", "groupBy region sum amount", "explain"],
  "tungsten-codegen": ["load sales", "udf tax amount", "explain"],
  "aqe-view": ["load users", "join campaigns on id", "explain"],
  "formats-cost": ["load sales", "explain"],
  "schema-strict": ["load sales", "schema", "select region, amount", "show"],
  "write-partitioned": ["load sales", "select region, amount", "write"],
  "stream-batch": ["load events", "filter event == purchase", "groupBy event count *", "explain"],
  "stream-watermark": ["load events", "sort ts", "explain"],
  "ml-features": ["load sales", "withColumn tipped amount * 1.1", "select region, tipped", "show"],
  "ml-pipeline": ["load sales", "filter amount > 20", "withColumn tipped amount * 1.1", "groupBy region sum tipped", "show"],
  "ops-skew-fix": ["load sales", "repartition 4", "groupBy region sum amount", "explain"],
  "ops-retry": ["load sales", "join users on user_id", "explain"],
  "lab-spill": ["set executor.mb 1", "load sales", "groupBy region sum amount", "explain"],
  "lab-salt": ["load sales", "salt user_id 4", "groupBy region sum amount", "explain"],
  "lab-broadcast": ["load sales", "join users on user_id broadcast", "explain"],
  "lab-udf-modes": ["set udf.mode python", "load sales", "udf upper region", "explain"],
  "lab-late": ["load events", "sort ts", "stream watermark 10m", "stream emit"],
  "lab-ml": ["load sales", "ml vectorize amount,user_id", "ml fit amount", "ml predict", "show"],
  "lab-retry": ["set speculate on", "load sales", "injectFail 0", "show"],
  "lab-formats": ["set format csv", "load sales", "explain"],
  "lab-agg-mix": ["load sales", "groupBy region sum amount, count *", "show"],
  "lab-nested": ["load events", "mapExplode tags", "show"],
};

test("every level has a known solution", () => {
  for (const level of allLevels()) {
    assert.ok(SOLUTIONS[level.id], "missing solution for " + level.id);
    assert.ok(level.learn && level.learn.length >= 2, "thin learn on " + level.id);
  }
});

test("all level solutions meet goals under par", () => {
  for (const level of allLevels()) {
    const script = SOLUTIONS[level.id];
    const state = runScript(script);
    const res = checkGoals(level, state);
    assert.equal(res.met, true, level.id + " failed: " + JSON.stringify(res.checks));
    assert.ok(script.length <= (level.commandsAllowed || 99), level.id + " over par");
  }
});

test("curriculum covers every major pack", () => {
  const seqs = new Set(allLevels().map((l) => l.sequence));
  for (const s of [
    "intro",
    "lazy",
    "actions",
    "shuffle",
    "optimize",
    "sql",
    "joins",
    "analytics",
    "internals",
    "data",
    "streaming",
    "mlops",
    "ops",
  ]) {
    assert.ok(seqs.has(s), "missing sequence " + s);
  }
  assert.ok(allLevels().length >= 30, "curriculum too small");
});
