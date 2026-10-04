# Control script for the notification system. Run through the shim install.ps1 writes: ~\.claude\notify-ctl.cmd
#   notify-ctl.cmd snooze <30m|1h|4h|8h> [all|toast|telegram]   mute notifications for a while (default: all channels)
#   notify-ctl.cmd on                                           cancel the snooze
#   notify-ctl.cmd status                                       show snooze + Telegram state
#   notify-ctl.cmd test                                         send a test notification to every enabled channel
#   notify-ctl.cmd telegram-setup [-ChatId <id>]                one-time: connect the bot (token is asked, never echoed)
param(
    [Parameter(Position = 0)][string]$Command = 'status',
    [Parameter(Position = 1)][string]$Arg1,
    [Parameter(Position = 2)][string]$Arg2,
    [string]$ChatId
)
$ErrorActionPreference = 'Stop'
$stateDir  = Join-Path $HOME '.claude'
$snoozeFile = Join-Path $stateDir 'notify.snooze.json'
. (Join-Path $PSScriptRoot 'channels\telegram.ps1')

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
    $tg = Get-TgConfig
    if ($tg) {
        $n = if ($tg.PSObject.Properties['topics']) { @($tg.topics.PSObject.Properties).Count } else { 0 }
        Write-Host "Telegram: da ket noi (chat_id $($tg.chat_id), $n topic)"
    } else { Write-Host 'Telegram: chua ket noi - chay: notify-ctl.cmd telegram-setup' }
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
        if (Get-TgConfig) {
            if (Send-Telegram -Text "Thong bao thu tu $project" -Project $project) { Write-Host 'telegram: da gui' } else { Write-Host 'telegram: GUI LOI (kiem tra mang/bot co la admin & co quyen Manage Topics khong)' }
        } else { Write-Host 'telegram: chua ket noi' }
    }
    'telegram-setup' {
        Write-Host @'
Truoc khi tiep tuc, can co (lam 1 lan tren dien thoai/Telegram):
  1. Chat voi @BotFather -> /newbot -> dat ten -> nhan token.
  2. Tao 1 SUPERGROUP moi (vd: "Claude"), bat "Topics" trong Group Settings.
  3. Them bot vao group va cap quyen ADMIN (bat "Manage Topics").
  4. Gui 1 tin nhan bat ky trong group.
'@
        $secure = Read-Host 'Dan bot token (se khong hien tren man hinh)' -AsSecureString
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
        $me = Invoke-Tg $plain 'getMe'
        Write-Host "Bot hop le: @$($me.result.username)"

        if (-not $ChatId) {
            Read-Host 'Da them bot vao group va gui 1 tin nhan chua? Nhan Enter de tim group' | Out-Null
            $up = Invoke-Tg $plain 'getUpdates' @{ timeout = 0 }
            $chats = @{}
            foreach ($u in $up.result) {
                foreach ($c in @($u.message.chat, $u.my_chat_member.chat, $u.channel_post.chat)) {
                    if ($c -and $c.type -in 'group', 'supergroup') { $chats[[string]$c.id] = $c.title }
                }
            }
            if ($chats.Count -eq 0) { throw 'Khong thay group nao. Hay gui 1 tin nhan trong group (bot phai la admin) roi chay lai, hoac dung -ChatId <id>.' }
            $ids = @($chats.Keys)
            if ($ids.Count -eq 1) { $ChatId = $ids[0] }
            else {
                for ($i = 0; $i -lt $ids.Count; $i++) { Write-Host "  [$i] $($chats[$ids[$i]])  ($($ids[$i]))" }
                $ChatId = $ids[[int](Read-Host 'Chon so')]
            }
            Write-Host "Group: $($chats[$ChatId]) ($ChatId)"
        }

        $chat = (Invoke-Tg $plain 'getChat' @{ chat_id = $ChatId }).result
        if (-not $chat.is_forum) { Write-Warning 'Group chua bat Topics: tin se vao chung 1 luong, khong tach theo project. Bat Topics trong Group Settings roi chay lai neu muon tach.' }

        Save-TgConfig ([pscustomobject]@{ chat_id = $ChatId; token_enc = (Protect-TgToken $secure); topics = [pscustomobject]@{} })
        $plain = $null
        Write-Host "Da luu cau hinh vao $script:TgFile (token ma hoa theo tai khoan Windows, KHONG nam trong repo)."
        if (Send-Telegram -Text 'Da ket noi Claude Code notify.' -Project 'setup') { Write-Host 'Da gui tin thu vao group.' } else { Write-Warning 'Gui tin thu that bai - kiem tra bot co la admin va quyen Manage Topics.' }
    }
    default { Write-Host "Lenh khong ro: $Command. Dung: snooze | on | status | test | telegram-setup"; exit 1 }
}
