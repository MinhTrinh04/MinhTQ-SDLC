# Claude Code hook -> Windows toast (BurntToast). Wired to Stop + Notification + PreToolUse(AskUserQuestion) by install.ps1.
# Reads the hook JSON from stdin; never fails the hook (always exits 0).
# Debug: set CLAUDE_NOTIFY_DEBUG=1 to append every raw payload to %TEMP%\claude-notify-debug.log.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$data = $null
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw) { $data = $raw | ConvertFrom-Json }
    if ($env:CLAUDE_NOTIFY_DEBUG) {
        Add-Content -Path (Join-Path $env:TEMP 'claude-notify-debug.log') -Value "$(Get-Date -Format o) $raw" -Encoding UTF8
    }
} catch { }

$hookEvent = if ($data -and $data.hook_event_name) { $data.hook_event_name } else { 'Stop' }
# Project dir: hook payload cwd, else the env var Claude sets for hooks, else the hook's own working dir.
$cwd = if ($data -and $data.cwd) { [string]$data.cwd } elseif ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$project = Split-Path $cwd -Leaf

if ($hookEvent -eq 'PreToolUse') {
    # AskUserQuestion: show the first question and its option labels.
    $q = @($data.tool_input.questions)[0]
    $title = 'Claude cần bạn quyết định'
    $body  = if ($q.question) { [string]$q.question } else { 'Claude đang hỏi bạn một câu.' }
    $opts  = @($q.options | ForEach-Object { $_.label }) -join ' | '
    if ($opts) { $body = "$body`n$opts" }
} elseif ($hookEvent -eq 'Notification') {
    $title = 'Claude Code cần bạn'
    $body  = if ($data.message) { $data.message } else { 'Claude đang chờ phản hồi.' }
} else {
    $title = 'Claude Code'
    $body  = 'Tác vụ đã hoàn thành!'
}
if ($project) { $title = "$title - $project" }

Import-Module BurntToast
$logo = Join-Path $PSScriptRoot 'claude-logo.png'
$appId = 'Claude.Code.Notify'   # registered by install.ps1 (Register-ToastApp); no exe behind it, so a click launches nothing
if (Test-Path "HKCU:\Software\Classes\AppUserModelId\$appId") {
    # BurntToast 1.1.0 cannot set an AppId, so send through the Windows toast API directly.
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
    [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
    $esc  = { param($s) [Security.SecurityElement]::Escape([string]$s) }
    $img  = if (Test-Path -LiteralPath $logo) { "<image placement=`"appLogoOverride`" src=`"file:///$($logo -replace '\\', '/')`"/>" } else { '' }
    $doc  = New-Object Windows.Data.Xml.Dom.XmlDocument
    $doc.LoadXml("<toast><visual><binding template=`"ToastGeneric`">$img<text>$(& $esc $title)</text><text>$(& $esc $body)</text></binding></visual></toast>")
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($doc))
} elseif (Test-Path -LiteralPath $logo) {
    New-BurntToastNotification -Text $title, $body -AppLogo $logo
} else {
    New-BurntToastNotification -Text $title, $body
}
exit 0
