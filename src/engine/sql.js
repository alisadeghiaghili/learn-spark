/**
 * Small real SQL parser (tokenizer + AST) for SELECT / WHERE / GROUP BY / ORDER BY.
 * Not a port of Catalyst — but a genuine parse, not a regex guess.
 */

/**
 * @typedef {{ type: 'select', cols: string[], star: boolean, table: string, where: string|null, groupBy: string[], orderBy: { col: string, desc: boolean }|null, aggs: { fn: string, col: string|null, alias: string }[] }} SelectAst
 */

/**
 * Tokenize SQL into words, punctuation, strings.
 *
 * @param {string} sql
 * @returns {Array<{ t: string, v: string }>}
 */
export function tokenizeSql(sql) {
  const out = [];
  let i = 0;
  const s = sql.trim();
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      let buf = "";
      while (j < s.length && s[j] !== ch) {
        buf += s[j];
        j += 1;
      }
      out.push({ t: "str", v: buf });
      i = j + 1;
      continue;
    }
    if (/[(),*=<>!]/.test(ch)) {
      if ((ch === "<" || ch === ">" || ch === "!" || ch === "=") && s[i + 1] === "=") {
        out.push({ t: "op", v: ch + "=" });
        i += 2;
        continue;
      }
      out.push({ t: ch === "," || ch === "(" || ch === ")" ? ch : "op", v: ch });
      i += 1;
      continue;
    }
    let j = i;
    let buf = "";
    while (j < s.length && !/[\s(),*=<>!]/.test(s[j])) {
      buf += s[j];
      j += 1;
    }
    out.push({ t: "id", v: buf });
    i = j;
  }
  return out;
}

const AGGS = ["sum", "count", "avg", "min", "max"];

/**
 * Parse SELECT statement.
 *
 * @param {string} sql
 * @returns {SelectAst}
 */
export function parseSelect(sql) {
  const toks = tokenizeSql(String(sql).replace(/;\s*$/, ""));
  const words = toks.map(function (t) { return t.t === "id" ? t.v.toLowerCase() : t.v; });
  function expect(word) {
    const t = toks.shift();
    if (!t || (t.t === "id" && t.v.toLowerCase() === word)) return t;
    if (t && t.v.toLowerCase() === word) return t;
    throw new Error("SQL parse error: expected " + word + " near '" + (t ? t.v : "EOF") + "'");
  }
  function peek() {
    return toks[0] || null;
  }
  function isKw(w) {
    const t = peek();
    return t && t.t === "id" && t.v.toLowerCase() === w;
  }

  expect("select");

  // projection
  /** @type {string[]} */
  const cols = [];
  /** @type {{ fn: string, col: string|null, alias: string }[]} */
  const aggs = [];
  let star = false;

  function parseProjItem() {
    const t = toks.shift();
    if (!t) throw new Error("SQL parse error: empty projection");
    if (t.t === "op" && t.v === "*") {
      star = true;
      return;
    }
    if (t.t === "id" && AGGS.indexOf(t.v.toLowerCase()) !== -1 && peek() && peek().t === "(") {
      const fn = t.v.toLowerCase();
      toks.shift(); // (
      const inner = toks.shift();
      let col = null;
      if (inner && !(inner.t === "op" && inner.v === "*")) col = inner.v;
      expect(")");
      const alias = fn + "(" + (col || "*") + ")";
      aggs.push({ fn: fn, col: col, alias: alias });
      cols.push(alias);
      return;
    }
    cols.push(t.v);
  }

  parseProjItem();
  while (peek() && peek().t === ",") {
    toks.shift();
    parseProjItem();
  }

  expect("from");
  const tableTok = toks.shift();
  if (!tableTok) throw new Error("SQL parse error: missing table");
  const table = tableTok.v;

  let where = null;
  if (isKw("where")) {
    toks.shift();
    const buf = [];
    while (peek() && !isKw("group") && !isKw("order")) {
      const t = toks.shift();
      buf.push(t.t === "str" ? "'" + t.v + "'" : t.v);
    }
    where = buf.join(" ").replace(/\s+([<>=!]+)\s+/g, " $1 ");
  }

  /** @type {string[]} */
  const groupBy = [];
  if (isKw("group")) {
    toks.shift();
    expect("by");
    const g = toks.shift();
    groupBy.push(g.v);
    while (peek() && peek().t === ",") {
      toks.shift();
      const x = toks.shift();
      groupBy.push(x.v);
    }
  }

  /** @type {{ col: string, desc: boolean }|null} */
  let orderBy = null;
  if (isKw("order")) {
    toks.shift();
    expect("by");
    const c = toks.shift();
    let desc = false;
    if (isKw("desc")) {
      toks.shift();
      desc = true;
    } else if (isKw("asc")) {
      toks.shift();
    }
    orderBy = { col: c.v, desc: desc };
  }

  if (toks.length) {
    throw new Error("SQL parse error: unexpected token '" + toks[0].v + "'");
  }

  void words;
  return {
    type: "select",
    cols: cols,
    star: star,
    table: table,
    where: where,
    groupBy: groupBy,
    orderBy: orderBy,
    aggs: aggs,
  };
}
