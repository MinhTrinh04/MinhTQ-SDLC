# Telegram Relay — kế hoạch triển khai

> Thiết kế đã duyệt: `docs/flow/specs/telegram-relay-design.md`. Kế hoạch bắt đầu từ Task 8 vì Task 1 đến 7 (relay đầu tiên dựa trên biến môi trường) đã thực thi rồi bị thay thế bởi các task này và được xoá khỏi tài liệu. Người thực thi cần có shell (`node`, `npm`, `git`, `grep`, PowerShell). Thứ tự: Task 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17. Task 12 độc lập với backend nhưng cần xong trước Task 13.
> Quyết định đã chốt: cache tra cứu 30 giây; DB lỗi khi tra khoá thì từ chối (503); khoá admin cất DPAPI ở `~/.claude/notify.admin.json`; topic mặc định lưu với `_id` là `_default`; DB user chỉ có `readWrite` trên một database; giữ tên thư mục `relay/`.

**Quy ước (các lỗi đã gặp trong repo này, phải tránh):**
- `hooks/notify.ps1` giữ UTF-8 **có BOM** và **không nằm trong kế hoạch này** (không đụng). Các file `.ps1` còn lại (`notify-ctl.ps1`, `relay.ps1`, `relay-admin.ps1`) và mọi file JS của `relay/` chỉ chứa **ASCII** (tiếng Việt không dấu trong thông báo của script).
- Không soạn đường dẫn Windows hay chuỗi có `\n`, `\u...` qua Python string literal (`\n` thành xuống dòng). Dùng công cụ Edit/Write hoặc heredoc bash có quote (`<<'EOF'`). Công cụ Write và heredoc có thể đổi escape JS kiểu `\u00b7` thành ký tự thật: sau khi viết luôn kiểm tra file thuần ASCII **và** không có ký tự điều khiển (NUL là ASCII nên kiểm ASCII thôi chưa đủ).
- Trước khi sửa `hooks/notify-ctl.ps1`, `README.md`, `commands/notify.md` chạy `grep -c $'\r' <file>` để biết file đang dùng CRLF hay LF và giữ nguyên kiểu đó; Edit cần `old_string` khớp chính xác. Số dòng nêu dưới đây chỉ để định hướng, **neo bằng nội dung**, không bằng số dòng.
- PowerShell 5.1: `$HOME` cố định lúc process khởi động; mọi test client chạy trong **process con** đã đặt `USERPROFILE`/`HOME` giả, tuyệt đối không ghi vào `~/.claude` thật. JSON mảng rỗng `[]` bị biến thành `$null`: dùng `@($x | Where-Object { $_ })`, đừng tin `.Count` của `@($null)`.
- Lệnh admin **không** được chạy thử trên `~/.claude` thật trong lúc triển khai; đó là việc của bộ test Task 16.

**Các điểm chốt khi lập kế hoạch (đã được gộp vào thiết kế):**
1. Thêm `relay/lib/util.js` dùng chung giữa `notify.js` và `admin.js` (tránh nhân đôi `sha`, `send`, `clean`, `readBody`); spec chỉ liệt kê `db.js` và `store.js`.
2. `machine-list` và `topic-list` trả `{machines:[...]}` và `{topics:[...]}` (bọc trong object) thay vì mảng trần.
3. Tra **topic** lỗi thì hạ cấp thành "không có thread" (tin vào General); chỉ tra **khoá** lỗi mới fail closed 503. Lý do: tin đã được xác thực nên đừng mất tin chỉ vì không tra được topic.
4. `machine-add -Apply` **không in khoá**; chỉ in khoá nếu ghi `notify.relay.json` thất bại (để khoá không bị mất).
5. Giới hạn lần xác thực **sai** của admin được kiểm tra **trước** phép so khoá, nên dò khoá bị làm chậm kể cả khi gặp đúng khoá trong lúc bị tấn công.

**Rủi ro cần biết (không có task riêng):** thời gian xấu nhất ở backend là kết nối Mongo 3 giây + hai lần gọi Telegram 4 giây = 11 giây, vượt timeout 10 giây của client; khi đó client báo lỗi dù tin có thể đã được gửi. Chấp nhận cho trường hợp rất hiếm (cold start chậm **và** thread phải thử lại); kiểm tra thực tế ở bước kiểm tra tay (Task 16d).

---

### Task 8: dependency `mongodb` (added 2026-10-04)

**Files:** sửa `relay/package.json`; tạo `relay/package-lock.json` (do npm sinh); `relay/node_modules/` giữ trong `.gitignore` (đã có).
**Interfaces:** sinh ra `require('mongodb')` cho `relay/lib/db.js`.

**Steps**
1. Chạy `cd /c/Github/MinhTQ-SDLC/relay && npm view mongodb@6 version` và `npm view mongodb version`. Chọn **major 6** vì giữ nguyên `engines: ">=18"`; nếu cố ý chọn major 7 thì phải đổi `engines.node` theo trường `engines` của gói đó.
2. Chạy `npm install mongodb@6 --save`. npm ghi `"mongodb": "^6.x.y"` vào `dependencies` và tạo `package-lock.json`. (Muốn ghim chính xác: `npm install mongodb@6.x.y --save-exact`.)
3. Đọc `relay/package.json`, xác nhận còn `name`, `private`, `engines`, `scripts.test` và có thêm khối `dependencies`.
4. Chạy `node -e "require('mongodb'); console.log('ok')"` trong `relay/`, kỳ vọng in `ok`.
5. Chạy `git status --short`: `relay/package-lock.json` hiện là untracked (sẽ commit), `node_modules` **không** xuất hiện.

Vercel tự chạy `npm install` (hoặc `npm ci` khi có lock file) từ Root Directory `relay`, nên không commit gì từ `node_modules`.

---

### Task 9: `relay/lib/util.js`, `relay/lib/db.js`, `relay/lib/store.js`, DB giả và test (added 2026-10-04)

**Files**
- Tạo `relay/lib/util.js`, `relay/lib/db.js`, `relay/lib/store.js`.
- Tạo `relay/test/fake-db.js`, `relay/test/db.test.js`, `relay/test/store.test.js`.

**Interfaces (produces)**
- `util`: `{ MAX_BODY, sha(s) → Buffer, send(res, code, obj, headers), clean(s), readBody(req) }` — chuyển nguyên văn từ `notify.js`.
- `db`: `getDb() → Promise<Db>`, `_setDb(fakeOrNull)`, `ensureIndexes(db)`.
- `store`: `findMachineByKeyHash(hex) → name|null`; `findTopic(project) → threadId|null`; `addMachine(name, keyHash) → bool` (false khi trùng); `revokeMachine(name) → bool`; `listMachines() → [{name, createdAt, revoked}]`; `setTopic(project, threadId)`; `removeTopic(project) → bool`; `listTopics() → [{project, threadId}]`; hook cho test `_setClock(fn|null)`, `_resetCache()`, `_cacheSizes() → {machines, topics}`; hằng `TTL_MS = 30000`, `MAX_TOPIC_ENTRIES = 500`.
- `fake-db`: `makeFakeDb(seed = {machines: [], topics: []}) → { collection(name), state: {fail, calls[]}, dump() }`. `state.fail = true` làm mọi thao tác ném lỗi có chứa chuỗi `mongodb://fake-user:SECRET-DB-PASS@fake.invalid` (dùng cho test rò rỉ). Fake ném lỗi nếu bộ lọc có giá trị là object hoặc khoá bắt đầu bằng `$` (lớp phòng thủ thứ hai cho test injection). `col.docs` và `col.indexes` được phơi ra cho test.

**Steps**
1. Tạo `relay/test/fake-db.js` (file hỗ trợ test, viết trước):
   ```js
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
         find(filter) { guard('find'); assertPlain(filter); return { toArray: async () => docs.filter((x) => matches(x, filter)).map((d) => structuredClone(d)) }; },
       };
       cols.set(name, c); return c;
     }
     for (const [name, list] of Object.entries(seed)) for (const d of list) col(name).docs.push(structuredClone(d));
     return { collection: col, state, dump: () => JSON.stringify([...cols].map(([n, c]) => [n, c.docs])) };
   }
   module.exports = { makeFakeDb };
   ```
   (`find(filter, opts)` của fake bỏ qua tuỳ chọn `projection` vì JS bỏ qua tham số thừa; `store.js` vẫn dùng `projection` với driver thật.)
2. Tạo `relay/test/db.test.js`:
   ```js
   'use strict';
   const test = require('node:test');
   const assert = require('node:assert/strict');
   const db = require('../lib/db.js');
   const { makeFakeDb } = require('./fake-db.js');

   test('getDb without MONGODB_URI throws a generic error', async () => {
     db._setDb(null); delete process.env.MONGODB_URI;
     await assert.rejects(() => db.getDb(), /storage/);
   });
   test('_setDb injects a fake that getDb returns', async () => {
     const f = makeFakeDb(); db._setDb(f);
     assert.equal(await db.getDb(), f);
     db._setDb(null);
   });
   test('ensureIndexes is idempotent and makes keyHash unique', async () => {
     const f = makeFakeDb();
     await db.ensureIndexes(f); await db.ensureIndexes(f);
     assert.deepEqual(f.collection('machines').indexes, ['keyHash']);
   });
   ```
