/**
 * Share payload and curriculum summary tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { shareMessageLinkedIn, shareMessageX, buildShareTargets, SHARE_URL } from "../src/ui/share.js";
import { summarizeCurriculum, loadProgress, saveProgress } from "../src/ui/progress.js";
import { parseLine } from "../src/ui/terminal.js";
import { allLevels, LEVELS } from "../src/game/levels.js";

const ctx = {
  levelName: "Narrow filter",
  levelId: "filter-tour",
  commands: 3,
  par: 5,
  curriculum: {
    solvedCount: 2,
    total: 12,
    learned: [
      { id: "welcome", name: "Welcome to learnSpark", seriesTitle: "INTRO", learning: [] },
      { id: "filter-tour", name: "Narrow filter", seriesTitle: "INTRO", learning: [] },
    ],
    remaining: [],
    next: null,
    percent: 17,
  },
};

test("LinkedIn share includes curriculum bullets and link", () => {
  const text = shareMessageLinkedIn(ctx);
  assert.match(text, /What I have learned so far:/);
  assert.match(text, /INTRO: Welcome to learnSpark/);
  assert.match(text, /INTRO: Narrow filter/);
  assert.match(text, /Progress: 2\/12 levels/);
  assert.ok(text.includes(SHARE_URL));
  assert.match(text, /Latest win: Narrow filter \(filter-tour\)/);
});

test("X share stays short and links the app", () => {
  const text = shareMessageX(ctx);
  assert.ok(text.includes(SHARE_URL));
  assert.ok(text.length <= 280);
});

test("buildShareTargets encodes share URLs", () => {
  const t = buildShareTargets(ctx);
  assert.ok(t.linkedin.startsWith("https://www.linkedin.com/shareArticle"));
  assert.ok(t.x.startsWith("https://twitter.com/intent/tweet"));
  assert.ok(t.facebook.startsWith("https://www.facebook.com/sharer"));
  assert.equal(t.url, SHARE_URL);
  assert.ok(t.learnedLines.length >= 2);
});

test("curriculum summary splits learned vs remaining", () => {
  const progress = { welcome: { solved: true, bestCommands: 2 } };
  const s = summarizeCurriculum(progress);
  assert.equal(s.solvedCount, 1);
  assert.equal(s.total, allLevels().length);
  assert.equal(s.learned[0].id, "welcome");
  assert.equal(s.next.id, "filter-tour");
});

test("parseLine splits head and current token", () => {
  assert.deepEqual(parseLine("filter amount > "), {
    head: ["filter", "amount", ">"],
    current: "",
    afterSpace: true,
  });
  assert.deepEqual(parseLine("fil"), {
    head: [],
    current: "fil",
    afterSpace: false,
  });
  assert.deepEqual(parseLine("filter amount >"), {
    head: ["filter", "amount"],
    current: ">",
    afterSpace: false,
  });
});

test("every level has teach copy and learn outcomes", () => {
  for (const level of allLevels()) {
    assert.ok(level.intro && level.intro.length > 80, level.id + " intro too thin");
    assert.ok(Array.isArray(level.learn) && level.learn.length >= 2, level.id + " learn missing");
    assert.ok(LEVELS[level.id].goalText);
  }
});
