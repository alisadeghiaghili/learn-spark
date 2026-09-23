# learnSpark — Design Notes

Interactive Spark visualization and tutorial, modeled on LearnGitBranching's game loop.

## Product mapping

| LearnGitBranching | learnSpark |
| --- | --- |
| Commit tree | Logical plan / job DAG with stage boundaries |
| Working tree / files | Row partitions on executors |
| `git commit` etc. | Spark-like commands (`load`, `filter`, `groupBy`, `show`, …) |
| Levels + goal detection | Level sequences with goal predicates + command golf |
| Sandbox | Free sandbox with demo tables |
| `undo` / `reset` | Same |

## Visual direction

- **Style anchor**: Apache Spark technical docs dark chrome × LearnGitBranching game shell × Databricks console density.
- **Palette**: canvas `#0B0F14`, surface `#141A21`, elevated `#1C2430`, ink `#E8EEF4`, muted `#7D8B99`, accent `#E25A1C` (Spark orange), success `#3FB950`, stage `#A371F7`, partition `#2DD4BF`, danger `#F85149`.
- **Typography**: UI `Segoe UI, system-ui, sans-serif`; terminal/code `Cascadia Code, Consolas, JetBrains Mono, monospace`. Title 20–28px/600, body 13–14px, mono 12–13px.
- **Layout**: full-viewport app — left level rail, center DAG + preview, right goal rail, bottom REPL. Dense, no marketing hero.
- **Signature moments**:
  1. An **action** animates packets along DAG edges into partition cells.
  2. A **shuffle** (groupBy/join/repartition) draws a stage barrier and scatters rows across executors.

## Command language (teaching subset)

Space-separated, LearnGitBranching-flavored (not a full Spark API):

```
help | levels | goal | hint | undo | reset | clear
load <table>
show | count | schema | columns | explain | collect
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

Expression mini-language for `filter` / `withColumn`:

- Comparisons: `amount > 100`, `region == west`, `amount >= 50 && region == west`
- Arithmetic: `amount + 10`, `amount * 2`, `amount - 5`
- Literals: numbers and bare words / quoted strings

## Level sequences

1. **intro** — load, show, schema, filter, select
2. **lazy** — transformations vs actions; `explain`
3. **actions** — count, collect, write semantics
4. **shuffle** — groupBy, join, wide dependencies
5. **optimize** — cache, repartition, coalesce
6. **advanced** — sparksql, multi-stage plans

## Architecture decisions

See `docs/ADR-001-client-only-sim.md`. Engine is a deterministic in-browser simulator (no cluster). Visualization is SVG. No backend.

## Scope boundaries

- Does **not** run real Spark; it teaches execution *model* (lazy plans, stages, shuffles, cache).
- Does **not** implement full Catalyst optimizer, memory manager, or Tungsten.
- Does implement enough row semantics for goals and previews to be honest about results.
