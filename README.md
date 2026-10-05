# MinhTQ-SDLC

Bộ công cụ cho Claude Code trên Windows, gồm hai phần:

- **Lệnh và skill** (`/flow`, `/fix-feature`, `/pr`...): quy trình làm việc có kiểm chứng độc lập (brainstorm → plan → execute → verify → review).
- **Thông báo**: báo cho bạn khi Claude làm xong hoặc cần bạn quyết định, bằng toast Windows và (tuỳ chọn) tin Telegram trên điện thoại.

Chi tiết kỹ thuật (kiến trúc, bảo mật, vận hành, xử lý sự cố, phát triển) nằm ở [docs/PROJECT.md](docs/PROJECT.md).

## Mục lục
1. [Setup](#1-setup): [1.1 Cài đặt](#11-cài-đặt-repo-mỗi-máy-một-lần) · [1.2 Thiết lập Telegram](#12-thiết-lập-thông-báo-telegram) · [1.3 Kiểm tra](#13-kiểm-tra-đã-setup-đến-đâu)
2. [Notify: dùng hằng ngày](#2-notify-dùng-hằng-ngày)
3. [Lệnh và skill](#3-lệnh-và-skill)
4. [Tài liệu khác](#4-tài-liệu-khác)

---

## 1. Setup

### 1.1 Cài đặt repo (mỗi máy một lần)

```powershell
git clone <url-repo> C:\Github\MinhTQ-SDLC    # vào thư mục riêng, KHÔNG phải ~/.claude
cd C:\Github\MinhTQ-SDLC
.\install.cmd
```

Xong thì **mở session Claude Code mới** (lệnh, skill và thông báo chỉ được nạp lúc session khởi động). Chạy lại bao nhiêu lần cũng được, không cần quyền admin.

| Muốn | Lệnh |
| --- | --- |
| Cài tất cả (máy mới) | `.\install.cmd` |
| Chỉ nối `agents/`, `commands/`, `skills/` vào Claude Code | `.\install.cmd -Links` |
| Chỉ cài thông báo (toast) | `.\install.cmd -Notify` |
| Gỡ những gì đã cài | `.\install.cmd -Uninstall` (kèm `-Links` hoặc `-Notify` để gỡ riêng) |

Cài xong là **toast Windows đã dùng được ngay**, không cần cấu hình gì thêm. Lưu ý:

- **Đừng clone thẳng vào `~/.claude`** (nơi đó chứa cache và lịch sử của Claude Code) và **đừng dùng `ln -s`** trên Windows (Git Bash chỉ copy file, không tạo link thật).
- **Dời repo sang thư mục khác:** chạy lại `.\install.cmd`.
- **Thêm skill mới vào repo:** chạy lại `.\install.cmd -Links` một lần để nối thêm. Lệnh (`commands/`) và subagent (`agents/`) mới thì Claude Code thấy ngay.

### 1.2 Thiết lập thông báo Telegram

Bước này **tuỳ chọn**: chỉ cần khi bạn muốn nhận tin trên điện thoại. Làm **một lần cho cả hệ thống** (phần A đến C), rồi mỗi máy chạy phần D hoặc E.

Hướng dẫn đầy đủ từng bước và cách xử lý lỗi: [docs/PROJECT.md, mục 6](docs/PROJECT.md#6-triển-khai-relay-từng-bước).

**A. Telegram**
1. Chat với `@BotFather` → `/newbot` → lấy **token** (đổi bằng `/revoke` nếu lỡ lộ).
2. Tạo một **supergroup**, bật *Topics*, tự tạo một topic cho mỗi project, thêm bot vào group và cho làm **admin**.
3. Chuột phải một tin trong topic → *Copy Message Link* → `https://t.me/c/<chat>/<topic>/<tin>`. Khi đó:
   - `TELEGRAM_CHAT_ID` = `-100` + `<chat>` (ví dụ `t.me/c/4495729492/2/3` thì chat id là `-1004495729492`).
   - `<topic>` (ví dụ `2`) là id topic, dùng ở bước D.

**B. MongoDB Atlas (gói miễn phí M0)**
1. Tạo cluster **M0 Free**.
2. *Database Access* → user có role `readWrite` trên **đúng một database** (ví dụ `claude_notify`), mật khẩu mạnh.
3. *Network Access* → `0.0.0.0/0` (Vercel không có IP cố định).
4. *Connect* → *Drivers* → copy chuỗi `mongodb+srv://...`. Đây là `MONGODB_URI` (coi như mật khẩu).

**C. Vercel**
1. Đẩy repo lên GitHub, rồi trong Vercel *Import* repo với **Root Directory = `relay`** (Framework: *Other*).
2. Environment Variables (Production), đặt **một lần**:

   | Biến | Giá trị |
   | --- | --- |
   | `TELEGRAM_BOT_TOKEN` | token của bot |
   | `TELEGRAM_CHAT_ID` | `-100...` ở bước A.3 |
   | `MONGODB_URI` | chuỗi kết nối ở bước B.4 |
   | `NOTIFY_ADMIN_KEY` | mật khẩu quản trị **tự sinh** (lệnh bên dưới), ≥ 32 ký tự |

   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
   Lưu chuỗi này vào trình quản lý mật khẩu; bước D cần nhập lại.
3. Deploy. Kiểm tra: mở `https://<tên-project>.vercel.app/api/notify` trong trình duyệt, phải thấy lỗi **405** (nghĩa là relay đang chạy). `500` là thiếu env; trang đăng nhập Vercel là cần tắt *Deployment Protection* cho Production.

Sau bước C, **thêm máy hay topic mới không cần sửa env hay deploy lại**.

**D. Máy admin (máy của bạn, một lần)**

```powershell
$n = "$HOME\.claude\notify-ctl.cmd"                      # viết tắt cho các lệnh bên dưới
& $n admin-setup                                         # dán URL https://<app>.vercel.app/api/admin và NOTIFY_ADMIN_KEY (gõ ẩn)
& $n machine-add laptop -Apply                           # tạo khoá riêng cho CHÍNH máy này, tự lưu
& $n test                                                # tin vào topic General vì chưa map project
cd C:\Github\MinhTQ-SDLC                                 # thư mục của một project
& $n topic-add 2                                         # map project này với topic id 2 (tên thư mục = tên project)
& $n test                                                # giờ tin vào đúng topic
```

Rồi **mở session Claude Code mới** để các hook hoạt động.

**E. Thêm máy khác (ví dụ máy công ty)**

Máy mới **không cần khoá admin**:

1. Trên **máy admin**: `& $n machine-add congty` → in ra khoá của máy đó **một lần duy nhất**, hãy copy lại.
2. Trên **máy mới**: clone repo, `.\install.cmd`, rồi `& "$HOME\.claude\notify-ctl.cmd" relay-setup` và dán URL `https://<app>.vercel.app/api/notify` cùng khoá vừa copy (gõ ẩn).
3. Topic cho project của máy đó vẫn thêm **từ máy admin**: `& $n topic-add <tên-project> <id-topic>`.

### 1.3 Kiểm tra đã setup đến đâu

```powershell
& "$HOME\.claude\notify-ctl.cmd" status
```

| Dòng báo | Nghĩa |
| --- | --- |
| `Snooze: khong (thong bao dang bat)` | thông báo đang bật |
| `Telegram (qua relay): da cau hinh (...)` | máy này đã nối relay |
| `Telegram (qua relay): chua cau hinh` | chưa chạy bước D (hoặc E) trên máy này; toast vẫn dùng được |

## 2. Notify: dùng hằng ngày

Bạn nhận thông báo khi:

- Claude **làm xong** một lượt (tin điện thoại chỉ báo lượt chạy từ **60 giây** trở lên, để khỏi spam).
- Claude **cần bạn quyết định** (hỏi chọn phương án, ví dụ các cổng duyệt của `/flow`) hoặc đang chờ phản hồi.

Tin điện thoại cố ý chung chung (`Claude cần bạn đưa ra quyết định ở <project>`): không có code hay đường dẫn.

**Tạm tắt hoặc bật lại** (gõ trong Claude Code hoặc terminal):

| Muốn | Trong Claude Code | Trong terminal |
| --- | --- | --- |
| Tắt tất cả 30 phút / 1 / 4 / 8 giờ | `/notify snooze 30m` (`1h`, `4h`, `8h`) | `& $n snooze 1h` |
| Chỉ tắt tin điện thoại (toast vẫn hiện) | `/notify snooze 4h telegram` | `& $n snooze 4h telegram` |
| Chỉ tắt toast | `/notify snooze 1h toast` | `& $n snooze 1h toast` |
| Bật lại ngay | `/notify on` | `& $n on` |
| Xem trạng thái / gửi thử | `/notify status` / `/notify test` | `& $n status` / `& $n test` |

**Quản lý máy và topic** (chỉ trong terminal, trên máy admin; các lệnh này xử lý khoá bí mật nên không có trong `/notify`):

| Việc | Lệnh |
| --- | --- |
| Thêm máy | `& $n machine-add <tên>` (khoá chỉ hiện một lần) |
| Thu hồi máy (có hiệu lực trong ≤ 30 giây) | `& $n machine-revoke <tên>` |
| Xem danh sách máy | `& $n machines` |
| Cho project có topic riêng (chạy trong thư mục project) | `& $n topic-add <id-topic>`, hoặc `& $n topic-add <tên-project> <id-topic>` |
| Bỏ / xem map topic | `& $n topic-remove [project]` / `& $n topics` |
| Topic mặc định cho project chưa map | `& $n topic-add _default <id-topic>` |

(`$n = "$HOME\.claude\notify-ctl.cmd"` như ở mục 1.2.D.) Mất khoá của một máy thì tên đó đã bị giữ chỗ: `machine-revoke <tên>` rồi tạo máy mới bằng tên khác.

**Không thấy thông báo?** Tắt *Focus Assist / Do Not Disturb* của Windows và mở session Claude Code mới. Các nguyên nhân khác: [docs/PROJECT.md, mục 8](docs/PROJECT.md#8-xử-lý-sự-cố). Tinh chỉnh lâu dài (tắt hẳn một loại sự kiện, đổi ngưỡng 60 giây) trong `hooks/notify.config.json`.

## 3. Lệnh và skill

### 3.1 Cách đưa yêu cầu vào lệnh

Phần lớn lệnh nhận yêu cầu theo một trong ba cách:

- `--jira <ID>`: lấy từ ticket Jira (cần đã kết nối MCP Jira/Atlassian).
- `--file <đường-dẫn>`: đọc từ file `.md`, `.txt` hoặc `.pdf` (file `.doc`/`.docx` phải đổi sang `.md` hoặc `.pdf` trước).
- Văn bản thường: gõ thẳng mô tả sau tên lệnh.

`/flow` và `/flow-batch` thêm được `--auto-approve` để bỏ hai cổng duyệt (thiết kế, kế hoạch); khi đó phần thực thi chạy nền trong một worktree riêng.

### 3.2 Danh mục lệnh

| Lệnh | Dùng khi | Cách gọi |
| --- | --- | --- |
| `/flow` | Làm trọn một yêu cầu: brainstorm → plan → execute → verify → review | `/flow --jira ABC-1` · `/flow --file spec.md` · `/flow <mô tả>` |
| `/flow-batch` | Làm nhiều tính năng liên tiếp; mỗi tính năng duyệt xong là chạy nền ở worktree riêng | `/flow-batch --jira "A-1,A-2"` · `--file "a.md,b.md"` · mỗi dòng một tính năng |
| `/fix-feature` | Sửa bug nhanh: viết test tái hiện (phải fail), sửa tối thiểu, rồi verify. Không có cổng duyệt | `/fix-feature --jira BUG-9` · `/fix-feature <mô tả bug + cách tái hiện>` |
| `/scaffold` | Dựng tính năng/API mới: đề xuất 2-3 hướng, bạn chọn, rồi sinh BE endpoint, FE service call và types khớp nhau | `/scaffold <mô tả tính năng>` |
| `/optimize` | Tối ưu hiệu năng/cấu trúc: đo trước, đề xuất 2-3 cách (bạn chọn), làm, đo lại và giữ hoặc hoàn tác theo kết quả | `/optimize <đối tượng cần tối ưu>` |
| `/playwright-test` | Viết (hoặc dùng lại) test Playwright cho một luồng UI, chạy và sửa đến khi pass | `/playwright-test <mô tả luồng>` |
| `/migration-safe` | Viết migration (up + down), chạy thử trên DB shadow/staging (**không bao giờ production**), kiểm tra dữ liệu, rollback và xác nhận schema về đúng như cũ | `/migration-safe <mô tả thay đổi schema>` |
| `/pr` | Sinh mô tả PR (What / Why / How to test) từ git diff thật, chờ bạn duyệt rồi đăng bằng `gh` | `/pr` (so với `main`) · `/pr <nhánh-gốc>` · `/pr --batch --target <nhánh>` |
| `/jira-sync` | Đọc ticket để tạo checklist, hoặc đăng bình luận tiến độ (và chuyển "In Review", không bao giờ "Done") | `/jira-sync --read <ID>` · `/jira-sync --update <ID> --pr <url>` |
| `/loop-engineer` | Chạy không người trực theo lịch: lấy N ticket qua JQL, tự duyệt việc nhỏ rõ ràng, làm ở worktree riêng, việc lớn hoặc mơ hồ thì để lại cho người, và có báo cáo buổi sáng. Không bao giờ merge | `/loop-engineer --mode <sequential\|parallel> --count <N>` |
| `/notify` | Tạm tắt/bật thông báo, xem trạng thái | xem [mục 2](#2-notify-dùng-hằng-ngày) |

Điểm chung của các lệnh: kết quả kiểm chứng do **công cụ thật** (test, build, lệnh ghi trong `CLAUDE.md` của project) và subagent `verifier` quyết định, không phải Claude tự nhận xét; tự sửa lỗi tối đa 3 vòng; các lệnh dừng chờ bạn ở những điểm quyết định (duyệt thiết kế hoặc kế hoạch, chọn phương án, duyệt mô tả PR). `/pr` và `/loop-engineer` không bao giờ tự merge.

### 3.3 Pipeline `/flow`

```
brainstorm ──(bạn duyệt thiết kế)──► plan ──(bạn duyệt kế hoạch)──► execute ──► verify (≤ 3 vòng) ──► review
```

| Bước | Skill / subagent | Làm gì |
| --- | --- | --- |
| Brainstorm | skill `flow-brainstorm` | đọc code, phân loại spike / bounded / architectural, hỏi các câu còn mở, đề xuất thiết kế |
| Plan | skill `flow-plan` + subagent `planner` | khảo sát code thật, viết kế hoạch từng task |
| Execute | skill `flow-execute` | làm từng task (test trước nếu project có test runner), không làm ngoài kế hoạch |
| Verify | subagent `verifier` | chạy lệnh test/lint/build thật của project và báo PASS/FAIL khách quan; không sửa code |
| Review | subagent `reviewer` | soi lỗi logic/bảo mật mà test khó bắt; bắt buộc sau khi verify PASS |

Thiết kế và kế hoạch của các thay đổi lớn được lưu ở `docs/flow/specs/` và `docs/flow/plans/`.

### 3.4 Thêm lệnh hoặc skill mới

- **Lệnh:** thêm `commands/<tên>.md` (Claude Code thấy ngay).
- **Skill:** thêm `skills/<tên>/SKILL.md`, rồi chạy `.\install.cmd -Links` một lần.
- **Subagent:** thêm `agents/<tên>.md`.
- Trước khi commit chạy test của repo, kỳ vọng `PASS`:
  ```
  bash -c 'grep -rniE "TBD|todo:|fill in|placeholder" commands/*.md skills/*/SKILL.md agents/*.md && echo FAIL && exit 1 || echo PASS'
  ```
- Sửa xong thì `git commit` và `git push` như bình thường.

## 4. Tài liệu khác

- [docs/PROJECT.md](docs/PROJECT.md): kiến trúc, cách `install.cmd` hoạt động, hệ thống thông báo, relay (API, bảo mật), triển khai từng bước, vận hành, xử lý sự cố, quy ước phát triển.
- `docs/flow/specs/`, `docs/flow/plans/`: thiết kế và kế hoạch do pipeline `/flow` tạo ra.
- `CLAUDE.md` **riêng của từng project** (nếu có) nằm trong repo của project đó, không đưa vào repo này.
