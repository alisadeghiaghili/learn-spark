/**
 * Terminal view: history, word-wise Tab completion, ghost hint (no stacked text).
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const BASE_COMMANDS = [
  "load sales",
  "load users",
  "load products",
  "load logs",
  "filter amount > 100",
  "filter region == west",
  "select region, amount",
  "withColumn tipped amount * 1.1",
  "sort amount desc",
  "limit 5",
  "groupBy region sum amount",
  "groupBy region count *",
  "join users on user_id",
  "join users on user_id broadcast",
  "join users on user_id sort-merge",
  "join campaigns on user_id left",
  "join campaigns on user_id full",
  "window rank amount over region amount desc",
  "window sum amount over region ts",
  "explode tags",
  "udf upper region",
  "udf tax amount",
  "drop ts",
  "distinct",
  "sample 0.5",
  "set executor.mb 0.001",
  "set broadcast.threshold 10",
  "set udf.mode python",
  "set speculate on",
  "set format csv",
  "set format parquet",
  "salt user_id 4",
  "cube region sum amount",
  "approx user_id",
  "get tags mobile",
  "mapExplode tags",
  "ml vectorize amount,user_id",
  "ml fit amount",
  "ml predict",
  "stream emit",
  "stream watermark 10m",
  "injectFail 0",
  "groupBy region sum amount, count *",
  "repartition 4",
  "coalesce 2",
  "cache",
  "unpersist",
  "show",
  "count",
  "collect",
  "schema",
  "columns",
  "explain",
  "write",
  "sparksql select region, amount from sales where amount > 100",
  "levels",
  "goal",
  "hint",
  "undo",
  "reset",
  "clear",
  "next",
  "sandbox",
  "help",
];

/**
 * Split a line into completed words and the partial current token.
 *
 * @param {string} value
 * @returns {{ head: string[], current: string, afterSpace: boolean }}
 */
export function parseLine(value) {
  const endsWithSpace = /\s$/.test(value);
  const trimmed = value.replace(/\s+$/, "");
  if (!trimmed) {
    return { head: [], current: "", afterSpace: endsWithSpace };
  }
  const parts = trimmed.split(/\s+/);
  if (endsWithSpace) {
    return { head: parts, current: "", afterSpace: true };
  }
  return {
    head: parts.slice(0, -1),
    current: parts[parts.length - 1],
    afterSpace: false,
  };
}

export class TerminalView {
  /**
   * @param {HTMLElement} root
   * @param {(cmd: string) => void} onSubmit
   */
  constructor(root, onSubmit) {
    this.onSubmit = onSubmit;
    root.innerHTML = [
      '<div class="term-log" id="term-log" role="log" aria-live="polite"></div>',
      '<div class="term-hint" id="term-hint" hidden></div>',
      '<div class="term-input-row">',
      '  <label class="prompt" for="term-in">spark&gt;</label>',
      '  <div class="term-input-wrap" id="term-input-wrap">',
      '    <div class="term-ghost" id="term-ghost" aria-hidden="true"></div>',
      '    <input id="term-in" class="term-input" autocomplete="off" spellcheck="false" placeholder="load sales" />',
      "  </div>",
      "</div>",
    ].join("");
    this.logEl = root.querySelector("#term-log");
    this.inputEl = root.querySelector("#term-in");
    this.wrapEl = root.querySelector("#term-input-wrap");
    this.ghostEl = root.querySelector("#term-ghost");
    this.hintEl = root.querySelector("#term-hint");
    this.lines = [];
    this.history = [];
    this.historyIdx = -1;
    this.draft = "";
    this.hint = "";
    this.extraCompletions = [];
    this.wordCycle = [];
    this.wordIdx = 0;
    this.wordKey = "";
    this.measureCtx = null;

    this.inputEl.addEventListener("keydown", (e) => this.onKey(e));
    this.inputEl.addEventListener("input", () => this.syncGhost());
  }

  focus() {
    if (document.querySelector(".modal-backdrop.open")) return;
    this.inputEl.focus();
    const len = this.inputEl.value.length;
    try {
      this.inputEl.setSelectionRange(len, len);
    } catch (e) {
      // ignore
    }
  }

