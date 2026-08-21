# Thiết kế: Loop Engineering "flow" — vòng lặp brainstorm→plan→execute tự động

> Sub-project 1 của tài liệu spec gốc (`README.md`). Phạm vi: thiết kế bộ skill/command
> `flow-*` chạy toàn bộ vòng lặp brainstorm → plan → execute → verify → review trong 1 lệnh,
> tái sử dụng đúng phần logic dùng chung, tránh trùng lặp với 9 lệnh nghiệp vụ khác trong README.
>
> Không thuộc phạm vi tài liệu này: Daily briefing hub (tổng hợp Jira/Figma/Telegram/Zalo đầu
> ngày) — để lại làm sub-project riêng sau.

---

## 0. Quan hệ với superpowers plugin

Bộ `flow-*` là **code viết lại độc lập**, không gọi lại `superpowers:brainstorming` /
`superpowers:writing-plans` / `superpowers:executing-plans`, nhưng **mô phỏng đúng hành vi và
định dạng doc** của 3 skill đó (classify path, hỏi từng câu, approval gate cứng, ghi spec/plan
ra file trước khi thực thi).

Không cần gỡ superpowers plugin — các skill khác của nó (`test-driven-development`,
`systematic-debugging`, `verification-before-completion`, `using-git-worktrees`,
`receiving/requesting-code-review`, `finishing-a-development-branch`) không bị `flow-*` thay
thế và vẫn hữu ích độc lập.

---

## 1. Kiến trúc tổng thể

```
/flow [--jira ID | --file path | "mô tả text"]
        ↓
  Input adapter (xem Mục 4)
        ↓
  flow-brainstorm skill
    - đọc codebase hiện tại liên quan tới yêu cầu
    - đối chiếu yêu cầu mới với code hiện có
    - classify spike / bounded / architectural
    - hỏi từng câu CHỈ ở chỗ spec/ticket thiếu/mơ hồ
    - đề 2-3 approach (nếu architectural), đề xuất thay đổi cụ thể
    - output: design ngắn trong chat (bounded) hoặc spec file (architectural)
        ↓
   ⏸ DUYỆT #1 (người duyệt design/thay đổi đề xuất)
        ↓
  flow-plan skill
    - gọi subagent `planner` (Read/Glob/Grep only) khảo sát code hiện tại
    - sinh implementation plan chi tiết từng bước
    - ghi file docs/flow/plans/YYYY-MM-DD-<topic>-plan.md
        ↓
   ⏸ DUYỆT #2 (người duyệt plan)
        ↓
  flow-execute skill
    - chạy từng bước trong plan, TDD khi có test framework
    - không tự ý mở rộng scope ngoài plan
        ↓
  verify tự động — subagent `verifier` (Read + Bash giới hạn lệnh test/lint/build)
    - đọc lệnh test/lint/build từ CLAUDE.md project (auto-detect, không hardcode)
    - đổi FE/UI → thêm bước Playwright MCP chạy thử flow thật
        ↓
  Fail? → flow-execute tự sửa → verify lại — TỐI ĐA 3 vòng
        ↓
  Vẫn fail sau 3 lần → DỪNG, báo cáo chi tiết (bước nào fail, output lỗi cụ thể),
                        không tự đoán fix thêm
        ↓
  Pass → subagent `reviewer` (Read/Glob/Grep) — review adversarial BẮT BUỘC
          (tìm lỗi logic/bảo mật mà test không cover)
        ↓
  Báo cáo cuối: đã làm gì / verify bằng gì / kết quả pass-fail cụ thể
```

---

## 2. Vị trí file & subagent dùng chung

- Skill mới: `~/.claude/skills/flow-brainstorm/`, `~/.claude/skills/flow-plan/`,
  `~/.claude/skills/flow-execute/` — global, dùng được mọi project.
- Command orchestrator: `~/.claude/commands/flow.md`.
- Subagent dùng chung (tạo theo README mục 1.2, dùng lại nguyên):
  - `verifier` — Read, Bash (chỉ lệnh test/lint/build) — không sửa code, chỉ báo pass/fail.
  - `planner` — Read, Glob, Grep — chỉ khảo sát + lên kế hoạch, không thực thi.
  - `reviewer` — Read, Glob, Grep — review adversarial sau khi verify pass.
