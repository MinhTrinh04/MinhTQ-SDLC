# Claude Code hook dispatcher. Wired by install.ps1 to: Stop, Notification, PreToolUse(AskUserQuestion), UserPromptSubmit.
# Turns the hook payload into a message and fans it out to the enabled channels (channels\*.ps1),
# honouring notify.config.json, the snooze (notify-ctl.cmd snooze ...) and the Stop duration threshold.
# Reads the hook JSON from stdin; never fails the hook (always exits 0).
# Debug: set CLAUDE_NOTIFY_DEBUG=1 to append every raw payload to %TEMP%\claude-notify-debug.log.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$stateDir = Join-Path $HOME '.claude'
$turnsDir = Join-Path $stateDir 'notify.turns'

$data = $null
try {
    $raw = [Console]::In.ReadToEnd()
    if ($raw) { $data = $raw | ConvertFrom-Json }
    if ($env:CLAUDE_NOTIFY_DEBUG) {
        Add-Content -Path (Join-Path $env:TEMP 'claude-notify-debug.log') -Value "$(Get-Date -Format o) $raw" -Encoding UTF8
    }
} catch { }

$hookEvent = if ($data -and $data.hook_event_name) { $data.hook_event_name } else { 'Stop' }
$sessionId = if ($data -and $data.session_id) { [string]$data.session_id } else { '' }

# A new prompt starts a turn: remember when, so Stop can tell short turns from long ones.
if ($hookEvent -eq 'UserPromptSubmit') {
    if ($sessionId) {
        New-Item -ItemType Directory -Force -Path $turnsDir | Out-Null
        Set-Content -Path (Join-Path $turnsDir "$sessionId.txt") -Value ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    }
    exit 0
}

# Project dir: hook payload cwd, else the env var Claude sets for hooks, else the hook's own working dir.
$cwd = if ($data -and $data.cwd) { [string]$data.cwd } elseif ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
$project = Split-Path $cwd -Leaf

# Message kind + texts. Toast shows detail; Telegram stays deliberately generic (no code/paths leave the machine).
$kind = $null; $elapsed = $null
if ($hookEvent -eq 'PreToolUse') {
    $kind  = 'AskUserQuestion'
    $q     = @($data.tool_input.questions)[0]
    $title = 'Claude cần bạn quyết định'
    $body  = if ($q.question) { [string]$q.question } else { 'Claude đang hỏi bạn một câu.' }
    $opts  = @($q.options | ForEach-Object { $_.label }) -join ' | '
    if ($opts) { $body = "$body`n$opts" }
    $tgText = "Claude cần bạn đưa ra quyết định ở $project"
} elseif ($hookEvent -eq 'Notification') {
    $kind  = 'Notification'
    $title = 'Claude Code cần bạn'
    $body  = if ($data.message) { [string]$data.message } else { 'Claude đang chờ phản hồi.' }
    $tgText = "Claude đang chờ bạn ở $project"
} else {
    $kind  = 'Stop'
    $title = 'Claude Code'
    $body  = 'Tác vụ đã hoàn thành!'
    $turnFile = Join-Path $turnsDir "$sessionId.txt"
    if ($sessionId -and (Test-Path -LiteralPath $turnFile)) {
        $elapsed = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [int64](Get-Content -LiteralPath $turnFile -Raw)
        Remove-Item -LiteralPath $turnFile -Force
    }
    $tgText = "Claude đã xong ở $project" + $(if ($null -ne $elapsed) { " ($([math]::Floor($elapsed / 60)) phút $($elapsed % 60) giây)" } else { '' })
    # Opportunistic cleanup of turn files left behind by sessions that never reached Stop.
    Get-ChildItem $turnsDir -Filter *.txt | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-2) } | Remove-Item -Force
}
if ($project) { $title = "$title - $project" }

# Config (events + channels). Missing/broken file -> everything on with defaults.
$cfg = $null
try { $cfg = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'notify.config.json') -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
if ($cfg -and $cfg.events -and $cfg.events.PSObject.Properties[$kind] -and -not $cfg.events.$kind) { exit 0 }

# Snooze: notify-ctl.cmd snooze <30m|1h|4h|8h> [toast|telegram|all]
$snoozed = @()
try {
    $sn = Get-Content -LiteralPath (Join-Path $stateDir 'notify.snooze.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($sn -and ([DateTimeOffset]::Parse($sn.until) -gt [DateTimeOffset]::Now)) { $snoozed = @($sn.channels) }
} catch { }

function Test-ChannelOn([string]$name, [int]$defaultStopMin) {
    if ($snoozed -contains 'all' -or $snoozed -contains $name) { return $false }
    $c = if ($cfg -and $cfg.channels) { $cfg.channels.$name } else { $null }
    if ($c -and $c.PSObject.Properties['enabled'] -and -not $c.enabled) { return $false }
    if ($kind -eq 'Stop' -and $null -ne $elapsed) {
        $min = if ($c -and $c.PSObject.Properties['stopMinSeconds']) { [int]$c.stopMinSeconds } else { $defaultStopMin }
        if ($elapsed -lt $min) { return $false }
    }
    return $true
}

if (Test-ChannelOn 'toast' 0) {
    . (Join-Path $PSScriptRoot 'channels\toast.ps1')
    try { Send-Toast -Title $title -Body $body } catch { }
}
if (Test-ChannelOn 'telegram' 60) {
    . (Join-Path $PSScriptRoot 'channels\telegram.ps1')
    [void](Send-Telegram -Text $tgText -Project $project)
}
exit 0
