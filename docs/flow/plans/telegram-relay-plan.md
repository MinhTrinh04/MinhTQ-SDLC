# Telegram Relay — kế hoạch triển khai

> Thiết kế đã duyệt: `docs/flow/specs/telegram-relay-design.md`. Quyết định đã chốt: backend ở `relay/` trong repo này; rate limit trong bộ nhớ (best-effort); khoá client cất local, mã hoá DPAPI, ngoài repo (`relay-setup`).
> Người thực thi cần có shell (chạy `node --test`, `git`, `grep`, PowerShell). Thứ tự: Task 1 → 2 → 3 và 4 → 5 → 6 → 7. Task 1 và Task 2 độc lập nhau; Task 7 cần xong hết.

**Quy ước xuyên suốt (các lỗi đã gặp trong repo này, phải tránh):**
- File PowerShell có tiếng Việt (`hooks/notify.ps1`) phải giữ **UTF-8 có BOM**. Sửa bằng công cụ Edit (giữ nguyên byte); không ghi lại file qua Python string literal hay `Set-Content`. Kiểm tra 3 byte đầu trước và sau khi sửa: `239,187,191`.
- `hooks/notify-ctl.ps1` và `hooks/channels/relay.ps1` chỉ chứa ASCII (tiếng Việt không dấu, comment tiếng Anh) nên không cần BOM.
- Không soạn đường dẫn có `\n`, `\t`... qua Python string literal (`\n` biến thành xuống dòng). Dùng Edit/Write.
- Trong PowerShell 5.1, `$HOME` cố định lúc process khởi động, không đổi theo `$env:HOME` trong cùng process. Mọi test client chạy trong **process con** đã được set `USERPROFILE`/`HOME` từ trước, và tuyệt đối không ghi vào `~/.claude` thật.
- Test chung của repo (`CLAUDE.md`) grep `TBD|todo:|fill in|placeholder` trong `commands/*.md`, `skills/*/SKILL.md`, `agents/*.md`; chữ mới trong `commands/notify.md` không được chứa các cụm này.

---

## Task 1: Backend `relay/`

**Files**
- Create `relay/package.json`
- Create `relay/test/notify.test.js`
- Create `relay/api/notify.js`

**Interfaces**
- Produces: `module.exports = handler` với `handler(req, res)` là Vercel Node function (CommonJS, không dependency); thêm `module.exports._resetRateLimit()` chỉ dùng cho test.
- Đọc `req.method`, `req.headers.authorization`, `req.body` (có thể là object đã parse, chuỗi, hoặc `undefined`; nếu `undefined` thì đọc stream với giới hạn 4096 byte; nếu `req` không phải stream thì coi là body rỗng → 400). Ghi bằng `res.statusCode`, `res.setHeader`, `res.end(JSON)`.
- Đọc biến môi trường **mỗi lần gọi** (không đọc lúc nạp module) để test đổi được `process.env`.
- Consumes `fetch` toàn cục (test mock bằng `global.fetch`).
- **Thứ tự kiểm tra cố định** (test dựa vào): 405 → 500 (cấu hình) → 401 → 429 → 400 (validate) → gọi Telegram. 429 chỉ đếm request đã xác thực.

**Steps**
1. Tạo `relay/package.json`:
   ```json
   {
     "name": "claude-notify-relay",
     "private": true,
     "engines": { "node": ">=18" },
     "scripts": { "test": "node --test" }
   }
   ```
   Không có `"type"` (giữ CommonJS), không có `vercel.json` (route `/api/notify` suy ra từ `api/notify.js` khi Root Directory = `relay`).
