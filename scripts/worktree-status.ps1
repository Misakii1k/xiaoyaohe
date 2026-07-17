$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$entries = @()
$current = $null

foreach ($line in (& git -C $repo worktree list --porcelain)) {
  if ($line.StartsWith('worktree ')) {
    if ($current) { $entries += [pscustomobject]$current }
    $current = @{ Path = $line.Substring(9); Branch = '(detached)' }
  } elseif ($current -and $line.StartsWith('branch refs/heads/')) {
    $current.Branch = $line.Substring(18)
  }
}
if ($current) { $entries += [pscustomobject]$current }

foreach ($entry in $entries) {
  Write-Output "[$($entry.Branch)] $($entry.Path)"
  & git -C $entry.Path status --short --branch
  Write-Output ''
}
