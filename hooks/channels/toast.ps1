# Channel: Windows toast. Dot-sourced by notify.ps1.
# Uses its own AppId (Claude.Code.Notify, registered by install.ps1) so a click launches nothing;
# BurntToast 1.1.0 cannot set an AppId, so the toast goes through the Windows toast API directly.
function Send-Toast {
    param([string]$Title, [string]$Body)
    $logo  = Join-Path (Split-Path $PSScriptRoot -Parent) 'claude-logo.png'
    $appId = 'Claude.Code.Notify'

    if (Test-Path "HKCU:\Software\Classes\AppUserModelId\$appId") {
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
        $esc = { param($s) [Security.SecurityElement]::Escape([string]$s) }
        $img = if (Test-Path -LiteralPath $logo) { "<image placement=`"appLogoOverride`" src=`"file:///$($logo -replace '\\', '/')`"/>" } else { '' }
        $doc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $doc.LoadXml("<toast><visual><binding template=`"ToastGeneric`">$img<text>$(& $esc $Title)</text><text>$(& $esc $Body)</text></binding></visual></toast>")
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show([Windows.UI.Notifications.ToastNotification]::new($doc))
        return
    }

    # AppId not registered yet (install.cmd -Notify not run): fall back to the default BurntToast toast.
    Import-Module BurntToast
    if (Test-Path -LiteralPath $logo) { New-BurntToastNotification -Text $Title, $Body -AppLogo $logo }
    else { New-BurntToastNotification -Text $Title, $Body }
}
