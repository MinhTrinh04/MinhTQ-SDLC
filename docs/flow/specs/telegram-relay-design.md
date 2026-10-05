# Telegram Relay — thiết kế

> Phân loại: **Architectural** (hệ thống con mới: backend relay có lưu trữ MongoDB, endpoint admin, kênh client viết lại, nhóm lệnh quản trị).
> Nguồn yêu cầu: văn bản trực tiếp từ người dùng (không có ticket Jira).
> Tài liệu này ghi lại **thiết kế và các quyết định**. Hành vi chi tiết cuối cùng của hệ thống (API, giới hạn, triển khai, vận hành, xử lý sự cố) nằm ở [docs/PROJECT.md](../../PROJECT.md).

## 1. Mục tiêu & phạm vi

**Mục tiêu:**
- Bot token Telegram chỉ nằm ở **một nơi**: biến môi trường của backend relay trên Vercel. Các máy không giữ bot token và không gọi Telegram trực tiếp; chúng chỉ POST một request nhỏ `{project, text}` kèm một khoá riêng theo máy.
- Thêm **máy mới** hoặc **topic mới** mà **không phải sửa biến môi trường Vercel và không redeploy**. Dữ liệu thay đổi thường xuyên (khoá máy, bản đồ project → topic) sống trong MongoDB Atlas (gói miễn phí M0); biến môi trường chỉ đặt một lần: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MONGODB_URI`, `NOTIFY_ADMIN_KEY`.

**Trong phạm vi:**
- Backend `relay/` (Vercel serverless, Node): `POST /api/notify` nhận tin, `POST /api/admin` quản trị máy và topic.
- Lớp lưu trữ MongoDB (`relay/lib/db.js`, `relay/lib/store.js`) có cache ngắn hạn.
- Client PowerShell: kênh `hooks/channels/relay.ps1`, `hooks/channels/relay-admin.ps1`, các lệnh của `hooks/notify-ctl.ps1`, cập nhật `commands/notify.md` và tài liệu.

**Ngoài phạm vi:** trả lời hai chiều từ Telegram (webhook), bot tự tạo topic, giao diện web quản trị, tự xoay khoá, nhật ký kiểm toán.

## 2. Các phương án đã cân nhắc

| | Mô tả | Ưu | Nhược |
|---|---|---|---|
| **A. Mongo + endpoint admin (chọn)** | Backend tra khoá/topic trong Mongo; quản trị qua `POST /api/admin` có khoá admin riêng; `notify-ctl` gọi endpoint này | Khoá riêng theo máy, thu hồi được, thêm máy/topic bằng một lệnh, `MONGODB_URI` chỉ nằm trên Vercel | Thêm dịch vụ, thêm dependency, thêm bề mặt tấn công (endpoint admin) |
| B. Client truy cập thẳng Mongo | `notify-ctl` kết nối Mongo trực tiếp | Không cần endpoint admin | PowerShell không có driver Mongo; `MONGODB_URI` phải nằm trên mọi máy — **loại** |
| C. Khoá và topic trong biến môi trường (JSON) | Sửa env và redeploy mỗi lần thêm máy/topic | Đơn giản nhất | Đúng cái người dùng muốn tránh — **loại** |
| D. Upstash Redis thay MongoDB | Gọi qua HTTP bằng `fetch`, không cần dependency | Nhẹ hơn | Người dùng chọn MongoDB Atlas — **loại** |

**Quyết định của người dùng:** backend nằm trong repo này (thư mục `relay/`, giữ tên `relay`); rate limit trong bộ nhớ best-effort; khoá phía client cất ngoài repo, mã hoá DPAPI; cache tra cứu 30 giây (thu hồi khoá chậm tối đa 30 giây); topic do **người dùng tự tạo** trong Telegram, bot không tự tạo.

## 3. Kiến trúc

```
hook của Claude Code (Stop / Notification / PreToolUse(AskUserQuestion) / UserPromptSubmit)
   └─ hooks/notify.ps1   (dispatcher: cấu hình, snooze, ngưỡng 60 giây)
        ├─ channels/toast.ps1   → toast Windows
        └─ channels/relay.ps1   → HTTPS POST ─► relay (Vercel)