3. Tạo `relay/test/store.test.js`. Dùng `const hash = (k) => crypto.createHash('sha256').update(k).digest('hex')`; mỗi test bắt đầu bằng `db._setDb(fake = makeFakeDb(seed)); await db.ensureIndexes(fake); store._resetCache(); store._setClock(null)`. Các ca:
   - `findMachineByKeyHash`: trả tên cho khoá đang hoạt động; `null` cho khoá lạ; `null` cho khoá đã thu hồi; `null` cho chuỗi không phải hex hoặc quá ngắn **mà không gọi DB** (`fake.state.calls.length === 0`).
   - Cache khoá với đồng hồ giả (`let t = 1e6; store._setClock(() => t)`): khoá tìm thấy chỉ gọi DB một lần; lần gọi thứ hai tại `t + 29999` không thêm `machines.findOne`; sau khi sửa trực tiếp DB giả thành `revoked: true` (giả lập instance khác), lần gọi tại `t + 29999` vẫn trả tên, còn tại `t + 30001` trả `null`.
   - Khoá lạ **không bao giờ được cache**: tra khoá lạ, thêm máy đó thẳng vào `fake.collection('machines').docs`, lần tra kế tiếp thấy ngay; `_cacheSizes().machines === 0` sau lần tra khoá lạ.
   - `findTopic`: khớp chính xác; rơi về `_default`; `null` khi không có cả hai; `null` khi `threadId` ngoài khoảng (`0`, `2147483648`, `'11'`, `1.5`); doc project không hợp lệ thì dùng `_default` nếu hợp lệ; tên prototype (`constructor`, `__proto__`) trả `null`.
   - Kết quả "không có" của topic **được** cache 30 giây: tra `p2` (null), chèn topic thẳng vào DB giả, vẫn `null` cho đến `t + 30001`.
   - Trần cache: tra 501 project khác nhau thì `_cacheSizes().topics <= 500` ở mọi thời điểm.
   - Vô hiệu hoá: sau `setTopic`, `removeTopic`, `addMachine`, `revokeMachine` thì `_cacheSizes()` là `{machines: 0, topics: 0}` và lần tra kế tiếp thấy dữ liệu mới mà không cần đổi đồng hồ.
   - `addMachine`: true rồi false cho cùng tên; false cho tên khác nhưng trùng `keyHash` (chỉ mục duy nhất của fake ném mã 11000); lỗi khác mã 11000 (`fake.state.fail = true`) được ném lại.
   - `revokeMachine`: true cho máy có thật (đặt `revoked: true` và `revokedAt` là `Date`), false cho máy lạ; idempotent.
   - `listMachines`: trả `[{name, createdAt, revoked}]` sắp theo tên, **không** có thuộc tính `keyHash` và `JSON.stringify(kết quả)` không chứa giá trị băm.
   - `setTopic` upsert (gọi lần hai với id khác vẫn chỉ một doc); `removeTopic` true rồi false; `listTopics` trả `[{project, threadId}]`.
   - Chốt kiểu: `findTopic({$ne: null})`, `addMachine(['a'], 'x')`, `setTopic('p', '5')`, `removeTopic({})` bị reject với `TypeError` và không có lượt gọi DB nào.
4. Chạy `cd relay && node --test test/store.test.js test/db.test.js`, kỳ vọng **FAIL** (chưa có module): giai đoạn đỏ.
5. Tạo `relay/lib/util.js` bằng cách sao `sha`, `send`, `clean`, `readBody` từ `relay/api/notify.js` hiện tại. Giữ các escape `\u0000`, `\u0009`, `\u000B`, `\u001F`, `\u007F` **dưới dạng escape** trong mã nguồn. `sha` vẫn trả `Buffer`. Export `{ MAX_BODY: 4096, sha, send, clean, readBody }` (`readBody` dùng `MAX_BODY`).
6. Tạo `relay/lib/db.js`:
   ```js
   'use strict';
   // Cached MongoClient for serverless: one connection per warm instance. Never logs or rethrows the URI.
   let injected = null, dbPromise = null;

   async function ensureIndexes(db) {
     await db.collection('machines').createIndex({ keyHash: 1 }, { unique: true }); // idempotent
   }

   function getDb() {
     if (injected) return Promise.resolve(injected);
     if (!dbPromise) {
       const uri = process.env.MONGODB_URI;
       if (!uri) return Promise.reject(new Error('storage not configured'));
       const { MongoClient } = require('mongodb'); // lazy: tests with _setDb never load the driver
       const client = new MongoClient(uri, { maxPoolSize: 3, serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
       dbPromise = (async () => {
         await client.connect();
         const db = client.db(process.env.MONGODB_DB || 'claude_notify');
         await ensureIndexes(db);
         return db;
       })().catch(() => {
         dbPromise = null;
         client.close().catch(() => {});
         throw new Error('storage unavailable'); // generic: driver errors can contain the host or credentials
       });
     }
     return dbPromise;
   }

   function _setDb(fake) { injected = fake || null; dbPromise = null; }
   module.exports = { getDb, ensureIndexes, _setDb };
   ```
7. Tạo `relay/lib/store.js`:
   ```js
   'use strict';
   const { getDb } = require('./db');
   const TTL_MS = 30000, MAX_TOPIC_ENTRIES = 500;
   let clock = () => Date.now();
   const machineCache = new Map(); // keyHash -> { value: name, exp }   (found results only)
   const topicCache = new Map();   // project -> { value: threadId|null, exp }   (hits and misses)

   const validThread = (v) => Number.isSafeInteger(v) && v >= 1 && v <= 2147483647;
   function need(v, what) { if (typeof v !== 'string' || !v) throw new TypeError('bad ' + what); return v; }
   function invalidate() { machineCache.clear(); topicCache.clear(); }

   async function findMachineByKeyHash(hex) {
     if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) return null;
     const hit = machineCache.get(hex);
     if (hit && hit.exp > clock()) return hit.value;
     const doc = await (await getDb()).collection('machines').findOne({ keyHash: hex, revoked: false });
     if (!doc) { machineCache.delete(hex); return null; } // never cache "not found": random hashes must not grow memory
     machineCache.set(hex, { value: doc._id, exp: clock() + TTL_MS });
     return doc._id;
   }

   async function findTopic(project) {
     need(project, 'project');
     const hit = topicCache.get(project);
     if (hit && hit.exp > clock()) return hit.value;
     const col = (await getDb()).collection('topics');
     let value = null;
     for (const id of project === '_default' ? ['_default'] : [project, '_default']) {
       const d = await col.findOne({ _id: id });
       if (d && validThread(d.threadId)) { value = d.threadId; break; }
     }
     if (topicCache.size >= MAX_TOPIC_ENTRIES) topicCache.clear();
     topicCache.set(project, { value, exp: clock() + TTL_MS });
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
   ```
   Mỗi hàm công khai kiểm kiểu trước (`need`, `validThread`) nên `findOne` chỉ nhận chuỗi/số thuần.
8. Chạy `cd relay && node --test test/store.test.js test/db.test.js`, kỳ vọng PASS toàn bộ.
9. Kiểm tra encoding và escape:
   - `grep -nP '[^\x00-\x7F]' relay/lib/*.js relay/test/fake-db.js relay/test/db.test.js relay/test/store.test.js` không in gì.
   - `grep -naP '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' relay/lib/util.js` không in gì (xác nhận escape không bị đổi thành ký tự điều khiển thật).
   - `grep -n 'u0000' relay/lib/util.js` hiện chuỗi escape.

---

### Task 10: viết lại cấu hình và xác thực của `relay/api/notify.js`, cập nhật test (added 2026-10-04)

**Files:** sửa `relay/api/notify.js` và `relay/test/notify.test.js`.
**Interfaces (consumes):** `lib/util`, `lib/store` (`findMachineByKeyHash`, `findTopic`), `lib/db` (`_setDb` trong test). Giữ `module.exports = handler` và `handler._resetRateLimit`.

**Thứ tự kiểm tra của handler:** 405 → 500 (thiếu hoặc rỗng `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` hay `MONGODB_URI`; body luôn là `{error:'not configured'}`) → 401 (không có header `Bearer` hoặc băm lạ/đã thu hồi; thiếu header **không** tra DB) → 503 `{error:'storage unavailable'}` (tra khoá ném lỗi) → 429 (theo tên máy, như cũ) → 400 → Telegram.

**Steps**
1. Viết lại test **trước**. Thay phần đầu `relay/test/notify.test.js` (các dòng khai báo hằng, `setEnv`, `fresh`) bằng:
   ```js
   const crypto = require('node:crypto');
   const db = require('../lib/db.js'), store = require('../lib/store.js');
   const { makeFakeDb } = require('./fake-db.js');
   const hash = (k) => crypto.createHash('sha256').update(k).digest('hex');
   const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(40);
   const BOT = '123456:SECRET-BOT-TOKEN', DB_URI = 'mongodb://u:SECRET-DB-PASS@fake.invalid/x';
   let fake;
   function seedDb(over = {}) {
     const machines = over.machines || [
       { _id: 'laptop', keyHash: hash(KEY_A), createdAt: new Date(), revoked: false },
       { _id: 'desk', keyHash: hash(KEY_B), createdAt: new Date(), revoked: false }];
     const topics = over.topics || [{ _id: 'projA', threadId: 11 }, { _id: '_default', threadId: 99 }];
     fake = makeFakeDb({ machines, topics });
     db._setDb(fake); store._resetCache(); store._setClock(null);
   }
   function setEnv(over = {}, seed = {}) {
     process.env.TELEGRAM_BOT_TOKEN = BOT;
     process.env.TELEGRAM_CHAT_ID = '-100123';
     process.env.MONGODB_URI = DB_URI;
     for (const [k, v] of Object.entries(over)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
     seedDb(seed);
     handler._resetRateLimit();
   }
   function fresh(over, seed) { setEnv(over, seed); mockFetch(); }
   ```
   `mockRes`, `call`, `mockFetch` giữ nguyên.
