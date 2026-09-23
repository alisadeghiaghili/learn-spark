# ADR-001: Client-only Spark simulator

## Status

Accepted

## Context

A 100% client-side visualizer with no backend stays frictionless: open a tab and learn. learnSpark must teach Spark's execution model (lazy evaluation, stages, shuffles, caching, partitions) without requiring a cluster or JVM in the browser.

## Decision

Implement a **deterministic in-browser row engine** that:

1. Records a logical plan as a linked operator list (lineage).
2. Treats `filter` / `select` / `withColumn` / `sort` / `limit` as **transformations** (lazy).
3. Treats `show` / `count` / `collect` / `write` / `sparksql` results as **actions** that materialize.
4. Splits plans at wide operators (`groupBy`, `join`, `repartition`) into **stages** with shuffle boundaries.
5. Models partitions as row buckets; `repartition` / `coalesce` change bucket count.
6. Models `cache` / `unpersist` as plan short-circuits with a cost counter (recompute avoided).

Ship as static ES modules + CSS + SVG. No bundler required for local preview.

Persist learner progress in `localStorage` **and** a ~400-day cookie so a returning user resumes mid-curriculum.

## Consequences

- Fast iteration, trivial deploy, offline-friendly.
- Semantics are pedagogical, not a Spark compatibility layer.
- Complex features (AQE, spill, broadcast hints as cost models) stay out of scope until the core loop is solid.

## Alternatives considered

- **Pyodide / real Spark**: too heavy, slow cold start, fails the "open and play" bar.
- **Server-side Spark cluster**: adds ops burden and breaks offline learning.
