# Control script for the notification system. Run through the shim install.ps1 writes: ~\.claude\notify-ctl.cmd
#   notify-ctl.cmd snooze <30m|1h|4h|8h> [all|toast|telegram]   mute notifications for a while (default: all channels)
#   notify-ctl.cmd on                                           cancel the snooze
#   notify-ctl.cmd status                                       show snooze + relay state
#   notify-ctl.cmd test                                         send a test notification to every enabled channel
#   notify-ctl.cmd relay-setup [-Url <url>]                     one-time per machine: save the relay URL + this machine's key (key is asked, never echoed)
param(
    [Parameter(Position = 0)][string]$Command = 'status',
    [Parameter(Position = 1)][string]$Arg1,
    [Parameter(Position = 2)][string]$Arg2,
    [string]$Url
)
$ErrorActionPreference = 'Stop'
$stateDir  = Join-Path $HOME '.claude'
$snoozeFile = Join-Path $stateDir 'notify.snooze.json'
. (Join-Path $PSScriptRoot 'channels\relay.ps1')

function Get-Snooze {
    if (-not (Test-Path -LiteralPath $snoozeFile)) { return $null }
    try {
        $s = Get-Content -LiteralPath $snoozeFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([DateTimeOffset]::Parse($s.until) -gt [DateTimeOffset]::Now) { return $s }
    } catch { }
    return $null
}

function Show-Status {
    $s = Get-Snooze
    if ($s) {
        $left = [DateTimeOffset]::Parse($s.until) - [DateTimeOffset]::Now
        Write-Host ("Snooze: DANG TAT ({0}) - con {1}h{2:00}m, den {3:HH:mm dd/MM}" -f ($s.channels -join ', '), [math]::Floor($left.TotalHours), $left.Minutes, [DateTimeOffset]::Parse($s.until).LocalDateTime)
    } else { Write-Host 'Snooze: khong (thong bao dang bat)' }
    $rc = Get-RelayConfig
    if ($rc) {
        Write-Host "Telegram (qua relay): da cau hinh ($(([Uri]$rc.url).Host))"
    } else { Write-Host 'Telegram (qua relay): chua cau hinh - chay: notify-ctl.cmd relay-setup' }
}

switch ($Command) {
    'snooze' {
        $mins = @{ '30m' = 30; '1h' = 60; '4h' = 240; '8h' = 480 }[$Arg1]
        if (-not $mins) { Write-Host 'Dung: snooze <30m|1h|4h|8h> [all|toast|telegram]'; exit 1 }
        $ch = if ($Arg2) { $Arg2.ToLower() } else { 'all' }
        if ($ch -notin 'all', 'toast', 'telegram') { Write-Host 'Kenh phai la all, toast hoac telegram'; exit 1 }
        $until = [DateTimeOffset]::Now.AddMinutes($mins)
        $json = [pscustomobject]@{ until = $until.ToString('o'); channels = @($ch) } | ConvertTo-Json
        [IO.File]::WriteAllText($snoozeFile, $json, (New-Object Text.UTF8Encoding($false)))
        Write-Host ("Da tat thong bao ({0}) trong {1} - den {2:HH:mm dd/MM}. Bat lai som: notify-ctl.cmd on" -f $ch, $Arg1, $until.LocalDateTime)
    }
    'on' {
        Remove-Item -LiteralPath $snoozeFile -Force -ErrorAction SilentlyContinue
        Write-Host 'Da bat lai thong bao.'
    }
    'status' { Show-Status }
    'test' {
        $project = Split-Path (Get-Location).Path -Leaf
        . (Join-Path $PSScriptRoot 'channels\toast.ps1')
        try { Send-Toast -Title "Claude Code - $project" -Body 'Thong bao thu (toast)' ; Write-Host 'toast: da gui' } catch { Write-Host "toast: loi $_" }
        if (Get-RelayConfig) {
            if (Send-Relay -Text "Thong bao thu tu $project" -Project $project) { Write-Host 'telegram: da gui (qua relay)' } else { Write-Host 'telegram: GUI LOI (kiem tra mang/URL relay/khoa; chay lai relay-setup neu doi khoa)' }
        } else { Write-Host 'telegram: chua cau hinh relay' }
    }
    'relay-setup' {
        if (-not $Url) { $Url = Read-Host 'Dan URL relay (vd https://<app>.vercel.app/api/notify)' }
        $Url = $Url.Trim()
        $uri = $null
        if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin 'https', 'http') { Write-Host 'URL khong hop le.'; exit 1 }
        if ($uri.Scheme -ne 'https' -and $uri.Host -notin '127.0.0.1', 'localhost') { Write-Host 'URL phai la https (http chi cho phep voi localhost).'; exit 1 }
        $secure = Read-Host 'Dan khoa cua may nay (NOTIFY_KEYS tren Vercel; se khong hien tren man hinh)' -AsSecureString
        if ($secure.Length -lt 32) { Write-Host 'Khoa phai tu 32 ky tu tro len.'; exit 1 }
        Save-RelayConfig ([pscustomobject]@{ url = $Url; key_enc = (Protect-RelayKey $secure) })
        Write-Host "Da luu cau hinh vao $script:RelayFile (khoa ma hoa theo tai khoan Windows, KHONG nam trong repo)."
        $old = Join-Path $stateDir 'notify.telegram.json'
        if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force; Write-Host 'Da xoa notify.telegram.json cu (bot token khong con dung o may nay).' }
        $project = Split-Path (Get-Location).Path -Leaf
        if (Send-Relay -Text 'Da ket noi Claude Code notify.' -Project $project) { Write-Host 'Da gui tin thu qua relay.' } else { Write-Warning 'Gui tin thu that bai - kiem tra URL, khoa, va relay da deploy chua.' }
    }
    default { Write-Host "Lenh khong ro: $Command. Dung: snooze | on | status | test | relay-setup"; exit 1 }
}
