<#
.SYNOPSIS
  Links this repo's agents/, commands/ and each skills/<name>/ into ~/.claude using
  directory junctions (no admin rights needed). Safe to re-run any time.

.EXAMPLE
  .\install.cmd               # or: powershell -ExecutionPolicy Bypass -File install.ps1
  .\install.cmd -Uninstall    # remove only the junctions that point into this repo
#>
[CmdletBinding()]
param([switch]$Uninstall)

$ErrorActionPreference = 'Stop'
$repo   = $PSScriptRoot
$claude = Join-Path $HOME '.claude'

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

$skillsDir = Join-Path $claude 'skills'
$links = @(
    @{ Link = Join-Path $claude 'agents';   Target = Join-Path $repo 'agents' }
    @{ Link = Join-Path $claude 'commands'; Target = Join-Path $repo 'commands' }
)
# skills/ is linked per skill: ~/.claude/skills also holds Claude-managed folders (e.g. synced/).
Get-ChildItem (Join-Path $repo 'skills') -Directory | ForEach-Object {
    $links += @{ Link = Join-Path $skillsDir $_.Name; Target = $_.FullName }
}

if ($Uninstall) {
    foreach ($l in $links) {
        if ((Test-Path -LiteralPath $l.Link) -and (Test-PointsIntoRepo $l.Link)) { Remove-Link $l.Link }
    }
    if (Test-Path $skillsDir) {
        Get-ChildItem $skillsDir -Directory | Where-Object { Test-PointsIntoRepo $_.FullName } |
            ForEach-Object { Remove-Link $_.FullName }
    }
    return
}

New-Item -ItemType Directory -Force -Path $skillsDir | Out-Null

# Prune junctions to skills that were deleted/renamed in the repo.
Get-ChildItem $skillsDir -Directory | Where-Object {
    (Test-PointsIntoRepo $_.FullName) -and -not (Test-Path -LiteralPath (Get-LinkTarget $_.FullName))
} | ForEach-Object { Remove-Link $_.FullName }

foreach ($l in $links) { Add-Link $l.Link $l.Target }
Write-Host "`nDone. Open a new Claude Code session to pick up agents/commands/skills."