2. Viết test **trước**, `relay/test/notify.test.js`. Phần khung:
   ```js
   const test = require('node:test');
   const assert = require('node:assert/strict');
   const handler = require('../api/notify.js');

   const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(40);
   const BOT = '123456:SECRET-BOT-TOKEN';

   function setEnv(over = {}) {
     process.env.TELEGRAM_BOT_TOKEN = BOT;
     process.env.TELEGRAM_CHAT_ID = '-100123';
     process.env.NOTIFY_KEYS = JSON.stringify({ laptop: KEY_A, desk: KEY_B });
     process.env.NOTIFY_TOPICS = JSON.stringify({ projA: 11, _default: 99 });
     for (const [k, v] of Object.entries(over)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
     handler._resetRateLimit();
   }
   function mockRes() {
     const r = { statusCode: 0, headers: {}, body: '' };
     r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
     r.end = (b) => { r.body = b || ''; };
     return r;
   }
   async function call({ method = 'POST', key = KEY_A, body = { project: 'projA', text: 'hi' }, headers = {} } = {}) {
     const req = { method, headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), 'content-type': 'application/json', ...headers }, body };
     const res = mockRes();
     await handler(req, res);
     return res;
   }
   let calls;
   function mockFetch(...responses) { // mỗi phần tử: { status, json }
     calls = [];
     global.fetch = async (url, opts) => {
       calls.push({ url, body: JSON.parse(opts.body), signal: opts.signal });
       const r = responses.shift() || { status: 200, json: { ok: true } };
       return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
     };
   }
   ```
   Các test (mỗi `test(...)` bắt đầu bằng `setEnv(); mockFetch();`), tương ứng từng mục của thiết kế mục 6:
   - GET → 405 và header `allow` = `POST`.
   - Thiếu khoá và sai khoá → 401; `calls.length === 0`.
   - Thứ tự khoá không ảnh hưởng: dựng `NOTIFY_KEYS` là `{desk, laptop}` rồi `{laptop, desk}`; cả hai khoá đều xác thực được ở cả hai thứ tự; text gửi đi kết thúc bằng ` · desk` / ` · laptop` tương ứng.
   - Khoá ngắn hơn 32 ký tự trong `NOTIFY_KEYS` bị bỏ qua: thêm `short: 'abc'`, gửi khoá `abc` → 401.
   - 400: body `undefined`; body chuỗi `'not json'`; body `[]`; `text` 501 ký tự; `project` 101 ký tự; `text` rỗng; `text` chỉ có ký tự điều khiển (`'\u0007\u0000'`); `text` không phải chuỗi; body vượt 4 KB (`text: 'x'.repeat(5000)`, và `{project, text, junk: 'x'.repeat(5000)}`).
   - Ký tự điều khiển bị loại nhưng `\n` được giữ: gửi `'a\u0007b\nc'` → text trong body gửi Telegram bắt đầu bằng `'ab\nc'`.
   - 200 gửi đúng topic: `calls[0].body.message_thread_id === 11` với `projA`; URL là `https://api.telegram.org/bot${BOT}/sendMessage`; `chat_id` là `-100123`; **không có** khoá `parse_mode`.
   - Project lạ dùng `_default` (99); nếu không có `_default` thì body **không có** khoá `message_thread_id`.
   - Tên đặc biệt `'constructor'` và `'__proto__'` không nhận được thread (handler dùng `Object.prototype.hasOwnProperty`).
   - Topic cũ: `mockFetch({status:400,json:{ok:false,description:'Bad Request: message thread not found'}}, {status:200,json:{ok:true}})` → 200, `calls.length === 2`, body lần hai không có `message_thread_id`.
   - Lỗi Telegram khác (400 'chat not found', 500, `fetch` ném lỗi/AbortError) → 502, **không** thử lại với các lỗi không phải "thread not found"; body response là `{error:'upstream error'}`.
   - Rate limit: 30 request → 200, request thứ 31 → 429 kèm header `retry-after`; máy khác (`KEY_B`) không bị ảnh hưởng; sau `_resetRateLimit()` dùng lại được.
   - Bot token không bao giờ xuất hiện trong response (body lẫn header) ở các mã 200/400/401/405/429/500/502: gom mọi `res`, assert `!JSON.stringify(res).includes(BOT)`; kể cả khi mock Telegram trả `description` chứa token thì token cũng không được chuyển tiếp.
   - Thiếu env (lần lượt `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NOTIFY_KEYS` đặt `null`) → 500 `{error:'not configured'}`; `NOTIFY_KEYS` sai JSON cũng 500; body giống hệt nhau ở mọi trường hợp (không nói thiếu biến nào).
   - Timeout: assert `calls[0].signal` là `AbortSignal` (không chờ 8 giây thật).
