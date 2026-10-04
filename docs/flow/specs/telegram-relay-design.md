# Telegram Relay — thiết kế

> Phân loại: **Architectural** (hệ thống con mới: backend relay + viết lại kênh client + xoá code gửi Telegram trực tiếp).
> Nguồn yêu cầu: văn bản trực tiếp từ người dùng (không có ticket Jira).

## 1. Mục tiêu & phạm vi

**Mục tiêu:** bot token Telegram chỉ nằm ở một nơi (biến môi trường Vercel). Các máy client không còn giữ bot token, không còn gọi Telegram trực tiếp; chúng chỉ POST một request nhỏ tới relay kèm một khoá riêng theo máy.

**Trong phạm vi:**
- Backend `relay/` (Vercel serverless function, Node) nhận `{project, text}`, xác thực, giới hạn tần suất, validate, rồi gọi Telegram `sendMessage` vào đúng topic.
- Kênh client mới `hooks/channels/relay.ps1` thay `telegram.ps1`; `notify.ps1`, `notify-ctl.ps1`, `commands/notify.md` và README được cập nhật theo.
- **Xoá** toàn bộ code gửi Telegram trực tiếp (liệt kê ở mục 7).

**Ngoài phạm vi:** trả lời hai chiều từ Telegram (webhook), tự tạo topic, cấu hình snooze phía server, lưu trạng thái bền (KV/Redis).

## 2. Các phương án đã cân nhắc

| | Mô tả | Ưu | Nhược |
|---|---|---|---|
| **A. Relay stateless (đề xuất)** | Một function, rate limit trong bộ nhớ (best-effort), cấu hình qua env | Đơn giản nhất, không thêm dịch vụ, đủ cho 1–vài máy cá nhân | Rate limit không chính xác khi Vercel bật nhiều instance; đổi map topic/khoá phải sửa env + redeploy |
| B. Relay + Upstash/Vercel KV | Như A nhưng rate limit và map topic lưu trong KV | Giới hạn chính xác, đổi map không cần redeploy | Thêm dịch vụ, thêm env, thêm phụ thuộc — quá tay cho nhu cầu hiện tại |
| C. Giữ gọi Telegram trực tiếp (hiện trạng) | Mỗi máy giữ bot token (DPAPI) | Không cần backend | Token không mang sang máy khác được, phải setup lại bot token trên từng máy; nhiều code Telegram phía client |

**Chọn A.** Người dùng đã chốt: backend nằm trong repo này (`relay/`), rate limit trong bộ nhớ best-effort, khoá client cất local ngoài repo (DPAPI).

## 3. Kiến trúc tổng quan

```
hook (Stop/Notification/AskUserQuestion)
   └─ hooks/notify.ps1  (dispatcher: config, snooze, ngưỡng 60s)
        ├─ channels/toast.ps1   → toast Windows (không đổi)
        └─ channels/relay.ps1   → HTTPS POST ──► Vercel: relay/api/notify.js
                                                  ├─ xác thực khoá (timing-safe)
                                                  ├─ rate limit / validate
                                                  └─ Telegram sendMessage (bot token + topic map từ env)
```

Tên kênh trong `notify.config.json` và lệnh snooze vẫn là `telegram` (người dùng hiểu đó là kênh "điện thoại"); chỉ phần triển khai bên dưới đổi sang relay.

## 4. Backend `relay/`

### 4.1 Cấu trúc file
```
relay/
  api/notify.js        # handler duy nhất: POST /api/notify
  test/notify.test.js  # node:test, mock fetch, không cần mạng
  package.json         # {"private": true, "engines": {"node": ">=18"}, "scripts": {"test": "node --test"}}
```
Vercel deploy với **Root Directory = `relay`**. Không có dependency ngoài (dùng `node:crypto` và `fetch` có sẵn).

