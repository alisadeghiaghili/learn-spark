"""Add real array/struct columns to datasets."""
from pathlib import Path

p = Path(r"C:\Users\alisa\Desktop\Projects\learn-spark\src\engine\datasets.js")
t = p.read_text(encoding="utf-8")
t = t.replace(
    '{ id: 1, user_id: 1, event: "click", tags: "mobile,promo", ts: "2024-02-01" },',
    '{ id: 1, user_id: 1, event: "click", tags: ["mobile", "promo"], props: { device: "ios", v: 3 }, ts: "2024-02-01" },',
)
t = t.replace(
    '{ id: 2, user_id: 2, event: "view", tags: "desktop", ts: "2024-02-01" },',
    '{ id: 2, user_id: 2, event: "view", tags: ["desktop"], props: { device: "mac", v: 1 }, ts: "2024-02-01" },',
)
t = t.replace(
    '{ id: 3, user_id: 1, event: "purchase", tags: "mobile,vip", ts: "2024-02-02" },',
    '{ id: 3, user_id: 1, event: "purchase", tags: ["mobile", "vip"], props: { device: "ios", v: 5 }, ts: "2024-02-02" },',
)
t = t.replace(
    '{ id: 4, user_id: 3, event: "click", tags: "mobile", ts: "2024-02-02" },',
    '{ id: 4, user_id: 3, event: "click", tags: ["mobile"], props: { device: "android", v: 2 }, ts: "2024-02-02" },',
)
t = t.replace(
    '{ id: 5, user_id: 4, event: "view", tags: "desktop,promo", ts: "2024-02-03" },',
    '{ id: 5, user_id: 4, event: "view", tags: ["desktop", "promo"], props: { device: "mac", v: 4 }, ts: "2024-02-03" },',
)
t = t.replace(
    '{ id: 6, user_id: 2, event: "click", tags: "promo", ts: "2024-02-03" },',
    '{ id: 6, user_id: 2, event: "click", tags: ["promo"], props: { device: "ios", v: 2 }, ts: "2024-02-03" },',
)
t = t.replace(
    '{ id: 7, user_id: 5, event: "purchase", tags: "mobile", ts: "2023-01-01" },',
    '{ id: 7, user_id: 5, event: "purchase", tags: ["mobile"], props: { device: "android", v: 1 }, ts: "2023-01-01" },',
)
t = t.replace(
    '{ id: 8, user_id: 6, event: "click", tags: "promo", ts: "2024-02-10" },',
    '{ id: 8, user_id: 6, event: "click", tags: ["promo"], props: { device: "ios", v: 9 }, ts: "2024-02-10" },',
)
t = t.replace(
    '{ name: "tags", type: "string" },',
    '{ name: "tags", type: "array<string>" },\n      { name: "props", type: "struct" },',
)
t = t.replace(
    '{ id: 1, name: "ada", tier: "gold", city: "berlin" },',
    '{ id: 1, name: "ada", tier: "gold", city: "berlin", profile: { plan: "pro", seats: 3 } },',
)
t = t.replace(
    '{ name: "city", type: "string" },',
    '{ name: "city", type: "string" },\n      { name: "profile", type: "struct" },',
)
p.write_text(t, encoding="utf-8")
print("datasets nested", p.stat().st_size)