3. Chạy `node --test` trong `relay/`, xác nhận **FAIL** (chưa có `api/notify.js`).
4. Tạo `relay/api/notify.js`:
   ```js
   'use strict';
   const crypto = require('node:crypto');

   const MAX_BODY = 4096, MAX_PROJECT = 100, MAX_TEXT = 500;
   const WINDOW_MS = 60000, MAX_REQ = 30, TG_TIMEOUT_MS = 8000;
   const hits = new Map(); // tên máy -> mảng timestamp (best-effort, riêng từng instance)

   function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

   function send(res, code, obj, headers = {}) {
     res.statusCode = code;
     res.setHeader('Content-Type', 'application/json');
     for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
     res.end(JSON.stringify(obj));
   }

   function loadConfig() { // null khi thiếu/sai bất kỳ thứ gì bắt buộc
     try {
       const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
       if (!token || !chat) return null;
       const keys = JSON.parse(process.env.NOTIFY_KEYS || '');
       const entries = Object.entries(keys).filter(([, k]) => typeof k === 'string' && k.length >= 32);
       if (!entries.length) return null;
       const topics = process.env.NOTIFY_TOPICS ? JSON.parse(process.env.NOTIFY_TOPICS) : {};
       if (!topics || typeof topics !== 'object' || Array.isArray(topics)) return null;
       return { token, chat, entries, topics };
     } catch { return null; }
   }

   function authenticate(header, entries) { // không thoát sớm: duyệt hết mọi khoá
     const m = /^Bearer (.+)$/.exec(header || '');
     const given = sha(m ? m[1] : '');
     let machine = null;
     for (const [name, key] of entries) {
       if (crypto.timingSafeEqual(given, sha(key)) && m) machine = machine || name;
     }
     return machine;
   }

   function clean(s) { return s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim(); }

   async function readBody(req) {
     if (req.body !== undefined && req.body !== null) {
       return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
     }
     if (typeof req[Symbol.asyncIterator] !== 'function') return ''; // không có stream: coi như body rỗng
     const chunks = []; let n = 0;
     for await (const c of req) { n += c.length; if (n > MAX_BODY) return null; chunks.push(c); }
     return Buffer.concat(chunks).toString('utf8');
   }

   function rateLimited(machine) { // trả về số giây phải chờ, 0 nếu được phép
     const now = Date.now();
     const arr = (hits.get(machine) || []).filter((t) => now - t < WINDOW_MS);
     if (arr.length >= MAX_REQ) { hits.set(machine, arr); return Math.ceil((WINDOW_MS - (now - arr[0])) / 1000); }
     arr.push(now); hits.set(machine, arr); return 0;
   }

   async function tg(cfg, body) {
     const ctl = new AbortController();
     const timer = setTimeout(() => ctl.abort(), TG_TIMEOUT_MS);
     try {
       const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
         method: 'POST', headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify(body), signal: ctl.signal });
       let j = null; try { j = await r.json(); } catch {}
       return { ok: r.ok, status: r.status, description: j && j.description ? String(j.description) : '' };
     } catch { return { ok: false, status: 0, description: '' }; }
     finally { clearTimeout(timer); }
   }

   async function handler(req, res) {
     if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
     const cfg = loadConfig();
     if (!cfg) return send(res, 500, { error: 'not configured' });
     const machine = authenticate(req.headers && req.headers.authorization, cfg.entries);
     if (!machine) return send(res, 401, { error: 'unauthorized' });
     const wait = rateLimited(machine);
     if (wait) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': String(wait) });

     const raw = await readBody(req);
     if (raw === null || Buffer.byteLength(raw) > MAX_BODY) return send(res, 400, { error: 'bad request' });
     let b; try { b = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad request' }); }
     if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.project !== 'string' || typeof b.text !== 'string')
       return send(res, 400, { error: 'bad request' });
     const project = clean(b.project), text = clean(b.text);
     if (!project || project.length > MAX_PROJECT || !text || text.length > MAX_TEXT)
       return send(res, 400, { error: 'bad request' });

     const has = (k) => Object.prototype.hasOwnProperty.call(cfg.topics, k);
     const valid = (v) => Number.isInteger(v) && v > 0;
     const thread = has(project) && valid(cfg.topics[project]) ? cfg.topics[project]
       : (has('_default') && valid(cfg.topics._default) ? cfg.topics._default : null);
     const body = { chat_id: cfg.chat, text: `${text} \u00b7 ${machine}` }; // không dùng parse_mode: văn bản thuần
     if (thread !== null) body.message_thread_id = thread;

     let r = await tg(cfg, body);
     if (!r.ok && r.status === 400 && thread !== null && /thread not found/i.test(r.description)) {
       delete body.message_thread_id; r = await tg(cfg, body); // topic đã xoá/đóng: gửi vào General một lần
     }
     console.log(`notify machine=${machine} project=${project} status=${r.ok ? 200 : 502}`); // không log text/token/khoá
     return r.ok ? send(res, 200, { ok: true }) : send(res, 502, { error: 'upstream error' });
   }

   module.exports = handler;
   module.exports._resetRateLimit = () => hits.clear();
   ```
   Ký tự `·` được viết bằng escape `\u00b7` để file JS chỉ chứa ASCII.
5. Chạy `node --test` trong `relay/`; kỳ vọng mọi test pass, 0 fail. Sửa code hoặc test cho đến khi xanh.
6. Chạy `grep -n "console.log" relay/api/notify.js`; chỉ được có đúng một dòng log và nó chỉ chứa tên máy, project, mã trạng thái.

---

## Task 2: Kênh client `hooks/channels/relay.ps1` (mới, chỉ ASCII, không BOM)

**Files**
- Create `hooks/channels/relay.ps1`

**Interfaces (produces; dùng bởi `notify.ps1` và `notify-ctl.ps1`)**
- `$script:RelayFile` = `Join-Path (Join-Path $HOME '.claude') 'notify.relay.json'`.
- `Get-RelayConfig` → pscustomobject có `.url` và `.key_enc`, hoặc `$null` (thiếu file, JSON hỏng, thiếu trường). Không bao giờ ném lỗi.
- `Save-RelayConfig($cfg)` → ghi UTF-8 không BOM.
- `Protect-RelayKey([securestring]$Secure)` → chuỗi DPAPI; `Unprotect-RelayKey([string]$Encrypted)` → khoá dạng chữ.
- `Send-Relay -Text <string> -Project <string>` → `$true`/`$false`; không bao giờ ném lỗi; im lặng khi chưa cấu hình.
- Không phụ thuộc kênh khác. Không có biến override cho test (URL lấy từ file cấu hình nên test chỉ cần trỏ file đó vào mock cục bộ).