### 4.2 Hợp đồng API
`POST /api/notify`
- Header: `Authorization: Bearer <khoá của máy>`, `Content-Type: application/json`.
- Body: `{ "project": "<tên thư mục project>", "text": "<nội dung>" }`.

| Status | Khi nào |
|---|---|
| 200 `{ok:true}` | Telegram nhận tin |
| 400 | body không phải JSON object; `project` rỗng hoặc > 100 ký tự; `text` rỗng hoặc > 500 ký tự; body > 4 KB |
| 401 | thiếu/sai khoá |
| 405 | không phải POST (kèm `Allow: POST`) |
| 429 | vượt giới hạn (kèm `Retry-After`) |
| 500 `{error:"not configured"}` | thiếu env bắt buộc (không nói rõ thiếu cái nào) |
| 502 | Telegram lỗi/timeout (thông điệp chung, không lộ chi tiết) |

### 4.3 Biến môi trường (đặt trên Vercel, không commit)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `NOTIFY_KEYS` — JSON `{"<tên-máy>": "<khoá ≥ 32 ký tự>", ...}`. Tên máy được nối vào cuối tin (`... · <tên-máy>`) để biết tin đến từ máy nào.
- `NOTIFY_TOPICS` — JSON `{"<project>": <message_thread_id>, "_default": <id>}`; `_default` tuỳ chọn.

### 4.4 Xác thực
- Tách `Bearer <khoá>`; băm SHA-256 cả khoá gửi lên và từng khoá trong `NOTIFY_KEYS`, so bằng `crypto.timingSafeEqual` (hai buffer luôn cùng 32 byte nên không lộ độ dài). **Duyệt hết mọi khoá, không thoát sớm**, để thời gian phản hồi không phụ thuộc khoá đúng nằm ở vị trí nào.
- Khoá ngắn hơn 32 ký tự trong `NOTIFY_KEYS` bị bỏ qua (coi như chưa cấu hình).

### 4.5 Giới hạn tần suất
- Cửa sổ trượt 60 giây, tối đa 30 request mỗi tên máy, giữ trong `Map` ở bộ nhớ module.
- **Best-effort có chủ đích:** mỗi instance serverless có bộ đếm riêng và mất khi instance bị thu hồi. Khoá bảo vệ vẫn là lớp chặn chính; rate limit chỉ giảm thiệt hại khi một khoá bị lộ hoặc client chạy sai.

### 4.6 Validate & làm sạch
- Chỉ nhận đúng `project` và `text` kiểu chuỗi; bỏ qua trường lạ.
- Xoá ký tự điều khiển (trừ xuống dòng) khỏi `text` và `project`, cắt khoảng trắng đầu/cuối, từ chối nếu rỗng sau khi làm sạch.
- Không dùng `parse_mode` khi gọi Telegram (gửi văn bản thuần) để nội dung không bị hiểu thành markup/HTML.

### 4.6b Gọi Telegram & topic cũ bị xoá
- `thread = NOTIFY_TOPICS[project] ?? NOTIFY_TOPICS._default ?? không có` (không có thì vào topic General).
- `fetch` tới `api.telegram.org` với `AbortController` timeout 8 giây.
- Nếu Telegram trả 400 với mô tả khớp `/thread not found/i` (topic đã xoá/đóng): **thử lại đúng một lần không kèm `message_thread_id`** để tin vào General, không mất tin. Lỗi khác → 502.
- Không bao giờ ghi log bot token, khoá, hay nội dung `text`; log chỉ gồm tên máy, project, mã trạng thái.

## 5. Client

### 5.1 `hooks/channels/relay.ps1` (mới, thay `telegram.ps1`)
- Đọc `~/.claude/notify.relay.json`: `{ "url": "https://<app>.vercel.app/api/notify", "key_enc": "<DPAPI>" }`. Khoá được mã hoá bằng DPAPI (chỉ giải mã được bởi đúng tài khoản Windows trên đúng máy; **không** để chữ thường trên đĩa, **không** nằm trong repo). Hàm `Protect-RelayKey`/`Unprotect-RelayKey` giữ lại phần DPAPI tối thiểu của file cũ.
- `Send-Relay -Text -Project` → `Invoke-RestMethod` POST JSON UTF-8, timeout 10 giây, TLS 1.2. **Không bao giờ ném lỗi**, trả `$true/$false`. Chưa cấu hình thì trả `$false` và im lặng (toast vẫn chạy).

