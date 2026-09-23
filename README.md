# learnSpark

An interactive Apache Spark visualization and tutorial sandbox.

LearnGitBranching makes git click by drawing the tree while you type commands.
**learnSpark** does the same for Spark: a living **job DAG**, **partition buckets**, and a small command language that teaches lazy evaluation, actions, shuffles, and caching.

## Live

https://alisadeghiaghili.github.io/learn-spark/

## Run it

Open `index.html` in a modern browser (ES modules work over any static server, including the MiMo Desktop preview). Optional:

```bash
npm test
```

## Modes

- **Sandbox** — free play on demo tables (`sales`, `users`, `products`, `logs`)
- **Levels** — sequenced lessons with goal checks and command golf (`par`)

Type `levels` to browse, `hint` when stuck, `next` after a win, `undo` / `reset` to rewind.

## Command language

A teaching subset (not a full Spark API):

```
load sales
filter amount > 100
select region, amount
withColumn tipped amount * 1.1
sort amount desc
limit 5
groupBy region sum amount
join users on user_id
repartition 4
coalesce 2
cache
show | count | collect | schema | columns | explain | write
sparksql select region, amount from sales where amount > 100
```

Expressions support comparisons (`>`, `==`, …), `&&` / `||`, and `+ - * /`.

## What you should see

1. **Transformations** only extend the DAG (lazy).
2. **Actions** materialize rows and animate the plan.
3. **Wide ops** (`groupBy`, `join`, `repartition`) draw a **shuffle / stage** barrier.
4. **cache** lowers simulated compute cost on later actions.

This is a pedagogical simulator of Spark’s *execution model* — not a Spark runtime.

## Project layout

```
index.html
assets/css/main.css
src/engine/    datasets, plan builders, expressions, materialization, commands
src/game/      level sequences + goal predicates
src/ui/        app shell + DAG/partition visualizers
docs/          design notes + ADR
tests/         node:test suite for the engine
```

## Design

See [docs/DESIGN.md](docs/DESIGN.md) and [docs/ADR-001-client-only-sim.md](docs/ADR-001-client-only-sim.md).

## License

MIT