2. Viết lại các test cũ, **giữ ý định**:
   - "GET gives 405": giữ nguyên.
   - "missing and wrong key give 401 and never reach Telegram": giữ nguyên, thêm khẳng định `fake.state.calls.filter((c) => c === 'machines.findOne').length === 1` (thiếu khoá không tra DB, khoá sai tra một lần).
   - "key order in NOTIFY_KEYS ..." đổi thành **"each stored key authenticates as its own machine, whatever the insertion order"**: lặp theo cả hai thứ tự mảng `machines` bằng `seedDb({machines: [...]})`; `KEY_A` cho hậu tố ` \u00b7 laptop`, `KEY_B` cho ` \u00b7 desk`.
   - "a key shorter than 32 chars is ignored" đổi thành **"a short or unknown key gives 401"** (`'abc'` và `'z'.repeat(64)`), và thêm **"a revoked key gives 401 and never reaches Telegram"** (seed `laptop` với `revoked: true`).
   - Các test "400 for malformed or oversized input", "control characters are stripped", "200 sends to the mapped topic", "a deleted topic is retried", "other Telegram failures give 502", "rate limit", "the Telegram request carries an abort signal", "a closed or deleted topic also falls back", "newlines in project cannot forge log lines" giữ nguyên thân, vẫn dùng `fresh()`/`setEnv()` (nay seed DB giả).
   - "unknown project uses _default, or no thread when there is none": nửa sau dùng `fresh({}, { topics: [{_id: 'projA', threadId: 11}] })`.
   - "prototype property names never resolve to a thread": dùng `fresh({}, { topics: [{_id: 'projA', threadId: 11}] })`.
   - "an out-of-range topic id is never sent": với mỗi id trong `1e300, 2147483648, -5, 0, 1.5, '11'` dùng `fresh({}, { topics: [{_id: 'projA', threadId: id}] })`.
   - "the bot token never appears in any response": giữ và thêm khẳng định không chứa `SECRET-DB-PASS` và `hash(KEY_A)`; thêm một ca với `fake.state.fail = true`.
   - "missing or broken configuration gives an identical 500": danh sách ghi đè thành `{TELEGRAM_BOT_TOKEN: null}`, `{TELEGRAM_CHAT_ID: null}`, `{MONGODB_URI: null}`, `{MONGODB_URI: ''}`; body 500 phải bằng `{"error":"not configured"}` ở mọi ca.
3. Test mới trong cùng file:
   - **"DB-backed auth: the plaintext key is not in the database"**: sau một lần gọi 200, `fake.dump()` không chứa `KEY_A`.
   - **"30 s cache: a revoked key stays valid for at most 30 s"**: `let t = 1e6; store._setClock(() => t)`; gọi → 200; sửa `fake.collection('machines').docs[0].revoked = true`; tại `t = 1e6 + 29999` vẫn 200; tại `t = 1e6 + 30001` là 401.
   - **"a valid cached key makes no second DB lookup within the TTL"**: đếm các `machines.findOne` trong `fake.state.calls`.
   - **"unknown keys are not cached"**: gọi với khoá lạ (401), đẩy máy có băm đó thẳng vào fake, lần gọi kế tiếp (cùng đồng hồ) là 200.
   - **"_default topic comes from the DB"**: seed `_default` là 99, gọi với project khác, kỳ vọng `message_thread_id` là 99.
   - **"topic cache includes misses for 30 s"**: một ca đầu-cuối có đồng hồ (chi tiết đã có ở test store).
   - **"503 when the store throws on the key lookup"**: `fake.state.fail = true` → 503 body `{"error":"storage unavailable"}`; Telegram không được gọi; response không chứa `SECRET-DB-PASS`; output `console.log` bắt được không chứa `SECRET-DB-PASS`, khoá, băm hay `MONGODB_URI`.
   - **"topic lookup failure still delivers to General"**: lần gọi đầu cache khoá; rồi đặt `fake.state.fail = true` và gọi với project mới → 200 và không có `message_thread_id`.
   - **"secrets never in logs"**: bắt `console.log` qua nhiều lần gọi (200, 401, 502, 503); không được chứa `BOT`, `KEY_A`, `hash(KEY_A)`, `DB_URI`, `SECRET-DB-PASS`.
4. Chạy `cd relay && node --test test/notify.test.js`, kỳ vọng **FAIL** (đỏ).
5. Sửa `relay/api/notify.js`:
   - Xoá `sha`, `send`, `clean`, `readBody` cục bộ và `require('node:crypto')`; xoá phần `loadConfig` đọc JSON và `authenticate` cũ.
   - Thêm import và hàm mới:
     ```js
     const { MAX_BODY, sha, send, clean, readBody } = require('../lib/util');
     const store = require('../lib/store');
     const MAX_PROJECT = 100, MAX_TEXT = 500;

     function loadConfig() { // null when anything required is missing
       const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID, uri = process.env.MONGODB_URI;
       return token && chat && uri ? { token, chat } : null;
     }
     async function authenticate(header) { // machine name or null; throws when storage is down
       const m = /^Bearer (.+)$/.exec(header || '');
       return m ? store.findMachineByKeyHash(sha(m[1]).toString('hex')) : null;
     }
     ```
   - Trong handler, thay khối cấu hình + xác thực cũ bằng:
     ```js
       const cfg = loadConfig();
       if (!cfg) return send(res, 500, { error: 'not configured' });
       let machine;
       try { machine = await authenticate(req.headers && req.headers.authorization); }
       catch { console.log('notify status=503'); return send(res, 503, { error: 'storage unavailable' }); } // never log the error object
       if (!machine) return send(res, 401, { error: 'unauthorized' });
     ```
   - Thay khối tra topic (biến `has`, `valid`, `thread`) bằng:
     ```js
       let thread = null;
       try { thread = await store.findTopic(project); } catch { /* topic lookup failed: post to General */ }
       const body = { chat_id: cfg.chat, text: `${text} \u00b7 ${machine}` };
       if (thread !== null) body.message_thread_id = thread;
     ```
   - Giữ nguyên `tg`, `rateLimited`, logic thử lại, dòng log và các export.
6. Chạy `cd relay && node --test` (mọi file), kỳ vọng PASS.
7. Kiểm tra: `grep -nE "NOTIFY_KEYS|NOTIFY_TOPICS" relay/api/notify.js relay/test/notify.test.js` không in gì; `grep -nP '[^\x00-\x7F]' relay/api/notify.js relay/test/notify.test.js` không in gì; `grep -c 'u00b7' relay/api/notify.js` ít nhất 1.

---

### Task 11: `relay/api/admin.js` và `relay/test/admin.test.js` (added 2026-10-04)

**Files:** tạo `relay/api/admin.js` và `relay/test/admin.test.js`.
**Interface (produces):** `POST /api/admin`, `Authorization: Bearer <NOTIFY_ADMIN_KEY>`, body `{action, ...}`; export `handler` và `handler._resetRateLimit()`.

| Action | Tham số | Kết quả |
|---|---|---|
| `machine-add` | `name` | 200 `{name, key}` (khoá hiện một lần, header `Cache-Control: no-store`); 409 `{error:'name exists'}` |
| `machine-revoke` | `name` | 200 `{ok:true}` hoặc 404 `{error:'not found'}` |
| `machine-list` | không | 200 `{machines:[{name, createdAt, revoked}]}` |
| `topic-add` | `project`, `threadId` | 200 `{ok:true}` |
| `topic-remove` | `project` | 200 hoặc 404 |
| `topic-list` | không | 200 `{topics:[{project, threadId}]}` |

Mã khác: 405 (không phải POST); 500 `{error:'not configured'}` (thiếu hoặc dưới 32 ký tự `NOTIFY_ADMIN_KEY`, hoặc thiếu `MONGODB_URI`); 429 kèm `Retry-After`; 401; 400; 503 `{error:'storage unavailable'}` khi store ném lỗi.
**Thứ tự kiểm tra:** 405 → 500 → 429 giới hạn lần sai → 401 (ghi nhận là một lần sai) → 429 giới hạn thường → 400 body → thực hiện action.

