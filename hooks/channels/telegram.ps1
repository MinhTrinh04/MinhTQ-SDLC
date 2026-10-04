# Channel: Telegram. Dot-sourced by notify.ps1 and notify-ctl.ps1.
# One forum-enabled supergroup, one topic per project (created on first message).
# Credentials live OUTSIDE the repo in ~/.claude/notify.telegram.json; the token is DPAPI-encrypted
# (readable only by this Windows user). Create it with: notify-ctl.cmd telegram-setup
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:TgFile = Join-Path (Join-Path $HOME '.claude') 'notify.telegram.json'

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

# Sends $Text into the project's topic (created on first use). Returns $true on success. Never throws.
function Send-Telegram {
    param([string]$Text, [string]$Project)
    try {
        $cfg = Get-TgConfig
        if (-not $cfg) { return $false }
        $token = Unprotect-TgToken $cfg.token_enc
        if (-not $cfg.PSObject.Properties['topics']) { $cfg | Add-Member -NotePropertyName topics -NotePropertyValue ([pscustomobject]@{}) }

        $thread = $null
        if ($Project -and $cfg.topics.PSObject.Properties[$Project]) { $thread = $cfg.topics.$Project }
        if ($Project -and -not $thread) {
            try {
                $r = Invoke-Tg $token 'createForumTopic' @{ chat_id = $cfg.chat_id; name = $Project }
                $thread = $r.result.message_thread_id
                $cfg.topics | Add-Member -Force -NotePropertyName $Project -NotePropertyValue $thread
                Save-TgConfig $cfg
            } catch { $thread = $null }   # group without Topics: post in the main chat instead
        }

        $body = @{ chat_id = $cfg.chat_id; text = $Text }
        if ($thread) { $body.message_thread_id = $thread }
        try {
            [void](Invoke-Tg $token 'sendMessage' $body)
        } catch {
            if (-not $thread) { throw }
            # Topic was deleted in Telegram: forget it and post to the main chat this once.
            $cfg.topics.PSObject.Properties.Remove($Project); Save-TgConfig $cfg
            $body.Remove('message_thread_id'); [void](Invoke-Tg $token 'sendMessage' $body)
        }
        return $true
    } catch { return $false }
}
