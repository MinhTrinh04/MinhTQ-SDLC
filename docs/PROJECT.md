# Tài liệu dự án

Tài liệu kỹ thuật chi tiết của repo này, dành cho người **cài đặt, vận hành và phát triển** nó. Hướng dẫn dùng hằng ngày nằm ở [README.md](../README.md); tài liệu này đi sâu vào kiến trúc, cách cài đặt từng phần, mô hình bảo mật, vận hành và quy ước phát triển.

## Mục lục
1. [Tổng quan](#1-tổng-quan)
2. [Cấu trúc repo](#2-cấu-trúc-repo)
3. [Cài đặt (`install.cmd`)](#3-cài-đặt-installcmd)
4. [Hệ thống thông báo](#4-hệ-thống-thông-báo)
5. [Relay (backend Vercel + MongoDB)](#5-relay-backend-vercel--mongodb)
6. [Triển khai relay từng bước](#6-triển-khai-relay-từng-bước)
7. [Vận hành hằng ngày](#7-vận-hành-hằng-ngày)
8. [Xử lý sự cố](#8-xử-lý-sự-cố)
9. [Phát triển](#9-phát-triển)
10. [Quy trình `/flow` và thư mục `docs/flow`](#10-quy-trình-flow-và-thư-mục-docsflow)

---

## 1. Tổng quan

Repo gồm hai phần ghép với nhau:

1. **Bộ cấu hình Claude Code dùng chung** (`agents/`, `commands/`, `skills/`): các subagent, slash command và skill của pipeline `/flow` (brainstorm → plan → execute → verify → review) cùng các lệnh phụ (`/fix-feature`, `/pr`, `/scaffold`...). Các thư mục này được nối vào `~/.claude/` để Claude Code nhìn thấy mà không cần sao chép.
2. **Hệ thống thông báo** (`hooks/`, `relay/`): báo cho bạn khi Claude làm xong việc, khi cần quyết định, hoặc đang chờ. Có hai kênh: **toast Windows** trên máy, và **tin Telegram** gửi qua một backend nhỏ (relay) để bạn nhận được cả khi đi vắng.

Repo **không có mã ứng dụng** theo nghĩa thông thường; "kiểm thử" của chính repo là một lệnh grep tìm chữ để trống trong các file prompt (xem [mục 9](#9-phát-triển)).

Môi trường mục tiêu: **Windows 10/11**, Windows PowerShell 5.1, VS Code với extension Claude Code. Backend relay chạy Node ≥ 18.

## 2. Cấu trúc repo

```
agents/                 planner, reviewer, verifier (subagent dùng chung)
commands/               slash command: flow, flow-batch, fix-feature, scaffold, optimize,
                        playwright-test, migration-safe, pr, jira-sync, loop-engineer, notify
skills/                 flow-brainstorm, flow-plan, flow-execute
hooks/
  notify.ps1            bộ điều phối hook thông báo
  notify-ctl.ps1        lệnh quản lý: snooze, relay, admin, machine, topic
  notify.config.json    bật/tắt kênh và sự kiện, ngưỡng thời gian
  claude-logo.png       logo hiển thị trên toast
  channels/
    toast.ps1           kênh toast Windows
    relay.ps1           kênh điện thoại: gửi tới relay
    relay-admin.ps1     gọi API admin của relay
relay/                  backend Vercel serverless (Node)
  api/notify.js         nhận tin từ các máy
  api/admin.js          quản trị máy và topic
  lib/                  util.js, db.js (MongoDB), store.js (truy vấn + cache)
  test/                 test node:test và DB giả
docs/
  PROJECT.md            tài liệu này
  flow/specs, plans     thiết kế và kế hoạch do pipeline /flow tạo ra
install.cmd             launcher một dòng
install.ps1             toàn bộ logic cài đặt
CLAUDE.md               hướng dẫn kiểm thử của chính repo này
```

Không nằm trong repo (sinh ra trên từng máy, trong `~/.claude/` và registry): xem bảng ở [mục 4.5](#45-trạng-thái-trên-từng-máy).

## 3. Cài đặt (`install.cmd`)

`install.cmd` chỉ là launcher một dòng gọi `install.ps1` với `-ExecutionPolicy Bypass`, để chạy được trên máy mới dù PowerShell đang chặn script. Mọi logic nằm ở `install.ps1`.

```powershell
git clone <url-repo> C:\Github\MinhTQ-SDLC     # KHÔNG clone vào ~/.claude
cd C:\Github\MinhTQ-SDLC
.\install.cmd
```

Script có **hai phần độc lập**, đều **idempotent** (chạy lại bao nhiêu lần cũng được) và **không cần quyền admin**:

| Lệnh | Tác dụng |
| --- | --- |
| `.\install.cmd` | cả hai phần |
| `.\install.cmd -Links` | chỉ phần Links |
| `.\install.cmd -Notify` | chỉ phần Notify |
| `.\install.cmd -Uninstall` (kèm `-Links` hoặc `-Notify`) | gỡ đúng phần đó, chỉ gỡ cái script đã thêm |

### 3.1 Phần Links

Tạo **directory junction** (không phải symlink file, vì junction không cần quyền) từ `~/.claude/` về repo cho `agents/`, `commands/` và **từng thư mục con** của `skills/`. Không link cả `skills/` vì `~/.claude/skills/` còn chứa thư mục do Claude tự quản lý (ví dụ `synced/`).

- Link đã đúng thì bỏ qua; skill mới thêm vào repo thì chạy lại để link thêm; skill đã xoá khỏi repo thì link mồ côi bị dọn.
- Nếu `~/.claude/agents` (v.v.) đã là **thư mục thật**, script cảnh báo và bỏ qua, không ghi đè.
- `CLAUDE.md` của repo **không** được link (đó là hướng dẫn test của repo này, không phải CLAUDE.md global).
- Trên Windows đừng dùng `ln -s` trong Git Bash: nó chỉ copy file thay vì tạo link thật.

### 3.2 Phần Notify

1. Cài module **BurntToast** (user hiện tại, cần internet) nếu chưa có.
2. Đăng ký **AppId** `Claude.Code.Notify` trong `HKCU:\Software\Classes\AppUserModelId` (tên hiển thị "Claude Code", icon là `claude-logo.png`).
3. Ghi shim `~/.claude/notify-ctl.cmd` chứa đường dẫn của bản clone này, để `/notify` và README gọi `hooks\notify-ctl.ps1` mà không cần biết repo nằm ở đâu.
4. **Gộp** bốn hook vào `~/.claude/settings.json` (giữ nguyên mọi setting khác, backup `settings.json.bak` ở lần đầu):

   | Sự kiện | Matcher | Mục đích |
   | --- | --- | --- |
   | `Stop` | — | Claude làm xong một lượt |
   | `Notification` | — | Claude xin quyền hoặc chờ phản hồi |
   | `PreToolUse` | `AskUserQuestion` | Claude hỏi bạn chọn phương án (ví dụ cổng duyệt của `/flow`) |
   | `UserPromptSubmit` | — | ghi giờ bắt đầu lượt để `Stop` biết lượt dài hay ngắn |

   Lệnh hook trỏ thẳng vào `hooks\notify.ps1` trong repo, đường dẫn được tính lúc cài. **Di chuyển repo thì phải chạy lại `.\install.cmd -Notify`.** Mục cũ trỏ vào `notify.ps1`/BurntToast được thay, không bị nhân đôi.

Sau khi cài, **mở session Claude Code mới**: hook và skill chỉ được nạp lúc session khởi động.

## 4. Hệ thống thông báo

### 4.1 Luồng

```
hook của Claude Code (Stop / Notification / PreToolUse(AskUserQuestion) / UserPromptSubmit)
   └─ hooks/notify.ps1        đọc JSON từ stdin, áp dụng cấu hình, snooze, ngưỡng thời gian
        ├─ channels/toast.ps1  ─► toast Windows (không cần mạng)
        └─ channels/relay.ps1  ─► HTTPS POST ─► relay (Vercel) ─► Telegram (đúng topic của project)
```

`notify.ps1` **luôn thoát mã 0**: thông báo lỗi không bao giờ được làm hỏng một hook của Claude. Kênh nào lỗi thì bị bỏ qua, kênh khác vẫn chạy.

### 4.2 Nội dung thông báo

| Sự kiện | Toast | Tin điện thoại |
| --- | --- | --- |
| `AskUserQuestion` | `Claude cần bạn quyết định - <project>` + câu hỏi và các lựa chọn | `Claude cần bạn đưa ra quyết định ở <project>` |
| `Notification` | `Claude Code cần bạn - <project>` + thông điệp | `Claude đang chờ bạn ở <project>` |
| `Stop` | `Claude Code - <project>` + "Tác vụ đã hoàn thành!" | `Claude đã xong ở <project> (x phút y giây)` |

Tin điện thoại **cố ý chung chung**: không có code, đường dẫn hay nội dung câu hỏi, vì nó đi qua bên thứ ba. `<project>` là **tên thư mục** của `cwd` trong payload hook (dự phòng: `CLAUDE_PROJECT_DIR`, rồi thư mục hiện tại).

### 4.3 Cấu hình (`hooks/notify.config.json`)

```json
{
  "events":   { "Stop": true, "Notification": true, "AskUserQuestion": true },
  "channels": {
    "toast":    { "enabled": true, "stopMinSeconds": 0 },
    "telegram": { "enabled": true, "stopMinSeconds": 60 }
  }
}
```

- `events`: tắt hẳn một loại sự kiện cho mọi kênh.
- `channels.<tên>.enabled`: bật/tắt một kênh. Tên kênh `telegram` là kênh điện thoại (cài đặt bên dưới là relay).
- `stopMinSeconds`: sự kiện `Stop` chỉ gửi nếu lượt chạy lâu hơn ngưỡng. Mặc định toast gửi mọi lượt, điện thoại chỉ gửi lượt ≥ 60 giây để khỏi spam. Lượt không có giờ bắt đầu (session mở trước khi cài hook) được coi là dài và vẫn gửi.
- File thiếu hoặc hỏng: mọi thứ bật với mặc định trên.

### 4.4 Snooze và công cụ điều khiển

`notify-ctl.ps1` được gọi qua shim `~/.claude/notify-ctl.cmd` (hoặc `/notify` trong Claude Code đối với các lệnh không chứa bí mật):

| Lệnh | Tác dụng |
| --- | --- |
| `snooze <30m\|1h\|4h\|8h> [all\|toast\|telegram]` | tắt thông báo tạm thời (mặc định mọi kênh), ghi `notify.snooze.json` |
| `on` / `status` / `test` | bật lại ngay / xem trạng thái / gửi thử |
| `relay-setup [-Url]` | một lần trên **mỗi máy**: lưu URL relay + khoá của máy (khoá được hỏi ẩn) |
| `admin-setup [-Url]` | một lần trên **máy admin**: lưu URL admin + khoá admin |
| `machine-add <tên> [-Apply]` | tạo khoá cho một máy (hiện **một lần**); `-Apply` ghi luôn cho máy này |
| `machine-revoke <tên>`, `machines` | thu hồi / liệt kê máy |
| `topic-add [project] <id>`, `topic-remove [project]`, `topics` | quản lý bản đồ project → topic |

`/notify` chỉ nhận bốn dạng (`snooze`, `on`, `status`, `test`) và **từ chối mọi thứ khác**, kể cả các lệnh xử lý khoá bí mật.

### 4.5 Trạng thái trên từng máy

| Vị trí | Nội dung | Ghi chú |
| --- | --- | --- |
| `~/.claude/settings.json` | các hook ở mục 3.2 | được gộp, có `.bak` |
| `~/.claude/notify-ctl.cmd` | shim chứa đường dẫn repo | không commit, ghi lại mỗi lần cài |
| `~/.claude/notify.relay.json` | `{url, key_enc}` khoá của máy | mã hoá DPAPI |
| `~/.claude/notify.admin.json` | `{url, key_enc}` khoá admin | mã hoá DPAPI; chỉ máy admin có |
| `~/.claude/notify.snooze.json` | thời hạn và kênh bị tắt | tự hết hạn |
| `~/.claude/notify.turns/` | giờ bắt đầu lượt theo session | file quá 2 ngày được dọn |
| `HKCU:\Software\Classes\AppUserModelId\Claude.Code.Notify` | tên và icon toast | gỡ bằng `-Uninstall -Notify` |
| `%TEMP%\claude-notify-debug.log` | payload hook | chỉ khi đặt `CLAUDE_NOTIFY_DEBUG=1` |

**DPAPI** chỉ chặn người dùng Windows khác và việc đọc trộm ổ đĩa; mọi tiến trình chạy dưới tài khoản của bạn đều giải mã được. Vì vậy khoá admin (điều khiển mọi khoá máy và bản đồ topic) chỉ nên nằm trên máy bạn tin cậy.

### 4.6 Vì sao toast dùng AppId riêng

BurntToast 1.1.0 không đặt được AppId, nên toast mặc định mượn danh tính PowerShell: bấm vào toast khiến Windows chạy `powershell.exe` và một cửa sổ cmd nháy lên rồi tắt. `toast.ps1` vì vậy gửi thẳng qua API toast của Windows với AppId `Claude.Code.Notify` (không gắn với file chạy nào), nên bấm vào không khởi động gì. Header toast hiện "Claude Code" kèm logo thay vì "Windows PowerShell". Khi AppId chưa đăng ký (chưa chạy `-Notify`), script tự dùng toast BurntToast mặc định.

## 5. Relay (backend Vercel + MongoDB)

Relay là một Vercel serverless function (Node, CommonJS, một dependency: `mongodb`). Các máy POST `{project, text}` kèm khoá riêng; relay xác thực, giới hạn tần suất rồi gọi Telegram `sendMessage` vào đúng topic. **Bot token chỉ nằm ở biến môi trường của relay**; các máy không bao giờ giữ nó.

```
máy ──POST /api/notify (Bearer khoá máy)──► relay
        sha256(khoá) → machines.findOne({keyHash, revoked:false})        [cache 30 giây]
        topics.findOne({_id: project}) ?? topics.findOne({_id:'_default'}) [cache 30 giây]
        → Telegram sendMessage

máy admin ──POST /api/admin (Bearer NOTIFY_ADMIN_KEY) {action,...}──► relay ──► MongoDB
```

### 5.1 Biến môi trường (đặt một lần trên Vercel)

| Biến | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | có | token bot |
| `TELEGRAM_CHAT_ID` | có | id supergroup, dạng `-100xxxxxxxxxx` |
| `MONGODB_URI` | có | chuỗi kết nối Atlas (coi như mật khẩu) |
| `NOTIFY_ADMIN_KEY` | có | khoá admin ngẫu nhiên, **≥ 32 ký tự** |
| `MONGODB_DB` | không | tên database, mặc định `claude_notify` |

Thiếu bất kỳ biến bắt buộc nào, mọi endpoint trả `500 {"error":"not configured"}` (không nói thiếu cái nào).

### 5.2 Dữ liệu (MongoDB, database `claude_notify`)

- `machines`: `{ _id: <tên máy>, keyHash: <SHA-256 hex>, createdAt, revoked, revokedAt? }`. Tên khớp `^[a-z0-9][a-z0-9_-]{0,31}$`. Chỉ lưu **băm** của khoá; chỉ mục duy nhất trên `keyHash`. Thu hồi là "mềm": máy bị đánh dấu `revoked`, **tên vẫn bị giữ chỗ** (chưa có lệnh xoá hay cấp lại khoá cho một tên đã dùng).
- `topics`: `{ _id: <tên thư mục project>, threadId: <số nguyên 1..2147483647> }`. Project đặc biệt `_default` là topic mặc định cho project chưa map.
- Khoá máy do **server sinh**: 32 byte ngẫu nhiên, mã hoá base64url (43 ký tự), trả về đúng một lần.

### 5.3 `POST /api/notify`

Header `Authorization: Bearer <khoá máy>`; body `{ "project": "...", "text": "..." }`.

| Mã | Khi nào |
| --- | --- |
| 200 `{ok:true}` | Telegram nhận tin |
| 400 | body không phải JSON object; `project` rỗng hoặc > 100 ký tự; `text` rỗng hoặc > 500 ký tự; body > 4 KB |
| 401 | thiếu, sai hoặc đã thu hồi khoá |
| 405 | không phải POST |
| 429 | máy vượt 30 request/phút |
| 500 | thiếu biến môi trường |
| 502 | Telegram lỗi hoặc quá thời gian |
| 503 | không truy cập được MongoDB khi tra khoá (**từ chối**, không có đường dự phòng) |

Thứ tự kiểm tra: 405 → 500 → xác thực (401/503) → 429 → 400 → gửi. Tin được nối thêm ` · <tên máy>`. Văn bản gửi thuần (không `parse_mode`). Thread lấy từ `topics`: đúng project, rồi `_default`, rồi topic General. Nếu Telegram báo topic đã xoá/đóng (`thread not found`, `TOPIC_CLOSED`, `TOPIC_DELETED`), relay **gửi lại đúng một lần không kèm thread** để tin vào General, không mất tin. Tra topic lỗi thì tin vào General; chỉ tra **khoá** lỗi mới trả 503.

### 5.4 `POST /api/admin`

Header `Authorization: Bearer <NOTIFY_ADMIN_KEY>`; body `{ "action": ..., ... }`.

| action | tham số | kết quả |
| --- | --- | --- |
| `machine-add` | `name` | 200 `{name, key}` (header `Cache-Control: no-store`); 409 nếu tên đã có |
| `machine-revoke` | `name` | 200 hoặc 404 |
| `machine-list` | — | `{machines:[{name, createdAt, revoked}]}`, không bao giờ trả băm |
| `topic-add` | `project`, `threadId` | upsert; 200 |
| `topic-remove` | `project` | 200 hoặc 404 |
| `topic-list` | — | `{topics:[{project, threadId}]}` |

Mã khác: 400 (đầu vào sai), 401, 405, 429, 500, 503. Khoá admin được so bằng băm SHA-256 + `timingSafeEqual`. Khoá **sai** bị giới hạn theo IP (20 lần/phút); khoá **đúng** không bao giờ bị chặn, nên kẻ gian không thể khoá ngoài chính admin. Tối đa 10 request admin/phút/instance.

### 5.5 Các cơ chế bảo vệ và giới hạn

| Cơ chế | Chi tiết |
| --- | --- |
| Xác thực khoá máy | tra theo **băm** qua chỉ mục duy nhất; khoá là chuỗi ngẫu nhiên 256 bit nên thời gian truy vấn không cho kẻ tấn công thông tin dùng được |
| Cache 30 giây | chỉ cache khoá **tìm thấy** (không cache "không có", để băm ngẫu nhiên không làm phình bộ nhớ); topic cache cả có/không, tối đa 500 mục. Thu hồi khoá hoặc đổi topic có hiệu lực trong **tối đa 30 giây**. Ghi từ admin xoá cache cùng instance; bộ đếm thế hệ chặn một lượt tra đang chạy dở ghi lại dữ liệu cũ |
| Chặn dò khoá | IP gửi quá 30 khoá sai/phút không còn được tra DB (vẫn dùng được khoá đã cache), để một cuộc dò khoá không làm cạn giới hạn của Atlas M0 |
| Rate limit | 30 request/phút/máy (notify), 10/phút/instance (admin); giữ trong bộ nhớ nên **best-effort**: mỗi instance serverless có bộ đếm riêng |
| Validate | chỉ nhận chuỗi/số đã kiểm kiểu; từ chối object/mảng và toán tử `$...` (chống NoSQL injection); `clean()` loại ký tự điều khiển, dấu tách dòng, ký tự vô hình và điều khiển bidi |
| Nhật ký | chỉ `machine`, `project`, `action`, mã trạng thái; không bao giờ log khoá, băm, `MONGODB_URI`, bot token hay nội dung tin; không bao giờ log đối tượng lỗi của driver |
| Timeout | Telegram 4 giây mỗi lần (tối đa 2 lần); Mongo: kết nối 3 giây, socket 4 giây; sau một lần kết nối hỏng, từ chối ngay trong 5 giây thay vì quay số lại |

### 5.6 Mô hình bảo mật và rủi ro

| Mối đe doạ | Biện pháp / thực tế |
| --- | --- |
| Dò khoá admin | khoá ≥ 32 ký tự ngẫu nhiên, so timing-safe, giới hạn lần sai theo IP, phản hồi lỗi chung |
| Lộ khoá của một máy | `machine-revoke <tên>`; các máy khác không ảnh hưởng |
| Bản sao dữ liệu chỉ-đọc của DB bị lộ | vô hại: chỉ có băm SHA-256 của khoá 256 bit và id topic |
| **`MONGODB_URI` bị lộ** | **không vô hại**: có quyền `readWrite` nên kẻ gian ghi được một "máy" giả (băm khoá của họ) và gửi tin vào Telegram của bạn, hoặc sửa bản đồ topic. Chỉ đặt URI trên Vercel, mật khẩu mạnh, đổi mật khẩu ngay khi nghi lộ |
| Atlas phải mở `0.0.0.0/0` | Vercel gói miễn phí không có IP cố định; bù bằng TLS bắt buộc, user DB quyền tối thiểu một database, mật khẩu mạnh |
| Dữ liệu qua bên thứ ba | tin điện thoại cố ý chung chung (không code, không đường dẫn) |
| Cluster Atlas M0 giới hạn kết nối/thao tác | tấn công từ nhiều IP vẫn có thể làm relay trả 503; toast vẫn chạy |
| Cluster M0 có thể bị tạm dừng khi lâu không dùng | xem chính sách hiện hành của Atlas; tin điện thoại dừng cho đến khi bật lại |
| Thời gian xấu nhất | kết nối Mongo 3 giây + Telegram 4 giây × 2 = 11 giây, có thể vượt timeout 10 giây của client: client báo lỗi dù tin có thể đã gửi (hiếm) |
| Gói Vercel miễn phí | dành cho mục đích phi thương mại; dùng cho công việc công ty cần xem lại điều khoản |

Giới hạn 4 KB của body chỉ là kiểm tra **sau khi** nền tảng đã parse body (Vercel tự giới hạn khoảng 4,5 MB).

### 5.7 Phía client của relay

- `channels/relay.ps1`: đọc `~/.claude/notify.relay.json`; `Send-Relay -Text -Project` POST JSON UTF-8, timeout 10 giây, TLS 1.2, `-MaximumRedirection 0` (không bao giờ gửi lại khoá sang nơi khác), cắt khoảng trắng của khoá; **không bao giờ ném lỗi**, chưa cấu hình thì im lặng.
- `channels/relay-admin.ps1`: `Invoke-RelayAdmin -Action -Params` trả `{Ok, Status, Data}`; `Status` là mã HTTP, `0` khi không có phản hồi, `-1` khi chưa cấu hình admin; không bao giờ in khoá admin.
- `machine-add -Apply` suy URL relay từ URL admin (`.../api/admin` thành `.../api/notify`), ghi khoá đã mã hoá cho máy này và **không** in khoá; nếu ghi file thất bại mới in khoá (vì chỉ hiện một lần). Nếu ghi đè cấu hình relay cũ, lệnh cảnh báo rằng khoá cũ vẫn còn hiệu lực cho đến khi `machine-revoke`.
- Khoá mới của `machine-add` (không `-Apply`) được in **một lần** ra console: đừng bật `Start-Transcript` khi chạy.

## 6. Triển khai relay từng bước

Chỉ cần làm **một lần** cho cả hệ thống, rồi mỗi máy thiết lập client ([mục 6.4](#64-thiết-lập-client)).

### 6.1 Telegram

1. Chat với `@BotFather` → `/newbot` → lấy **token** (quên thì `/token`; lộ thì `/revoke`).
2. Tạo một **supergroup**, bật *Topics*, **tự tạo** một topic cho mỗi project (relay không tự tạo topic).
3. Thêm bot vào group và cấp quyền **admin**.
4. Lấy `message_thread_id` và chat id từ link: chuột phải một tin trong topic → *Copy Message Link* → `https://t.me/c/<chat>/<thread>/<message>`. `TELEGRAM_CHAT_ID` = `-100` + `<chat>`; `<thread>` là id topic. Ví dụ `t.me/c/1234567890/5/9` → chat `-1001234567890`, thread `5`. Topic General không có thread. Link dạng `t.me/c/...` chỉ có ở group **private**.
5. Thử trước khi lên Vercel (token nhập ẩn):
   ```powershell
   $s = Read-Host 'Bot token' -AsSecureString
   $t = [Net.NetworkCredential]::new('', $s).Password
   Invoke-RestMethod "https://api.telegram.org/bot$t/sendMessage" -Method Post -Body @{ chat_id = '-1001234567890'; message_thread_id = 5; text = 'thu bot' }
   ```

### 6.2 MongoDB Atlas (gói miễn phí M0)

1. Tạo tài khoản/project, *Build a Database* → **M0 Free**, chọn region gần bạn.
2. *Database Access* → Add New Database User, xác thực *Password*, mật khẩu **mạnh** (Autogenerate). Ký tự đặc biệt trong mật khẩu phải URL-encode trong chuỗi kết nối.
3. *Database User Privileges* → *Specific Privileges* → role `readWrite` trên **đúng một database** (ví dụ `claude_notify`), để trống collection. Không dùng "any database" hay `atlasAdmin`.
4. *Network Access* → Add IP Address → `0.0.0.0/0` (lý do và biện pháp bù ở [mục 5.6](#56-mô-hình-bảo-mật-và-rủi-ro)).
5. *Connect* → *Drivers* → copy `mongodb+srv://<user>:<mật khẩu>@<cluster>.mongodb.net/?retryWrites=true&w=majority`. Đây là `MONGODB_URI`.

### 6.3 Vercel

1. Import repo này, **Root Directory = `relay`**, Framework *Other*, không cần build command. Vercel tự chạy `npm install` từ `relay/package-lock.json`.
2. Settings → Environment Variables (Production): đặt các biến ở [mục 5.1](#51-biến-môi-trường-đặt-một-lần-trên-vercel), rồi Redeploy.
3. Sinh `NOTIFY_ADMIN_KEY` (PowerShell 5.1, ra 44 ký tự) và lưu vào trình quản lý mật khẩu:
   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
4. URL của relay là `https://<tên-project>.vercel.app/api/notify` (admin: `/api/admin`). Kiểm tra nhanh: GET vào `/api/notify` phải trả `405` (function sống); `500 not configured` nghĩa là thiếu hoặc sai biến môi trường (nhớ Redeploy sau khi sửa).
5. Nếu Vercel bật *Deployment Protection / Vercel Authentication* cho Production, endpoint sẽ trả trang đăng nhập (401): tắt cho Production.

### 6.4 Thiết lập client

```powershell
& "$HOME\.claude\notify-ctl.cmd" admin-setup                  # máy admin, một lần: URL .../api/admin + khoá admin (ẩn)
& "$HOME\.claude\notify-ctl.cmd" machine-add laptop -Apply    # khoá riêng cho CHÍNH máy này, tự ghi notify.relay.json
& "$HOME\.claude\notify-ctl.cmd" test
cd <thư mục project>; & "$HOME\.claude\notify-ctl.cmd" topic-add <thread_id>   # hoặc: topic-add _default <thread_id>
```

`admin-setup` huỷ file vừa lưu nếu server trả 401 (khoá admin sai).

## 7. Vận hành hằng ngày

| Việc | Cách làm |
| --- | --- |
| Thêm máy mới | máy admin: `machine-add <tên>` (khoá hiện một lần). Máy mới: `install.cmd` rồi `relay-setup` (URL `.../api/notify` + khoá đó). Máy mới **không** cần `admin-setup` |
| Thu hồi máy | `machine-revoke <tên>`; bị từ chối sau tối đa 30 giây; xem `machines` |
| Mất khoá của một máy | tên đó đã bị giữ chỗ: `machine-revoke <tên>` rồi tạo máy mới bằng tên khác |
| Thêm/sửa/xoá topic | `topic-add [project] <id>`, `topic-remove [project]`, `topics` (không cần sửa env hay redeploy) |
| Đổi mật khẩu MongoDB | đổi ở Atlas, cập nhật `MONGODB_URI` trên Vercel, Redeploy |
| Đổi khoá admin | đổi `NOTIFY_ADMIN_KEY` trên Vercel, Redeploy, chạy lại `admin-setup` |
| Đổi bot token | `/revoke` ở BotFather, cập nhật `TELEGRAM_BOT_TOKEN`, Redeploy |
| Tạm im lặng | `/notify snooze 1h` (hoặc `4h telegram`, v.v.) |
| Di chuyển repo | chạy lại `.\install.cmd` |

## 8. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| Không thấy toast | Focus Assist / Do Not Disturb đang bật; AppId chưa đăng ký | tắt Do Not Disturb; chạy `.\install.cmd -Notify`; đặt `CLAUDE_NOTIFY_DEBUG=1` rồi xem `%TEMP%\claude-notify-debug.log` để chắc hook có chạy |
| Hook không chạy | session mở trước khi cài; repo đã bị di chuyển | mở session mới; chạy lại `.\install.cmd -Notify`; gõ `/hooks` kiểm tra |
| Bấm toast thấy cmd nháy | toast mặc định của BurntToast (AppId chưa đăng ký) | chạy `.\install.cmd -Notify` |
| Có toast nhưng không có tin Telegram | chưa `relay-setup`; kênh bị snooze; lượt `Stop` ngắn hơn 60 giây | `notify-ctl.cmd status`; `/notify on`; xem `stopMinSeconds` |
| `test` báo GUI LOI | sai URL/khoá; relay chưa deploy; mạng | chạy lại `relay-setup`; kiểm tra bằng GET `/api/notify` (kỳ vọng 405) |
| Relay trả 401 | khoá sai hoặc đã thu hồi (hiệu lực trong ≤ 30 giây) | `machines` xem trạng thái; tạo khoá mới |
| Relay trả 429 | vượt 30 request/phút/máy | chờ một phút |
| Relay trả 500 | thiếu hoặc sai biến môi trường | kiểm tra [mục 5.1](#51-biến-môi-trường-đặt-một-lần-trên-vercel), Redeploy |
| Relay trả 502 | Telegram lỗi; bot chưa là admin; sai chat id | thử lại bước 6.1.5 trực tiếp với Telegram |
| Relay trả 503 | MongoDB không truy cập được (Network Access, mật khẩu, cluster M0 bị tạm dừng) | kiểm tra Atlas; toast vẫn chạy trong lúc đó |
| Tin vào General thay vì topic | project chưa map; id topic sai/đã xoá | `topics`, `topic-add` |
| `machine-add` lỗi 409 | tên đã dùng (kể cả đã thu hồi) | dùng tên khác |

## 9. Phát triển

### 9.1 Kiểm thử

- **Repo (CLAUDE.md):** không có mã ứng dụng, nên "test" là không để lọt chữ để trống vào prompt:
  ```
  bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'
  ```
  Kết quả đúng: `PASS`. Các file `docs/` bị loại có chủ ý.
- **Backend relay:** `cd relay; npm install; node --test` (Node ≥ 18, không cần mạng hay Atlas). Test dùng `fetch` giả và một MongoDB giả trong bộ nhớ (`relay/test/fake-db.js`), kèm một test quay số tới cổng không tồn tại để kiểm tra đường lỗi kết nối thật (mất khoảng 6 giây).
- **Client PowerShell:** chạy các script trong **process con** với `USERPROFILE`/`HOME` giả và một server HTTP giả, **không bao giờ** ghi vào `~/.claude` thật. Bộ test này hiện **chưa nằm trong repo** (đang ở thư mục tạm của phiên làm việc); đây là khoảng trống đã biết.
- **Kiểm tra tay** sau khi deploy: `admin-setup` và `relay-setup` tương tác (prompt ẩn), cụm Atlas thật, Vercel thật, thu hồi khoá có hiệu lực ≤ 30 giây, độ trễ cold start.

### 9.2 Quy ước và cạm bẫy đã gặp

| Chủ đề | Quy ước |
| --- | --- |
| Mã hoá file PowerShell | `hooks/notify.ps1` có tiếng Việt nên phải **UTF-8 có BOM** (bỏ BOM thì PowerShell 5.1 đọc sai); các file `.ps1` khác (`notify-ctl.ps1`, `relay.ps1`, `relay-admin.ps1`, `toast.ps1`) và mọi file JS của `relay/` chỉ chứa **ASCII** (thông báo tiếng Việt không dấu). Kiểm tra sau mỗi lần ghi file |
| `$HOME` trong PowerShell 5.1 | cố định lúc process khởi động, **không** đổi theo `$env:HOME` trong cùng process: test phải chạy trong process con |
| JSON mảng rỗng | `[]` bị biến thành `$null` khi parse: dùng `@($x \| Where-Object { $_ })`, đừng tin `.Count` của `@($null)` |
| Escape trong JS | công cụ ghi file có thể đổi `\u00b7` thành ký tự thật và làm hỏng quy ước ASCII; viết ký tự bằng `String.fromCharCode` khi cần, và kiểm tra lại. Không đưa literal U+2028/U+2029 vào regex |
| Đường dẫn Windows | đừng soạn đường dẫn có `\n`, `\t` qua chuỗi Python (`\n` thành xuống dòng) |
| Xuống dòng | một số file làm việc dùng CRLF; giữ nguyên kiểu đang dùng, đừng trộn |
| Test không đụng máy thật | mọi test client chạy với HOME giả và có chốt kiểm tra rằng các file thật trong `~/.claude` không đổi |
| Bí mật | không bao giờ commit hay dán vào chat bot token, khoá relay, khoá admin hay `MONGODB_URI` |

### 9.3 Thêm một kênh thông báo

Thêm một file `hooks/channels/<tên>.ps1` định nghĩa hàm gửi (không bao giờ ném lỗi), nạp nó trong `notify.ps1` bằng dot-source ở khối kênh tương ứng, thêm khoá vào `notify.config.json`, rồi cập nhật tài liệu này.

### 9.4 Commit

Commit nhỏ, tách backend (`relay/`) khỏi client và tài liệu; thêm file bằng đường dẫn tường minh (không `git add -A`); không commit `node_modules`, `.vercel`, hay file trạng thái trong `~/.claude`.

## 10. Quy trình `/flow` và thư mục `docs/flow`

Thay đổi lớn đi qua pipeline `/flow`: **brainstorm** (phân loại spike/bounded/architectural, hỏi các câu còn mở, trình bày thiết kế, chờ duyệt) → **plan** (subagent `planner` khảo sát code, viết kế hoạch, chờ duyệt) → **execute** (làm từng task, test trước nếu có test runner) → **verify** (subagent `verifier` chạy lệnh thật và báo PASS/FAIL, tối đa 3 vòng) → **review** (subagent `reviewer` soi lỗi logic/bảo mật mà test khó bắt, bắt buộc).

- `docs/flow/specs/<chủ-đề>-design.md`: thiết kế đã duyệt (viết tiếng Việt, thuật ngữ kỹ thuật giữ nguyên). Một chủ đề một file; thiết kế mới của cùng chủ đề được **nối thêm** thành mục có ngày, không tạo file mới.
- `docs/flow/plans/<chủ-đề>-plan.md`: kế hoạch triển khai từng task, cùng quy tắc.
- Thiết kế và kế hoạch chỉ được commit **sau khi** được duyệt; thiết kế/kế hoạch bị từ chối thì để nguyên trên đĩa, không commit.
- Hai tài liệu của relay: [specs/telegram-relay-design.md](flow/specs/telegram-relay-design.md) và [plans/telegram-relay-plan.md](flow/plans/telegram-relay-plan.md).
