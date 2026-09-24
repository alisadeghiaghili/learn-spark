/**
 * Runtime knobs the learner can tune (teaching controls for Spark configs).
 */

/** @type {{ executorMb: number, broadcastThresholdMb: number, autoBroadcast: boolean, aqe: boolean, speculate: boolean, tasksPerExecutor: number, shufflePartitions: number, format: string, saltSkew: boolean, pythonUdf: boolean, udfMode: 'native'|'jvm'|'python'|'pandas' }} */
export const settings = {
  executorMb: 4,
  broadcastThresholdMb: 10,
  autoBroadcast: true,
  aqe: true,
  speculate: false,
  tasksPerExecutor: 2,
  shufflePartitions: 4,
  format: "parquet",
  saltSkew: false,
  udfMode: "jvm",
  storageLevel: "MEMORY_AND_DISK",
  windowFrame: "rows-unbounded-current",
  outputMode: "append",
  watermarkLag: null,
};

/**
 * Reset knobs to defaults.
 *
 * @returns {void}
 */
export function resetSettings() {
  settings.executorMb = 4;
  settings.broadcastThresholdMb = 10;
  settings.autoBroadcast = true;
  settings.aqe = true;
  settings.speculate = false;
  settings.tasksPerExecutor = 2;
  settings.shufflePartitions = 4;
  settings.format = "parquet";
  settings.saltSkew = false;
  settings.udfMode = "jvm";
  settings.storageLevel = "MEMORY_AND_DISK";
  settings.windowFrame = "rows-unbounded-current";
  settings.outputMode = "append";
  settings.watermarkLag = null;
}

/**
 * Apply `set key value`.
 *
 * @param {string} key
 * @param {string} raw
 * @returns {string}
 */
export function applySetting(key, raw) {
  const k = String(key || "").toLowerCase();
  const v = String(raw || "").trim();
  if (k === "executor.mb" || k === "executor_mb") {
    settings.executorMb = Math.max(0.001, Number(v) || settings.executorMb);
    return "spark.executor.memory=" + settings.executorMb + "MB (simulated)";
  }
  if (k === "broadcast.threshold" || k === "broadcast_threshold") {
    settings.broadcastThresholdMb = Math.max(0, Number(v) || 0);
    return "spark.sql.autoBroadcastJoinThreshold=" + settings.broadcastThresholdMb + "MB";
  }
  if (k === "autobroadcast") {
    settings.autoBroadcast = v !== "off" && v !== "false" && v !== "0";
    return "autoBroadcast=" + settings.autoBroadcast;
  }
  if (k === "aqe") {
    settings.aqe = v !== "off" && v !== "false" && v !== "0";
    return "spark.sql.adaptive.enabled=" + settings.aqe;
  }
  if (k === "speculate") {
    settings.speculate = v === "on" || v === "true" || v === "1";
    return "spark.speculation=" + settings.speculate;
  }
  if (k === "tasks.per.executor" || k === "cores") {
    settings.tasksPerExecutor = Math.max(1, Number(v) || settings.tasksPerExecutor);
    return "tasks/executor=" + settings.tasksPerExecutor;
  }
  if (k === "shuffle.partitions" || k === "sql.shuffle.partitions") {
    settings.shufflePartitions = Math.max(1, Number(v) || settings.shufflePartitions);
    return "spark.sql.shuffle.partitions=" + settings.shufflePartitions;
  }
  if (k === "format") {
    settings.format = v || "parquet";
    return "default format=" + settings.format;
  }
  if (k === "salt" || k === "skew.salt") {
    settings.saltSkew = v === "on" || v === "true" || v === "1";
    return "skew salt=" + settings.saltSkew;
  }
  if (k === "storage.level" || k === "storagelevel") {
    const lv = v.toUpperCase().replace(/-/g, "_");
    const ok = ["MEMORY_ONLY", "MEMORY_AND_DISK", "MEMORY_ONLY_SER", "DISK_ONLY", "MEMORY_ONLY_2", "OFF_HEAP"];
    if (ok.indexOf(lv) === -1) {
      throw new Error("storage.level must be " + ok.join("|"));
    }
    settings.storageLevel = lv;
    return "storageLevel=" + lv;
  }
  if (k === "window.frame" || k === "frame") {
    settings.windowFrame = v || "rows-unbounded-current";
    return "windowFrame=" + settings.windowFrame;
  }
  if (k === "outputmode") {
    settings.outputMode = v || "append";
    return "outputMode=" + settings.outputMode;
  }
  if (k === "udf.mode") {
    const mode = v.toLowerCase();
    if (mode !== "native" && mode !== "jvm" && mode !== "python" && mode !== "pandas") {
      throw new Error("udf.mode must be native|jvm|python|pandas");
    }
    settings.udfMode = mode;
    return "udf.mode=" + settings.udfMode;
  }
  throw new Error("unknown setting '" + key + "'. try: executor.mb, broadcast.threshold, aqe, speculate, tasks.per.executor, shuffle.partitions, format, salt, udf.mode");
}

/**
 * Snapshot for `set` with no args / explain.
 *
 * @returns {string}
 */
export function describeSettings() {
  return [
    "executor.mb=" + settings.executorMb,
    "broadcast.threshold=" + settings.broadcastThresholdMb,
    "autobroadcast=" + settings.autoBroadcast,
    "aqe=" + settings.aqe,
    "speculate=" + settings.speculate,
    "tasks.per.executor=" + settings.tasksPerExecutor,
    "shuffle.partitions=" + settings.shufflePartitions,
    "format=" + settings.format,
    "salt=" + settings.saltSkew,
    "udf.mode=" + settings.udfMode,
    "storage.level=" + settings.storageLevel,
    "window.frame=" + settings.windowFrame,
    "outputMode=" + settings.outputMode,
  ].join("  ");
}

/**
 * Estimate executor count for cluster panel.
 *
 * @param {number} partitions
 * @returns {{ executors: number, slots: number }}
 */
export function clusterShape(partitions) {
  const slots = Math.max(1, settings.tasksPerExecutor);
  const executors = Math.max(1, Math.ceil((partitions || 1) / slots));
  return { executors: executors, slots: slots };
}