**Steps**
1. Viết `relay/test/admin.test.js` **trước**. File có `mockRes`/`call` riêng (khoảng 10 dòng, sao từ `notify.test.js`) và `setupEnv(over, seed)` đặt `NOTIFY_ADMIN_KEY = 'K'.repeat(40)`, `MONGODB_URI`, gọi `db._setDb(fake)`, `store._resetCache()` và `handler._resetRateLimit()`. Các ca bắt buộc:
   1. GET → 405 kèm `Allow: POST`.
   2. Cấu hình: thiếu khoá, khoá 31 ký tự, thiếu `MONGODB_URI` đều cho cùng body 500 `{"error":"not configured"}`.
   3. Thiếu hoặc sai khoá → 401, không có lượt gọi DB nào (`fake.state.calls.length === 0`).
   4. Giới hạn lần sai: 20 khoá sai đều 401; lần thứ 21 dù dùng **đúng** khoá vẫn 429 với `Retry-After >= 1`; sau `_resetRateLimit()` khoá đúng dùng lại được.
   5. Giới hạn thường: 10 lần `machine-list` đều 200, lần thứ 11 là 429.
   6. `machine-add`: trả 200 `{name, key}`; `key` khớp `/^[A-Za-z0-9_-]{43}$/` và header `Cache-Control` là `no-store`; doc trong DB có `keyHash === sha256(key)` (hex), `revoked === false`, `createdAt` là `Date`; `fake.dump()` không chứa khoá; hai lần gọi cho hai khoá khác nhau.
   7. Đầu-cuối: khoá do `machine-add` trả về xác thực được qua `../api/notify.js` (fetch giả, không seed máy nào) và tin có hậu tố ` \u00b7 <tên>`.
   8. Trùng tên → 409, body không có `key`, băm gốc không đổi.
   9. Kiểm tra tên: `''`, `'A'`, `'Upper'`, `'-x'`, `'a'.repeat(33)`, `'a b'`, `'a/b'`, `5`, `null`, thiếu trường, `{$ne: null}`, `['a']` đều 400; `'a'.repeat(32)` hợp lệ → 200.
   10. `machine-revoke`: 200 đặt `revoked: true` và `revokedAt`; tên vẫn bị giữ chỗ (`machine-add` lại cùng tên → 409); tên lạ → 404, thu hồi lần hai → 200; sau thu hồi qua admin, khoá bị thu hồi nhận 401 ở `notify.js` **ngay** (cache cùng instance đã xoá).
   11. `machine-list`: body không có thuộc tính `keyHash` và không có giá trị băm; có cờ `revoked` và `createdAt`; sắp xếp theo tên.
   12. `topic-add`: upsert (gọi lần hai với id khác vẫn một doc); chấp nhận `_default`; `threadId` không hợp lệ → 400: `0`, `-1`, `2147483648`, `1.5`, `'5'`, `null`, `1e300`, `{$gt: 0}`, `[5]`; `project` không hợp lệ → 400: `''`, `'x'.repeat(101)`, `'a\nb'`, `'a\u0007'`, `' lead'`, `{$ne: null}`, `['a']`, `5`.
   13. `topic-remove`: 200 rồi 404; object/mảng ở `project` → 400.
   14. `topic-list` trả `{topics: [...]}`.
   15. NoSQL injection: mọi action với object/mảng ở `name`, `project`, `threadId` đều 400, `fake.state.calls` vẫn rỗng (fake cũng sẽ ném nếu có bộ lọc dạng object).
   16. Action lạ, thiếu hoặc không phải chuỗi → 400; body không phải JSON, body là mảng, body trên 4 KB → 400.
   17. Lỗi DB: với `fake.state.fail = true`, `machine-add`, `machine-list`, `topic-add` đều 503 `{"error":"storage unavailable"}`; response không chứa `SECRET-DB-PASS`.
   18. Không rò rỉ bí mật: bắt `console.log` và response qua nhiều lần gọi; không được chứa khoá admin, khoá vừa sinh, băm, `SECRET-DB-PASS` hay `MONGODB_URI`.
   19. Định dạng log: mỗi dòng log khớp `/^admin (action=[a-z-]+ )?status=\d{3}( name=[a-z0-9_-]+| project=.+)?$/` (nới `project=.+` vì tên project có thể chứa khoảng trắng bên trong nhưng không có ký tự điều khiển hay xuống dòng).
2. Chạy `cd relay && node --test test/admin.test.js`, kỳ vọng **FAIL** (đỏ).
3. Tạo `relay/api/admin.js`:
   ```js
   'use strict';
   const crypto = require('node:crypto');
   const { MAX_BODY, sha, send, clean, readBody } = require('../lib/util');
   const store = require('../lib/store');

   const WINDOW_MS = 60000, MAX_REQ = 10, MAX_FAIL = 20;
   const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
   let okHits = [], failHits = []; // per instance, best-effort (same trade-off as notify.js)

   const recent = (arr, now) => arr.filter((t) => now - t < WINDOW_MS);
   const wait = (arr, now) => Math.max(1, Math.ceil((WINDOW_MS - (now - arr[0])) / 1000));
   const log = (s) => console.log('admin ' + s); // only validated, charset-limited values reach the log

   function loadConfig() {
     const key = process.env.NOTIFY_ADMIN_KEY, uri = process.env.MONGODB_URI;
     return key && key.length >= 32 && uri ? { key } : null;
   }
   function isAdmin(header, key) {
     const m = /^Bearer (.+)$/.exec(header || '');
     const same = crypto.timingSafeEqual(sha(m ? m[1] : ''), sha(key)); // equal-length digests
     return !!m && same;
   }
   const vName = (v) => (typeof v === 'string' && NAME_RE.test(v) ? v : null);
   function vProject(v) {
     if (typeof v !== 'string' || v.length < 1 || v.length > 100) return null;
     return clean(v) === v && !/\n/.test(v) ? v : null; // reject, never repair
   }
   const vThread = (v) => (Number.isSafeInteger(v) && v >= 1 && v <= 2147483647 ? v : null);

   async function handler(req, res) {
     if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
     const cfg = loadConfig();
     if (!cfg) return send(res, 500, { error: 'not configured' });
     const now = Date.now();
     failHits = recent(failHits, now);
     if (failHits.length >= MAX_FAIL) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': String(wait(failHits, now)) });
     if (!isAdmin(req.headers && req.headers.authorization, cfg.key)) {
       failHits.push(now); log('status=401');
       return send(res, 401, { error: 'unauthorized' });
     }
     okHits = recent(okHits, now);
     if (okHits.length >= MAX_REQ) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': String(wait(okHits, now)) });
     okHits.push(now);

     const bad = (action) => { log(`${action ? 'action=' + action + ' ' : ''}status=400`); return send(res, 400, { error: 'bad request' }); };
     const raw = await readBody(req);
     if (raw === null || Buffer.byteLength(raw) > MAX_BODY) return bad();
     let b; try { b = JSON.parse(raw); } catch { return bad(); }
     if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.action !== 'string') return bad();

     try {
       switch (b.action) {
         case 'machine-add': {
           const name = vName(b.name); if (!name) return bad('machine-add');
           const key = crypto.randomBytes(32).toString('base64url'); // 43 chars, 256 bits; only its hash is stored
           if (!(await store.addMachine(name, sha(key).toString('hex')))) { log(`action=machine-add status=409 name=${name}`); return send(res, 409, { error: 'name exists' }); }
           log(`action=machine-add status=200 name=${name}`);
           return send(res, 200, { name, key }, { 'Cache-Control': 'no-store' });
         }
         case 'machine-revoke': {
           const name = vName(b.name); if (!name) return bad('machine-revoke');
           const ok = await store.revokeMachine(name);
           log(`action=machine-revoke status=${ok ? 200 : 404} name=${name}`);
           return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'not found' });
         }
         case 'machine-list': { const machines = await store.listMachines(); log('action=machine-list status=200'); return send(res, 200, { machines }); }
         case 'topic-add': {
           const project = vProject(b.project), threadId = vThread(b.threadId);
           if (!project || threadId === null) return bad('topic-add');
           await store.setTopic(project, threadId);
           log(`action=topic-add status=200 project=${project}`);
           return send(res, 200, { ok: true });
         }
         case 'topic-remove': {
           const project = vProject(b.project); if (!project) return bad('topic-remove');
           const ok = await store.removeTopic(project);
           log(`action=topic-remove status=${ok ? 200 : 404} project=${project}`);
           return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'not found' });
         }
         case 'topic-list': { const topics = await store.listTopics(); log('action=topic-list status=200'); return send(res, 200, { topics }); }
         default: return bad();
       }
     } catch { log('status=503'); return send(res, 503, { error: 'storage unavailable' }); } // never log the error object
   }

   module.exports = handler;
   module.exports._resetRateLimit = () => { okHits = []; failHits = []; };
   ```
4. Chạy `cd relay && node --test`, kỳ vọng PASS.
5. Kiểm tra encoding: `grep -nP '[^\x00-\x7F]' relay/api/admin.js relay/test/admin.test.js` không in gì; `grep -naP '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' relay/api/admin.js relay/test/admin.test.js` không in gì.

---

### Task 12: `hooks/channels/relay-admin.ps1` (chỉ ASCII, không BOM) (added 2026-10-04)

**Files:** tạo `hooks/channels/relay-admin.ps1`.
**Interfaces (produces):** `Get-AdminConfig` → `{url, key_enc}` hoặc `$null`; `Save-AdminConfig($cfg)` ghi `~/.claude/notify.admin.json` UTF-8 không BOM; `Invoke-RelayAdmin -Action <string> -Params <hashtable>` **không bao giờ ném lỗi** và trả `[pscustomobject]@{ Ok; Status; Data }` (`Status` là mã HTTP; `0` khi không có phản hồi: mạng, timeout, redirect bị từ chối; `-1` khi chưa cấu hình admin; `Data` là JSON đã parse khi thành công); `$script:AdminFile`.
File này **dot-source `relay.ps1`** (`. (Join-Path $PSScriptRoot 'relay.ps1')`) để dùng lại `Protect-RelayKey`/`Unprotect-RelayKey` và thiết lập TLS 1.2; dot-source hai lần (notify-ctl đã nạp một lần) là vô hại, và nhờ đó bộ test có thể chạy `. relay-admin.ps1; Save-AdminConfig ...` trong một process con.

