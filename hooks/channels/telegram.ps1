# Channel: Telegram. Dot-sourced by notify.ps1 and notify-ctl.ps1.
# One supergroup with Topics; YOU create the topics, the bot only posts into them.
#   - Credentials (token + chat_id) live OUTSIDE the repo in ~/.claude/notify.telegram.json; the token is
#     DPAPI-encrypted (readable only by this Windows user on this machine). Create it: notify-ctl.cmd telegram-setup
#   - The project -> topic map is NOT secret and lives IN the repo (hooks/notify.topics.json) so every machine
#     shares it. Manage it with: notify-ctl.cmd topic-add | topic-detect | topic-remove | topics
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:TgFile     = Join-Path (Join-Path $HOME '.claude') 'notify.telegram.json'
$script:TopicsFile = if ($env:CLAUDE_NOTIFY_TOPICS_FILE) { $env:CLAUDE_NOTIFY_TOPICS_FILE } else { Join-Path (Split-Path $PSScriptRoot -Parent) 'notify.topics.json' }

function Get-TgApiBase { if ($env:CLAUDE_TG_API) { $env:CLAUDE_TG_API } else { 'https://api.telegram.org' } }

function Get-TgConfig {
    if (-not (Test-Path -LiteralPath $script:TgFile)) { return $null }
    $cfg = Get-Content -LiteralPath $script:TgFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $cfg.token_enc -or -not $cfg.chat_id) { return $null }
    return $cfg
}

function Save-TgConfig($cfg) {
    $json = $cfg | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($script:TgFile, $json, (New-Object Text.UTF8Encoding($false)))
}

# Topic map: { "<project folder name>": <message_thread_id>, "_default": <id> }  ("_default" is optional)
function Get-TgTopics {
    $map = [ordered]@{}
    if (Test-Path -LiteralPath $script:TopicsFile) {
        try { (Get-Content -LiteralPath $script:TopicsFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $map[$_.Name] = $_.Value } } catch { }
    }
    return $map
}

function Save-TgTopics($map) {
    $json = ([pscustomobject]$map) | ConvertTo-Json
    if (-not $map.Count) { $json = '{}' }
    [IO.File]::WriteAllText($script:TopicsFile, $json, (New-Object Text.UTF8Encoding($false)))
}

function Protect-TgToken([securestring]$Secure) { return ($Secure | ConvertFrom-SecureString) }

function Unprotect-TgToken([string]$Encrypted) {
    $secure = $Encrypted | ConvertTo-SecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Invoke-Tg {
    param([string]$Token, [string]$Method, [hashtable]$Body = @{})
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress))
    Invoke-RestMethod -Uri "$(Get-TgApiBase)/bot$Token/$Method" -Method Post `
        -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 10
}

# Sends $Text into the project's topic (else "_default", else the group's General topic). Returns $true on success. Never throws.
function Send-Telegram {
    param([string]$Text, [string]$Project)
    try {
        $cfg = Get-TgConfig
        if (-not $cfg) { return $false }
        $token  = Unprotect-TgToken $cfg.token_enc
        $topics = Get-TgTopics
        $thread = if ($Project -and $topics.Contains($Project)) { $topics[$Project] } elseif ($topics.Contains('_default')) { $topics['_default'] } else { $null }

        $body = @{ chat_id = $cfg.chat_id; text = $Text }
        if ($thread) { $body.message_thread_id = [int]$thread }
        try {
            [void](Invoke-Tg $token 'sendMessage' $body)
        } catch {
            if (-not $thread) { throw }
            # Topic id is stale (topic deleted/closed): post to the General topic this once so the message is not lost.
            $body.Remove('message_thread_id'); [void](Invoke-Tg $token 'sendMessage' $body)
        }
        return $true
    } catch { return $false }
}