### 5.2 `hooks/notify.ps1`
Khối "telegram" gọi `Send-Relay` thay cho `Send-Telegram`. Giữ nguyên logic cấu hình, snooze, ngưỡng `stopMinSeconds = 60`, và nội dung tin chung chung.

### 5.3 `hooks/notify-ctl.ps1`
- **Thêm** `relay-setup [-Url <url>]`: hỏi URL (nếu chưa truyền) và khoá bằng `Read-Host -AsSecureString` (không hiện, không ghi lịch sử), lưu `notify.relay.json`, gửi một tin thử và báo kết quả. Nếu tìm thấy file cũ `~/.claude/notify.telegram.json` thì xoá (đó là bot token cũ không còn dùng).
- `status` và `test` dùng relay.
- **Xoá** `telegram-setup`, `topics`, `topic-add`, `topic-detect`, `topic-remove`.

### 5.4 Tài liệu & lệnh
- `commands/notify.md`: quy tắc "không dùng `telegram-setup`" đổi thành `relay-setup` (vẫn không bao giờ hỏi/đọc/in khoá trong session Claude).
- README: thay mục Telegram bằng mục **Relay** (cách deploy lên Vercel, cách đặt env, cách lấy `message_thread_id` từ link topic `t.me/c/<chat>/<thread>`, `relay-setup` trên từng máy), bỏ phần nói về bot token DPAPI/`-ChatId`/`topic-*`.

## 6. Kiểm thử

**Backend (`node --test`, mock `fetch`, không cần mạng):** 405 với GET; 401 thiếu/sai khoá; thứ tự khoá trong `NOTIFY_KEYS` không ảnh hưởng kết quả; 400 với body rỗng/không phải JSON/`text` quá dài/`project` quá dài/ký tự điều khiển; 200 gửi đúng `message_thread_id` theo project; project lạ dùng `_default`, không có `_default` thì không kèm thread; topic cũ (400 "thread not found") thử lại không kèm thread; Telegram lỗi khác → 502; vượt 30 request/phút → 429; bot token không xuất hiện trong bất kỳ response nào; thiếu env → 500.

**Client:** chạy `notify.ps1` trong HOME giả với server HTTP giả (như đã làm với Telegram giả): có/không cấu hình relay, relay lỗi 500, relay timeout (toast vẫn hiện, hook vẫn thoát mã 0), snooze kênh `telegram` chặn gọi relay, lượt `Stop` ngắn hơn 60 giây không gọi relay.

**Smoke test thật** sau khi bạn deploy: `notify-ctl.cmd test`.

## 7. Danh sách xoá (sau khi thiết kế được duyệt)
- `hooks/channels/telegram.ps1` (toàn bộ: DPAPI bot token, `Send-Telegram`, `Invoke-Tg`, `getUpdates`).
- `hooks/notify.topics.json` (map topic chuyển sang `NOTIFY_TOPICS` trên Vercel).
- Trong `hooks/notify-ctl.ps1`: `telegram-setup`, `topics`, `topic-add`, `topic-detect`, `topic-remove`, và các tham chiếu `Get-TgConfig`/`Get-TgTopics`/`$script:TgFile`/`$script:TopicsFile`.
- Biến override test chỉ phục vụ Telegram trực tiếp: `CLAUDE_TG_API`, `CLAUDE_NOTIFY_TOPICS_FILE`.
- Trong README: phần cài bot token cho từng máy, `-ChatId`, bảng `topic-detect/add/remove`, đoạn nói token DPAPI không copy được.
- **Giữ lại:** toast, snooze, ngưỡng 60 giây, `notify.config.json`, hook `UserPromptSubmit`, shim `notify-ctl.cmd`, `install.ps1` (không cần đổi).