**Steps**
1. Tạo `hooks/channels/relay.ps1` với nội dung:
   ```powershell
   # Channel: relay (phone notifications). Dot-sourced by notify.ps1 and notify-ctl.ps1.
   # The bot token lives only on the Vercel relay (see relay/). This machine keeps just a per-machine relay key,
   # DPAPI-encrypted (readable only by this Windows user on this machine), in ~/.claude/notify.relay.json:
   #   { "url": "https://<app>.vercel.app/api/notify", "key_enc": "<DPAPI string>" }
   # Create it with: notify-ctl.cmd relay-setup
   [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

   $script:RelayFile = Join-Path (Join-Path $HOME '.claude') 'notify.relay.json'

   function Get-RelayConfig {
       try {
           if (-not (Test-Path -LiteralPath $script:RelayFile)) { return $null }
           $cfg = Get-Content -LiteralPath $script:RelayFile -Raw -Encoding UTF8 | ConvertFrom-Json
           if (-not $cfg.url -or -not $cfg.key_enc) { return $null }
           return $cfg
       } catch { return $null }
   }

   function Save-RelayConfig($cfg) {
       $json = $cfg | ConvertTo-Json -Depth 5
       [IO.File]::WriteAllText($script:RelayFile, $json, (New-Object Text.UTF8Encoding($false)))
   }

   function Protect-RelayKey([securestring]$Secure) { return ($Secure | ConvertFrom-SecureString) }

   function Unprotect-RelayKey([string]$Encrypted) {
       $secure = $Encrypted | ConvertTo-SecureString
       $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
       try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
       finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
   }

   # POSTs {project,text} to the relay. Returns $true on success. Never throws; silent when not configured.
   function Send-Relay {
       param([string]$Text, [string]$Project)
       try {
           $cfg = Get-RelayConfig
           if (-not $cfg) { return $false }
           $key = Unprotect-RelayKey $cfg.key_enc
           $bytes = [Text.Encoding]::UTF8.GetBytes((@{ project = $Project; text = $Text } | ConvertTo-Json -Compress))
           [void](Invoke-RestMethod -Uri $cfg.url -Method Post -Headers @{ Authorization = "Bearer $key" } `
               -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 10)
           return $true
       } catch { return $false }
   }
   ```
2. Xác nhận file thuần ASCII: `Grep` mẫu `[^\x00-\x7F]` trên file, kỳ vọng 0 kết quả.
3. Parse-check: `powershell -NoProfile -Command "$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('C:\Github\MinhTQ-SDLC\hooks\channels\relay.ps1',[ref]$null,[ref]$e); $e.Count"` → `0`.
4. `$Project` rỗng thì relay trả 400 (chấp nhận được, relay là nơi validate); `notify.ps1` luôn lấy `$project` từ tên thư mục của `cwd`.

---

## Task 3: `hooks/notify.ps1` chuyển sang `Send-Relay`

**Files**
- Modify `hooks/notify.ps1` (giữ nguyên encoding và BOM; chỉ dùng Edit)

**Interfaces**
- Consumes `Send-Relay -Text -Project` từ `channels/relay.ps1`. Tên kênh trong `Test-ChannelOn 'telegram' 60`, trong `notify.config.json` và trong snooze **vẫn là `telegram`**.

**Steps**
1. Ghi lại 3 byte đầu của file (kỳ vọng `239,187,191`).
2. Edit comment "Toast shows detail; Telegram stays deliberately generic ..." đổi `Telegram stays deliberately generic` thành `the phone message (relay) stays deliberately generic`.
3. Edit khối cuối:
   ```powershell
   if (Test-ChannelOn 'telegram' 60) {
       . (Join-Path $PSScriptRoot 'channels\telegram.ps1')
       [void](Send-Telegram -Text $tgText -Project $project)
   }
   ```
   thành:
   ```powershell
   if (Test-ChannelOn 'telegram' 60) {
       . (Join-Path $PSScriptRoot 'channels\relay.ps1')
       [void](Send-Relay -Text $tgText -Project $project)
   }
   ```
   Giữ nguyên tên biến `$tgText` (vô hại, và không nằm trong mẫu grep của Task 5).
4. Kiểm tra lại 3 byte đầu vẫn là `239,187,191` và parse-check file (0 lỗi).

---

## Task 4: `hooks/notify-ctl.ps1` (thêm `relay-setup`, sửa `status`/`test`, xoá mọi lệnh Telegram/topic)

**Files**
- Modify `hooks/notify-ctl.ps1` (giữ chỉ ASCII)

**Interfaces**
- Consumes từ `relay.ps1`: `Get-RelayConfig`, `Save-RelayConfig`, `Protect-RelayKey`, `Send-Relay`, `$script:RelayFile`.
- Tham số mới `-Url`; tham số `-ChatId` bị bỏ. Lệnh mới `relay-setup [-Url <url>]`.

**Steps** (sửa theo nội dung neo, không theo số dòng; dùng Edit)
1. Comment đầu file: đổi dòng `status` thành `#   notify-ctl.cmd status                                       show snooze + relay state`; xoá 5 dòng comment `telegram-setup`/`topics`/`topic-detect`/`topic-add`/`topic-remove`; thêm:
   ```
   #   notify-ctl.cmd relay-setup [-Url <url>]                     one-time per machine: save the relay URL + this machine's key (key is asked, never echoed)
   ```