**Steps**
1. Tạo file:
   ```powershell
   # Channel helper: relay admin API (machine keys + topic map). Dot-sourced by notify-ctl.ps1. ASCII only.
   # Config: ~/.claude/notify.admin.json = { "url": "https://<app>.vercel.app/api/admin", "key_enc": "<DPAPI string>" }
   # The admin key is DPAPI-encrypted (this Windows user, this machine) and is never printed.
   . (Join-Path $PSScriptRoot 'relay.ps1')   # Protect-RelayKey / Unprotect-RelayKey, TLS 1.2

   $script:AdminFile = Join-Path (Join-Path $HOME '.claude') 'notify.admin.json'

   function Get-AdminConfig {
       try {
           if (-not (Test-Path -LiteralPath $script:AdminFile)) { return $null }
           $cfg = Get-Content -LiteralPath $script:AdminFile -Raw -Encoding UTF8 | ConvertFrom-Json
           if (-not $cfg.url -or -not $cfg.key_enc) { return $null }
           return $cfg
       } catch { return $null }
   }

   function Save-AdminConfig($cfg) {
       $json = $cfg | ConvertTo-Json -Depth 5
       [IO.File]::WriteAllText($script:AdminFile, $json, (New-Object Text.UTF8Encoding($false)))
   }

   # POSTs { action, ...Params } to the admin endpoint. Never throws; never prints the key.
   function Invoke-RelayAdmin {
       param([string]$Action, [hashtable]$Params = @{})
       $cfg = Get-AdminConfig
       if (-not $cfg) { return [pscustomobject]@{ Ok = $false; Status = -1; Data = $null } }
       try {
           $key = (Unprotect-RelayKey $cfg.key_enc).Trim()
           $payload = @{ action = $Action }
           foreach ($k in $Params.Keys) { $payload[$k] = $Params[$k] }
           $bytes = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress))
           $data = Invoke-RestMethod -Uri $cfg.url -Method Post -Headers @{ Authorization = "Bearer $key" } `
               -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 10 -MaximumRedirection 0   # no redirects: never re-send the key elsewhere
           return [pscustomobject]@{ Ok = $true; Status = 200; Data = $data }
       } catch {
           $status = 0
           try { if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } } catch { }
           return [pscustomobject]@{ Ok = $false; Status = $status; Data = $null }
       }
   }
   ```
2. Kiểm tra encoding: `grep -nP '[^\x00-\x7F]' hooks/channels/relay-admin.ps1` không in gì.
3. Parse-check:
   ```powershell
   $e=$null; [void][Management.Automation.Language.Parser]::ParseFile('C:\Github\MinhTQ-SDLC\hooks\channels\relay-admin.ps1',[ref]$null,[ref]$e); $e.Count
   ```
   Kỳ vọng in `0`.

---

### Task 13: các lệnh mới của `hooks/notify-ctl.ps1` (added 2026-10-04)

**Files:** sửa `hooks/notify-ctl.ps1` (giữ chỉ ASCII).
**Interfaces (consumes):** `Get-AdminConfig`, `Save-AdminConfig`, `Invoke-RelayAdmin`; từ `relay.ps1`: `Save-RelayConfig`, `Protect-RelayKey`, `$script:RelayFile`.
Trước hết chạy `grep -c $'\r' hooks/notify-ctl.ps1` và giữ kiểu xuống dòng. Mọi chỉnh sửa dùng công cụ Edit với neo chính xác; mọi chữ mới là ASCII (tiếng Việt không dấu như các thông báo sẵn có).

**Steps**
1. **Comment đầu file.** Neo: dòng `#   notify-ctl.cmd relay-setup [-Url <url>]                     one-time per machine: save the relay URL + this machine's key (key is asked, never echoed)`. Thêm ngay sau nó:
   ```
   #   notify-ctl.cmd admin-setup [-Url <url>]                     one-time on the admin machine: save the admin URL + admin key (key is asked, never echoed)
   #   notify-ctl.cmd machine-add <name> [-Apply]                  create a machine key (shown ONCE); -Apply stores it for THIS machine
   #   notify-ctl.cmd machine-revoke <name>                        revoke a machine key (effective within ~30 s)
   #   notify-ctl.cmd machines                                     list machines
   #   notify-ctl.cmd topic-add [project] <thread_id>              map a project (default: current folder name; _default allowed) to a topic
   #   notify-ctl.cmd topic-remove [project]                       remove a mapping
   #   notify-ctl.cmd topics                                       list mappings
   ```
2. **Khối `param`.** Thay hai dòng `    [string]$Url` và `)` bằng `    [string]$Url,` / `    [switch]$Apply` / `)`.
3. **Dot-source.** Neo: `. (Join-Path $PSScriptRoot 'channels\relay.ps1')`. Thêm ngay sau:
   ```powershell
   . (Join-Path $PSScriptRoot 'channels\relay-admin.ps1')
   ```
4. **Hàm trợ giúp.** Chèn trước dòng `switch ($Command) {`:
   ```powershell
   function Test-RelayUrl([string]$u) { # https only (http allowed for localhost)
       $uri = $null
       if (-not [Uri]::TryCreate($u, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin 'https', 'http') { Write-Host 'URL khong hop le.'; return $false }
       if ($uri.Scheme -ne 'https' -and $uri.Host -notin '127.0.0.1', 'localhost') { Write-Host 'URL phai la https (http chi cho phep voi localhost).'; return $false }
       return $true
   }

   function Get-RelayUrlFromAdmin([string]$adminUrl) { # .../api/admin -> .../api/notify, or $null
       if ($adminUrl -match '/api/admin/?$') { return ($adminUrl -replace '/api/admin/?$', '/api/notify') }
       return $null
   }

   function Require-Admin { # exits when admin-setup has not been run
       if (-not (Get-AdminConfig)) { Write-Host 'Chua cau hinh admin - chay truoc: notify-ctl.cmd admin-setup'; exit 1 }
   }

   function Show-AdminError($r, [string]$what) {
       switch ($r.Status) {
           0   { Write-Host "$what that bai: khong ket noi duoc toi admin endpoint (kiem tra mang/URL)." }
           401 { Write-Host "$what that bai: khoa admin sai (chay lai admin-setup)." }
           404 { Write-Host "$what that bai: khong tim thay." }
           409 { Write-Host "$what that bai: ten da ton tai." }
           429 { Write-Host "$what that bai: qua nhieu request, thu lai sau 1 phut." }
           503 { Write-Host "$what that bai: kho du lieu (MongoDB) khong san sang." }
           default { Write-Host "$what that bai: HTTP $($r.Status)." }
       }
   }

   function Get-ProjectName([string]$given) { if ($given) { return $given } else { return (Split-Path (Get-Location).Path -Leaf) } }
   ```
5. **Lời nhắc của `relay-setup`.** Thay chuỗi `'Dan khoa cua may nay (NOTIFY_KEYS tren Vercel; se khong hien tren man hinh)'` bằng `'Dan khoa cua may nay (do lenh machine-add in ra; se khong hien tren man hinh)'`.
6. **Các nhánh mới.** Chèn trước dòng `    default { Write-Host "Lenh khong ro: $Command. Dung: snooze | on | status | test | relay-setup"; exit 1 }`:
   ```powershell
       'admin-setup' {
           if (-not $Url) { $Url = Read-Host 'Dan URL admin (vd https://<app>.vercel.app/api/admin)' }
           $Url = $Url.Trim()
           if (-not (Test-RelayUrl $Url)) { exit 1 }
           $secure = Read-Host 'Dan khoa admin (NOTIFY_ADMIN_KEY; se khong hien tren man hinh)' -AsSecureString
           if ($secure.Length -lt 32) { Write-Host 'Khoa phai tu 32 ky tu tro len.'; exit 1 }
           Save-AdminConfig ([pscustomobject]@{ url = $Url; key_enc = (Protect-RelayKey $secure) })
           Write-Host "Da luu cau hinh vao $script:AdminFile (khoa ma hoa theo tai khoan Windows, KHONG nam trong repo)."
           $r = Invoke-RelayAdmin -Action 'machine-list'
           if ($r.Ok) { Write-Host 'Ket noi admin OK.' } else { Show-AdminError $r 'Kiem tra ket noi admin' }
       }
       'machine-add' {
           Require-Admin
           if ($Arg1 -cnotmatch '^[a-z0-9][a-z0-9_-]{0,31}$') { Write-Host 'Dung: machine-add <ten> [-Apply]   (ten: a-z 0-9 _ -, toi da 32 ky tu, bat dau bang chu/so, chu thuong)'; exit 1 }
           $relayUrl = $null
           if ($Apply) {
               $relayUrl = Get-RelayUrlFromAdmin ((Get-AdminConfig).url)
               if (-not $relayUrl) { Write-Host 'Khong suy ra duoc URL relay tu URL admin (phai ket thuc bang /api/admin). Chay lai khong co -Apply roi dung relay-setup.'; exit 1 }
           }
           $r = Invoke-RelayAdmin -Action 'machine-add' -Params @{ name = $Arg1 }
           if (-not $r.Ok) { Show-AdminError $r 'machine-add'; exit 1 }
           $key = [string]$r.Data.key
           if ($Apply) {
               try {
                   Save-RelayConfig ([pscustomobject]@{ url = $relayUrl; key_enc = (Protect-RelayKey (ConvertTo-SecureString $key -AsPlainText -Force)) })
                   Write-Host "Da tao may '$Arg1' va ghi khoa (ma hoa) vao $script:RelayFile. Chay: notify-ctl.cmd test"
               } catch {
                   Write-Warning 'Khong ghi duoc notify.relay.json. Khoa duoi day chi hien MOT LAN - hay luu lai:'
                   Write-Host $key
               }
           } else {
               Write-Host "Da tao may '$Arg1'. Khoa (chi hien MOT LAN, hay luu ngay):"
               Write-Host $key
               Write-Host 'Tren may do chay: notify-ctl.cmd relay-setup (dan URL .../api/notify va khoa nay).'
           }
       }
       'machine-revoke' {
           Require-Admin
           if (-not $Arg1) { Write-Host 'Dung: machine-revoke <ten>'; exit 1 }
           $r = Invoke-RelayAdmin -Action 'machine-revoke' -Params @{ name = $Arg1 }
           if ($r.Ok) { Write-Host "Da thu hoi may '$Arg1' (co hieu luc trong toi da 30 giay)." } else { Show-AdminError $r 'machine-revoke'; exit 1 }
       }
       'machines' {
           Require-Admin
           $r = Invoke-RelayAdmin -Action 'machine-list'
           if (-not $r.Ok) { Show-AdminError $r 'machines'; exit 1 }
           $list = @($r.Data.machines | Where-Object { $_ })
           if (-not $list.Count) { Write-Host '(chua co may nao)' }
           foreach ($m in $list) { Write-Host ('{0,-34} {1}  {2}' -f $m.name, $(if ($m.revoked) { 'DA THU HOI' } else { 'hoat dong' }), $m.createdAt) }
       }
       'topic-add' {
           Require-Admin
           $project = $null; $idText = $null
           if ($Arg2) { $project = $Arg1; $idText = $Arg2 } else { $project = Get-ProjectName ''; $idText = $Arg1 }
           $tid = 0
           if (-not [int]::TryParse([string]$idText, [ref]$tid) -or $tid -lt 1) { Write-Host 'Dung: topic-add [project] <thread_id>   (thread_id: so nguyen 1..2147483647)'; exit 1 }
           if (-not $project -or $project.Length -gt 100) { Write-Host 'Ten project khong hop le (1..100 ky tu).'; exit 1 }
           $r = Invoke-RelayAdmin -Action 'topic-add' -Params @{ project = $project; threadId = $tid }
           if ($r.Ok) { Write-Host "Da map '$project' -> topic $tid (co hieu luc trong toi da 30 giay)." } else { Show-AdminError $r 'topic-add'; exit 1 }
       }
       'topic-remove' {
           Require-Admin
           $project = Get-ProjectName $Arg1
           $r = Invoke-RelayAdmin -Action 'topic-remove' -Params @{ project = $project }
           if ($r.Ok) { Write-Host "Da xoa map cua '$project'." } else { Show-AdminError $r 'topic-remove'; exit 1 }
       }
       'topics' {
           Require-Admin
           $r = Invoke-RelayAdmin -Action 'topic-list'
           if (-not $r.Ok) { Show-AdminError $r 'topics'; exit 1 }
           $list = @($r.Data.topics | Where-Object { $_ })
           if (-not $list.Count) { Write-Host '(chua co map nao)' }
           foreach ($t in $list) { Write-Host ('{0,-34} -> {1}' -f $t.project, $t.threadId) }
       }
   ```
   Lưu ý: `[int]::TryParse` thất bại với giá trị trên 2147483647 nên khoảng giá trị cũng được ép ở client; `-cnotmatch` có chủ đích vì `-match` mặc định không phân biệt hoa thường.