## 8. Rủi ro & đánh đổi
- **Endpoint công khai:** chặn bằng khoá timing-safe + rate limit + chỉ nhận POST + kích thước body nhỏ; không bật CORS.
- **Rate limit best-effort:** chấp nhận được cho dùng cá nhân (xem 4.5).
- **Cold start:** có thể thêm ~1 giây ở lần gọi đầu; hook có timeout 10 giây và toast không phụ thuộc relay.
- **Bên thứ ba thấy nội dung tin:** tin vốn đã chung chung (tên project + "cần quyết định"), không có code hay đường dẫn.
- **Lộ khoá của một máy:** đổi/xoá khoá đó trong `NOTIFY_KEYS` trên Vercel rồi redeploy; các máy khác không bị ảnh hưởng.
- **Gói Vercel miễn phí** dành cho mục đích phi thương mại; dùng cho công việc công ty cần xem lại điều khoản.
- **Mất tính năng:** không còn Telegram nếu relay chưa deploy hoặc Vercel sập (toast vẫn hoạt động). Đây là hệ quả của việc người dùng yêu cầu xoá đường gọi trực tiếp.

---

## 9. Bổ sung (2026-10-04): lưu khoá máy và bản đồ topic trong MongoDB

> Phân loại: **Architectural** (lớp lưu trữ mới, endpoint admin mới, đổi cách xác thực, nhóm lệnh quản trị mới ở client).
> Mục này **thay thế** các phần sau của thiết kế ở trên: 4.3 (biến môi trường `NOTIFY_KEYS`, `NOTIFY_TOPICS`), 4.4 (xác thực theo danh sách khoá trong env) và 4.6b (tra topic từ env). Các phần còn lại (hợp đồng `POST /api/notify`, rate limit, validate, retry khi topic cũ, client `Send-Relay`, snooze) giữ nguyên.

### 9.1 Mục tiêu
Thêm **máy mới** hoặc **topic mới** mà **không phải sửa biến môi trường Vercel và không redeploy**. Biến môi trường chỉ đặt một lần: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MONGODB_URI`, `NOTIFY_ADMIN_KEY`. Dữ liệu thay đổi thường xuyên (khoá máy, map topic) sống trong MongoDB Atlas (gói miễn phí M0). Bot token vẫn ở env, không đưa vào DB. Vì chưa deploy nên **không cần migration**; bỏ hẳn hỗ trợ `NOTIFY_KEYS`/`NOTIFY_TOPICS`.

### 9.2 Các phương án đã cân nhắc
| | Mô tả | Ưu | Nhược |
|---|---|---|---|
| **A. Mongo + endpoint admin (chọn)** | Backend tra khoá/topic trong Mongo; quản trị qua `POST /api/admin` có khoá admin riêng; `notify-ctl` gọi endpoint này | Khoá riêng theo máy, thu hồi được, thêm máy/topic bằng một lệnh, `MONGODB_URI` chỉ nằm trên Vercel | Thêm dịch vụ, thêm dependency, thêm bề mặt tấn công (endpoint admin) |
| B. Client truy cập thẳng Mongo | `notify-ctl` kết nối Mongo trực tiếp | Không cần endpoint admin | PowerShell không có driver Mongo; `MONGODB_URI` phải nằm trên mọi máy — **loại** |
| C. Giữ env JSON (hiện trạng) | Sửa env + redeploy mỗi lần thêm | Đơn giản nhất | Đúng cái người dùng muốn tránh — **loại** |

(Upstash Redis đã được cân nhắc và người dùng chọn MongoDB.)

### 9.3 Kiến trúc
```
máy ──POST /api/notify (Bearer khoá máy)──► backend
        sha256(khoá) → machines.findOne({keyHash, revoked:false})        [cache 30 giây]
        topics.findOne({_id: project}) ?? topics.findOne({_id:'_default'}) [cache 30 giây]
        → Telegram sendMessage (bot token từ env)