  /**
   * @param {{ kind: string, text: string }[]} lines
   */
  setLog(lines) {
    this.lines = lines;
    this.render();
  }

  /**
   * @param {string} kind
   * @param {string} text
   */
  push(kind, text) {
    this.lines.push({ kind: kind, text: text });
    if (this.lines.length > 400) this.lines = this.lines.slice(-300);
    this.render();
  }

  pushHistory(cmd) {
    const trimmed = String(cmd || "").trim();
    if (!trimmed) return;
    this.history.push(trimmed);
    this.historyIdx = this.history.length;
  }

  clear() {
    this.lines = [];
    this.render();
  }

  render() {
    const html = this.lines
      .map(function (l) {
        const prefix = l.kind === "cmd" ? "spark> " : "";
        return '<div class="line ' + l.kind + '">' + prefix + escapeHtml(l.text) + "</div>";
      })
      .join("");
    this.logEl.innerHTML = html;
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /**
   * @param {string|null} command
   */
  setHint(command) {
    this.hint = command || "";
    // Empty input: placeholder only — never stacked with ghost.
    this.inputEl.placeholder = this.hint
      ? "try: " + this.hint
      : "Type a command — help · levels · hint · next";
    this.hintEl.hidden = !this.hint;
    if (this.hint) {
      this.hintEl.innerHTML =
        "Next: <code>" + escapeHtml(this.hint) + '</code> <span class="par-note">· Tab fills word</span>';
    } else {
      this.hintEl.textContent = "";
    }
    this.syncGhost();
  }

  /**
   * @param {string[]} commands
   */
  setExtraCompletions(commands) {
    this.extraCompletions = (commands || []).filter(Boolean);
  }

  allCompletions() {
    const seen = [];
    const add = (w) => {
      if (w && seen.indexOf(w) === -1) seen.push(w);
    };
    this.extraCompletions.forEach(add);
    BASE_COMMANDS.forEach(add);
    for (let i = this.history.length - 1; i >= 0; i -= 1) add(this.history[i]);
    return seen;
  }

  /**
   * @param {string[]} head
   * @param {string} current
   * @returns {string[]}
   */
  matchingCommands(head, current) {
    const cur = current.toLowerCase();
    return this.allCompletions().filter(function (cmd) {
      const words = cmd.split(/\s+/);
      if (words.length <= head.length) {
        if (head.length && words.length === head.length) {
          return words.every(function (w, i) { return w === head[i]; });
        }
        return false;
      }
      for (let i = 0; i < head.length; i += 1) {
        if (words[i] !== head[i]) return false;
      }
      if (!cur) return true;
      return (words[head.length] || "").toLowerCase().indexOf(cur) === 0;
    });
  }

  /**
   * Distinct next-word options, hint first.
   *
   * @param {string[]} head
   * @param {string} current
   * @returns {string[]}
   */
  nextWords(head, current) {
    const matches = this.matchingCommands(head, current);
    const words = [];
    const push = (w) => {
      if (w && words.indexOf(w) === -1) words.push(w);
    };
    if (this.hint) {
      const hw = this.hint.split(/\s+/);
      const okHead = head.every(function (h, i) { return hw[i] === h; });
      if (okHead) push(hw[head.length]);
    }
    matches.forEach(function (cmd) {
      push(cmd.split(/\s+/)[head.length]);
    });
    const cur = current.toLowerCase();
    return words.filter(function (w) { return !current || w.toLowerCase().indexOf(cur) === 0; });
  }

  measureText(text) {
    if (!this.measureCtx) {
      const c = document.createElement("canvas");
      this.measureCtx = c.getContext("2d");
    }
    const ctx = this.measureCtx;
    if (!ctx) return text.length * 7.2;
    const font = window.getComputedStyle(this.inputEl).font;
    ctx.font = font || "13px Consolas, monospace";
    return ctx.measureText(text).width;
  }

  /**
   * Ghost shows only the rest of the current word (or next word after a space).
   * Empty input uses placeholder alone so two texts never stack.
   */
  syncGhost() {
    const value = this.inputEl.value;
    this.ghostEl.dataset.visible = "0";
    this.ghostEl.textContent = "";
    this.wrapEl.classList.remove("has-ghost");

    if (!value) return;

    const parsed = parseLine(value);
    const words = this.nextWords(parsed.head, parsed.afterSpace ? "" : parsed.current);
    const first = words[0];
    if (!first) return;

    if (parsed.afterSpace) {
      this.ghostEl.textContent = first;
      this.ghostEl.style.left = this.measureText(value) + "px";
      this.ghostEl.dataset.visible = "1";
      this.wrapEl.classList.add("has-ghost");
      return;
    }

    if (
      first.toLowerCase().indexOf(parsed.current.toLowerCase()) !== 0 ||
      first.length <= parsed.current.length
    ) {
      return;
    }

    // Suffix of the current word only — not the whole command line.
    this.ghostEl.textContent = first.slice(parsed.current.length);
    this.ghostEl.style.left = this.measureText(value) + "px";
    this.ghostEl.dataset.visible = "1";
    this.wrapEl.classList.add("has-ghost");
  }

  /**
   * Real-terminal Tab: complete the current word (or next word), cycle on repeat.
   *
   * @param {KeyboardEvent} e
   */
  applyTab(e) {
    e.preventDefault();
    const value = this.inputEl.value;
    const parsed = parseLine(value);
    const cycleKey = parsed.head.join(" ") + "|" + (parsed.afterSpace ? "" : parsed.current);

    if (!value && this.hint) {
      const firstWord = this.hint.split(/\s+/)[0];
      this.inputEl.value = firstWord;
      this.wordCycle = [firstWord];
      this.wordIdx = 0;
      this.wordKey = firstWord;
      this.focus();
      this.syncGhost();
      return;
    }

    const options = this.nextWords(parsed.head, parsed.afterSpace ? "" : parsed.current);
    if (!options.length) {
      this.syncGhost();
      return;
    }

    if (cycleKey !== this.wordKey || !this.wordCycle.length) {
      this.wordKey = cycleKey;
      this.wordCycle = options;
      this.wordIdx = 0;
    } else {
      this.wordIdx = (this.wordIdx + 1) % this.wordCycle.length;
    }

    const chosen = this.wordCycle[this.wordIdx] || options[0];
    const headText = parsed.head.length ? parsed.head.join(" ") + " " : "";
    // Complete ONLY the current/next word — not the entire command.
    this.inputEl.value = headText + chosen;
    this.focus();
    this.syncGhost();

    if (this.wordCycle.length > 1) {
      const preview = this.wordCycle.slice(0, 6).join(" · ");
      this.hintEl.hidden = false;
      this.hintEl.innerHTML =
        "Tab word <strong>" +
        (this.wordIdx + 1) +
        "/" +
        this.wordCycle.length +
        "</strong>: <code>" +
        escapeHtml(preview) +
        "</code>" +
        (this.wordCycle.length > 6 ? " …" : "");
    } else if (this.hint) {
      this.hintEl.innerHTML =
        "Next: <code>" + escapeHtml(this.hint) + '</code> <span class="par-note">· Tab fills word</span>';
    }
  }

  onKey(e) {
    if (e.key === "Tab") {
      this.applyTab(e);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.inputEl.value = "";
      this.wordCycle = [];
      this.wordKey = "";
      this.syncGhost();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (document.querySelector(".modal-backdrop.open")) return;
      const value = this.inputEl.value;
      this.inputEl.value = "";
      const trimmed = value.trim();
      if (trimmed) {
        this.history.push(trimmed);
        this.historyIdx = this.history.length;
      }
      this.wordCycle = [];
      this.wordKey = "";
      this.onSubmit(value);
      this.focus();
      this.syncGhost();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!this.history.length) return;
      if (this.historyIdx === this.history.length) this.draft = this.inputEl.value;
      this.historyIdx = Math.max(0, this.historyIdx - 1);
      this.inputEl.value = this.history[this.historyIdx] || "";
      this.wordCycle = [];
      this.focus();
      this.syncGhost();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!this.history.length) return;
      this.historyIdx = Math.min(this.history.length, this.historyIdx + 1);
      this.inputEl.value =
        this.historyIdx >= this.history.length
          ? this.draft
          : this.history[this.historyIdx] || "";
      this.wordCycle = [];
      this.focus();
      this.syncGhost();
    }
  }
}
