/**
 * Social share payloads (LinkedIn, X, Facebook, copy) with curriculum list.
 */

export const LIVE_URL = "https://alisadeghiaghili.github.io/learn-spark/";
export const SHARE_URL = "https://alisadeghiaghili.github.io/learn-spark/";
export const REPO_URL = "https://github.com/alisadeghiaghili/learn-spark";
export const TITLE = "learnSpark — interactive Apache Spark tutorial";

/**
 * @typedef {{ levelName: string, levelId: string, commands: number|null, par: number, curriculum: any }} ShareContext
 */

/**
 * Bullet lines for learned curriculum items.
 *
 * @param {any[]} items
 * @returns {string[]}
 */
function bulletList(items) {
  return (items || []).map(function (l) {
    return "• " + l.seriesTitle + ": " + l.name;
  });
}

/**
 * Long post (LinkedIn / Facebook / clipboard).
 *
 * @param {ShareContext} ctx
 * @returns {string}
 */
export function shareMessageLinkedIn(ctx) {
  const c = ctx.curriculum;
  const learned = bulletList(c.learned);
  const parts = [
    "I am really happy — I just learned practical Apache Spark execution on learnSpark!",
    "",
  ];
  if (c.solvedCount > 0) {
    parts.push(
      "Latest win: " + ctx.levelName + " (" + ctx.levelId + ")" +
        (ctx.commands !== null ? " in " + ctx.commands + " commands (par " + ctx.par + ")" : "")
    );
  } else {
    parts.push("My Spark journey just started.");
  }
  parts.push("");
  if (learned.length) {
    parts.push("What I have learned so far:");
    for (let i = 0; i < learned.length; i += 1) parts.push(learned[i]);
    parts.push("");
  }
  parts.push("Progress: " + c.solvedCount + "/" + c.total + " levels.");
  parts.push("");
  parts.push("If you work with data pipelines or Spark jobs, try it — free, no login:");
  parts.push(SHARE_URL);
  return parts.filter(function (x) { return x !== null && x !== undefined; }).join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Short post for X.
 *
 * @param {ShareContext} ctx
 * @returns {string}
 */
export function shareMessageX(ctx) {
  const c = ctx.curriculum;
  const head = "Level " + c.solvedCount + "/" + c.total + " cleared on learnSpark — learning Apache Spark by visualizing jobs.";
  const first = c.learned[0] ? "• " + c.learned[0].name : "lazy plans · shuffles · cache";
  let text = head + "\n" + first + "\n" + SHARE_URL;
  if (text.length > 275) text = head + "\n" + SHARE_URL;
  return text;
}

/**
 * Build open-urls + texts.
 *
 * @param {ShareContext} ctx
 * @returns {{ linkedin: string, x: string, facebook: string, text: string, shortText: string, url: string, learnedLines: string[] }}
 */
export function buildShareTargets(ctx) {
  const longText = shareMessageLinkedIn(ctx);
  const shortText = shareMessageX(ctx);
  const url = SHARE_URL;
  return {
    linkedin:
      "https://www.linkedin.com/shareArticle?mini=true&url=" +
      encodeURIComponent(url) +
      "&title=" +
      encodeURIComponent(TITLE) +
      "&summary=" +
      encodeURIComponent(longText) +
      "&source=learnSpark",
    x: "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shortText),
    facebook:
      "https://www.facebook.com/sharer/sharer.php?u=" +
      encodeURIComponent(url) +
      "&quote=" +
      encodeURIComponent(longText),
    text: longText,
    shortText: shortText,
    url: url,
    learnedLines: bulletList(ctx.curriculum.learned),
  };
}

/**
 * Open a share window.
 *
 * @param {string} url
 * @returns {void}
 */
export function openShareWindow(url) {
  window.open(url, "_blank", "noopener,noreferrer,width=720,height=640");
}

/**
 * Copy payload to clipboard.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copySharePayload(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e2) {
      return false;
    }
  }
}

/**
 * Open target and copy text as fallback for networks that drop prefilled posts.
 *
 * @param {'linkedin'|'facebook'|'x'|'copy'} kind
 * @param {any} targets
 * @returns {Promise<{ opened: boolean, copied: boolean }>}
 */
export async function shareWithClipboard(kind, targets) {
  if (kind === "copy") {
    return { opened: false, copied: await copySharePayload(targets.text) };
  }
  const copied = await copySharePayload(kind === "x" ? targets.shortText : targets.text);
  const href = kind === "linkedin" ? targets.linkedin : kind === "facebook" ? targets.facebook : targets.x;
  openShareWindow(href);
  return { opened: true, copied: copied };
}