máy admin ──POST /api/admin (Bearer NOTIFY_ADMIN_KEY) {action,...}──► backend ──► MongoDB
```

### 9.4 Dữ liệu (database `claude_notify`, tên đổi được bằng env tuỳ chọn `MONGODB_DB`)
- `machines`: `{ _id: <name>, keyHash: <hex SHA-256>, createdAt: <Date>, revoked: <bool>, revokedAt?: <Date> }`. `name` khớp `^[a-z0-9][a-z0-9_-]{0,31}$`. Chỉ lưu **băm**, không lưu khoá thật. Chỉ mục duy nhất trên `keyHash`.
- `topics`: `{ _id: <project>, threadId: <int 1..2147483647> }`. Project đặc biệt `_default` là topic mặc định cho project chưa map.
- Chỉ mục tạo idempotent (`createIndex`) ở lần kết nối đầu của mỗi instance.
- Khoá máy sinh phía server: 32 byte ngẫu nhiên (`crypto.randomBytes`) mã hoá base64url (43 ký tự).

### 9.5 Backend `relay/`
**File mới/đổi:**
- `relay/lib/db.js` — `getDb()` giữ `MongoClient` trong biến module (cache giữa các lần gọi serverless), tuỳ chọn `maxPoolSize: 3`, `serverSelectionTimeoutMS: 3000`, `connectTimeoutMS: 3000`; `_setDb(fake)` để test chèn DB giả; không bao giờ log `MONGODB_URI`.
- `relay/lib/store.js` — các hàm `findMachineByKeyHash`, `findTopic`, `addMachine`, `revokeMachine`, `listMachines`, `setTopic`, `removeTopic`, `listTopics`. Cache bộ nhớ TTL 30 giây (đồng hồ có thể chèn để test): chỉ cache kết quả **tìm thấy** của khoá máy (không cache kết quả "không có" để kẻ tấn công không làm phình bộ nhớ bằng băm tuỳ ý); topic cache cả có/không, tối đa 500 mục (vượt thì xoá cache). Ghi từ admin xoá cache cùng instance (best-effort).
- `relay/api/notify.js` — bỏ `loadConfig` JSON và `authenticate` theo danh sách env. Cấu hình bắt buộc: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MONGODB_URI` (thiếu → 500 `{error:'not configured'}`). Thứ tự kiểm tra: 405 → 500 → 401 (băm khoá, tra DB) → 429 → 400 → gửi Telegram. Lỗi DB khi tra khoá → **503** `{error:'storage unavailable'}` (fail closed, không có đường dự phòng bằng env). Tin vẫn nối ` · <tên máy>` lấy từ `machines._id`.
- `relay/api/admin.js` — `POST` duy nhất, `Authorization: Bearer <NOTIFY_ADMIN_KEY>`; `NOTIFY_ADMIN_KEY` phải dài ≥ 32 ký tự (ngắn hơn → 500 `not configured`); so sánh bằng băm SHA-256 + `crypto.timingSafeEqual`. Body `{ "action": "...", ... }`:

  | action | tham số | kết quả |
  |---|---|---|
  | `machine-add` | `name` | 200 `{name, key}` — **khoá chỉ hiện đúng một lần**; tên đã có → 409 |
  | `machine-revoke` | `name` | 200 hoặc 404; đặt `revoked:true` (tên vẫn bị giữ chỗ) |
  | `machine-list` | — | `[{name, createdAt, revoked}]`, không bao giờ trả băm |
  | `topic-add` | `project`, `threadId` | upsert; 200 |
  | `topic-remove` | `project` | 200 hoặc 404 |
  | `topic-list` | — | `[{project, threadId}]` |