máy ──POST /api/notify (Bearer khoá máy)──► relay
        sha256(khoá) → machines.findOne({keyHash, revoked:false})          [cache 30 giây]
        topics.findOne({_id: project}) ?? topics.findOne({_id:'_default'})  [cache 30 giây]
        → Telegram sendMessage (bot token từ env)

máy admin ──POST /api/admin (Bearer NOTIFY_ADMIN_KEY) {action,...}──► relay ──► MongoDB
```

Tên kênh trong `notify.config.json` và lệnh snooze vẫn là `telegram` (người dùng hiểu đó là kênh "điện thoại").

## 4. Dữ liệu (database `claude_notify`, đổi tên bằng env tuỳ chọn `MONGODB_DB`)

- `machines`: `{ _id: <tên>, keyHash: <hex SHA-256>, createdAt, revoked, revokedAt? }`. Tên khớp `^[a-z0-9][a-z0-9_-]{0,31}$`. Chỉ lưu **băm**, không lưu khoá thật; chỉ mục duy nhất trên `keyHash`. Thu hồi là "mềm" (tên vẫn bị giữ chỗ).
- `topics`: `{ _id: <tên thư mục project>, threadId: <số nguyên 1..2147483647> }`. Project đặc biệt `_default` là topic mặc định cho project chưa map.
- Chỉ mục tạo idempotent (`createIndex`) ở lần kết nối đầu của mỗi instance; lỗi tạo chỉ mục không làm hỏng lớp DB.
- Khoá máy do **server sinh**: 32 byte ngẫu nhiên (`crypto.randomBytes`), base64url (43 ký tự), trả về đúng một lần.

## 5. Backend `relay/`

### 5.1 File và cấu hình
```
relay/
  api/notify.js    api/admin.js
  lib/util.js      (sha, send, clean, clientIp, readBody dùng chung)
  lib/db.js        (MongoClient cache giữa các lần gọi serverless)
  lib/store.js     (truy vấn + cache)
  test/            (node:test, DB giả, fetch giả)
  package.json     (một dependency: mongodb 6.x; engines node >=18)
```
Vercel deploy với **Root Directory = `relay`**. Biến môi trường bắt buộc: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MONGODB_URI`, `NOTIFY_ADMIN_KEY` (≥ 32 ký tự). Thiếu bất kỳ biến nào → `500 {error:'not configured'}` (không nói thiếu biến nào).

### 5.2 `POST /api/notify`
- Thứ tự kiểm tra: 405 → 500 → xác thực (401, hoặc 503 khi tra khoá lỗi) → 429 → 400 → gửi Telegram.
- Lỗi DB khi tra **khoá** → **503** `{error:'storage unavailable'}` (fail closed, không có đường dự phòng bằng env). Tra **topic** lỗi thì hạ cấp thành "không có thread": tin đã xác thực nên không mất chỉ vì không tra được topic.
- Tin gửi đi là văn bản thuần (không `parse_mode`), nối ` · <tên máy>`.
- Thread = topic của project, rồi `_default`, rồi topic General. Nếu Telegram báo topic đã xoá hoặc đóng (`thread not found`, `TOPIC_CLOSED`, `TOPIC_DELETED`), relay **gửi lại đúng một lần không kèm thread** để tin vào General. Lỗi khác → 502. `fetch` có timeout 4 giây mỗi lần.
- Rate limit: cửa sổ trượt 60 giây, tối đa 30 request mỗi tên máy, trong bộ nhớ module (**best-effort có chủ đích**: mỗi instance có bộ đếm riêng).

### 5.3 `POST /api/admin`
`Authorization: Bearer <NOTIFY_ADMIN_KEY>`; body `{action, ...}`:

