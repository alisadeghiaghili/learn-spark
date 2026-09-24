"""Append honest-engine tests."""
from pathlib import Path

p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\tests\engine.test.js")
p.write_text(
    p.read_text(encoding="utf-8")
    + r'''

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
''',
    encoding="utf-8",
)
print("honest tests appended")