2. Khối `param(...)`: thay `[string]$Arg2,` + `[string]$ChatId` bằng `[string]$Arg2,` + `[string]$Url`.
3. Dòng dot-source: `channels\telegram.ps1` → `channels\relay.ps1`.
4. Trong `Show-Status`, thay khối `$tg = Get-TgConfig ... else { Write-Host 'Telegram: chua ket noi ...' }` bằng:
   ```powershell
       $rc = Get-RelayConfig
       if ($rc) {
           Write-Host "Telegram (qua relay): da cau hinh ($(([Uri]$rc.url).Host))"
       } else { Write-Host 'Telegram (qua relay): chua cau hinh - chay: notify-ctl.cmd relay-setup' }
   ```
5. Trong nhánh `'test'`, thay khối `if (Get-TgConfig) { ... } else { Write-Host 'telegram: chua ket noi' }` bằng:
   ```powershell
           if (Get-RelayConfig) {
               if (Send-Relay -Text "Thong bao thu tu $project" -Project $project) { Write-Host 'telegram: da gui (qua relay)' } else { Write-Host 'telegram: GUI LOI (kiem tra mang/URL relay/khoa; chay lai relay-setup neu doi khoa)' }
           } else { Write-Host 'telegram: chua cau hinh relay' }
   ```
6. Xoá toàn bộ các nhánh `'telegram-setup'`, `'topics'`, `'topic-add'`, `'topic-remove'`, `'topic-detect'` và thay bằng nhánh mới:
   ```powershell
       'relay-setup' {
           if (-not $Url) { $Url = Read-Host 'Dan URL relay (vd https://<app>.vercel.app/api/notify)' }
           $Url = $Url.Trim()
           $uri = $null
           if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin 'https', 'http') { Write-Host 'URL khong hop le.'; exit 1 }
           if ($uri.Scheme -ne 'https' -and $uri.Host -notin '127.0.0.1', 'localhost') { Write-Host 'URL phai la https (http chi cho phep voi localhost).'; exit 1 }
           $secure = Read-Host 'Dan khoa cua may nay (NOTIFY_KEYS tren Vercel; se khong hien tren man hinh)' -AsSecureString
           if ($secure.Length -lt 32) { Write-Host 'Khoa phai tu 32 ky tu tro len.'; exit 1 }
           Save-RelayConfig ([pscustomobject]@{ url = $Url; key_enc = (Protect-RelayKey $secure) })
           Write-Host "Da luu cau hinh vao $script:RelayFile (khoa ma hoa theo tai khoan Windows, KHONG nam trong repo)."
           $old = Join-Path $stateDir 'notify.telegram.json'
           if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force; Write-Host 'Da xoa notify.telegram.json cu (bot token khong con dung o may nay).' }
           $project = Split-Path (Get-Location).Path -Leaf
           if (Send-Relay -Text 'Da ket noi Claude Code notify.' -Project $project) { Write-Host 'Da gui tin thu qua relay.' } else { Write-Warning 'Gui tin thu that bai - kiem tra URL, khoa, va relay da deploy chua.' }
       }
   ```
7. Nhánh `default`: đổi chuỗi usage thành `Dung: snooze | on | status | test | relay-setup`.
8. Nhánh `snooze`, `on`, `status` giữ nguyên (kênh vẫn tên `telegram`).
9. Xác nhận file vẫn thuần ASCII và parse-check 0 lỗi.

---

## Task 5: Xoá code thừa và chứng minh không còn sót

**Files**
- Delete `hooks/channels/telegram.ps1` (gồm `Get-TgApiBase`, `Get-TgConfig`, `Save-TgConfig`, `Get-TgTopics`, `Save-TgTopics`, `Protect-TgToken`, `Unprotect-TgToken`, `Invoke-Tg`, `Send-Telegram`, `$script:TgFile`, `$script:TopicsFile` và hai biến override `CLAUDE_TG_API`, `CLAUDE_NOTIFY_TOPICS_FILE`)
- Delete `hooks/notify.topics.json`
- Các phần xoá trong file khác nằm ở Task 3, 4, 6.

**Steps**
1. Chỉ xoá **sau khi** Task 3 và Task 4 xong (nếu không script đang chạy sẽ hỏng): `git rm hooks/channels/telegram.ps1 hooks/notify.topics.json`.
2. Chứng minh không sót (chạy ở thư mục gốc repo, loại `docs/` vì spec/plan cũ hợp lệ khi nhắc tới chúng):
   ```
   grep -rnE "Send-Telegram|Get-TgConfig|Get-TgTopics|TgFile|TopicsFile|CLAUDE_TG_API|CLAUDE_NOTIFY_TOPICS_FILE|telegram-setup|topic-detect|topic-add|topic-remove|notify\.topics" . --exclude-dir=docs --exclude-dir=.git --exclude-dir=node_modules && echo LEFTOVER && exit 1 || echo CLEAN
   ```
   Kỳ vọng `CLEAN`.