| action | tham số | kết quả |
|---|---|---|
| `machine-add` | `name` | 200 `{name, key}` (khoá hiện một lần, `Cache-Control: no-store`); 409 nếu tên đã có |
| `machine-revoke` | `name` | 200 hoặc 404 (đặt `revoked: true`, tên vẫn bị giữ chỗ) |
| `machine-list` | — | `{machines:[{name, createdAt, revoked}]}`, không bao giờ trả băm |
| `topic-add` | `project`, `threadId` | upsert; 200 |
| `topic-remove` | `project` | 200 hoặc 404 |
| `topic-list` | — | `{topics:[{project, threadId}]}` |

- Khoá admin được so bằng băm SHA-256 + `crypto.timingSafeEqual` (hai buffer cùng độ dài).
- Khoá **sai** bị đếm và giới hạn **theo IP** (`X-Forwarded-For`, 20 lần/phút → 429); khoá **đúng** được so trước và **không bao giờ** bị chặn, nên kẻ gian không thể khoá ngoài chính admin. Tối đa 10 request admin/phút/instance.

### 5.4 Cache và chống dò khoá
- Cache bộ nhớ TTL 30 giây (đồng hồ chèn được để test): chỉ cache khoá **tìm thấy** (không cache "không có", để băm ngẫu nhiên không làm phình bộ nhớ); topic cache cả có/không, tối đa 500 mục.
- Mỗi lần `invalidate()` tăng bộ đếm `generation`; một lượt tra đang chạy dở khi có ghi (ví dụ thu hồi khoá) **không** được ghi lại kết quả cũ vào cache.
- Một IP gửi quá 30 khoá sai/phút không còn được **tra DB** (`findMachineByKeyHash(hex, allowDb = false)` chỉ phục vụ từ cache), để dò khoá không làm cạn giới hạn kết nối/thao tác của Atlas M0. Khoá đúng đã nằm trong cache vẫn dùng được; IP khác không bị ảnh hưởng.
- Khoá máy là chuỗi ngẫu nhiên 256 bit và được tra theo **băm** qua chỉ mục duy nhất, nên thời gian truy vấn không cho kẻ tấn công thông tin dùng được.

### 5.5 Validate, nhật ký, lớp DB
- Chỉ nhận chuỗi/số đã kiểm kiểu; từ chối (400) object, mảng và mọi toán tử `$...` (chống NoSQL injection). `project` 1..100 ký tự, `text` 1..500, body ≤ 4 KB. `clean()` loại ký tự điều khiển (giữ xuống dòng), dấu tách dòng (U+0085, U+2028, U+2029), ký tự zero-width và điều khiển bidi, U+FEFF.
- `readBody` được bọc `try/catch` (getter `req.body` của nền tảng có thể ném lỗi khi JSON hỏng). Các response chứa dữ liệu admin có `Cache-Control: no-store`.
- Nhật ký chỉ có tên máy, project, action và mã trạng thái; không bao giờ log khoá, băm, `MONGODB_URI`, bot token, nội dung tin, hay đối tượng lỗi của driver (lỗi của driver có thể chứa host hoặc thông tin đăng nhập).
- `db.js`: `maxPoolSize 3`, kết nối và chọn server 3 giây, `socketTimeoutMS` 4 giây; sau một lần kết nối thất bại thì từ chối ngay trong 5 giây thay vì quay số lại ở mỗi request.

## 6. Client