- Doc output: `docs/flow/specs/` (design/spec), `docs/flow/plans/` (implementation plan) —
  namespace riêng, không trùng `docs/superpowers/specs/` của plugin gốc.

---

## 3. Rà soát overlap với 9 lệnh nghiệp vụ trong README mục 3

Nguyên tắc: logic loop-retry-verify chỉ viết **một lần**, trong `flow-execute` + `verifier`.
Các lệnh nghiệp vụ là **entry point khác nhau** vào cùng pipeline, khác nhau ở chỗ bắt đầu từ
bước nào / bỏ bước nào / verify bằng gì.

| Lệnh | Quan hệ với flow-* | Ghi chú |
|---|---|---|
| `/project-init` | Độc lập | One-time bootstrap, không có loop — không tái dùng |
| `/scaffold` | Tái dùng cao | = `flow-plan` + `flow-execute` + `verifier`, **skip** `flow-brainstorm` (input đã là spec/API sẵn) |
| `/fix-feature` | Tái dùng cao | = `flow-execute` + `verifier` retry loop, **skip** brainstorm+plan (bounded, viết test tái hiện bug trước) |
| `/optimize` | Tái dùng một phần | Dùng đoạn "đề 2-3 approach, không tự chọn" của `flow-brainstorm` + `flow-execute` cho approach được chọn. Verify **không** dùng `verifier` chung — cần script đo benchmark riêng (baseline vs sau khi đổi) |
| `/playwright-test` | Tái dùng cao | = nhánh Playwright của `verifier` + retry loop của `flow-execute`, không cần brainstorm/plan |
| `/pr-description` | Độc lập | Việc 1-shot, không loop/retry |
| `/migration-safe` | Tái dùng thấp | Dùng `flow-execute` để viết migration; verify là logic riêng (shadow DB, rollback, so schema) — không dùng `verifier` chung được vì tiêu chí "xong" khác hẳn |
| `/review-pr` | Chính là subagent `reviewer` | Gọi thẳng `reviewer` độc lập, dùng để review PR không phải do `/flow` sinh ra |
| `/jira-sync` | Điểm nối 2 đầu | AC từ Jira có thể feed vào input `flow-brainstorm`; sau verify pass có thể gọi để update ticket — nhưng bản thân là command MCP riêng |

Thiết kế chi tiết từng lệnh trong bảng này (ngoài phần tái dùng đã nêu) để lại làm spec riêng
khi tới lượt — không mở rộng phạm vi tài liệu này thêm.

---

## 4. Input adapter

```
/flow --jira PROJ-123
/flow --file docs/req/new-feature.md
/flow "mô tả text thường"
```

Dùng **flag rõ ràng**, không auto-detect theo pattern (tránh đoán sai khi tên file/ticket đặc biệt).

```
Nhận flag
  ├─ --jira <ID>   → gọi MCP Jira/Atlassian (get_issue) → lấy title + description + AC
  ├─ --file <path> → đọc file (Read tool: .md/.txt/.pdf ok;
  │                   .doc/.docx KHÔNG đọc trực tiếp được — báo người convert sang .md/.pdf,
  │                   hoặc tự convert bằng pandoc nếu máy có sẵn)
  └─ text thường   → dùng nguyên văn làm mô tả
        ↓
Chuẩn hoá thành 1 khối "yêu cầu nghiệp vụ" (nguồn + nội dung + link gốc nếu có)
        ↓
flow-brainstorm nhận khối này làm input (xem Mục 1)
```

**Ràng buộc thật cần biết trước khi triển khai:**
- MCP Jira/Atlassian **chưa authorize** trên máy hiện tại — `--jira` không chạy được cho tới
  khi connect qua `/mcp` hoặc claude.ai connector settings. Không phải lỗi thiết kế, là việc
  cần làm trước khi dùng flag này.
- `.docx` không tự đọc được bằng Read tool trong harness hiện tại.

---

## 5. Nguyên tắc kế thừa từ tài liệu gốc (README mục 0)

Toàn bộ pipeline trên tuân thủ đúng 5 nguyên tắc gốc: verify bằng tool thật (không tự chấm
điểm), tách planner/executor, giới hạn retry = 3, người giữ quyền duyệt ở 2 điểm (design, plan),
không auto-hoá việc không có tiêu chí "xong" rõ ràng (`/optimize` là ví dụ — người phải tự chọn
approach, không để `flow-brainstorm` tự chọn).

