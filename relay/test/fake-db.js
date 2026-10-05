'use strict';
// In-memory stand-in for the subset of the MongoDB driver that relay/lib/store.js uses.
function dupError(what) { return Object.assign(new Error('E11000 duplicate key error ' + what), { code: 11000 }); }
function assertPlain(filter) {
  for (const [k, v] of Object.entries(filter || {})) {
    if (k.startsWith('$')) throw new Error('fake-db: operator key in filter: ' + k);
    if (v !== null && typeof v === 'object') throw new Error('fake-db: object value in filter for ' + k);
  }
}
const matches = (doc, filter) => Object.entries(filter || {}).every(([k, v]) => doc[k] === v);

function makeFakeDb(seed = {}) {
  const state = { fail: false, calls: [] };
  const cols = new Map();
  function col(name) {
    if (cols.has(name)) return cols.get(name);
    const docs = [], unique = [];
    const guard = (op) => {
      state.calls.push(name + '.' + op);
      if (state.fail) throw new Error('connect failed mongodb://fake-user:SECRET-DB-PASS@fake.invalid');
    };
    const checkUnique = (doc, self) => {
      if (docs.some((d) => d !== self && d._id === doc._id)) throw dupError('_id');
      for (const f of unique) if (doc[f] !== undefined && docs.some((d) => d !== self && d[f] === doc[f])) throw dupError(f);
    };
    const c = {
      docs, indexes: unique,
      async createIndex(spec, opts = {}) { guard('createIndex'); const f = Object.keys(spec)[0]; if (opts.unique && !unique.includes(f)) unique.push(f); return f + '_1'; },
      async findOne(filter) { guard('findOne'); assertPlain(filter); const d = docs.find((x) => matches(x, filter)); return d ? structuredClone(d) : null; },
      async insertOne(doc) { guard('insertOne'); checkUnique(doc, null); docs.push(structuredClone(doc)); return { acknowledged: true, insertedId: doc._id }; },
      async updateOne(filter, update, opts = {}) {
        guard('updateOne'); assertPlain(filter);
        if (Object.keys(update).some((k) => k !== '$set')) throw new Error('fake-db: only $set is supported');
        const d = docs.find((x) => matches(x, filter));
        if (d) { const next = { ...d, ...structuredClone(update.$set) }; checkUnique(next, d); Object.assign(d, next); return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }; }
        if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        const doc = { ...filter, ...structuredClone(update.$set) }; checkUnique(doc, null); docs.push(doc);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
      },
      async deleteOne(filter) { guard('deleteOne'); assertPlain(filter); const i = docs.findIndex((x) => matches(x, filter)); if (i < 0) return { deletedCount: 0 }; docs.splice(i, 1); return { deletedCount: 1 }; },
      find(filter, opts = {}) {
        guard('find'); assertPlain(filter); state.lastFind = { filter, ...opts };
        const drop = Object.entries((opts && opts.projection) || {}).filter(([, v]) => v === 0).map(([k]) => k);
        return { toArray: async () => docs.filter((x) => matches(x, filter)).map((d) => { const c = structuredClone(d); for (const k of drop) delete c[k]; return c; }) };
      },
    };
    cols.set(name, c); return c;
  }
  for (const [name, list] of Object.entries(seed)) for (const d of list) col(name).docs.push(structuredClone(d));
  return { collection: col, state, dump: () => JSON.stringify([...cols].map(([n, c]) => [n, c.docs])) };
}
module.exports = { makeFakeDb };
