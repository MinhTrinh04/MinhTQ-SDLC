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
