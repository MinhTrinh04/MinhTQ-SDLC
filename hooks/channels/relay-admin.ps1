# Channel helper: relay admin API (machine keys + topic map). Dot-sourced by notify-ctl.ps1. ASCII only.
# Config: ~/.claude/notify.admin.json = { "url": "https://<app>.vercel.app/api/admin", "key_enc": "<DPAPI string>" }
# The admin key is DPAPI-encrypted (this Windows user, this machine) and is never printed.
. (Join-Path $PSScriptRoot 'relay.ps1')   # Protect-RelayKey / Unprotect-RelayKey, TLS 1.2

$script:AdminFile = Join-Path (Join-Path $HOME '.claude') 'notify.admin.json'

function Get-AdminConfig {
    try {
        if (-not (Test-Path -LiteralPath $script:AdminFile)) { return $null }
        $cfg = Get-Content -LiteralPath $script:AdminFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if (-not $cfg.url -or -not $cfg.key_enc) { return $null }
        return $cfg
    } catch { return $null }
}

function Save-AdminConfig($cfg) {
    $json = $cfg | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText($script:AdminFile, $json, (New-Object Text.UTF8Encoding($false)))
}

# POSTs { action, ...Params } to the admin endpoint. Never throws; never prints the key.
function Invoke-RelayAdmin {
    param([string]$Action, [hashtable]$Params = @{})
    $cfg = Get-AdminConfig
    if (-not $cfg) { return [pscustomobject]@{ Ok = $false; Status = -1; Data = $null } }
    try {
        $key = (Unprotect-RelayKey $cfg.key_enc).Trim()
        $payload = @{ action = $Action }
        foreach ($k in $Params.Keys) { $payload[$k] = $Params[$k] }
        $bytes = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Compress))
        $data = Invoke-RestMethod -Uri $cfg.url -Method Post -Headers @{ Authorization = "Bearer $key" } `
            -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 10 -MaximumRedirection 0   # no redirects: never re-send the key elsewhere
        return [pscustomobject]@{ Ok = $true; Status = 200; Data = $data }
    } catch {
        $status = 0
        try { if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode } } catch { }
        return [pscustomobject]@{ Ok = $false; Status = $status; Data = $null }
    }
}
