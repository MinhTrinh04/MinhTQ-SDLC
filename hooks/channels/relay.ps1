# Channel: relay (phone notifications). Dot-sourced by notify.ps1 and notify-ctl.ps1.
# The bot token lives only on the Vercel relay (see relay/). This machine keeps just a per-machine relay key,
# DPAPI-encrypted (readable only by this Windows user on this machine), in ~/.claude/notify.relay.json:
#   { "url": "https://<app>.vercel.app/api/notify", "key_enc": "<DPAPI string>" }
# Create it with: notify-ctl.cmd relay-setup
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:RelayFile = Join-Path (Join-Path $HOME '.claude') 'notify.relay.json'

function Get-RelayConfig {
    try {
        if (-not (Test-Path -LiteralPath $script:RelayFile)) { return $null }
        $cfg = Get-Content -LiteralPath $script:RelayFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $cfg.url -or -not $cfg.key_enc) { return $null }
        return $cfg
    } catch { return $null }
}

function Save-RelayConfig($cfg) {
    $json = $cfg | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($script:RelayFile, $json, (New-Object Text.UTF8Encoding($false)))
}

function Protect-RelayKey([securestring]$Secure) { return ($Secure | ConvertFrom-SecureString) }

function Unprotect-RelayKey([string]$Encrypted) {
    $secure = $Encrypted | ConvertTo-SecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# POSTs {project,text} to the relay. Returns $true on success. Never throws; silent when not configured.
function Send-Relay {
    param([string]$Text, [string]$Project)
    try {
        $cfg = Get-RelayConfig
        if (-not $cfg) { return $false }
        $key = (Unprotect-RelayKey $cfg.key_enc).Trim()   # a pasted key often carries a trailing space/newline
        $bytes = [Text.Encoding]::UTF8.GetBytes((@{ project = $Project; text = $Text } | ConvertTo-Json -Compress))
        [void](Invoke-RestMethod -Uri $cfg.url -Method Post -Headers @{ Authorization = "Bearer $key" } `
            -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 10 -MaximumRedirection 0)   # no redirects: never re-send the key elsewhere
        return $true
    } catch { return $false }
}
