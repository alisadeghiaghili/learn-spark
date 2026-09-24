"""Allow fractional executor.mb and fix mapExplode on arrays."""
from pathlib import Path

# settings: fractional executor
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\settings.js")
t = p.read_text(encoding="utf-8")
t = t.replace(
    "    settings.executorMb = Math.max(1, Number(v) || settings.executorMb);",
    "    settings.executorMb = Math.max(0.001, Number(v) || settings.executorMb);",
)
p.write_text(t, encoding="utf-8")

# mapExplode on arrays: key = element
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\execute.js")
t = p.read_text(encoding="utf-8")
t = t.replace(
    '''      if (src && typeof src === "object") {
        pairs = Object.keys(src).map(function (k) { return { key: k, value: src[k] }; });
      } else if (typeof src === "string") {''',
    '''      if (Array.isArray(src)) {
        pairs = src.map(function (v) { return { key: String(v), value: v }; });
      } else if (src && typeof src === "object") {
        pairs = Object.keys(src).map(function (k) { return { key: k, value: src[k] }; });
      } else if (typeof src === "string") {''',
)
p.write_text(t, encoding="utf-8")

# lab-spill + tests use 0.001
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\game\levels.js")
t = p.read_text(encoding="utf-8")
t = t.replace(
    'goalText: "Shrink executor memory, run a wide plan, and catch SPILLED on explain.",',
    'goalText: "Shrink executor memory to 1KB, run a wide plan, and catch SPILLED on explain.",',
)
t = t.replace(
    'Steps: set executor.mb 1 -> load sales -> groupBy region sum amount -> explain.',
    'Steps: set executor.mb 0.001 -> load sales -> groupBy region sum amount -> explain.',
)
t = t.replace(
    'hints: ["set executor.mb 1", "load sales", "groupBy region sum amount", "explain"],',
    'hints: ["set executor.mb 0.001", "load sales", "groupBy region sum amount", "explain"],',
)
t = t.replace(
    '{ type: "setting", label: "executor.mb is tiny", key: "executorMb", value: 1 },',
    '{ type: "setting", label: "executor.mb is 1KB", key: "executorMb", value: 0.001 },',
)
t = t.replace(
    'Then `set executor.mb 32` and explain again - spill disappears.',
    'Then `set executor.mb 32` and explain again - spill disappears.',
)
p.write_text(t, encoding="utf-8")

p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\tests\levels.test.js")
t = p.read_text(encoding="utf-8")
t = t.replace(
    '"lab-spill": ["set executor.mb 1", "load sales", "groupBy region sum amount", "explain"],',
    '"lab-spill": ["set executor.mb 0.001", "load sales", "groupBy region sum amount", "explain"],',
)
p.write_text(t, encoding="utf-8")

p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\tests\engine.test.js")
t = p.read_text(encoding="utf-8")
t = t.replace(
    '  applySetting("executor.mb", "1");',
    '  applySetting("executor.mb", "0.001");',
)
p.write_text(t, encoding="utf-8")

# terminal completion
p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\ui\terminal.js")
t = p.read_text(encoding="utf-8")
t = t.replace('"set executor.mb 1",', '"set executor.mb 0.001",')
p.write_text(t, encoding="utf-8")

print("fractional memory + mapExplode arrays")