- Giới hạn tần suất riêng cho admin: 10 request/phút/instance, và đếm cả lần xác thực **sai** (20 lần/phút/instance → 429) để làm chậm dò khoá.
- `relay/package.json`: thêm dependency `mongodb` (một phiên bản chính cố định); `engines` giữ `node >=18`.
- Validate đầu vào dùng lại hàm làm sạch hiện có: `project` 1..100 ký tự không có ký tự điều khiển/xuống dòng; `threadId` là số nguyên 1..2147483647; `name` theo regex ở 9.4.
- **Chống NoSQL injection:** mọi giá trị đưa vào truy vấn phải là `string` hoặc `number` đã kiểm kiểu; từ chối (400) nếu là object/mảng; truy vấn chỉ dùng so khớp bằng, không bao giờ nhận toán tử `$...` từ đầu vào.
- Nhật ký: chỉ `action`, tên máy, project, mã trạng thái; không log khoá, băm, `MONGODB_URI`, bot token hay nội dung tin.

**Về "so sánh an toàn":** khoá máy là chuỗi ngẫu nhiên 256 bit; backend tra theo **băm** qua chỉ mục duy nhất, nên thời gian truy vấn không cho kẻ tấn công thông tin dùng được (không thể chọn băm từng phần mà không có tiền ảnh). Riêng khoá admin (một giá trị trong env) vẫn so bằng `timingSafeEqual`.

### 9.6 Client
- `hooks/channels/relay-admin.ps1` (mới, chỉ ASCII): `Get-AdminConfig`, `Save-AdminConfig`, `Invoke-RelayAdmin -Action -Params`. Cấu hình ở `~/.claude/notify.admin.json` = `{ "url": ".../api/admin", "key_enc": "<DPAPI>" }` (ngoài repo, không commit). Timeout 10 giây, `-MaximumRedirection 0`, cắt khoảng trắng của khoá, không bao giờ in khoá admin.
- `hooks/notify-ctl.ps1` thêm lệnh (giữ `relay-setup` cho máy thường):
  - `admin-setup [-Url <url>]` — hỏi URL admin và khoá admin (ẩn), lưu DPAPI.
  - `machine-add <tên> [-Apply]` — gọi admin, **in khoá đúng một lần** kèm nhắc chạy `relay-setup` trên máy mới; `-Apply` ghi luôn khoá vào `notify.relay.json` của máy hiện tại (URL relay suy ra từ URL admin) để khỏi sao chép tay.
  - `machine-revoke <tên>`, `machines`.
  - `topic-add [project] <thread_id>` (không có project thì lấy tên thư mục hiện tại; `_default` hợp lệ), `topic-remove [project]`, `topics`.
- `commands/notify.md`: các lệnh admin **không** nằm trong `/notify` (cần khoá bí mật); quy tắc cấm đọc/in khoá mở rộng sang khoá admin.
- `hooks/channels/relay.ps1` và `notify.ps1` **không đổi** (vẫn `Send-Relay`).

### 9.7 Phân tích bảo mật
| Mối đe doạ | Biện pháp |
|---|---|
| Dò khoá admin | Khoá ≥ 32 ký tự ngẫu nhiên, timing-safe, giới hạn cả lần sai, phản hồi lỗi chung |
| Lộ `MONGODB_URI` | Chỉ ở env Vercel; user DB chỉ có quyền `readWrite` trên một database; mật khẩu mạnh; xoay mật khẩu được |
| Atlas Network Access mở `0.0.0.0/0` (gói miễn phí/Vercel không có IP cố định) | Chấp nhận có chủ đích, bù bằng: TLS bắt buộc, mật khẩu mạnh, user DB quyền tối thiểu, DB chỉ chứa băm và id topic. Ghi rõ trong README |
| Bản sao dữ liệu chỉ-đọc của DB bị lộ | Chỉ có băm SHA-256 của khoá 256 bit và id topic: không dùng được để giả máy |
| `MONGODB_URI` (quyền `readWrite`) bị lộ | **Không vô hại:** kẻ gian ghi được một "máy" giả (băm khoá của họ) và sửa bản đồ topic, rồi gửi tin vào Telegram. Biện pháp: chỉ đặt URI trên Vercel, mật khẩu mạnh, xoay mật khẩu ngay khi nghi lộ; README nêu rõ |
| Thu hồi khoá chậm | Tối đa 30 giây (TTL cache), chấp nhận được; chỉnh bằng hằng số |
| Cụm Atlas/DB sập | Fail closed (503); toast trên máy vẫn hoạt động |
| NoSQL injection | Kiểm kiểu chặt, không nhận toán tử từ đầu vào (9.5) |
| Spam tạo máy qua admin | Chỉ khoá admin tạo được; rate limit admin |

