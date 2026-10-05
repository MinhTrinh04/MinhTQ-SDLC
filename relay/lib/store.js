'use strict';
const { getDb } = require('./db');
const TTL_MS = 30000, MAX_TOPIC_ENTRIES = 500;
let clock = () => Date.now();
let generation = 0; // bumped on every invalidate(): an in-flight lookup must not re-populate the cache with data read before a write
const machineCache = new Map(); // keyHash -> { value: name, exp }   (found results only)
const topicCache = new Map();   // project -> { value: threadId|null, exp }   (hits and misses)

const validThread = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 2147483647;
function need(v, what) { if (typeof v !== 'string' || !v) throw new TypeError('bad ' + what); return v; }
function invalidate() { generation++; machineCache.clear(); topicCache.clear(); }

// allowDb=false serves the cache only (used to throttle callers that keep sending unknown keys).
async function findMachineByKeyHash(hex, allowDb = true) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) return null;
  const hit = machineCache.get(hex);
  if (hit && hit.exp > clock()) return hit.value;
  if (!allowDb) return null;
  const gen = generation;
  const doc = await (await getDb()).collection('machines').findOne({ keyHash: hex, revoked: false });
  if (!doc) { machineCache.delete(hex); return null; } // never cache "not found": random hashes must not grow memory
  if (gen === generation) machineCache.set(hex, { value: doc._id, exp: clock() + TTL_MS }); // a write happened meanwhile: do not cache stale data
  return doc._id;
}

async function findTopic(project) {
  need(project, 'project');
  const hit = topicCache.get(project);
  if (hit && hit.exp > clock()) return hit.value;
  const gen = generation;
  const col = (await getDb()).collection('topics');
  let value = null;
  for (const id of project === '_default' ? ['_default'] : [project, '_default']) {
    const d = await col.findOne({ _id: id });
    if (d && validThread(d.threadId)) { value = d.threadId; break; }
  }
  if (gen === generation) {
    if (topicCache.size >= MAX_TOPIC_ENTRIES) topicCache.clear();
    topicCache.set(project, { value, exp: clock() + TTL_MS });
  }
  return value;
}

async function addMachine(name, keyHash) {
  need(name, 'name'); need(keyHash, 'keyHash');
  try {
    await (await getDb()).collection('machines').insertOne({ _id: name, keyHash, createdAt: new Date(), revoked: false });
    return true;
  } catch (e) { if (e && e.code === 11000) return false; throw e; }
  finally { invalidate(); }
}
async function revokeMachine(name) {
  need(name, 'name');
  try {
    const r = await (await getDb()).collection('machines').updateOne({ _id: name }, { $set: { revoked: true, revokedAt: new Date() } });
    return r.matchedCount > 0;
  } finally { invalidate(); }
}
async function listMachines() {
  const docs = await (await getDb()).collection('machines').find({}, { projection: { keyHash: 0 } }).toArray();
  return docs.map((d) => ({ name: d._id, createdAt: d.createdAt, revoked: !!d.revoked })).sort((a, b) => a.name.localeCompare(b.name));
}
async function setTopic(project, threadId) {
  need(project, 'project');
  if (!validThread(threadId)) throw new TypeError('bad threadId');
  try { await (await getDb()).collection('topics').updateOne({ _id: project }, { $set: { threadId } }, { upsert: true }); }
  finally { invalidate(); }
}
async function removeTopic(project) {
  need(project, 'project');
  try { return (await (await getDb()).collection('topics').deleteOne({ _id: project })).deletedCount > 0; }
  finally { invalidate(); }
}
async function listTopics() {
  const docs = await (await getDb()).collection('topics').find({}).toArray();
  return docs.map((d) => ({ project: d._id, threadId: d.threadId })).sort((a, b) => a.project.localeCompare(b.project));
}

function _setClock(fn) { clock = fn || (() => Date.now()); }
function _resetCache() { invalidate(); }
function _cacheSizes() { return { machines: machineCache.size, topics: topicCache.size }; }
module.exports = { findMachineByKeyHash, findTopic, addMachine, revokeMachine, listMachines, setTopic, removeTopic, listTopics,
  _setClock, _resetCache, _cacheSizes, TTL_MS, MAX_TOPIC_ENTRIES };
