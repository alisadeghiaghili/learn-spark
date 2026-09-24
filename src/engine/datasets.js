/**
 * Built-in demo tables for the learnSpark sandbox.
 *
 * Rows are plain objects. Schema is informational for `schema` / `columns`.
 */

/**
 * @typedef {{ name: string, type: 'int'|'double'|'string' }} Column
 * @typedef {{ name: string, schema: Column[], rows: Record<string, unknown>[] }} Dataset
 */

/** @type {Record<string, Dataset>} */
export const DATASETS = {
  sales: {
    name: 'sales',
    schema: [
      { name: 'id', type: 'int' },
      { name: 'user_id', type: 'int' },
      { name: 'product_id', type: 'int' },
      { name: 'amount', type: 'double' },
      { name: 'region', type: 'string' },
      { name: 'ts', type: 'string' },
    ],
    rows: [
      { id: 1, user_id: 1, product_id: 1, amount: 120.5, region: 'west', ts: '2024-01-03' },
      { id: 2, user_id: 2, product_id: 2, amount: 45.0, region: 'east', ts: '2024-01-04' },
      { id: 3, user_id: 3, product_id: 1, amount: 310.0, region: 'west', ts: '2024-01-05' },
      { id: 4, user_id: 4, product_id: 3, amount: 89.9, region: 'north', ts: '2024-01-05' },
      { id: 5, user_id: 1, product_id: 2, amount: 220.0, region: 'west', ts: '2024-01-07' },
      { id: 6, user_id: 5, product_id: 4, amount: 15.25, region: 'south', ts: '2024-01-08' },
      { id: 7, user_id: 2, product_id: 1, amount: 500.0, region: 'east', ts: '2024-01-09' },
      { id: 8, user_id: 6, product_id: 3, amount: 75.0, region: 'north', ts: '2024-01-10' },
      { id: 9, user_id: 3, product_id: 4, amount: 99.99, region: 'west', ts: '2024-01-11' },
      { id: 10, user_id: 7, product_id: 2, amount: 180.0, region: 'south', ts: '2024-01-12' },
      { id: 11, user_id: 4, product_id: 1, amount: 60.0, region: 'north', ts: '2024-01-13' },
      { id: 12, user_id: 8, product_id: 3, amount: 250.0, region: 'east', ts: '2024-01-14' },
    ],
  },
  users: {
    name: 'users',
    schema: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'string' },
      { name: 'tier', type: 'string' },
      { name: 'city', type: 'string' },
    ],
    rows: [
      { id: 1, name: 'ada', tier: 'gold', city: 'berlin' },
      { id: 2, name: 'grace', tier: 'silver', city: 'munich' },
      { id: 3, name: 'alan', tier: 'gold', city: 'hamburg' },
      { id: 4, name: 'edsger', tier: 'bronze', city: 'cologne' },
      { id: 5, name: 'barbara', tier: 'silver', city: 'berlin' },
      { id: 6, name: 'donald', tier: 'gold', city: 'munich' },
      { id: 7, name: 'john', tier: 'bronze', city: 'leipzig' },
      { id: 8, name: 'tony', tier: 'silver', city: 'berlin' },
    ],
  },
  products: {
    name: 'products',
    schema: [
      { name: 'id', type: 'int' },
      { name: 'sku', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'price', type: 'double' },
    ],
    rows: [
      { id: 1, sku: 'P-100', category: 'laptop', price: 1200 },
      { id: 2, sku: 'P-200', category: 'phone', price: 800 },
      { id: 3, sku: 'P-300', category: 'tablet', price: 450 },
      { id: 4, sku: 'P-400', category: 'audio', price: 120 },
    ],
  },
  events: {
    name: "events",
    schema: [
      { name: "id", type: "int" },
      { name: "user_id", type: "int" },
      { name: "event", type: "string" },
      { name: "tags", type: "string" },
      { name: "ts", type: "string" },
    ],
    rows: [
      { id: 1, user_id: 1, event: "click", tags: "mobile,promo", ts: "2024-02-01" },
      { id: 2, user_id: 2, event: "view", tags: "desktop", ts: "2024-02-01" },
      { id: 3, user_id: 1, event: "purchase", tags: "mobile,vip", ts: "2024-02-02" },
      { id: 4, user_id: 3, event: "click", tags: "mobile", ts: "2024-02-02" },
      { id: 5, user_id: 4, event: "view", tags: "desktop,promo", ts: "2024-02-03" },
      { id: 6, user_id: 2, event: "click", tags: "promo", ts: "2024-02-03" },
      { id: 7, user_id: 5, event: "purchase", tags: "mobile", ts: "2023-01-01" },
      { id: 8, user_id: 6, event: "click", tags: "promo", ts: "2024-02-10" },
    ],
  },
  campaigns: {
    name: "campaigns",
    schema: [
      { name: "id", type: "int" },
      { name: "user_id", type: "int" },
      { name: "spend", type: "double" },
      { name: "channel", type: "string" },
    ],
    rows: [
      { id: 1, user_id: 1, spend: 120, channel: "search" },
      { id: 2, user_id: 2, spend: 80, channel: "social" },
      { id: 3, user_id: 99, spend: 40, channel: "email" },
      { id: 4, user_id: 3, spend: 200, channel: "search" },
    ],
  },
  logs: {
    name: 'logs',
    schema: [
      { name: 'id', type: 'int' },
      { name: 'level', type: 'string' },
      { name: 'service', type: 'string' },
      { name: 'latency_ms', type: 'int' },
    ],
    rows: [
      { id: 1, level: 'INFO', service: 'api', latency_ms: 12 },
      { id: 2, level: 'WARN', service: 'api', latency_ms: 250 },
      { id: 3, level: 'ERROR', service: 'db', latency_ms: 890 },
      { id: 4, level: 'INFO', service: 'db', latency_ms: 22 },
      { id: 5, level: 'ERROR', service: 'api', latency_ms: 1200 },
      { id: 6, level: 'INFO', service: 'worker', latency_ms: 40 },
      { id: 7, level: 'WARN', service: 'worker', latency_ms: 310 },
      { id: 8, level: 'ERROR', service: 'worker', latency_ms: 770 },
    ],
  },
};

/**
 * List dataset names available in the sandbox.
 *
 * @returns {string[]}
 */
export function listDatasets() {
  return Object.keys(DATASETS);
}

/**
 * Resolve a dataset by name.
 *
 * @param {string} name
 * @returns {Dataset}
 * @throws {Error} when the table does not exist
 */
export function getDataset(name) {
  const key = String(name || '').toLowerCase();
  const ds = DATASETS[key];
  if (!ds) {
    throw new Error(`table not found: ${name}. try one of: ${listDatasets().join(', ')}`);
  }
  return {
    name: ds.name,
    schema: ds.schema.map((c) => ({ ...c })),
    rows: ds.rows.map((r) => ({ ...r })),
  };
}
