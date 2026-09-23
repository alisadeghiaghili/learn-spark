/**
 * Progress persistence (localStorage + cookie) and curriculum summary.
 */

import { allLevels, getNextLevel } from "../game/levels.js";

export const STORAGE_KEY = "learnspark.progress.v1";
export const COOKIE_KEY = "learn_spark_progress";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

/**
 * @typedef {{ solved?: boolean, bestCommands?: number }} LevelProgress
 */

/**
 * Read the progress cookie payload.
 *
 * @returns {string|null}
 */
function readCookie() {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";");
  for (let i = 0; i < parts.length; i += 1) {
    const raw = parts[i].trim().split("=");
    const rawKey = raw[0];
    if (rawKey !== COOKIE_KEY) continue;
    try {
      return decodeURIComponent(raw.slice(1).join("="));
    } catch (e) {
      return raw.slice(1).join("=");
    }
  }
  return null;
}

/**
 * Write progress cookie (~400 days).
 *
 * @param {string} payload
 * @returns {void}
 */
function writeCookie(payload) {
  if (typeof document === "undefined") return;
  const encoded = encodeURIComponent(payload);
  document.cookie = COOKIE_KEY + "=" + encoded + "; path=/; max-age=" + COOKIE_MAX_AGE + "; SameSite=Lax";
}

/**
 * Parse persisted blob or bare map.
 *
 * @param {string|null} raw
 * @returns {Record<string, LevelProgress>|null}
 */
function parseBlob(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "progress" in parsed) {
      return parsed.progress || {};
    }
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Merge localStorage + cookie so a new browser session still resumes.
 *
 * @returns {Record<string, LevelProgress>}
 */
export function loadProgress() {
  let fromLocal = null;
  let fromCookie = null;
  try {
    fromLocal = parseBlob(localStorage.getItem(STORAGE_KEY));
  } catch (e) {
    fromLocal = null;
  }
  try {
    fromCookie = parseBlob(readCookie());
  } catch (e) {
    fromCookie = null;
  }

  const merged = {};
  const sources = [fromCookie || {}, fromLocal || {}];
  for (let s = 0; s < sources.length; s += 1) {
    const src = sources[s];
    const keys = Object.keys(src);
    for (let i = 0; i < keys.length; i += 1) {
      const id = keys[i];
      const prog = src[id];
      if (!prog) continue;
      const prev = merged[id] || {};
      const bestA = prev.bestCommands;
      const bestB = prog.bestCommands;
      let best;
      if (bestA === undefined) best = bestB;
      else if (bestB === undefined) best = bestA;
      else best = Math.min(bestA, bestB);
      merged[id] = {
        solved: Boolean(prog.solved || prev.solved),
        bestCommands: best,
      };
    }
  }
  return merged;
}

/**
 * Persist progress to localStorage + cookie.
 *
 * @param {Record<string, LevelProgress>} progress
 * @returns {void}
 */
export function saveProgress(progress) {
  const payload = JSON.stringify({
    progress: progress,
    savedAt: new Date().toISOString(),
  });
  try {
    localStorage.setItem(STORAGE_KEY, payload);
  } catch (e) {
    // private mode / quota — cookie still helps
  }
  writeCookie(payload);
}

/**
 * Curriculum summary for UI and share posts.
 *
 * @param {Record<string, LevelProgress>} progress
 * @returns {{ solvedCount: number, total: number, learned: any[], remaining: any[], next: any|null, percent: number }}
 */
export function summarizeCurriculum(progress) {
  const list = allLevels();
  const learned = [];
  const remaining = [];
  let next = null;

  for (let i = 0; i < list.length; i += 1) {
    const level = list[i];
    const item = {
      id: level.id,
      name: level.title,
      seriesTitle: (level.sequence || "").toUpperCase(),
      learning: level.learn || [],
      bestCommands: progress[level.id] ? progress[level.id].bestCommands : undefined,
    };
    if (progress[level.id] && progress[level.id].solved) {
      learned.push(item);
    } else {
      remaining.push(item);
      if (!next) next = item;
    }
  }

  let lastSolvedIdx = -1;
  for (let i = 0; i < list.length; i += 1) {
    if (progress[list[i].id] && progress[list[i].id].solved) lastSolvedIdx = i;
  }
  const officialNext = lastSolvedIdx >= 0 ? getNextLevel(list[lastSolvedIdx].id) : list[0];
  if (officialNext && progress[officialNext.id] && progress[officialNext.id].solved) {
    next = remaining[0] || null;
  } else if (officialNext) {
    let found = null;
    for (let i = 0; i < remaining.length; i += 1) {
      if (remaining[i].id === officialNext.id) found = remaining[i];
    }
    next = found || remaining[0] || null;
  }

  const percent = list.length ? Math.round((learned.length / list.length) * 100) : 0;
  return {
    solvedCount: learned.length,
    total: list.length,
    learned: learned,
    remaining: remaining,
    next: next,
    percent: percent,
  };
}

/**
 * Welcome-back terminal blurb.
 *
 * @param {any} summary
 * @returns {string}
 */
export function resumeLine(summary) {
  if (!summary.solvedCount) {
    return "No saved progress yet (" + summary.total + " levels waiting). Start with `levels`.";
  }
  const names = summary.learned.map(function (l) { return l.name; }).join(" · ");
  const nextText = summary.next
    ? "Next up: " + summary.next.name
    : "All levels cleared.";
  return [
    "Welcome back — progress saved: " + summary.solvedCount + "/" + summary.total + " levels (" + summary.percent + "%).",
    "Learned so far: " + names,
    nextText,
    "Open Levels to resume. Progress is kept in this browser (cookie + storage).",
  ].join("\n");
}
