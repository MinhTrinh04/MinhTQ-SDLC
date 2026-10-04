'use strict';
// Cached MongoClient for serverless: one connection per warm instance. Never logs or rethrows the URI.
let injected = null, dbPromise = null, retryAt = 0;
const BACKOFF_MS = 5000; // after a failed connect, fail fast for a while instead of re-dialing on every request

async function ensureIndexes(db) {
  await db.collection('machines').createIndex({ keyHash: 1 }, { unique: true }); // idempotent
}

function getDb() {
  if (injected) return Promise.resolve(injected);
  if (!dbPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) return Promise.reject(new Error('storage not configured'));
    if (Date.now() < retryAt) return Promise.reject(new Error('storage unavailable'));
    const { MongoClient } = require('mongodb'); // lazy: tests with _setDb never load the driver
    const client = new MongoClient(uri, { maxPoolSize: 3, serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000, socketTimeoutMS: 4000 });
    dbPromise = (async () => {
      await client.connect();
      const db = client.db(process.env.MONGODB_DB || 'claude_notify');
      try { await ensureIndexes(db); } catch { /* best-effort: lookups work without the index, so do not take the whole DB layer down */ }
      return db;
    })().catch(() => {
      dbPromise = null; retryAt = Date.now() + BACKOFF_MS;
      client.close().catch(() => {});
      throw new Error('storage unavailable'); // generic: driver errors can contain the host or credentials
    });
  }
  return dbPromise;
}

function _setDb(fake) { injected = fake || null; dbPromise = null; retryAt = 0; }
module.exports = { getDb, ensureIndexes, _setDb };
