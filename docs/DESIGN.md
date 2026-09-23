# learnSpark — Design Notes

Interactive Spark visualization and tutorial sandbox.

## Product model

| Surface | Role |
| --- | --- |
| Job DAG | Logical plan with stage / shuffle boundaries |
| Partition view | Row buckets on executors |
| Terminal | Teaching command language + history + Tab |
| Goals rail | Live checklist with neon focus on the active step |
| Celebrate modal | Win + share curriculum to LinkedIn / X / Facebook |

## Visual direction

- **Style anchor**: Apache Spark technical docs dark chrome × Databricks console density.
- **Palette**: canvas `#0B0F14`, surface `#141A21`, elevated `#1C2430`, ink `#E8EEF4`, muted `#7D8B99`, accent `#E25A1C` (Spark orange), success `#3FB950`, stage `#A371F7`, partition `#2DD4BF`, danger `#F85149`.
- **Typography**: UI `Segoe UI, system-ui, sans-serif`; terminal/code `Cascadia Code, Consolas, JetBrains Mono, monospace`.
- **Layout**: full-viewport app — left level rail, center DAG + preview, right goal rail, bottom REPL.
- **Signature moments**:
  1. An **action** animates packets along DAG edges into partition cells.
  2. A **shuffle** (groupBy/join/repartition) draws a stage barrier and scatters rows across executors.
  3. Clearing a level bursts confetti and offers a curriculum-aware share post.

## Command language (teaching subset)

```
help | levels | goal | hint | undo | reset | clear | next
load <table>
show | count | schema | columns | explain | collect | write
filter <expr>
select <col[ , col...>
withColumn <name> <expr>
groupBy <keys> <sum|count|avg|min|max> [col]
join <table> on <key>
sort <col> [desc]
limit <n>
repartition <n> | coalesce <n>
cache | unpersist
sparksql <select ...>
```

## Level sequences

1. **intro** — load, show, schema, filter, select
2. **lazy** — transformations vs actions; `explain`
3. **actions** — count, collect, write semantics
4. **shuffle** — groupBy, join, wide dependencies
5. **optimize** — cache, repartition, coalesce
6. **advanced** — sparksql, multi-stage plans

## Architecture decisions

See `docs/ADR-001-client-only-sim.md`. Engine is a deterministic in-browser simulator (no cluster). Visualization is SVG. No backend. Progress: localStorage + long-lived cookie.

## Scope boundaries

- Does **not** run real Spark; it teaches execution *model* (lazy plans, stages, shuffles, cache).
- Does **not** implement full Catalyst optimizer, memory manager, or Tungsten.
- Does implement enough row semantics for goals and previews to be honest about results.
