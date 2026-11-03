# ACM UAT metadata-only evidence collector
# PREPARE ONLY: reads tracked local changes, does not copy source, .env, DB data, or credentials.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\acm-uat-evidence-readonly.ps1
param(
  [string]$RepoPath = 'D:\ACM_QLLK_UAT',
  [string]$OutputDirectory = (Join-Path $env:USERPROFILE 'Downloads')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { throw 'ACM_UAT_NOT_FOUND' }
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { throw 'OUTPUT_DIRECTORY_NOT_FOUND' }
$git = Get-Command git -ErrorAction Stop
$root = (& $git.Source -C $RepoPath rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'NOT_A_GIT_REPO' }
# Pin intended path: do not silently inspect another working tree.
if ([IO.Path]::GetFullPath($root).TrimEnd('\') -ine [IO.Path]::GetFullPath($RepoPath).TrimEnd('\')) { throw 'UNEXPECTED_REPO_ROOT' }
$head = (& $git.Source -C $root rev-parse HEAD).Trim()
$branch = (& $git.Source -C $root branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'GIT_METADATA_FAILED' }
# Git -m: modified tracked paths only; no source data is ever serialized.
# Git config core.quotePath=false permits Unicode path display; filenames containing LF are rejected.
$lines = @(& $git.Source -C $root -c core.quotePath=false ls-files -m)
if ($LASTEXITCODE -ne 0) { throw 'GIT_LIST_FAILED' }
$items = @()
foreach ($relative in $lines) {
  if ([string]::IsNullOrWhiteSpace($relative)) { continue }
  if ($relative.Contains([char]10) -or $relative.Contains([char]13)) { throw 'UNSAFE_PATH_NAME' }
  # Avoid disclosing sensitive filenames or hashing secret-bearing config files.
  $lower = $relative.ToLowerInvariant().Replace('\','/')
  if ($lower -match '(^|/)(\.env[^/]*|\.git|secrets?|credentials?|private|data|dumps?|backups?)(/|$)' -or
      $lower -match '(password|token|\.pem$|\.p12$|\.key$|\.sqlite$|\.db$)') { continue }
  $full = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
  $file = Get-Item -LiteralPath $full -Force
  if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
  $sha = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
  $items += [pscustomobject]@{ path=$relative; lengthBytes=$file.Length; sha256=$sha }
}
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$out = Join-Path $OutputDirectory ("ACM_UAT_Metadata_ONLY_" + $stamp + ".json")
$report = [ordered]@{
  format='ACM_UAT_METADATA_ONLY_v1'
  generatedLocal=(Get-Date).ToString('o')
  repository='ACM_QLLK_UAT'
  branch=$branch
  headCommit=$head
  trackedModifiedNonSensitiveFileCount=$items.Count
  excluded='untracked files; source content; .env/secrets; database rows; git diff; credential-bearing paths'
  files=$items
  warning='Metadata only. This does NOT establish code safety or contain source needed to implement changes.'
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $out -Encoding UTF8
Write-Host ('EVIDENCE_METADATA_CREATED: ' + $out)
Write-Host ('HEAD: ' + $head)
Write-Host ('TRACKED_MODIFIED_REPORTED: ' + $items.Count)
Write-Host ('SHA256_REPORT: ' + (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host 'NO_SOURCE_NO_SECRETS_NO_DATABASE_NO_GIT_WRITE'