3. Grep bổ sung, cũng phải không có kết quả: `grep -rnE "Tg[A-Z]|Invoke-Tg|Save-Tg|-ChatId|channels.telegram\.ps1" . --exclude-dir=docs --exclude-dir=.git --exclude-dir=node_modules`. Từ `telegram` thuần (tên kênh trong config/snooze/usage) và chuỗi `notify.telegram.json` (file cũ do `relay-setup` xoá) được phép xuất hiện; hai grep trên không bắt chúng.
4. Xác nhận `hooks/` chỉ còn: `claude-logo.png`, `notify.config.json`, `notify.ps1`, `notify-ctl.ps1`, `channels/toast.ps1`, `channels/relay.ps1`.

---

## Task 6: `commands/notify.md`, README, `.gitignore`

**Files**
- Modify `commands/notify.md`
- Modify `README.md`
- Modify `.gitignore`

### 6a. `commands/notify.md`
1. Dòng `description` frontmatter: `(toast + Telegram)` → `(toast + phone via relay)`.
2. Dòng mô tả `status` → ``- `status` — show whether a snooze is active and whether the relay (phone notifications) is configured.``
3. Quy tắc cấm `telegram-setup` → thay bằng:
   ``- `relay-setup` is NOT available through this command: it asks for a secret per-machine relay key interactively. If the user asks for it, tell them to run `& "$HOME\.claude\notify-ctl.cmd" relay-setup` themselves in a terminal. Never ask for, read, or echo a relay key (or any bot token) in this session.``
4. Quy tắc "bốn dạng đối số" giữ nguyên.

### 6b. `README.md` (tìm bằng nội dung neo, không theo số dòng)
1. Thay toàn bộ mục từ heading `#### Thông báo Telegram (group có Topics, mỗi project một topic)` đến hết dòng "`<project>` là **tên thư mục** ... Lệnh đầy đủ: ..." bằng mục sau (giữ nguyên bảng sự kiện và câu "Tin cố ý chung chung" như cũ, chỉ đổi phần còn lại):

   ````markdown
   #### Thông báo điện thoại qua Relay (Telegram)

   Bot token chỉ nằm **một chỗ**: biến môi trường của relay trên Vercel. Mỗi máy chỉ gửi `{project, text}` kèm **khoá riêng của máy** tới `relay/api/notify.js`; relay kiểm tra khoá, giới hạn tần suất rồi gọi Telegram. Chưa deploy relay hoặc Vercel gặp sự cố thì chỉ còn toast trên máy.

   | Sự kiện | Nội dung tin |
   | --- | --- |
   | Claude hỏi bạn chọn phương án (`AskUserQuestion`) | `Claude cần bạn đưa ra quyết định ở <project>` |
   | Claude xin quyền / chờ lâu (`Notification`) | `Claude đang chờ bạn ở <project>` |
   | Claude làm xong (`Stop`) | `Claude đã xong ở <project> (x phút y giây)` — **chỉ gửi nếu lượt chạy ≥ 60 giây** |

   Tin cố ý chung chung: không gửi code, đường dẫn hay nội dung câu hỏi ra ngoài máy. Cuối tin có ` · <tên máy>` để biết tin đến từ máy nào.

   **1. Deploy relay lên Vercel (một lần):**

   1. Trên Telegram: `@BotFather` → `/newbot` lấy token. Tạo supergroup, bật *Topics*, **tự tạo** một topic cho mỗi project, thêm bot làm **admin**.
   2. Vercel: Import repo này, đặt **Root Directory = `relay`**, không cần build command (Framework: Other).
   3. Project Settings → Environment Variables (Production), rồi Redeploy:

      | Biến | Giá trị |
      | --- | --- |
      | `TELEGRAM_BOT_TOKEN` | token của bot |
      | `TELEGRAM_CHAT_ID` | id supergroup, dạng `-100xxxxxxxxxx` |
      | `NOTIFY_KEYS` | JSON `{"laptop":"<khoá ≥ 32 ký tự>","desk":"<khoá khác>"}` — mỗi máy một khoá, tên máy được nối vào cuối tin |
      | `NOTIFY_TOPICS` | JSON `{"<tên thư mục project>":<message_thread_id>,"_default":<id>}` — `_default` tuỳ chọn |

   4. Sinh khoá ngẫu nhiên (PowerShell 5.1, ra 44 ký tự):
      ```powershell
      $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
      ```
   5. Lấy `message_thread_id` từ link topic `https://t.me/c/<chat>/<thread>` (chuột phải topic → Copy Topic Link; hoặc link của một tin bên trong topic `t.me/c/<chat>/<thread>/<message>`). Số đầu sau `/c/` là chat (`TELEGRAM_CHAT_ID` = `-100` + số đó), số thứ hai là `message_thread_id`. Ví dụ `t.me/c/1234567890/5` → chat `-1001234567890`, thread `5`. Topic General không có thread: bỏ qua.

   Project không có trong `NOTIFY_TOPICS` thì tin vào `_default`, nếu không có `_default` thì vào General. Topic đã bị xoá/đóng thì tin tự gửi lại vào General một lần, không mất. Đổi bản đồ hoặc khoá = sửa biến môi trường trên Vercel rồi redeploy. Giới hạn của relay: chỉ nhận POST, body ≤ 4 KB, `text` ≤ 500, `project` ≤ 100, 30 request/phút/máy (best-effort, giữ trong bộ nhớ). Gói Vercel miễn phí dành cho mục đích phi thương mại; dùng cho công việc công ty cần xem lại điều khoản.

   **2. Cài mỗi máy (một lần):**

   ```powershell
   & "$HOME\.claude\notify-ctl.cmd" relay-setup
   ```

   Script hỏi URL relay (`https://<app>.vercel.app/api/notify`; thêm `-Url <url>` để bỏ qua câu hỏi) và khoá của máy này (không hiện trên màn hình), lưu vào `~/.claude/notify.relay.json` — khoá được **mã hoá DPAPI theo tài khoản Windows**, nằm **ngoài repo**, không bao giờ commit — rồi gửi một tin thử. File `~/.claude/notify.telegram.json` của bản cũ (nếu có) được xoá tự động.

   Mất máy: xoá/đổi khoá của máy đó trong `NOTIFY_KEYS` rồi redeploy; các máy khác không bị ảnh hưởng. Test relay cục bộ: `cd relay; node --test` (cần Node ≥ 18, không cần mạng). `<project>` là **tên thư mục** của project.

   **Bật/tắt tạm thời** (gõ trong Claude Code hoặc terminal):

   | Muốn | Lệnh trong Claude Code | Lệnh terminal |
   | --- | --- | --- |
   | Tắt tất cả 30 phút / 1 / 4 / 8 giờ | `/notify snooze 30m` (`1h`, `4h`, `8h`) | `& "$HOME\.claude\notify-ctl.cmd" snooze 1h` |
   | Chỉ tắt kênh điện thoại/Telegram (toast vẫn hiện) | `/notify snooze 4h telegram` | `... snooze 4h telegram` |
   | Chỉ tắt toast | `/notify snooze 1h toast` | `... snooze 1h toast` |
   | Bật lại ngay | `/notify on` | `... on` |
   | Xem trạng thái / gửi thử | `/notify status` / `/notify test` | `... status` / `... test` |
   ````
   (Bảng snooze thay thế luôn bảng snooze cũ trong README để không bị trùng; khi sửa phải xoá bảng cũ.)
