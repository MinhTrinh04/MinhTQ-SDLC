# Control script for the notification system. Run through the shim install.ps1 writes: ~\.claude\notify-ctl.cmd
#   notify-ctl.cmd snooze <30m|1h|4h|8h> [all|toast|telegram]   mute notifications for a while (default: all channels)
#   notify-ctl.cmd on                                           cancel the snooze
#   notify-ctl.cmd status                                       show snooze + relay state
#   notify-ctl.cmd test                                         send a test notification to every enabled channel
#   notify-ctl.cmd relay-setup [-Url <url>]                     one-time per machine: save the relay URL + this machine's key (key is asked, never echoed)
#   notify-ctl.cmd admin-setup [-Url <url>]                     one-time on the admin machine: save the admin URL + admin key (key is asked, never echoed)
#   notify-ctl.cmd machine-add <name> [-Apply]                  create a machine key (shown ONCE); -Apply stores it for THIS machine
#   notify-ctl.cmd machine-revoke <name>                        revoke a machine key (effective within ~30 s)
#   notify-ctl.cmd machines                                     list machines
#   notify-ctl.cmd topic-add [project] <thread_id>              map a project (default: current folder name; _default allowed) to a topic
#   notify-ctl.cmd topic-remove [project]                       remove a mapping
#   notify-ctl.cmd topics                                       list mappings
param(
    [Parameter(Position = 0)][string]$Command = 'status',
    [Parameter(Position = 1)][string]$Arg1,
    [Parameter(Position = 2)][string]$Arg2,
    [string]$Url,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$stateDir  = Join-Path $HOME '.claude'
$snoozeFile = Join-Path $stateDir 'notify.snooze.json'
. (Join-Path $PSScriptRoot 'channels\relay.ps1')
. (Join-Path $PSScriptRoot 'channels\relay-admin.ps1')

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

function Test-RelayUrl([string]$u) { # https only (http allowed for localhost)
    $uri = $null
    if (-not [Uri]::TryCreate($u, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -notin 'https', 'http') { Write-Host 'URL khong hop le.'; return $false }
    if ($uri.Scheme -ne 'https' -and $uri.Host -notin '127.0.0.1', 'localhost') { Write-Host 'URL phai la https (http chi cho phep voi localhost).'; return $false }
    return $true
}

function Get-RelayUrlFromAdmin([string]$adminUrl) { # .../api/admin -> .../api/notify, or $null
    if ($adminUrl -match '/api/admin/?$') { return ($adminUrl -replace '/api/admin/?$', '/api/notify') }
    return $null
}

function Require-Admin { # exits when admin-setup has not been run
    if (-not (Get-AdminConfig)) { Write-Host 'Chua cau hinh admin - chay truoc: notify-ctl.cmd admin-setup'; exit 1 }
}

function Show-AdminError($r, [string]$what) {
    switch ($r.Status) {
        0   { Write-Host "$what that bai: khong ket noi duoc toi admin endpoint (kiem tra mang/URL)." }
        401 { Write-Host "$what that bai: khoa admin sai (chay lai admin-setup)." }
        404 { Write-Host "$what that bai: khong tim thay." }
        409 { Write-Host "$what that bai: ten da ton tai." }
        429 { Write-Host "$what that bai: qua nhieu request, thu lai sau 1 phut." }
        503 { Write-Host "$what that bai: kho du lieu (MongoDB) khong san sang." }
        default { Write-Host "$what that bai: HTTP $($r.Status)." }
    }
}

function Get-ProjectName([string]$given) { if ($given) { return $given } else { return (Split-Path (Get-Location).Path -Leaf) } }

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
        $secure = Read-Host 'Dan khoa cua may nay (do lenh machine-add in ra; se khong hien tren man hinh)' -AsSecureString
        if ($secure.Length -lt 32) { Write-Host 'Khoa phai tu 32 ky tu tro len.'; exit 1 }
        Save-RelayConfig ([pscustomobject]@{ url = $Url; key_enc = (Protect-RelayKey $secure) })
        Write-Host "Da luu cau hinh vao $script:RelayFile (khoa ma hoa theo tai khoan Windows, KHONG nam trong repo)."
        $old = Join-Path $stateDir 'notify.telegram.json'
        if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force; Write-Host 'Da xoa notify.telegram.json cu (bot token khong con dung o may nay).' }
        $project = Split-Path (Get-Location).Path -Leaf
        if (Send-Relay -Text 'Da ket noi Claude Code notify.' -Project $project) { Write-Host 'Da gui tin thu qua relay.' } else { Write-Warning 'Gui tin thu that bai - kiem tra URL, khoa, va relay da deploy chua.' }
    }
    'admin-setup' {
        if (-not $Url) { $Url = Read-Host 'Dan URL admin (vd https://<app>.vercel.app/api/admin)' }
        $Url = $Url.Trim()
        if (-not (Test-RelayUrl $Url)) { exit 1 }
        $secure = Read-Host 'Dan khoa admin (NOTIFY_ADMIN_KEY; se khong hien tren man hinh)' -AsSecureString
        if ($secure.Length -lt 32) { Write-Host 'Khoa phai tu 32 ky tu tro len.'; exit 1 }
        Save-AdminConfig ([pscustomobject]@{ url = $Url; key_enc = (Protect-RelayKey $secure) })
        Write-Host "Da luu cau hinh vao $script:AdminFile (khoa ma hoa theo tai khoan Windows, KHONG nam trong repo)."
        $r = Invoke-RelayAdmin -Action 'machine-list'
        if ($r.Ok) { Write-Host 'Ket noi admin OK.' }
        elseif ($r.Status -eq 401) {
            Remove-Item -LiteralPath $script:AdminFile -Force -ErrorAction SilentlyContinue   # do not keep a key the server rejected
            Write-Host 'Khoa admin sai - da huy luu. Chay lai admin-setup voi dung NOTIFY_ADMIN_KEY.'; exit 1
        } else { Show-AdminError $r 'Kiem tra ket noi admin' }
    }
    'machine-add' {
        Require-Admin
        if ($Arg1 -cnotmatch '^[a-z0-9][a-z0-9_-]{0,31}$') { Write-Host 'Dung: machine-add <ten> [-Apply]   (ten: a-z 0-9 _ -, toi da 32 ky tu, bat dau bang chu/so, chu thuong)'; exit 1 }
        $relayUrl = $null
        if ($Apply) {
            $relayUrl = Get-RelayUrlFromAdmin ((Get-AdminConfig).url)
            if (-not $relayUrl) { Write-Host 'Khong suy ra duoc URL relay tu URL admin (phai ket thuc bang /api/admin). Chay lai khong co -Apply roi dung relay-setup.'; exit 1 }
        }
        $r = Invoke-RelayAdmin -Action 'machine-add' -Params @{ name = $Arg1 }
        if (-not $r.Ok) { Show-AdminError $r 'machine-add'; exit 1 }
        $key = [string]$r.Data.key
        if (-not $key) { Write-Host 'machine-add: phan hoi khong co khoa (kiem tra URL admin co dung la .../api/admin khong).'; exit 1 }
        if ($Apply) {
            try {
                if (Get-RelayConfig) { Write-Warning 'Da ghi de cau hinh relay cu cua may nay. Khoa cu van con hieu luc - neu khong dung nua hay thu hoi bang machine-revoke.' }
                Save-RelayConfig ([pscustomobject]@{ url = $relayUrl; key_enc = (Protect-RelayKey (ConvertTo-SecureString $key -AsPlainText -Force)) })
                Write-Host "Da tao may '$Arg1' va ghi khoa (ma hoa) vao $script:RelayFile. Chay: notify-ctl.cmd test"
            } catch {
                Write-Warning 'Khong ghi duoc notify.relay.json. Khoa duoi day chi hien MOT LAN - hay luu lai:'
                Write-Host $key
            }
        } else {
            Write-Host "Da tao may '$Arg1'. Khoa (chi hien MOT LAN, hay luu ngay):"
            Write-Host $key
            Write-Host 'Tren may do chay: notify-ctl.cmd relay-setup (dan URL .../api/notify va khoa nay).'
        }
    }
    'machine-revoke' {
        Require-Admin
        if (-not $Arg1) { Write-Host 'Dung: machine-revoke <ten>'; exit 1 }
        $r = Invoke-RelayAdmin -Action 'machine-revoke' -Params @{ name = $Arg1 }
        if ($r.Ok) { Write-Host "Da thu hoi may '$Arg1' (co hieu luc trong toi da 30 giay)." } else { Show-AdminError $r 'machine-revoke'; exit 1 }
    }
    'machines' {
        Require-Admin
        $r = Invoke-RelayAdmin -Action 'machine-list'
        if (-not $r.Ok) { Show-AdminError $r 'machines'; exit 1 }
        $list = @($r.Data.machines | Where-Object { $_ })
        if (-not $list.Count) { Write-Host '(chua co may nao)' }
        foreach ($m in $list) { Write-Host ('{0,-34} {1}  {2}' -f $m.name, $(if ($m.revoked) { 'DA THU HOI' } else { 'hoat dong' }), $m.createdAt) }
    }
    'topic-add' {
        Require-Admin
        $project = $null; $idText = $null
        if ($Arg2) { $project = $Arg1; $idText = $Arg2 } else { $project = Get-ProjectName ''; $idText = $Arg1 }
        $tid = 0
        if (-not [int]::TryParse([string]$idText, [ref]$tid) -or $tid -lt 1) { Write-Host 'Dung: topic-add [project] <thread_id>   (thread_id: so nguyen 1..2147483647)'; exit 1 }
        if (-not $project -or $project.Length -gt 100) { Write-Host 'Ten project khong hop le (1..100 ky tu).'; exit 1 }
        $r = Invoke-RelayAdmin -Action 'topic-add' -Params @{ project = $project; threadId = $tid }
        if ($r.Ok) { Write-Host "Da map '$project' -> topic $tid (co hieu luc trong toi da 30 giay)." } else { Show-AdminError $r 'topic-add'; exit 1 }
    }
    'topic-remove' {
        Require-Admin
        $project = Get-ProjectName $Arg1
        if (-not $project -or $project.Length -gt 100) { Write-Host 'Ten project khong hop le (1..100 ky tu). Dung: topic-remove <project>'; exit 1 }
        $r = Invoke-RelayAdmin -Action 'topic-remove' -Params @{ project = $project }
        if ($r.Ok) { Write-Host "Da xoa map cua '$project'." } else { Show-AdminError $r 'topic-remove'; exit 1 }
    }
    'topics' {
        Require-Admin
        $r = Invoke-RelayAdmin -Action 'topic-list'
        if (-not $r.Ok) { Show-AdminError $r 'topics'; exit 1 }
        $list = @($r.Data.topics | Where-Object { $_ })
        if (-not $list.Count) { Write-Host '(chua co map nao)' }
        foreach ($t in $list) { Write-Host ('{0,-34} -> {1}' -f $t.project, $t.threadId) }
    }
    default { Write-Host "Lenh khong ro: $Command. Dung: snooze | on | status | test | relay-setup | admin-setup | machine-add | machine-revoke | machines | topic-add | topic-remove | topics"; exit 1 }
}
