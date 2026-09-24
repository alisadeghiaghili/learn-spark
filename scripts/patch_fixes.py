"""Fix spill counter scope and sort-merge unmatched tail."""
from pathlib import Path

p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\execute.js")
t = p.read_text(encoding="utf-8")

# module-level spill counters used by aggregate()
t = t.replace(
    "let idSeq = 0;",
    "let idSeq = 0;\n/** @type {number} */\nlet groupSpillFiles = 0;\n/** @type {number} */\nlet groupSpilledBytes = 0;\n/** @type {boolean} */\nlet spilledFlag = false;",
)
# if idSeq not in execute.js, add after imports
if "groupSpillFiles = 0" not in t:
    t = t.replace(
        'import { analyzeCodegen } from "./codegen.js";',
        'import { analyzeCodegen } from "./codegen.js";\n\nlet groupSpillFiles = 0;\nlet groupSpilledBytes = 0;\nlet spilledFlag = false;',
    )

t = t.replace(
    "  groupSpillFiles += packed.spillFiles;\n  groupSpilledBytes += packed.spilledBytes;\n  if (packed.spillFiles) spilled = true;",
    "  groupSpillFiles += packed.spillFiles;\n  groupSpilledBytes += packed.spilledBytes;\n  if (packed.spillFiles) spilledFlag = true;",
)

# reset counters at start of materialize
t = t.replace(
    "  let spilled = false;\n  let cacheHits = 0;",
    "  groupSpillFiles = 0;\n  groupSpilledBytes = 0;\n  spilledFlag = false;\n  let spilled = false;\n  let cacheHits = 0;",
)

# fold spilledFlag into spilled at end of materialize
t = t.replace(
    "  const columns = rows.length ? Object.keys(rows[0]) : inferColumns(spine);",
    "  spilled = spilled || spilledFlag;\n  const columns = rows.length ? Object.keys(rows[0]) : inferColumns(spine);",
)

# local groupSpillFiles declarations conflict - remove local ones
t = t.replace(
    "  let joinStats = null;\n  let distribution = [];\n  let skewRatio = 1;\n  let groupSpillFiles = 0;\n  let groupSpilledBytes = 0;",
    "  let joinStats = null;\n  let distribution = [];\n  let skewRatio = 1;",
)

p.write_text(t, encoding="utf-8")
print("execute spill scope fixed")

j = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\joins.js")
t = j.read_text(encoding="utf-8")
old = """    let i = 0;
    let j = 0;
    while (i < sl.rows.length && j < sr.rows.length) {"""
new = """    let i = 0;
    let j = 0;
    while (i < sl.rows.length || j < sr.rows.length) {
      if (i >= sl.rows.length) {
        if (type === "right" || type === "full") rows.push(strip(pad(sr.rows[j], left)));
        j += 1;
        continue;
      }
      if (j >= sr.rows.length) {
        if (type === "left" || type === "full") rows.push(strip(pad(sl.rows[i], right)));
        i += 1;
        continue;
      }"""
if old not in t:
    raise SystemExit("smj loop not found")
t = t.replace(old, new, 1)
j.write_text(t, encoding="utf-8")
print("smj tail fixed")
