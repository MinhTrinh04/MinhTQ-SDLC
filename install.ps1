<#
.SYNOPSIS
  Sets up ~/.claude from this repo. Safe to re-run any time. Two independent parts:
    Links  - junctions for agents/, commands/ and each skills/<name>/ (no admin rights needed)
    Notify - BurntToast + Stop/Notification toast hooks in ~/.claude/settings.json
  No switch = both parts.

.EXAMPLE
  .\install.cmd                    # everything
  .\install.cmd -Links             # only agents/commands/skills links
  .\install.cmd -Notify            # only the toast notification
  .\install.cmd -Uninstall         # remove everything this script added (combine with -Links / -Notify)
#>
[CmdletBinding()]
param([switch]$Uninstall, [switch]$Links, [switch]$Notify)

$ErrorActionPreference = 'Stop'
$repo   = $PSScriptRoot
$claude = Join-Path $HOME '.claude'
$doLinks  = $Links  -or -not $Notify
$doNotify = $Notify -or -not $Links

function Get-LinkTarget($path) {
    $item = Get-Item -LiteralPath $path -Force
    if ($item.LinkType -notin 'Junction', 'SymbolicLink') { return $null }
    return ([string]@($item.Target)[0]) -replace '^\\\?\?\\', '' -replace '\\+$', ''
}