---

## 6. Việc cần làm khi chuyển sang implementation plan

1. Viết 3 skill: `flow-brainstorm`, `flow-plan`, `flow-execute` tại `~/.claude/skills/`
2. Viết command `flow.md` tại `~/.claude/commands/` (orchestrator + input adapter)
3. Tạo 3 subagent `verifier.md`, `planner.md`, `reviewer.md` tại `~/.claude/agents/` (nếu README
   mục 6 bước 2 chưa làm)
4. Test end-to-end `/flow "mô tả việc nhỏ"` trên 1 project thật (bounded path, không cần MCP
   Jira) trước khi test `--jira`/`--file`
5. `--jira` cần authorize MCP Atlassian trước khi test
6. `/flow-batch` (Mục 7) triển khai sau khi `/flow` đơn lẻ chạy ổn định

---

## 7. Chạy nhiều tính năng song song — `/flow-batch`

**Insight cốt lõi:** duyệt (design + plan) là 2 điểm bắt buộc có người, **không song song hoá
được** — người chỉ đọc 1 chỗ 1 lúc. Nhưng `flow-execute` + `verifier` + `reviewer` (sau khi plan
đã duyệt) đã tự chạy autonomous sẵn trong thiết kế Mục 1, không cần người can thiệp giữa chừng —
đây là phần song song hoá được.

### 7.1 Input

```
/flow-batch --jira "PROJ-1,PROJ-2,PROJ-3"
/flow-batch --file "a.md,b.md,c.md"
/flow-batch (nhiều dòng mô tả text, mỗi dòng 1 feature)
```

Mỗi item trong batch dùng đúng input adapter ở Mục 4 (flag rõ ràng, không auto-detect).

### 7.2 Pha 1 — Brainstorm + Plan (tuần tự, có người duyệt)

Với từng feature trong batch, theo thứ tự:
`flow-brainstorm` → ⏸ duyệt #1 → `flow-plan` → ⏸ duyệt #2.

Làm lần lượt trong chat chính (không song song — người là nút thắt cổ chai có chủ đích, đúng
nguyên tắc "con người giữ quyền quyết định cuối" ở README mục 0.4). Kết thúc pha 1: N plan file
đã duyệt, mỗi file ứng với 1 feature.

### 7.3 Pha 2 — Execute (song song, tự động, cách ly)

- Mỗi feature được cấp 1 git worktree + branch riêng (tránh N feature đụng file nhau khi
  sửa chung 1 working tree).
- Dùng Workflow tool: `parallel()` N lời gọi `agent()`, mỗi agent chạy trọn
  `flow-execute` + retry loop với `verifier` (tối đa 3 vòng, đúng Mục 1) + `reviewer` bắt buộc,
  trên đúng plan đã duyệt của feature đó, `isolation: 'worktree'`.
- Không giới hạn concurrency cứng — để Workflow tool tự cap theo `min(16, CPU-2)`, feature thừa
  tự xếp hàng chờ slot trống. Phù hợp quy mô 3-5 feature nêu ra ban đầu; nếu batch lớn hơn nhiều,
  Workflow tự nhiên giãn thời gian chứ không tràn tài nguyên.
- Không dừng chờ duyệt giữa chừng trong pha này (đã duyệt xong ở Pha 1, đúng nguyên tắc chỉ
  duyệt ở 2 điểm design/plan).

### 7.4 Output

Báo cáo tổng hợp cuối: từng feature — pass/fail, verify bằng gì, branch/worktree nào chứa kết
quả. Người tự merge từng branch theo ý (dùng `superpowers:finishing-a-development-branch` cho
từng cái, không tự động merge hàng loạt).

### 7.5 Ràng buộc cần biết

- Gọi Workflow tool thật sự (không chỉ thiết kế) cần người dùng opt-in rõ bằng lời ở lượt gọi đó
  (từ khoá "ultracode", hoặc yêu cầu trực tiếp "dùng workflow/multi-agent") — đây là hành vi
  runtime của harness, không phải giới hạn thiết kế, nhưng cần nhớ khi thực thi `/flow-batch`.
- `isolation: 'worktree'` tốn thời gian setup + disk mỗi agent — hợp lý cho batch vài feature,
  không nên dùng cho batch hàng chục feature nhỏ lẻ.