7. **Dòng usage mặc định.** Thay bằng:
   ```powershell
       default { Write-Host "Lenh khong ro: $Command. Dung: snooze | on | status | test | relay-setup | admin-setup | machine-add | machine-revoke | machines | topic-add | topic-remove | topics"; exit 1 }
   ```
8. Kiểm tra:
   - Parse-check (đoạn như Task 12 nhưng với `hooks\notify-ctl.ps1`) in `0`.
   - `grep -nP '[^\x00-\x7F]' hooks/notify-ctl.ps1` không in gì.
   - `grep -n NOTIFY_KEYS hooks/notify-ctl.ps1` không in gì.
   - Chạy `powershell -NoProfile -File hooks\notify-ctl.ps1 bogus`, kỳ vọng in dòng usage mới và thoát 1 (lệnh lạ nên không ghi gì).
   - **Không** chạy lệnh admin nào trên `~/.claude` thật; việc đó thuộc bộ test ở Task 16.

---

### Task 14: `commands/notify.md` (added 2026-10-04)

**Files:** sửa `commands/notify.md` (nội dung tiếng Anh, theo quy ước của các command anh em; không chứa các từ cấm của test repo).

**Steps**
1. Thay toàn bộ gạch đầu dòng bắt đầu bằng `` - `relay-setup` is NOT available through this command`` bằng:
   ```
   - `relay-setup` and all admin commands (`admin-setup`, `machine-add`, `machine-revoke`, `machines`, `topic-add`, `topic-remove`, `topics`) are NOT available through this command: they handle secret keys (the per-machine relay key and the relay admin key). If the user asks for one of them, tell them to run `& "$HOME\.claude\notify-ctl.cmd" <command>` themselves in a terminal. Never ask for, read, print or echo a relay key, an admin key, a MongoDB connection string or a bot token in this session, and never read `~/.claude/notify.relay.json` or `~/.claude/notify.admin.json`.
   ```
2. Bước 1 (kiểm tra đối số) và quy tắc "Any argument other than the four forms" giữ nguyên: chúng đã từ chối mọi thứ ngoài bốn dạng, nên các lệnh admin bị chặn sẵn.
3. Chạy test của repo:
   ```
   bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'
   ```
   Kỳ vọng `PASS`.

---

### Task 15: README và ghi chú vào spec (added 2026-10-04)

**Files:** sửa `README.md` (mục relay và dòng mô tả cấu trúc file). Đọc kỹ mục relay trước khi sửa, neo bằng nội dung; dùng Edit.

**Steps**
1. Đoạn mở đầu của mục relay: thay câu "relay kiểm tra khoá, giới hạn tần suất rồi gọi Telegram" bằng "relay tra khoá trong MongoDB (chỉ lưu **băm** SHA-256), giới hạn tần suất rồi gọi Telegram. Khoá máy và bản đồ topic nằm trong MongoDB Atlas nên thêm máy/topic **không cần sửa env hay redeploy**".
2. Thay cả khối "**1. Deploy relay lên Vercel (một lần):**" (đến hết đoạn nói về giới hạn của relay) bằng nội dung sau (viết tiếng Việt có dấu trong file thật):
   - **1. Cài đặt một lần**
     - **a. Telegram:** `@BotFather` → `/newbot` lấy token. Tạo supergroup, bật *Topics*, tự tạo một topic cho mỗi project, thêm bot làm **admin**. Lấy `message_thread_id` từ link topic `t.me/c/<chat>/<thread>` (ví dụ `t.me/c/1234567890/5` → chat `-1001234567890`, thread `5`; topic General không có thread).
     - **b. MongoDB Atlas (gói miễn phí M0):**
       1. Tạo tài khoản/project trên MongoDB Atlas, *Build a Database* → **M0 Free**, chọn region gần bạn.
       2. *Database Access* → Add New Database User → Authentication *Password*, mật khẩu **mạnh** (nút Autogenerate). Mật khẩu có ký tự đặc biệt phải URL-encode trong chuỗi kết nối.
       3. *Database User Privileges* → *Specific Privileges* → role `readWrite` trên **đúng một database** (ví dụ `claude_notify`), để trống collection. Không dùng quyền "any database", không dùng `atlasAdmin`.
       4. *Network Access* → Add IP Address → `0.0.0.0/0`. **Vì sao:** Vercel serverless không có IP cố định nên không thể giới hạn theo IP. **Bù lại:** kết nối bắt buộc TLS; user DB chỉ có `readWrite` trên một database; mật khẩu mạnh, xoay được bất cứ lúc nào; DB chỉ chứa băm SHA-256 của khoá 256 bit và id topic nên nếu lộ cũng không giả được máy.
       5. *Connect* → *Drivers* → copy chuỗi `mongodb+srv://<user>:<mật khẩu>@<cluster>.mongodb.net/?retryWrites=true&w=majority`. Đây là `MONGODB_URI` (coi như mật khẩu, chỉ đặt trên Vercel).
       6. Lưu ý: cluster M0 có thể bị tạm dừng khi lâu không dùng (xem chính sách hiện hành của Atlas); khi đó tin điện thoại dừng cho tới khi bật lại, toast vẫn chạy.
     - **c. Vercel:** Import repo này, **Root Directory = `relay`**, không cần build command. Project Settings → Environment Variables (Production), đặt **một lần** rồi Redeploy:

       | Biến | Giá trị |
       | --- | --- |
       | `TELEGRAM_BOT_TOKEN` | token của bot |
       | `TELEGRAM_CHAT_ID` | id supergroup, dạng `-100xxxxxxxxxx` |
       | `MONGODB_URI` | chuỗi kết nối Atlas ở bước b.5 |
       | `NOTIFY_ADMIN_KEY` | khoá admin ngẫu nhiên, **≥ 32 ký tự** (cách sinh bên dưới) |
       | `MONGODB_DB` | tuỳ chọn, tên database; mặc định `claude_notify` (phải khớp database đã cấp quyền ở b.3) |

       Sinh `NOTIFY_ADMIN_KEY` (PowerShell 5.1, ra 44 ký tự):
       ```powershell
       $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
       ```
       Lưu khoá này vào trình quản lý mật khẩu; nó chỉ cần nhập một lần trên máy admin.
