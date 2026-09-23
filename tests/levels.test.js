/**
 * Level solvability checks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execute, createState } from "../src/engine/commands.js";
import { LEVELS, allLevels, checkGoals } from "../src/game/levels.js";

/**
 * Run a command script against a fresh state.
 *
 * @param {string[]} script
 * @returns {object}
 */
function runScript(script) {
  let state = createState();
  for (const line of script) {
    const r = execute(state, line, { level: null });
    state = r.state;
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
  "group-regions": ["load sales", "groupBy region sum amount", "show"],
  "join-users": ["load sales", "join users on user_id", "show"],
  "cache-it": ["load sales", "filter amount > 50", "cache", "show", "count"],
  "tune-parts": ["load sales", "repartition 4", "show"],
  "sparksql-tour": ["sparksql select region, amount from sales where amount > 100"],
  pipeline: ["load sales", "filter amount > 20", "withColumn tipped amount * 1.1", "groupBy region sum tipped", "show"],
};

test("every level has a known solution", () => {
  for (const level of allLevels()) {
    assert.ok(SOLUTIONS[level.id], "missing solution for " + level.id);
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