- `hooks/channels/relay.ps1`: đọc `~/.claude/notify.relay.json` = `{url, key_enc}`, khoá mã hoá **DPAPI** (chỉ giải mã được bởi đúng tài khoản Windows trên đúng máy; không để chữ thường, không nằm trong repo). `Send-Relay -Text -Project` POST JSON UTF-8, timeout 10 giây, TLS 1.2, `-MaximumRedirection 0`, cắt khoảng trắng của khoá; **không bao giờ ném lỗi**, chưa cấu hình thì im lặng (toast vẫn chạy).
- `hooks/channels/relay-admin.ps1`: `Get-AdminConfig`, `Save-AdminConfig`, `Invoke-RelayAdmin -Action -Params` (trả `{Ok, Status, Data}`); cấu hình ở `~/.claude/notify.admin.json` (ngoài repo, DPAPI); không bao giờ in khoá admin.
- `hooks/notify.ps1`: giữ nguyên cấu hình, snooze, ngưỡng `stopMinSeconds`, nội dung tin chung chung; khối kênh `telegram` gọi `Send-Relay`.
- `hooks/notify-ctl.ps1`: giữ `relay-setup` cho máy thường; thêm `admin-setup [-Url]`, `machine-add <tên> [-Apply]`, `machine-revoke <tên>`, `machines`, `topic-add [project] <id>`, `topic-remove [project]`, `topics`.
  - `machine-add` báo lỗi nếu phản hồi 200 không có khoá. Không `-Apply` thì in khoá đúng một lần. `-Apply` ghi luôn cho máy hiện tại (URL relay suy ra từ URL admin: `.../api/admin` → `.../api/notify`) và **không in khoá** (chỉ in nếu ghi file thất bại, để khoá không bị mất); nếu ghi đè cấu hình relay cũ thì cảnh báo rằng khoá cũ còn hiệu lực cho đến khi `machine-revoke`.
  - `topic-add` và `topic-remove` kiểm tra tên project (1..100 ký tự); không có project thì lấy tên thư mục hiện tại; `_default` hợp lệ.
  - `admin-setup` huỷ file vừa lưu nếu server trả 401.
- `commands/notify.md`: các lệnh xử lý khoá bí mật (`relay-setup` và mọi lệnh admin) **không** nằm trong `/notify`; quy tắc cấm đọc, in hay lặp lại khoá relay, khoá admin, chuỗi kết nối MongoDB hay bot token; đối số được kiểm tra trước khi chạy.

## 7. Phân tích bảo mật

| Mối đe doạ | Biện pháp |
|---|---|
| Dò khoá admin | Khoá ≥ 32 ký tự ngẫu nhiên, so timing-safe, giới hạn lần sai theo IP, phản hồi lỗi chung |
| Khoá admin bị khoá ngoài (DoS) | Khoá đúng không bao giờ bị giới hạn lần sai; bộ đếm lần sai theo IP |
| Dò khoá máy làm cạn Atlas | IP gửi quá 30 khoá sai/phút mất quyền tra DB (5.4) |
| Lộ khoá của một máy | `machine-revoke`, hiệu lực trong tối đa 30 giây; máy khác không ảnh hưởng |
| Bản sao dữ liệu chỉ-đọc của DB bị lộ | Chỉ có băm SHA-256 của khoá 256 bit và id topic: không dùng được để giả máy |
| **`MONGODB_URI` (quyền `readWrite`) bị lộ** | **Không vô hại:** kẻ gian ghi được một "máy" giả (băm khoá của họ) và sửa bản đồ topic rồi gửi tin vào Telegram. Biện pháp: chỉ đặt URI trên Vercel, mật khẩu mạnh, user DB chỉ có quyền trên một database, đổi mật khẩu ngay khi nghi lộ |
| Atlas Network Access mở `0.0.0.0/0` (Vercel gói miễn phí không có IP cố định) | Chấp nhận có chủ đích, bù bằng TLS bắt buộc, mật khẩu mạnh, quyền tối thiểu |
| NoSQL injection | Kiểm kiểu chặt, từ chối object/mảng, truy vấn chỉ so khớp bằng |
| Cụm Atlas/DB sập | Fail closed (503); toast trên máy vẫn hoạt động |
| Spam tạo máy qua admin | Chỉ khoá admin tạo được; có rate limit |
| Rò rỉ qua log/phản hồi | Không log khoá, băm, URI, token, nội dung tin hay lỗi của driver |