3. Đoạn "Project không có trong ..." (nói về bản đồ topic): thay bằng: project chưa map thì tin vào topic `_default` (nếu có), nếu không có thì vào General. Topic đã bị xoá/đóng thì tin tự gửi lại vào General một lần. Giữ nguyên câu về giới hạn của relay (chỉ nhận POST, body ≤ 4 KB, `text` ≤ 500, `project` ≤ 100, 30 request/phút/máy, best-effort) và câu về gói Vercel miễn phí. Thêm: thu hồi khoá hoặc đổi topic có hiệu lực trong **tối đa 30 giây** (do cache); nếu MongoDB không truy cập được, relay trả 503 (không gửi tin) và toast vẫn chạy.
4. Thay "**2. Cài mỗi máy (một lần):**" bằng **2. Thiết lập client**:
   ```powershell
   & "$HOME\.claude\notify-ctl.cmd" admin-setup                    # máy admin, một lần: dán URL https://<app>.vercel.app/api/admin và khoá admin (ẩn)
   & "$HOME\.claude\notify-ctl.cmd" machine-add laptop -Apply      # tạo khoá cho CHÍNH máy này, tự ghi notify.relay.json (URL suy ra: /api/admin thành /api/notify)
   & "$HOME\.claude\notify-ctl.cmd" test
   cd <thư mục project>; & "$HOME\.claude\notify-ctl.cmd" topic-add <thread_id>     # map project này với topic; hoặc: topic-add _default <thread_id>
   ```
   kèm các ý: khoá admin và khoá máy đều mã hoá DPAPI theo tài khoản Windows (`notify.admin.json`, `notify.relay.json`), nằm **ngoài repo**; **thêm máy khác sau này:** trên máy admin chạy `machine-add <tên>` (không `-Apply`), khoá chỉ hiện **một lần**, trên máy mới chạy `relay-setup` (URL `.../api/notify` + khoá đó), máy mới **không** cần `admin-setup`; **thu hồi máy:** `machine-revoke <tên>` (khoá bị từ chối sau tối đa 30 giây, tên vẫn bị giữ chỗ), `machines` để xem danh sách; **thêm/sửa/xoá topic sau này:** `topic-add [project] <thread_id>` (không có project thì lấy tên thư mục hiện tại), `topic-remove [project]`, `topics`; lệnh admin **không** nằm trong `/notify` (cần khoá bí mật); test relay cục bộ: `cd relay; npm install; node --test` (Node ≥ 18, không cần mạng hay Atlas).
5. Tìm trong README mọi nhắc tới cách cũ (`NOTIFY_KEYS`, `NOTIFY_TOPICS`, "redeploy" gắn với đổi khoá/topic, "Mất máy: xoá/đổi khoá") và xoá hoặc viết lại.
6. Dòng mô tả cấu trúc file: đổi mô tả `relay/` thành "relay Vercel serverless (`api/notify.js` nhận tin, `api/admin.js` quản trị máy/topic, `lib/db.js` + `lib/store.js` lưu trữ MongoDB, `test/` gồm test và DB giả)"; đổi mô tả `hooks/notify-ctl.ps1` thành `snooze/status/relay-setup/admin-setup/machine-*/topic-*`; thêm `hooks/channels/relay-admin.ps1` (gọi API admin) vào danh sách kênh.
7. Chạy `grep -n "NOTIFY_KEYS\|NOTIFY_TOPICS" README.md`, kỳ vọng không in gì.

---

### Task 16: Kiểm chứng và bộ test client cập nhật (added 2026-10-04)

**Files (scratchpad, không commit):** sửa `C:\Users\minhtq\AppData\Local\Temp\claude\c--Github-MinhTQ-SDLC\b3b9e513-f9a2-4b5f-81dd-d1e8742cf2cd\scratchpad\run-client-tests.ps1`; tạo `...\scratchpad\mock-admin.js`.

**16a. Kiểm tra backend và repo (theo thứ tự)**
1. `cd /c/Github/MinhTQ-SDLC/relay && node --test` báo 0 lỗi (chạy cả test notify, admin, store, db; file `fake-db.js` cũng bị nạp như "file test" nhưng không có test nên vô hại).
2. Test của repo: `bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'` in `PASS`.
3. Grep chứng minh không còn sót, không in gì: `grep -rnE "NOTIFY_KEYS|NOTIFY_TOPICS" . --exclude-dir=docs --exclude-dir=.git --exclude-dir=node_modules`.
4. Parse-check bốn file, mỗi file 0 lỗi:
   ```powershell
   foreach ($f in 'hooks\notify.ps1','hooks\notify-ctl.ps1','hooks\channels\relay.ps1','hooks\channels\relay-admin.ps1') {
     $e = $null; [void][Management.Automation.Language.Parser]::ParseFile("C:\Github\MinhTQ-SDLC\$f", [ref]$null, [ref]$e); "$f errors=$($e.Count)"
   }
   ```
5. Encoding: BOM vẫn còn ở `hooks/notify.ps1` (`head -c3 hooks/notify.ps1 | od -An -tx1` in `ef bb bf`); không có byte > 0x7F: `grep -nP '[^\x00-\x7F]' hooks/notify-ctl.ps1 hooks/channels/relay.ps1 hooks/channels/relay-admin.ps1 relay/api/*.js relay/lib/*.js relay/test/*.js` không in gì; không có ký tự điều khiển do đổi escape: `grep -naP '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' relay/api/*.js relay/lib/*.js relay/test/*.js` không in gì; escape vẫn là escape: `grep -c 'u00b7' relay/api/notify.js relay/test/notify.test.js` mỗi file ít nhất 1 và `grep -c 'u0000' relay/lib/util.js` ít nhất 1.
6. `git status --short` chỉ có các đường dẫn dự kiến và không có `node_modules`.

**16b. `mock-admin.js`** — server HTTP Node trên 127.0.0.1, xử lý `POST /api/admin`, ghi `{url, auth, body}` dạng JSON từng dòng vào `LOGFILE`. Biến môi trường: `PORT`, `LOGFILE`, `MODE` (`ok`, `401`, `redirect`, `hang`), `ADMIN_KEY` (khoá mong đợi). Cũng nhận `POST /api/notify` (trả `{"ok":true}`) để kiểm tra đầu-cuối URL suy ra khi `-Apply`.
```js
const http = require('http'), fs = require('fs');
const mode = process.env.MODE || 'ok', log = process.env.LOGFILE, port = +process.env.PORT, adminKey = process.env.ADMIN_KEY;
const reply = (res, code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
http.createServer((req, res) => {
  let raw = ''; req.on('data', (c) => raw += c);
  req.on('end', () => {
    fs.appendFileSync(log, JSON.stringify({ url: req.url, auth: req.headers.authorization, body: raw }) + '\n');
    if (mode === 'hang') return setTimeout(() => res.end('{}'), 20000);
    if (mode === 'redirect') { res.statusCode = 302; res.setHeader('Location', 'http://127.0.0.1:' + port + '/other'); return res.end(); }
    if (req.url === '/api/notify') return reply(res, 200, { ok: true });
    if (mode === '401' || req.headers.authorization !== 'Bearer ' + adminKey) return reply(res, 401, { error: 'unauthorized' });
    let b = {}; try { b = JSON.parse(raw); } catch {}
    switch (b.action) {
      case 'machine-add': return b.name === 'already' ? reply(res, 409, { error: 'name exists' }) : reply(res, 200, { name: b.name, key: 'N'.repeat(43) });
      case 'machine-revoke': return b.name === 'ghost' ? reply(res, 404, { error: 'not found' }) : reply(res, 200, { ok: true });
      case 'machine-list': return reply(res, 200, { machines: [{ name: 'laptop', createdAt: '2026-10-04T00:00:00.000Z', revoked: false }, { name: 'old', createdAt: '2026-10-03T00:00:00.000Z', revoked: true }] });
      case 'topic-add': return reply(res, 200, { ok: true });
      case 'topic-remove': return b.project === 'none' ? reply(res, 404, { error: 'not found' }) : reply(res, 200, { ok: true });
      case 'topic-list': return reply(res, 200, { topics: [{ project: 'projx', threadId: 7 }, { project: '_default', threadId: 5 }] });
      default: return reply(res, 400, { error: 'bad request' });
    }
  });
}).listen(port, '127.0.0.1', () => console.log('ready'));
```

**16c. Chỉnh `run-client-tests.ps1`**
1. Thêm hằng gần đầu file: `$adminPort = 18091`, `$adminKey = 'A' * 40`, `$issuedKey = 'N' * 43`, `$adminLog = Join-Path $fake 'admin.log'`, `$adminPs = "$repo\hooks\channels\relay-admin.ps1"`.
2. Trong `Get-RealState`, danh sách tên thành `'notify.relay.json', 'notify.admin.json', 'notify.snooze.json', 'notify.turns'`.
3. **Sửa ca H cũ** (ca cuối của mục H): lệnh `topics` nay là lệnh hợp lệ nên đổi sang một lệnh đã bị xoá:
   ```powershell
       $r = Invoke-Child @('-File', $ctl, 'telegram-setup')
       Check 'H: removed command prints usage with relay-setup and exits 1' ($r.Code -eq 1 -and $r.Out -match 'relay-setup')
   ```