2. Dòng "Tinh chỉnh lâu dài ... `hooks/notify.config.json`" giữ nguyên.
3. Dòng mô tả cấu trúc file (đoạn nhắc `hooks/channels/`, `hooks/notify.topics.json`): đổi thành `hooks/channels/` chứa `toast.ps1` và `relay.ps1`; bỏ hẳn mệnh đề `hooks/notify.topics.json`; thêm `relay/` — Vercel serverless relay (`api/notify.js`, `test/notify.test.js`).
4. README **không** được chứa các tên lệnh đã xoá (`telegram-setup`, `topic-add`, `topic-detect`, `topic-remove`), `-ChatId`, hay `notify.topics`, vì grep ở Task 5 không loại README.

### 6c. `.gitignore`
Thêm hai dòng (file hiện chỉ có `.claude/worktrees/`): `.vercel/` và `relay/node_modules/`.

---

## Task 7: Kiểm chứng và commit

**7a. Backend:** trong `relay/` chạy `node --test`; kỳ vọng mọi test pass, 0 fail.

**7b. Test của repo** (từ thư mục gốc):
```
bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'
```
Kỳ vọng `PASS`. Chạy lại hai grep của Task 5; kỳ vọng `CLEAN` và không có kết quả.

**7c. Client với relay giả trong HOME giả.** Tất cả file test nằm trong thư mục scratchpad của session, **không đưa vào repo**.
- `mock-relay.js` (Node, nghe `127.0.0.1:<port>`; biến `MODE` = `ok` / `500` / `hang`, `LOGFILE`, `PORT`):
  ```js
  const http = require('http'), fs = require('fs');
  const mode = process.env.MODE || 'ok', log = process.env.LOGFILE, port = +process.env.PORT;
  http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => b += c);
    req.on('end', () => {
      fs.appendFileSync(log, JSON.stringify({ auth: req.headers.authorization, body: b }) + '\n');
      if (mode === 'hang') return setTimeout(() => res.end('{}'), 20000);
      res.statusCode = mode === '500' ? 500 : 200; res.end('{"ok":true}');
    });
  }).listen(port, '127.0.0.1', () => console.log('ready'));
  ```