## 8. Kiểm thử

- **Backend (`node --test`, DB giả trong bộ nhớ, `fetch` giả, không cần mạng):** DB giả cài các thao tác tối thiểu (`findOne`, `insertOne`, `updateOne` upsert, `deleteOne`, `find().toArray()` có projection, `createIndex` có chỉ mục duy nhất và lỗi trùng khoá mã 11000); chèn bằng `db._setDb()`. Các ca chính: xác thực qua DB (khoá đúng, sai, đã thu hồi); cache 30 giây với đồng hồ giả; một lượt tra đang chạy dở không ghi lại dữ liệu cũ vào cache sau khi thu hồi hoặc đổi topic; không cache khoá "không có"; IP quá giới hạn không được tra DB nhưng vẫn dùng được khoá trong cache; topic map, `_default`, giá trị ngoài khoảng, tên thuộc tính prototype; DB lỗi → 503, không rò rỉ bí mật; thiếu env → 500 giống hệt nhau; toàn bộ admin (từng action, 409, thu hồi có hiệu lực ngay, không lộ băm, lần sai theo IP, khoá đúng không bị chặn, payload NoSQL-injection → 400, no-store); `clean()` và `clientIp`; đường kết nối Mongo thật tới cổng không tồn tại (lỗi chung, không lộ URI, có backoff).
- **Client (process con, HOME giả, server relay và admin giả):** lưu mã hoá DPAPI (không để khoá dạng chữ), `machine-add` (khoá hiện một lần, `-Apply` ghi đúng URL suy ra và không in khoá, phản hồi thiếu khoá, trùng tên, cảnh báo ghi đè), `machine-revoke`, `machines`, `topic-add/remove`, `topics` (id hợp lệ và không hợp lệ), lệnh admin khi chưa `admin-setup`, lỗi 401 và kết nối bị từ chối, redirect không được đi theo; mọi bước có chốt kiểm tra rằng `~/.claude` thật không đổi. Bộ test này hiện chưa nằm trong repo.
- **Kiểm tra tay:** `admin-setup` và `relay-setup` tương tác (prompt ẩn), cụm Atlas thật, Vercel thật, thu hồi khoá có hiệu lực trong ≤ 30 giây, độ trễ cold start.

## 9. Rủi ro & đánh đổi

- **Độ trễ:** thêm một lượt truy vấn DB cho tin đầu tiên của mỗi instance (cache 30 giây giảm các tin sau); driver `mongodb` làm cold start chậm hơn. Trường hợp xấu nhất ở backend là kết nối 3 giây + Telegram 4 giây × 2 = 11 giây, có thể vượt timeout 10 giây của client: client báo lỗi dù tin có thể đã gửi (hiếm; sẽ đo khi deploy).
- **Giới hạn của Atlas M0:** kết nối và thao tác có hạn; tấn công từ nhiều IP vẫn có thể làm relay trả 503 (toast vẫn chạy). Cluster miễn phí có thể bị tạm dừng khi lâu không dùng (xem chính sách hiện hành của Atlas).
- **Thêm một dịch vụ phải vận hành** và thêm một credential quan trọng (`MONGODB_URI`) cùng khoá admin.
- **Gói Vercel miễn phí** dành cho mục đích phi thương mại; dùng cho công việc công ty cần xem lại điều khoản.
- **Bên thứ ba thấy nội dung tin:** tin cố ý chung chung (tên project và "cần quyết định"), không có code hay đường dẫn.
- **Biết trước, không sửa:** chưa có lệnh xoá hoặc cấp lại khoá cho một tên máy đã dùng (tên bị giữ chỗ vĩnh viễn); giới hạn 4 KB chỉ là kiểm tra sau khi nền tảng đã parse body (Vercel tự giới hạn khoảng 4,5 MB); DPAPI không chặn các tiến trình khác chạy dưới cùng tài khoản.