4. Thêm hàm trợ giúp (mọi thao tác ghi file chạy trong process con với HOME giả):
   ```powershell
   function Set-FakeAdmin([string]$url = "http://127.0.0.1:$adminPort/api/admin") {
       [void](Invoke-Child @('-Command', ". '$adminPs'; Save-AdminConfig ([pscustomobject]@{ url = '$url'; key_enc = (Protect-RelayKey (ConvertTo-SecureString '$adminKey' -AsPlainText -Force)) })"))
   }
   function Clear-FakeAdmin { Remove-Item -LiteralPath "$fake\.claude\notify.admin.json" -ErrorAction SilentlyContinue }
   function Reset-AdminLog { Remove-Item -LiteralPath $adminLog -ErrorAction SilentlyContinue }
   function Get-AdminLines { if (Test-Path -LiteralPath $adminLog) { @(Get-Content -LiteralPath $adminLog -Encoding UTF8) } else { @() } }
   function Get-AdminReqs { Get-AdminLines | ForEach-Object { $_ | ConvertFrom-Json } }
   $script:mockAdmin = $null
   function Start-MockAdmin([string]$mode) {
       Stop-MockAdmin
       $env:MODE = $mode; $env:PORT = "$adminPort"; $env:LOGFILE = $adminLog; $env:ADMIN_KEY = $adminKey
       $script:mockAdmin = Start-Process node -ArgumentList "`"$scratch\mock-admin.js`"" -PassThru -WindowStyle Hidden
       for ($i = 0; $i -lt 50; $i++) { try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $adminPort); $c.Close(); return } catch { Start-Sleep -Milliseconds 100 } }
       throw 'mock admin did not start'
   }
   function Stop-MockAdmin { if ($script:mockAdmin) { try { Stop-Process -Id $script:mockAdmin.Id -Force -ErrorAction SilentlyContinue } catch { }; $script:mockAdmin = $null } }
   ```
   Trong khối `finally` thêm `Stop-MockAdmin` và đưa `Env:ADMIN_KEY` vào danh sách `Remove-Item Env:`.
5. Thêm mục "I. admin commands" trong khối `try`, trước `finally`, dùng `Invoke-Child @('-File', $ctl, ...)`. Với `topic-add` không có project, tạo `New-Item -ItemType Directory "$fake\projx"` rồi `Push-Location "$fake\projx"` (process con kế thừa thư mục hiện tại), và `Pop-Location` sau đó.
   - **I1. Trước admin-setup.** `Clear-FakeAdmin; Clear-FakeRelay; Start-MockAdmin 'ok'; Reset-AdminLog`. Với mỗi lệnh `machines`, `machine-add x`, `machine-revoke x`, `topics`, `topic-add 5`, `topic-remove p`: đầu ra khớp `admin-setup`, mã thoát 1, `(Get-AdminLines).Count -eq 0` (không có request), `notify.relay.json` không tồn tại; đặt tên ca `I1: <lệnh> before admin-setup says so`.
   - **I2. Kiểm tra URL của admin-setup** (phần chạy được mà không cần prompt): `admin-setup -Url notaurl` thoát 1 và in 'URL khong hop le'; `admin-setup -Url http://example.com/api/admin` thoát 1 và nhắc 'https'. Cả hai thất bại trước prompt ẩn nên không bị treo, và file cấu hình vẫn vắng.
   - **I3. Lưu mã hoá.** Gọi `Set-FakeAdmin`. Kiểm tra file tồn tại, chứa `url` và `key_enc`, và **không** chứa `$adminKey`; trong process con, `. relay.ps1; . relay-admin.ps1; Unprotect-RelayKey (Get-AdminConfig).key_enc` in đúng khoá (so với `$adminKey`).
   - **I4. `machines`.** `Reset-AdminLog` rồi `machines`: thoát 0, đầu ra có `laptop`, `old` và `DA THU HOI`; request có `auth -eq "Bearer $adminKey"` và body có `action = 'machine-list'`.
   - **I5. `machine-add` (không `-Apply`).** Body `{action:'machine-add', name:'desk'}`; đầu ra chứa `$issuedKey` **đúng một lần** (`([regex]::Matches($r.Out, [regex]::Escape($issuedKey))).Count -eq 1`); `notify.relay.json` không tồn tại.
   - **I6. `machine-add -Apply`.** Chạy `machine-add desk -Apply`: thoát 0 và đầu ra **không** chứa `$issuedKey`; `notify.relay.json` tồn tại, `url` bằng `http://127.0.0.1:18091/api/notify`, nội dung file không chứa khoá; process con giải mã ra `$issuedKey` (`Unprotect-RelayKey (Get-RelayConfig).key_enc`); đầu-cuối: `Reset-AdminLog; Run-Notify $notif` thì log mock có một request với `url -eq '/api/notify'` và `auth -eq "Bearer $issuedKey"`.
   - **I7. Kiểm tra tên và lỗi.** `machine-add 'Bad Name'`: thoát 1, không có request. `machine-add already -Apply`: thoát 1, đầu ra khớp 'ten da ton tai', và (xoá file relay trước khi chạy) `notify.relay.json` vẫn vắng. `-Apply` với URL admin không suy ra được: `Set-FakeAdmin "http://127.0.0.1:$adminPort/other"`, chạy `machine-add x -Apply` → thoát 1 và **không có request nào** (khoá không bị tạo rồi mất); sau đó khôi phục bằng `Set-FakeAdmin`.
   - **I8. `machine-revoke`.** `machine-revoke desk`: body đúng và đầu ra khớp `30 giay`; `machine-revoke ghost`: thoát 1 và 'khong tim thay'.
   - **I9. `topic-add`.** Trong `projx`: `topic-add 7` gửi `project = 'projx'` và văn bản body khớp `"threadId":7` (số, không phải chuỗi); `topic-add other 9` gửi project `other`, thread 9; `topic-add _default 5` được chấp nhận; `topic-add proj abc`, `topic-add proj 0`, `topic-add proj 2147483648` đều thoát 1 và không có request.
   - **I10. `topic-remove` và `topics`.** `topic-remove` không đối số gửi `project = 'projx'`; `topic-remove none` thoát 1 và 'khong tim thay'; `topics` in `projx` với `7` và `_default` với `5`.
   - **I11. Lỗi phía server.** `Start-MockAdmin '401'`: một lệnh thoát 1 và in 'khoa admin sai', đầu ra không chứa `$adminKey` lẫn `$issuedKey`. `Stop-MockAdmin`: `machines` thoát 1 và 'khong ket noi duoc' (nhanh vì kết nối bị từ chối). `Start-MockAdmin 'redirect'; Reset-AdminLog`: `machines` thoát 1 và log có đúng 1 dòng (redirect **không** được đi theo). Tuỳ chọn: `Start-MockAdmin 'hang'` rồi `machines` trả về trong 8 đến 16 giây với mã thoát 1 (timeout 10 giây).
6. Chạy harness: `powershell -NoProfile -ExecutionPolicy Bypass -File <scratchpad>\run-client-tests.ps1`; kết thúc bằng `ALL CHECKS PASSED`, bao gồm ca SAFETY (các file relay/admin/snooze/turns của `~/.claude` thật không đổi).

**16d. Việc phải làm tay (không pipe được hoặc cần dịch vụ thật)**
- `admin-setup` tương tác: prompt ẩn `Read-Host -AsSecureString`, ràng buộc tối thiểu 32 ký tự, thông báo cuối "Ket noi admin OK"/"khoa admin sai". Harness chỉ kiểm URL và định dạng file lưu; biến môi trường chỉ-để-test trong mã phát hành là không chấp nhận được nên file được ghi sẵn trong test.
- `relay-setup` tương tác với khoá do `machine-add` in ra.
- Cụm Atlas thật: tạo M0, user `readWrite` hạn chế, Network Access `0.0.0.0/0`.
- Deploy Vercel và biến môi trường, rồi: `machine-add`, `relay-setup`, `test`, `topic-add` thật; thu hồi khoá và xác nhận bị từ chối trong vòng 30 giây; thời gian cold start cộng kết nối Mongo so với timeout 10 giây của client.
- Máy thứ hai gia nhập bằng `machine-add` rồi `relay-setup`.
- Cụm Atlas bị tạm dừng cho 503 và chỉ còn toast.

---

### Task 17: commit sau khi verifier PASS và reviewer (added 2026-10-04)

Dùng đường dẫn tường minh, không dùng `git add -A`. Trước mỗi commit chạy `git diff --cached --stat` và xác nhận không có `node_modules`, `.vercel` hay file scratchpad bị stage. Không push trừ khi được yêu cầu. Hai commit:
1. Backend:
   ```
   git add relay/package.json relay/package-lock.json relay/lib/util.js relay/lib/db.js relay/lib/store.js relay/api/notify.js relay/api/admin.js relay/test/fake-db.js relay/test/db.test.js relay/test/store.test.js relay/test/notify.test.js relay/test/admin.test.js
   git commit -m "feat(relay): store machine keys and topic map in MongoDB, add admin endpoint"
   ```
2. Client và tài liệu:
   ```
   git add hooks/channels/relay-admin.ps1 hooks/notify-ctl.ps1 commands/notify.md README.md docs/flow/specs/telegram-relay-design.md
   git commit -m "feat(notify): admin commands for machines and topics, README for Atlas setup"
   ```

---

### Tự rà soát (Task 8 đến 17)

- **Phủ thiết kế:** dữ liệu và chỉ mục (mục 4 của thiết kế → Task 9), backend `notify.js`/`admin.js`/`db.js`/`store.js` (9.5 → Task 9 đến 11), dependency (9.5 → Task 8), client (9.6 → Task 12, 13), `commands/notify.md` (9.6 → Task 14), bảo mật (9.7 → các ca test ở Task 9 đến 11 và 16), kiểm thử (9.8 → Task 9 đến 11 và 16), danh sách xoá/thay và README (9.9 → Task 10, 15), rủi ro (9.10 → đầu mục này và Task 15 bước 2). Cache 30 giây, fail closed 503, `_default`, DB user `readWrite` một database, giữ tên `relay/` đều có task tương ứng.
- **Nhất quán tên:** `findMachineByKeyHash`, `findTopic`, `addMachine`, `revokeMachine`, `listMachines`, `setTopic`, `removeTopic`, `listTopics`, `_setDb`, `_setClock`, `_resetCache`, `_cacheSizes`, `Get-AdminConfig`, `Save-AdminConfig`, `Invoke-RelayAdmin`, `$script:AdminFile`, tham số `-Apply`, biến `NOTIFY_ADMIN_KEY`, `MONGODB_URI`, `MONGODB_DB` dùng giống nhau ở mọi task; các action admin (`machine-add`, `machine-revoke`, `machine-list`, `topic-add`, `topic-remove`, `topic-list`) khớp giữa `admin.js`, `notify-ctl.ps1`, mock và README.
- **Không có bước nào để ngỏ giá trị chưa quyết định;** các điểm chốt khi lập kế hoạch được liệt kê ở đầu tài liệu và đã được gộp vào thiết kế.