### 9.8 Kiểm thử
- **Backend (`node --test`, DB giả trong bộ nhớ, `fetch` giả, không cần mạng):** DB giả cài tối thiểu `findOne`, `insertOne`, `updateOne`/upsert, `deleteOne`, `find().toArray()`, `createIndex`; chèn bằng `db._setDb()`. Các ca: xác thực qua DB (khoá đúng, sai, bị thu hồi); cache 30 giây (đồng hồ giả: thu hồi trễ tối đa 30 giây, không cache kết quả "không có" của khoá); topic map/`_default`/không có; DB ném lỗi → 503; thiếu `MONGODB_URI` → 500; admin: sai/thiếu khoá → 401, rate limit lần sai → 429, từng action (machine-add trả khoá một lần và trong DB chỉ có băm, 409 khi trùng tên, revoke, list không lộ băm, topic add/remove/list); validate gồm payload NoSQL-injection (`{"$ne":null}`, mảng) → 400; khoá/băm/`MONGODB_URI`/bot token không bao giờ xuất hiện trong response hay log. Các test cũ của `notify.js` được cập nhật sang cấu hình DB giả.
- **Client (HOME giả + server admin giả):** `admin-setup` lưu DPAPI và không để khoá dạng chữ; `machine-add` in khoá một lần, `-Apply` tạo `notify.relay.json` đúng; `machine-revoke`, `machines`, `topic-add/remove`, `topics`; lệnh admin khi chưa `admin-setup` báo rõ; `~/.claude` thật không bị ghi.
- **Kiểm tra tay sau khi bạn tạo cluster Atlas:** `machine-add`, `relay-setup`, `test`, `topic-add`, thu hồi khoá và xác nhận tin bị từ chối sau tối đa 30 giây.

### 9.9 Danh sách xoá/thay
- Xoá: `loadConfig` đọc `NOTIFY_KEYS`/`NOTIFY_TOPICS`, `authenticate` theo danh sách env, các test dựa vào hai biến đó, và phần README nói về chúng.
- Thay bằng: `lib/db.js`, `lib/store.js`, `api/admin.js`, `relay-admin.ps1`, các lệnh `notify-ctl` mới, hướng dẫn Atlas trong README.
- README cần: tạo cluster Atlas M0, tạo user DB quyền tối thiểu, Network Access cho Vercel, bộ env một lần, quy trình `admin-setup` → `machine-add` → `relay-setup` (máy mới) → `topic-add`.

### 9.10 Rủi ro & đánh đổi
- **Độ trễ:** thêm một lượt truy vấn DB cho tin đầu tiên của mỗi instance (cache 30 giây giảm các tin sau); driver `mongodb` làm cold start chậm hơn (kiểm tra lại timeout 10 giây của client).
- **Giới hạn kết nối:** `maxPoolSize` nhỏ và client được cache để không làm tràn số kết nối của Atlas M0.
- **Cluster miễn phí có thể bị tạm dừng khi lâu không dùng** (cần xem chính sách hiện hành của Atlas); khi đó tin điện thoại ngừng cho đến khi bật lại, toast vẫn chạy.
- **Thêm một dịch vụ phải vận hành** và thêm một credential quan trọng (`MONGODB_URI`) cùng một khoá admin.
- **Ngoài phạm vi:** bot tự tạo topic, giao diện web quản trị, tự xoay khoá, nhật ký kiểm toán.

