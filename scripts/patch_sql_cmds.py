"""Use real SQL parser in commands.js sparksql."""
from pathlib import Path

p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\commands.js")
t = p.read_text(encoding="utf-8")

t = t.replace(
    'import { applySetting, describeSettings, resetSettings, settings as getSettings } from "./settings.js";',
    'import { applySetting, describeSettings, resetSettings, settings as getSettings } from "./settings.js";\nimport { parseSelect } from "./sql.js";',
)

# replace sqlToOps body with parser-based mapping
start = t.find("function sqlToOps(sql) {")
end = t.find("function explainText(df, result) {")
if start < 0 or end < 0:
    raise SystemExit("sqlToOps markers not found")

new_fn = r'''function sqlToOps(sql) {
  const ast = parseSelect(sql);
  let frame = createSource(ast.table);
  if (ast.where) frame = filter(frame, ast.where);
  if (ast.groupBy && ast.groupBy.length) {
    const first = ast.aggs[0] || { fn: "count", col: null };
    frame = groupBy(frame, ast.groupBy, first.fn, first.col);
    return frame;
  }
  if (ast.orderBy) frame = sort(frame, ast.orderBy.col, ast.orderBy.desc);
  if (ast.star || !ast.cols.length) return frame;
  const projected = ast.cols.filter(function (c) { return c.indexOf("(") === -1; });
  return projected.length ? select(frame, projected) : frame;
}

'''
t = t[:start] + new_fn + t[end:]
p.write_text(t, encoding="utf-8")
print("commands sql parser wired")
