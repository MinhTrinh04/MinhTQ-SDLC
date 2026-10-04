# Claude Code hook -> Windows toast (BurntToast). Wired to Stop + Notification by install.ps1.
# Reads the hook JSON from stdin; never fails the hook (always exit 0).
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$data = $null
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw) { $data = $raw | ConvertFrom-Json }
} catch { }

$event   = if ($data -and $data.hook_event_name) { $data.hook_event_name } else { 'Stop' }
$project = if ($data -and $data.cwd) { Split-Path $data.cwd -Leaf } else { '' }

if ($event -eq 'Notification') {
    $title = 'Claude Code cần bạn'
    $body  = if ($data.message) { $data.message } else { 'Claude đang chờ phản hồi.' }
} else {
    $title = 'Claude Code'
    $body  = 'Tác vụ đã hoàn thành!'
}
if ($project) { $title = "$title - $project" }

Import-Module BurntToast
$logo = Join-Path $PSScriptRoot 'claude-logo.png'
if (Test-Path -LiteralPath $logo) {
    New-BurntToastNotification -Text $title, $body -AppLogo $logo
} else {
    New-BurntToastNotification -Text $title, $body
}
exit 0