function Test-PointsIntoRepo($path) {
    $t = Get-LinkTarget $path
    return $t -and $t.StartsWith($repo.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
}

# Deletes only the link itself, never the content it points to.
function Remove-Link($path) {
    [System.IO.Directory]::Delete($path, $false)
    Write-Host "UNLINK $path"
}

function Add-Link($link, $target) {
    if (Test-Path -LiteralPath $link) {
        $cur = Get-LinkTarget $link
        if ($cur -and $cur -ieq $target.TrimEnd('\')) {
            Write-Host "OK     $link"
        } elseif ($cur) {
            Write-Warning "$link already links to $cur - skipped. Remove it with: cmd /c rmdir `"$link`""
        } else {
            Write-Warning "$link is a real folder - skipped to avoid data loss. Back it up / rename it, then re-run."
        }
        return
    }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host "LINK   $link -> $target"
}

$notifyScript = Join-Path $repo 'hooks\notify.ps1'
$hookCommand  = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$notifyScript`""
$hookEvents   = 'Stop', 'Notification', 'PreToolUse'
$hookMatchers = @{ PreToolUse = 'AskUserQuestion' }   # PreToolUse only fires for the human-decision tool

function Test-NotifyEntry($entry) {
    $cmds = @()
    if ($entry.command) { $cmds += $entry.command }
    foreach ($h in @($entry.hooks)) { if ($h.command) { $cmds += $h.command } }
    return [bool]($cmds | Where-Object { $_ -match 'notify\.ps1|BurntToast' })
}

# Merges (or removes) the toast hooks in ~/.claude/settings.json, keeping every other setting.
# Replaces any earlier notify.ps1/BurntToast entry, including the old malformed flat form.
function Update-NotifyHooks([bool]$Add) {
    $path = Join-Path $claude 'settings.json'
    if (Test-Path $path) {
        $bak = "$path.bak"
        if (-not (Test-Path $bak)) { Copy-Item $path $bak }
        $s = Get-Content $path -Raw -Encoding UTF8 | ConvertFrom-Json
    } else {
        if (-not $Add) { return }
        $s = [pscustomobject]@{}
    }
    if (-not $s.PSObject.Properties['hooks']) {
        if (-not $Add) { return }
        $s | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
    }
    foreach ($ev in $hookEvents) {
        $existing = @(); if ($s.hooks.PSObject.Properties[$ev]) { $existing = @($s.hooks.$ev) }
        $kept = @($existing | Where-Object { -not (Test-NotifyEntry $_) })
        if ($Add) {
            $entry = [pscustomobject]@{ hooks = @([pscustomobject]@{ type = 'command'; command = $hookCommand }) }
            if ($hookMatchers[$ev]) { $entry | Add-Member -NotePropertyName matcher -NotePropertyValue $hookMatchers[$ev] }
            $kept += $entry
        }
        if ($kept.Count) { $s.hooks | Add-Member -Force -NotePropertyName $ev -NotePropertyValue $kept }
        else { $s.hooks.PSObject.Properties.Remove($ev) }
    }
    $json = $s | ConvertTo-Json -Depth 10
    [IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding($false)))
    Write-Host "$(if ($Add) {'HOOKS '} else {'UNHOOK'}) $path ($($hookEvents -join ', '))"
}

# Own toast identity (AUMID) so a click has no executable to launch. Toasts borrowing PowerShell's identity
# make Windows start powershell.exe on click (a console flashes). Also gives the toast header the Claude name/logo.
function Register-ToastApp([bool]$Add) {
    $key = 'HKCU:\Software\Classes\AppUserModelId\Claude.Code.Notify'
    if (-not $Add) {
        if (Test-Path $key) { Remove-Item $key -Recurse -Force; Write-Host 'UNREG  toast app Claude.Code.Notify' }
        return
    }
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty -Path $key -Name DisplayName -Value 'Claude Code'
    Set-ItemProperty -Path $key -Name IconUri -Value (Join-Path $repo 'hooks\claude-logo.png')
    Write-Host 'REG    toast app Claude.Code.Notify'
}

function Install-BurntToast {
    if (Get-Module -ListAvailable BurntToast) { Write-Host 'OK     BurntToast'; return }
    try {
        Install-PackageProvider -Name NuGet -Scope CurrentUser -Force | Out-Null
        Install-Module -Name BurntToast -Scope CurrentUser -Force -AllowClobber
        Write-Host 'INSTALL BurntToast'
    } catch { Write-Warning "Could not install BurntToast ($_). Toast hooks will stay silent until it is installed." }
}

$skillsDir = Join-Path $claude 'skills'
$linkSpecs = @(
    @{ Link = Join-Path $claude 'agents';   Target = Join-Path $repo 'agents' }
    @{ Link = Join-Path $claude 'commands'; Target = Join-Path $repo 'commands' }
)
# skills/ is linked per skill: ~/.claude/skills also holds Claude-managed folders (e.g. synced/).
Get-ChildItem (Join-Path $repo 'skills') -Directory | ForEach-Object {
    $linkSpecs += @{ Link = Join-Path $skillsDir $_.Name; Target = $_.FullName }
}

if ($Uninstall) {
    if ($doLinks) {
        foreach ($l in $linkSpecs) {
            if ((Test-Path -LiteralPath $l.Link) -and (Test-PointsIntoRepo $l.Link)) { Remove-Link $l.Link }
        }
        if (Test-Path $skillsDir) {
            Get-ChildItem $skillsDir -Directory | Where-Object { Test-PointsIntoRepo $_.FullName } |
                ForEach-Object { Remove-Link $_.FullName }
        }
    }
    if ($doNotify) { Update-NotifyHooks $false; Register-ToastApp $false }
    return
}

if ($doLinks) {
    New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null

    # Prune junctions to skills that were deleted/renamed in the repo.
    Get-ChildItem $skillsDir -Directory | Where-Object {
        (Test-PointsIntoRepo $_.FullName) -and -not (Test-Path -LiteralPath (Get-LinkTarget $_.FullName))
    } | ForEach-Object { Remove-Link $_.FullName }

    foreach ($l in $linkSpecs) { Add-Link $l.Link $l.Target }
}

if ($doNotify) {
    if (-not (Test-Path -LiteralPath $notifyScript)) { throw "Missing $notifyScript - did you commit hooks/notify.ps1?" }
    Install-BurntToast
    Register-ToastApp $true
    Update-NotifyHooks $true
}
Write-Host "`nDone. Open a new Claude Code session to pick up the changes."