### 9.11 Ghi chú triển khai (2026-10-04)

Khi lập kế hoạch triển khai, năm điểm sau được chốt hơi khác so với văn bản của mục 9 ở trên; **code theo các điểm này**:
1. Thêm `relay/lib/util.js` dùng chung giữa `notify.js` và `admin.js` (tránh nhân đôi `sha`, `send`, `clean`, `readBody`); spec chỉ liệt kê `db.js` và `store.js`.
2. `machine-list` và `topic-list` trả `{machines:[...]}` và `{topics:[...]}` (bọc trong object) thay vì mảng trần.
3. Tra **topic** lỗi thì hạ cấp thành "không có thread" (tin vào General); chỉ tra **khoá** lỗi mới fail closed 503. Lý do: tin đã được xác thực nên không nên mất tin chỉ vì không tra được topic.
4. `machine-add -Apply` **không in khoá**; chỉ in khoá nếu ghi `notify.relay.json` thất bại (để khoá không bị mất).
5. ~~Giới hạn lần xác thực sai của admin kiểm tra trước phép so khoá~~ — **đã đổi sau review:** khoá admin được so **trước**; chỉ khoá **sai** mới bị đếm và giới hạn, **theo từng IP** (`X-Forwarded-For`, 20 lần/phút), và khoá đúng **không bao giờ** bị chặn. Cách ban đầu (bộ đếm toàn cục kiểm tra trước) cho phép kẻ gian khoá ngoài chính admin.

Các điểm bổ sung sau khi `reviewer` rà soát:
6. `notify.js`: một IP gửi quá 30 khoá sai/phút không còn được **tra DB** (`findMachineByKeyHash(hex, allowDb = false)` chỉ phục vụ từ cache), để dò khoá không làm cạn giới hạn kết nối/thao tác của Atlas M0. Khoá đúng đã nằm trong cache vẫn dùng được; IP khác không bị ảnh hưởng.
7. `store.js`: bộ đếm `generation` tăng ở mỗi lần `invalidate()`; một lượt tra đang chạy dở khi có ghi (ví dụ thu hồi khoá) **không** được ghi lại kết quả cũ vào cache.
8. `db.js`: `socketTimeoutMS` 4 giây; sau một lần kết nối thất bại thì từ chối ngay trong 5 giây (không quay số lại ở mỗi request); lỗi tạo chỉ mục không làm hỏng cả lớp DB (lookups vẫn chạy).
9. `util.clean` loại thêm các ký tự dòng/vô hình/bidi (U+0085, U+2028, U+2029, các ký tự zero-width và điều khiển bidi, U+FEFF) khỏi `text` và `project`; `admin.js` từ chối (400) các giá trị chứa chúng.
10. `readBody` được bọc `try/catch` ở cả hai endpoint (getter `req.body` của nền tảng có thể ném lỗi khi JSON hỏng); các response chứa dữ liệu của admin có `Cache-Control: no-store`.
11. Client: `machine-add` báo lỗi khi phản hồi 200 không có khoá; `-Apply` cảnh báo khi ghi đè cấu hình relay cũ (khoá cũ vẫn hiệu lực cho tới khi `machine-revoke`); `topic-remove` kiểm tra tên project như `topic-add`; `admin-setup` huỷ file vừa lưu nếu server trả 401.
12. Biết trước, không sửa: chưa có lệnh xoá hoặc cấp lại khoá cho một tên máy đã dùng (tên bị giữ chỗ vĩnh viễn, đúng thiết kế mục 9.4); giới hạn 4 KB chỉ là kiểm tra sau khi nền tảng đã parse body (Vercel tự giới hạn ~4,5 MB).
