/**
 * Stateful streaming engine: keyed state, watermarks, output modes.
 *
 * outputMode:
 *  - append: emit only new rows for keys first seen this epoch
 *  - update: emit current agg every time a key changes
 *  - complete: emit full result table every trigger
 */

/**
 * @typedef {{ id: string, key: string, eventTime: string, value: number }} Event
 */

export class StreamState {
  /**
   * @param {{ watermarkLagDays?: number, outputMode?: 'append'|'update'|'complete' }} opts
   */
  constructor(opts) {
    opts = opts || {};
    /** @type {Map<string, { sum: number, count: number, maxEventTime: string, emitted: boolean }>} */
    this.aggs = new Map();
    this.watermarkLagDays = opts.watermarkLagDays != null ? opts.watermarkLagDays : 0;
    this.outputMode = opts.outputMode || "append";
    this.epoch = 0;
    this.droppedLate = 0;
    this.stateBytes = 0;
    this.checkpoint = null;
    this.maxEventTime = null;
  }

  /**
   * @param {'append'|'update'|'complete'} mode
   */
  setOutputMode(mode) {
    this.outputMode = mode;
  }

  /**
   * @param {number} days
   */
  setWatermarkDays(days) {
    this.watermarkLagDays = days;
  }

  /**
   * Cutoff date for late data.
   *
   * @returns {string|null}
   */
  watermark() {
    if (this.maxEventTime == null || !this.watermarkLagDays) return null;
    const d = new Date(this.maxEventTime + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - this.watermarkLagDays);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Ingest a micro-batch of events; return emitted rows per outputMode.
   *
   * @param {Event[]} events
   * @returns {{ emitted: any[], lateDropped: number, stateKeys: number, watermark: string|null, epoch: number }}
   */
  microBatch(events) {
    this.epoch += 1;
    const batch = events || [];
    let lateDropped = 0;

    // advance max event time first
    for (let i = 0; i < batch.length; i += 1) {
      const t = String(batch[i].eventTime);
      if (this.maxEventTime == null || t > this.maxEventTime) this.maxEventTime = t;
    }
    const cutoff = this.watermark();

    /** @type {any[]} */
    const emitted = [];
    const touched = new Set();

    for (let i = 0; i < batch.length; i += 1) {
      const e = batch[i];
      const t = String(e.eventTime);
      if (cutoff && t < cutoff) {
        lateDropped += 1;
        continue;
      }
      const key = String(e.key);
      touched.add(key);
      if (!this.aggs.has(key)) {
        this.aggs.set(key, {
          sum: 0,
          count: 0,
          maxEventTime: t,
          emitted: false,
        });
      }
      const st = this.aggs.get(key);
      st.sum += Number(e.value) || 0;
      st.count += 1;
      if (t > st.maxEventTime) st.maxEventTime = t;
      this.stateBytes += 48;
    }

    // evict state below watermark (keys whose maxEventTime is late)
    if (cutoff) {
      const keys = Array.from(this.aggs.keys());
      for (let i = 0; i < keys.length; i += 1) {
        const st = this.aggs.get(keys[i]);
        if (st.maxEventTime < cutoff) {
          this.aggs.delete(keys[i]);
          this.stateBytes = Math.max(0, this.stateBytes - 48);
        }
      }
    }

    if (this.outputMode === "complete") {
      this.aggs.forEach(function (st, key) {
        emitted.push({ key: key, sum: st.sum, count: st.count, epoch: this.epoch });
      }, this);
    } else if (this.outputMode === "update") {
      touched.forEach(function (key) {
        const st = this.aggs.get(key);
        if (!st) return;
        st.emitted = true;
        emitted.push({ key: key, sum: st.sum, count: st.count, epoch: this.epoch });
      }, this);
    } else {
      // append: only first time we see the key (and it survives watermark)
      touched.forEach(function (key) {
        const st = this.aggs.get(key);
        if (!st || st.emitted) return;
        st.emitted = true;
        emitted.push({ key: key, sum: st.sum, count: st.count, epoch: this.epoch });
      }, this);
    }

    this.droppedLate += lateDropped;
    this.checkpoint = {
      epoch: this.epoch,
      keys: this.aggs.size,
      watermark: cutoff,
      outputMode: this.outputMode,
    };

    return {
      emitted: emitted,
      lateDropped: lateDropped,
      stateKeys: this.aggs.size,
      watermark: cutoff,
      epoch: this.epoch,
    };
  }
}

/**
 * Build StreamEvents from dataset rows.
 *
 * @param {Array} rows
 * @param {string} keyCol
 * @param {string} timeCol
 * @param {string} valueCol
 * @returns {Event[]}
 */
export function toEvents(rows, keyCol, timeCol, valueCol) {
  return rows.map(function (r) {
    return {
      id: String(r.id),
      key: String(r[keyCol]),
      eventTime: String(r[timeCol]),
      value: Number(r[valueCol] != null ? r[valueCol] : 1),
    };
  });
}
