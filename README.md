# Thiết kế hệ thống Loop/Workflow cá nhân cho Claude Code

> Tài liệu này là bản spec để đưa cho Claude Code (chạy trên máy cá nhân) tự đọc và triển khai thành hệ thống thật: global CLAUDE.md, subagents, hooks, và slash commands. Mục tiêu: setup 1 lần, mọi project sau chỉ cần gõ lệnh có sẵn.
>
> **Bắt đầu nhanh:** xem [mục 1.5](#15-cài-đặt-và-đồng-bộ-qua-github-windows) để cài đặt, [mục 3](#3-danh-mục-slash-commands-menu-lệnh-dùng-hằng-ngày) để biết các lệnh. Chi tiết kỹ thuật (kiến trúc, triển khai thông báo Telegram, vận hành, xử lý sự cố, phát triển) nằm ở [docs/PROJECT.md](docs/PROJECT.md).

---

## 0. Nguyên tắc thiết kế xuyên suốt

1. **Verify độc lập, không tự chấm điểm**: mọi loop đều phải có bước kiểm tra bằng công cụ thật (test, lint, build, script) — không dựa vào việc Claude tự báo "xong".
2. **Tách planner khỏi executor**: việc lớn/rủi ro cao luôn đi qua Plan Mode trước, duyệt kế hoạch rồi mới thực thi.
3. **Giới hạn vòng lặp**: mọi loop tự sửa lỗi phải có max retry (khuyến nghị 3) để tránh chạy vô hạn.
4. **Con người giữ quyền quyết định cuối** ở 2 điểm: duyệt kế hoạch trước khi chạy việc rủi ro cao, và duyệt trước khi merge/deploy/production.
5. **Không tự động hoá việc không có tiêu chí "xong" rõ ràng** (kiến trúc, trade-off sản phẩm, UX) — những việc này chỉ nên dùng Claude để hỗ trợ, không để loop tự quyết.

---

## 1. Tầng toàn cục (setup 1 lần — áp dụng mọi project)

### 1.1 CLAUDE.md toàn cục (`~/.claude/CLAUDE.md`)

Nội dung cần có:

- Triết lý làm việc: luôn ưu tiên verify bằng test/build thật; nếu project không có test, phải đề xuất viết test trước khi refactor lớn.
- Quy tắc báo cáo: sau mỗi loop, luôn tóm tắt — đã làm gì, verify bằng cách nào, kết quả pass/fail cụ thể.
- Mức tự động mặc định: `acceptEdits` cho việc sửa nhỏ có test bảo vệ; luôn hỏi xác nhận cho: xoá file, thao tác DB, deploy, merge.
- Quy tắc dừng: không tự lặp quá 3 lần cho cùng một lỗi; nếu vẫn fail, dừng và báo cáo chi tiết cho người.

### 1.2 Subagents dùng chung (`~/.claude/agents/`)

| Subagent   | Vai trò                                                                         | Tools cho phép                  |
| ---------- | ------------------------------------------------------------------------------- | ------------------------------- |
| `verifier` | Chỉ chạy test/lint/build, không sửa code, báo cáo pass/fail khách quan          | Read, Bash (chỉ lệnh test/lint) |
| `planner`  | Chỉ lên kế hoạch, không thực thi, output là danh sách bước + rủi ro             | Read, Glob, Grep                |
| `reviewer` | Review adversarial sau khi code xong, tìm lỗi logic/bảo mật mà test không cover | Read, Glob, Grep                |

### 1.3 Hooks mặc định (`~/.claude/settings.json`)

- `PostToolUse` trên Edit/Write → tự chạy lint/format của project (đọc lệnh test từ CLAUDE.md của project đó, không hardcode).
- `PreToolUse` trên Bash → chặn các lệnh nguy hiểm (`rm -rf`, thao tác trực tiếp lên DB production, git push --force lên main).
- `SubagentStop` → log lại kết quả subagent để review sau.

### 1.4 Slash commands toàn cục (`~/.claude/commands/`)

Đây là "menu lệnh" thật sự dùng hằng ngày — chi tiết ở Mục 3.

---

### 1.5 Cài đặt và đồng bộ qua GitHub (Windows)

Toàn bộ cấu hình dùng chung (`agents/`, `commands/`, `skills/` và hệ thống thông báo) nằm trong **một repo riêng** — khuyến nghị để private. Repo này không liên quan đến repo của từng project.

**Cài đặt (một lần mỗi máy):**

```powershell
git clone <url-repo> C:\Github\MinhTQ-SDLC    # vào thư mục riêng, KHÔNG phải ~/.claude
cd C:\Github\MinhTQ-SDLC
.\install.cmd
```

Xong thì **mở session Claude Code mới** (lệnh, skill và thông báo chỉ được nạp lúc session khởi động). Lệnh cài chạy lại bao nhiêu lần cũng được, không cần quyền admin.

| Muốn | Lệnh |
| --- | --- |
| Cài tất cả (máy mới) | `.\install.cmd` |
| Chỉ nối `agents/`, `commands/`, `skills/` vào Claude Code | `.\install.cmd -Links` |
| Chỉ cài thông báo | `.\install.cmd -Notify` |
| Gỡ những gì đã cài | `.\install.cmd -Uninstall` (kèm `-Links` hoặc `-Notify` để gỡ riêng từng phần) |

**Dùng hằng ngày:**

- **Thêm hay sửa command/skill:** sửa trực tiếp trong repo rồi `git commit` và `git push` như bình thường; Claude Code thấy thay đổi ngay. Riêng **skill mới** thì chạy lại `.\install.cmd -Links` một lần để nối thêm.
- **Cài máy mới:** clone vào thư mục riêng và chạy `.\install.cmd`, không mất gì.
- **Đừng clone thẳng vào `~/.claude`** (thư mục đó chứa cache và lịch sử của Claude Code), và **đừng dùng `ln -s`** trên Windows (Git Bash chỉ copy file chứ không tạo link thật).
- **Dời repo sang thư mục khác:** chạy lại `.\install.cmd`.
- `CLAUDE.md` **riêng của từng project** (sinh ra bởi `/project-init`) nằm trong repo của project đó, không đưa vào repo này.

Chi tiết cách `install.cmd` hoạt động (junction, hook được thêm vào `settings.json`, AppId của toast...) xem [docs/PROJECT.md](docs/PROJECT.md#3-cài-đặt-installcmd).

#### Thông báo khi Claude xong hoặc cần bạn

Sau khi cài, bạn nhận được thông báo (toast Windows kèm logo Claude, không cần cấu hình gì thêm) khi:

- Claude **làm xong** một lượt.
- Claude **cần bạn quyết định** (hỏi chọn phương án, ví dụ các cổng duyệt của `/flow`) hoặc đang chờ phản hồi.

Muốn nhận cả trên **điện thoại (Telegram)** khi đi vắng thì cần thiết lập relay **một lần** (Telegram bot, MongoDB Atlas, Vercel): xem [docs/PROJECT.md, mục 6](docs/PROJECT.md#6-triển-khai-relay-từng-bước). Tin điện thoại cố ý chung chung (`Claude cần bạn đưa ra quyết định ở <project>`), và lượt `Stop` chỉ báo khi chạy từ 60 giây trở lên để khỏi spam.

**Tạm tắt hoặc bật lại** (gõ trong Claude Code hoặc terminal):

| Muốn | Trong Claude Code | Trong terminal |
| --- | --- | --- |
| Tắt tất cả 30 phút / 1 / 4 / 8 giờ | `/notify snooze 30m` (`1h`, `4h`, `8h`) | `& "$HOME\.claude\notify-ctl.cmd" snooze 1h` |
| Chỉ tắt tin điện thoại (toast vẫn hiện) | `/notify snooze 4h telegram` | `... snooze 4h telegram` |
| Chỉ tắt toast | `/notify snooze 1h toast` | `... snooze 1h toast` |
| Bật lại ngay | `/notify on` | `... on` |
| Xem trạng thái / gửi thử | `/notify status` / `/notify test` | `... status` / `... test` |

**Khi đã bật Telegram, các việc thường làm** (chạy trong terminal; các lệnh này xử lý khoá bí mật nên không có trong `/notify`):

| Việc | Lệnh |
| --- | --- |
| Nối máy này vào relay (máy admin, một lần) | `notify-ctl.cmd admin-setup` rồi `notify-ctl.cmd machine-add <tên-máy> -Apply` |
| Thêm máy khác | trên máy admin `notify-ctl.cmd machine-add <tên>` (khoá chỉ hiện **một lần**), trên máy mới `notify-ctl.cmd relay-setup` |
| Thu hồi một máy | `notify-ctl.cmd machine-revoke <tên>` (xem danh sách: `notify-ctl.cmd machines`) |
| Cho một project có topic riêng | trong thư mục project: `notify-ctl.cmd topic-add <id-topic>` (xem: `notify-ctl.cmd topics`) |

(`notify-ctl.cmd` đầy đủ là `& "$HOME\.claude\notify-ctl.cmd"`.) Thêm máy hay topic **không cần** sửa biến môi trường hay deploy lại.

**Không thấy thông báo?** Tắt *Focus Assist / Do Not Disturb* của Windows và mở session Claude Code mới. Các nguyên nhân khác và cách xử lý nằm ở [docs/PROJECT.md, mục 8](docs/PROJECT.md#8-xử-lý-sự-cố). Tinh chỉnh lâu dài (tắt hẳn một loại sự kiện, đổi ngưỡng 60 giây) trong `hooks/notify.config.json`.

---

## 2. Luồng bootstrap khi gặp project mới

```
Mở project mới trong Claude Code
        ↓
Gõ: /project-init
        ↓
Claude tự đọc: package.json/requirements.txt, cấu trúc thư mục,
test runner hiện có, CI config hiện có, convention đặt tên
        ↓
Claude tự sinh CLAUDE.md riêng cho project
  (kế thừa triết lý global, thêm: stack, lệnh test/build/lint cụ thể,
   convention riêng, các thư mục nhạy cảm không được tự sửa)
        ↓
Claude đề xuất: project này hợp dùng loop nào trong danh mục sẵn có
        ↓
Bootstrap xong — từ giờ chỉ cần gõ lệnh loop tương ứng
```

Bootstrap chỉ chạy **một lần** cho mỗi project (chạy lại khi stack thay đổi lớn).

---

## 3. Danh mục slash commands (menu lệnh dùng hằng ngày)

### `/project-init`

**Dùng khi:** bắt đầu project mới, hoặc project chưa từng bootstrap.
**Luồng:** khảo sát codebase → sinh CLAUDE.md riêng → đề xuất loop phù hợp → báo cáo tóm tắt.
**Verify:** không có verify tự động (đây là bước setup) — người đọc lại CLAUDE.md vừa sinh để xác nhận đúng.

### `/scaffold [mô tả tính năng/spec API]`

**Dùng khi:** khởi tạo FE/BE mới, hoặc dựng feature từ đầu theo API contract.
**Luồng:**

1. Plan Mode: Claude đọc spec (OpenAPI/mô tả), đề xuất cấu trúc file BE + FE + types
2. Duyệt kế hoạch
3. Thực thi: sinh BE endpoint, FE service call, types khớp nhau
4. Verify: build không lỗi, gọi thử endpoint (nếu có test integration)
   **Stop condition:** build pass là coi như xong; logic nghiệp vụ phức tạp cần người review thêm.

### `/fix-feature [tên tính năng] [mô tả bug]`

**Dùng khi:** sửa chức năng B theo bug report.
**Luồng:**

1. Đọc mô tả + steps to reproduce
2. Viết test tái hiện bug (test phải FAIL trước khi sửa — bằng chứng bug có thật)
3. Sửa code
4. Chạy lại test — phải PASS
5. Max 3 lần lặp nếu vẫn fail, sau đó dừng và báo cáo
   **Verify:** test mới viết ở bước 2, không phải Claude tự nhận xét.

### `/optimize [tên tính năng]`

**Dùng khi:** brainstorm & tối ưu (performance, cấu trúc, query...).
**Luồng:**

1. Đo baseline thật (benchmark, EXPLAIN ANALYZE, thời gian chạy...)
2. Claude đề xuất 2-3 phương án kèm trade-off, KHÔNG tự chọn 1 phương án
3. Người chọn phương án
4. Thực thi phương án đã chọn
5. Đo lại, so với baseline — chỉ giữ nếu tốt hơn, không thì revert
   **Lưu ý:** đây là loại việc "đúng" mang tính chủ quan → không auto-loop toàn bộ, chỉ auto phần đo lường + thực thi sau khi người chọn hướng.

### `/playwright-test [tên feature/flow]`

**Dùng khi:** cần test UI, hoặc vừa sửa FE cần verify bằng Playwright.
**Luồng:**

1. Nếu chưa có test cho flow này: Claude viết test case Playwright từ mô tả user flow
2. Chạy test
3. Nếu fail: đọc trace/screenshot lỗi → sửa code hoặc sửa selector → chạy lại
4. Max 3 lần lặp
   **Verify:** kết quả `playwright test` (exit code + report), không phải Claude tự đánh giá UI đẹp/xấu.

### `/pr-description`

**Dùng khi:** vừa push code, cần mô tả PR + changelog.
**Luồng:**

1. Lấy diff thật (`git diff main...branch`)
2. Claude đọc diff + commit messages, sinh PR description theo template: What changed / Why / How to test
3. Update PR qua GitHub (nếu có tool/MCP GitHub) hoặc in ra để người tự dán
   **Verify:** không auto-merge; người đọc lại mô tả trước khi publish.

### `/migration-safe [mô tả thay đổi schema]`

**Dùng khi:** cần thay đổi DB schema an toàn.
**Luồng:**

1. Claude viết migration (up + down)
2. Chạy migration UP trên DB shadow/staging (không phải production)
3. Verify data integrity (row count, FK constraints)
4. Chạy migration DOWN (rollback) trên chính DB shadow đó
5. So sánh schema sau rollback với schema ban đầu — phải khớp 100%
6. Nếu rollback fail → DỪNG NGAY, cảnh báo, không cho merge
   **Tuyệt đối không:** tự động chạy trên production, tự động drop bất cứ gì trên DB thật.

### `/review-pr` (adversarial review)

**Dùng khi:** trước khi merge, cần review độc lập với người/subagent viết code.
**Luồng:** gọi subagent `reviewer` (context sạch, không thấy quá trình viết code) → đọc diff → báo cáo vấn đề cụ thể theo checklist bảo mật/best practice trong CLAUDE.md.

### `/jira-sync` (MCP tích hợp Jira)

**Dùng khi:** cần đọc/cập nhật ticket Jira liên quan tới task đang làm.
**Yêu cầu setup:** kết nối MCP server Atlassian/Jira (qua `/mcp` hoặc cấu hình `.mcp.json` — cần connector Jira đã được xác thực trên máy).
**Luồng ví dụ:**

1. Đọc ticket Jira theo ID (mô tả, acceptance criteria)
2. Dựa trên acceptance criteria, Claude tự tạo checklist việc cần làm
3. Sau khi code xong + verify pass, tự cập nhật trạng thái/comment vào ticket Jira (báo cáo tóm tắt đã làm gì, kèm link PR)
   **Lưu ý:** không tự động chuyển ticket sang "Done" nếu chưa qua review con người — chỉ nên tự comment tiến độ hoặc chuyển sang trạng thái "In Review".

---

## 4. Vòng lặp sử dụng hằng ngày

```
Mở project (đã bootstrap) → có việc phát sinh
        ↓
Tra bảng lệnh Mục 3 → gõ đúng slash command
        ↓
Claude chạy loop nội bộ (plan → execute → verify → lặp nếu cần, tối đa 3 lần)
        ↓
Claude báo cáo: đã làm gì / verify bằng gì / kết quả cụ thể
        ↓
Người duyệt kết quả cuối (không cần duyệt từng bước nhỏ)
        ↓
Việc mới phát sinh → lặp lại từ đầu
```

---

## 5. Cơ chế tự mở rộng danh mục lệnh

Khi phát hiện 1 loop mới hữu ích ở project cụ thể nhưng chưa có trong Mục 3:

```
Phát hiện pattern lặp lại hữu ích ở project A
        ↓
Yêu cầu Claude tổng quát hoá: bỏ chi tiết đặc thù project A,
giữ lại phần logic dùng chung được
        ↓
Đẩy thành slash command mới vào ~/.claude/commands/ (toàn cục)
        ↓
Cập nhật bảng danh mục ở Mục 3 (thêm dòng mới)
        ↓
Mọi project khác từ giờ có sẵn lệnh này
```

---

## 6. Việc cần Claude Code làm ngay khi nhận tài liệu này

1. Tạo/cập nhật `~/.claude/CLAUDE.md` theo Mục 1.1
2. Tạo 3 subagent trong `~/.claude/agents/`: `verifier.md`, `planner.md`, `reviewer.md` theo Mục 1.2
3. Cấu hình hooks mặc định trong `~/.claude/settings.json` theo Mục 1.3 (hỏi người dùng lệnh lint/test mặc định muốn dùng, vì mỗi máy có thể khác)
4. Tạo các slash command trong `~/.claude/commands/` cho từng lệnh ở Mục 3: `project-init.md`, `scaffold.md`, `fix-feature.md`, `optimize.md`, `playwright-test.md`, `pr-description.md`, `migration-safe.md`, `review-pr.md`, `jira-sync.md`
5. Với `/jira-sync`: kiểm tra xem đã có MCP Jira/Atlassian connected chưa; nếu chưa, hướng dẫn người dùng cách kết nối trước khi tạo command
6. Sau khi tạo xong, chạy thử `/project-init` trên project hiện tại để kiểm tra toàn bộ hệ thống hoạt động đúng
