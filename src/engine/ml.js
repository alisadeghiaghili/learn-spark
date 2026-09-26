/**
 * MLlib-shaped pipeline: Transformers, Estimators, Models, split, metrics.
 */

/**
 * Ordinary least squares (closed form) for one feature.
 *
 * @param {Array} rows
 * @param {string} xCol
 * @param {string} yCol
 * @returns {{ w: number, b: number, rmse: number, n: number, featureCol: string, targetCol: string }}
 */
export function fitLinreg(rows, xCol, yCol) {
  const n = rows.length;
  if (!n) return { w: 0, b: 0, rmse: 0, n: 0, featureCol: xCol, targetCol: yCol };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const x = Number(rows[i][xCol]) || 0;
    const y = Number(rows[i][yCol]) || 0;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const w = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const b = (sy - w * sx) / n;
  let se = 0;
  for (let i = 0; i < n; i += 1) {
    const x = Number(rows[i][xCol]) || 0;
    const y = Number(rows[i][yCol]) || 0;
    const err = y - (w * x + b);
    se += err * err;
  }
  return { w: w, b: b, rmse: Math.sqrt(se / n), n: n, featureCol: xCol, targetCol: yCol };
}

/**
 * Predict with a linear model.
 *
 * @param {Array} rows
 * @param {{ w: number, b: number, featureCol: string, targetCol?: string }} model
 * @returns {Array}
 */
export function predictLinreg(rows, model) {
  return rows.map(function (r) {
    const x = Number(r[model.featureCol]) || 0;
    const out = Object.assign({}, r);
    out.prediction = model.w * x + model.b;
    if (model.targetCol != null && model.targetCol in r) {
      out.residual = Number(r[model.targetCol]) - out.prediction;
    }
    return out;
  });
}

/**
 * Simple train/test split (deterministic hash).
 *
 * @param {Array} rows
 * @param {number} testRatio
 * @returns {{ train: Array, test: Array }}
 */
export function trainTestSplit(rows, testRatio) {
  const ratio = testRatio == null ? 0.25 : testRatio;
  const train = [];
  const test = [];
  for (let i = 0; i < rows.length; i += 1) {
    if ((i * 2654435761) % 1000 / 1000 < ratio) test.push(rows[i]);
    else train.push(rows[i]);
  }
  return { train: train, test: test };
}

/**
 * Regression metrics.
 *
 * @param {Array} rows
 * @param {string} yCol
 * @param {string} predCol
 * @returns {{ rmse: number, mae: number, n: number }}
 */
export function regressionMetrics(rows, yCol, predCol) {
  let se = 0;
  let ae = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const err = Number(rows[i][yCol]) - Number(rows[i][predCol]);
    se += err * err;
    ae += Math.abs(err);
  }
  const n = rows.length || 1;
  return { rmse: Math.sqrt(se / n), mae: ae / n, n: rows.length };
}

/**
 * Pipeline of named stages (transformers + one estimator at the end).
 */
export class Pipeline {
  constructor() {
    /** @type {{ name: string, kind: 'transformer'|'estimator', fn: Function }[]} */
    this.stages = [];
    this.model = null;
  }

  /**
   * @param {string} name
   * @param {(rows: any[]) => any[]} fn
   * @returns {Pipeline}
   */
  addTransformer(name, fn) {
    this.stages.push({ name: name, kind: "transformer", fn: fn });
    return this;
  }

  /**
   * @param {string} name
   * @param {(rows: any[]) => any} fn
   * @returns {Pipeline}
   */
  addEstimator(name, fn) {
    this.stages.push({ name: name, kind: "estimator", fn: fn });
    return this;
  }

  /**
   * Fit: run transformers, then estimator.
   *
   * @param {Array} rows
   * @returns {{ model: any, transformed: Array, trace: string[] }}
   */
  fit(rows) {
    let cur = rows;
    const trace = [];
    for (let i = 0; i < this.stages.length; i += 1) {
      const s = this.stages[i];
      if (s.kind === "transformer") {
        cur = s.fn(cur);
        trace.push("Transformer[" + s.name + "] -> " + cur.length + " rows");
      } else {
        this.model = s.fn(cur);
        trace.push("Estimator[" + s.name + "] -> model " + JSON.stringify({
          w: this.model.w,
          b: this.model.b,
          rmse: this.model.rmse,
        }));
      }
    }
    return { model: this.model, transformed: cur, trace: trace };
  }

  /**
   * Transform/score with the fitted model (transformers only + model predict).
   *
   * @param {Array} rows
   * @returns {Array}
   */
  transform(rows) {
    let cur = rows;
    for (let i = 0; i < this.stages.length; i += 1) {
      const s = this.stages[i];
      if (s.kind === "transformer") cur = s.fn(cur);
    }
    if (this.model && this.model.featureCol) {
      cur = predictLinreg(cur, this.model);
    }
    return cur;
  }
}