- `run-client-tests.ps1` (lưu UTF-8 có BOM vì có chuỗi tiếng Việt; tạo bằng công cụ Write): dùng biến `$fake = <scratchpad>\fakehome` (không dùng `$HOME` cho đường dẫn của chính nó), có chốt an toàn abort nếu `$fake` không nằm dưới thư mục scratchpad. Các hàm trợ giúp: `Invoke-Child` (đặt `USERPROFILE`/`HOME` = `$fake`, chạy `powershell -NoProfile -ExecutionPolicy Bypass -File ...` với payload qua stdin, lấy `$LASTEXITCODE`, khôi phục biến môi trường trong `finally`); `Set-FakeRelay($url)` (process con dot-source `relay.ps1` rồi `Save-RelayConfig` với khoá thử ≥ 32 ký tự); `Set-FakeSnooze($channels)`; `Start-Mock`/`Stop-Mock` (chờ cổng mở).
- Các ca và khẳng định (mỗi ca xoá log trước; các ca không quan tâm toast thì snooze `toast` để khỏi bật popup):
  - **A.** Có cấu hình, mode `ok`, sự kiện Notification: thoát 0; log có đúng 1 dòng; `auth` = `Bearer <khoá thử>`; body có `project = proj` và `text = "Claude đang chờ bạn ở proj"` (đọc log bằng UTF-8); `notify.relay.json` **không chứa** khoá dạng chữ.
  - **B.** Chưa cấu hình: thoát 0, không có dòng log, không có thông báo lỗi.
  - **C.** Mode `500`: thoát 0, có 1 dòng log (đã thử gọi), không có chữ lỗi ra stdout/stderr.
  - **D.** Mode `hang`: thoát 0, tổng thời gian khoảng 10 đến 13 giây (dưới 15) chứng minh timeout 10 giây.
  - **E.** Snooze `telegram`: không có dòng log; snooze `all`: không có dòng log; snooze `toast` riêng: có 1 dòng log.
  - **F.** `Stop` lượt 5 giây: không log; lượt 120 giây (ghi `notify.turns\s1.txt` lùi 120 giây): 1 dòng log, text chứa `2 phút`; `Stop` không có file lượt: 1 dòng log.
  - **G.** `PreToolUse` `AskUserQuestion`: 1 dòng log, text `Claude cần bạn đưa ra quyết định ở proj`.
  - **H.** `notify-ctl`: `status` trước khi cấu hình in dòng "chua cau hinh", sau `Set-FakeRelay` in "da cau hinh (127.0.0.1)"; `test` in `telegram: da gui (qua relay)` ở mode `ok`, `GUI LOI` ở mode `500`, `chua cau hinh relay` khi chưa cấu hình; `snooze 1h telegram` rồi `status` hiện snooze, `on` xoá nó; lệnh cũ `topics` in usage có `relay-setup` và thoát 1.
  - **Chốt an toàn cuối:** ghi lại trước khi chạy sự tồn tại/`LastWriteTime` của `~\.claude\notify.relay.json`, `notify.snooze.json`, `notify.turns` **thật**; nếu có thay đổi sau khi chạy thì báo FAIL.
- Chạy `powershell -NoProfile -File <scratchpad>\run-client-tests.ps1`; kỳ vọng mọi ca PASS, thoát khác 0 nếu có ca FAIL.

**7d. Kiểm tra tay (không tự động hoá được):**
1. Trong terminal đã đặt `USERPROFILE`/`HOME` giả, chạy `notify-ctl.ps1 relay-setup -Url http://127.0.0.1:<port>/api/notify` với relay giả; dán khoá ≥ 32 ký tự ở prompt ẩn. Kỳ vọng "Da luu", có tin thử trong log của relay giả, và (tạo trước `notify.telegram.json` trong HOME giả) file đó biến mất. Khoá quá ngắn bị từ chối (thoát 1) và URL `http://example.com` bị từ chối.
2. Sau khi bạn deploy lên Vercel: chạy `relay-setup` trên máy thật rồi `notify-ctl.cmd test`; tin phải vào đúng topic và có hậu tố ` · <tên máy>`.

**7e. Commit** (hai commit, chỉ thêm đúng đường dẫn, không `git add -A`):
1. `git add relay .gitignore && git commit -m "feat(relay): Vercel serverless relay for Telegram notifications"`
2. `git add hooks commands/notify.md README.md && git commit -m "refactor(notify): send phone notifications through the relay and remove direct Telegram code"`

---

## Tự rà soát

- **Phủ yêu cầu thiết kế:** backend (mục 4.2 đến 4.6b → Task 1), kênh client (5.1 → Task 2), dispatcher (5.2 → Task 3), `notify-ctl` (5.3 → Task 4), tài liệu và lệnh (5.4 → Task 6), danh sách xoá (mục 7 → Task 5), kiểm thử (mục 6 → Task 1 và 7).
- **Nhất quán tên:** `Send-Relay`, `Get-RelayConfig`, `Save-RelayConfig`, `Protect-RelayKey`, `Unprotect-RelayKey`, `$script:RelayFile`, tham số `-Url`, lệnh `relay-setup`, tên kênh `telegram` trong config/snooze, biến môi trường `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`/`NOTIFY_KEYS`/`NOTIFY_TOPICS` đều dùng giống nhau ở mọi task.
- **Điểm đã sửa so với bản nháp của planner:** `readBody` trả `''` khi `req` không phải stream (nếu không, test `body undefined` làm `for await` ném lỗi thay vì trả 400); bảng snooze cũ trong README phải bị thay (không để hai bảng).
- Không có bước nào để ngỏ giá trị chưa quyết định.
