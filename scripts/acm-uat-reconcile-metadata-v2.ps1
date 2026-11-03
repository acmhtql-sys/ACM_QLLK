# ACM UAT reconciliation manifest v2 - read-only, no source contents.
# This script does NOT fetch, checkout, commit, alter database, or upload data.
param(
    [string]$RepoPath = 'D:\ACM_QLLK_UAT',
    [string]$OutputDirectory = (Join-Path $env:USERPROFILE 'Downloads')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { throw 'UAT_REPO_NOT_FOUND' }
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { throw 'OUTPUT_DIRECTORY_NOT_FOUND' }
$git = (Get-Command git -ErrorAction Stop).Source
$root = (& $git -C $RepoPath rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'NOT_GIT_REPOSITORY' }
if ([IO.Path]::GetFullPath($root).TrimEnd('\') -ine [IO.Path]::GetFullPath($RepoPath).TrimEnd('\')) {
    throw 'UNEXPECTED_GIT_ROOT'
}
$head = (& $git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'GIT_HEAD_FAILED' }
$branch = (& $git -C $root branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) { throw 'GIT_BRANCH_FAILED' }
function Get-GitPaths([string[]]$GitArgs) {
    $result = @(& $git -C $root -c core.quotePath=false @GitArgs)
    if ($LASTEXITCODE -ne 0) { throw 'GIT_PATH_LIST_FAILED' }
    return @($result | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}
$groups = [ordered]@{
    modified = @(Get-GitPaths @('ls-files','-m'))
    staged = @(Get-GitPaths @('diff','--cached','--name-only'))
    deleted = @(Get-GitPaths @('ls-files','-d'))
    untracked = @(Get-GitPaths @('ls-files','--others','--exclude-standard'))
}
$included = @{}
$excludedCount = 0
foreach ($kind in $groups.Keys) {
    foreach ($path in $groups[$kind]) {
        if ($path.Contains([char]10) -or $path.Contains([char]13)) { throw 'UNSAFE_PATH_NAME' }
        $normalized = $path.Replace('\','/')
        $lower = $normalized.ToLowerInvariant()
        # Allowlist source-like paths only. Never report sensitive path names.
        $sourceTree = ($lower -match '^(apps|packages|scripts|docs|tests)/' -or $lower -match '^\.github/workflows/')
        $sourceExt = ($lower -match '\.(ts|tsx|js|jsx|prisma|sql|ps1|json|md|txt|ya?ml)$')
        $sensitive = ($lower -match '(^|/)(\.env[^/]*|\.git|node_modules|dist|build|coverage|secrets?|credentials?|private|dumps?|backups?|data)(/|$)' -or
                      $lower -match '(password|token|secret|credential|\.pem$|\.p12$|\.key$|\.sqlite$|\.db$)')
        if (-not $sourceTree -or -not $sourceExt -or $sensitive) { $excludedCount++; continue }
        if (-not $included.ContainsKey($normalized)) {
            $included[$normalized] = [ordered]@{ path=$normalized; states=@(); exists=$false; lengthBytes=$null; sha256=$null }
        }
        $entry = $included[$normalized]
        $entry.states = @($entry.states) + @($kind)
    }
}
$rootPrefix = ([IO.Path]::GetFullPath($root).TrimEnd('\') + '\')
foreach ($entry in $included.Values) {
    $full = [IO.Path]::GetFullPath((Join-Path -Path $root -ChildPath ($entry.path.Replace('/','\'))))
    if (-not $full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'PATH_OUTSIDE_REPOSITORY' }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $file = Get-Item -LiteralPath $full -Force
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
    $entry.exists = $true
    $entry.lengthBytes = $file.Length
    $entry.sha256 = (Get-FileHash -LiteralPath $full -Algorithm SHA256).Hash.ToLowerInvariant()
}
$report = [ordered]@{
    format='ACM_UAT_RECONCILE_METADATA_V2'
    generatedLocal=(Get-Date).ToString('o')
    repository='ACM_QLLK_UAT'
    branch=$branch
    headCommit=$head
    counts=[ordered]@{
        modified=$groups.modified.Count
        staged=$groups.staged.Count
        deleted=$groups.deleted.Count
        untracked=$groups.untracked.Count
        distinctAllowedPaths=$included.Count
        excludedObservations=$excludedCount
    }
    files=@($included.Values | Sort-Object { $_.path })
    warning='Metadata only. Paths and hashes require operator review before sharing. Does not include source contents, secrets, ignored files, or database rows.'
}
$out = Join-Path $OutputDirectory ('ACM_UAT_Reconcile_Metadata_V2_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '.json')
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $out -Encoding UTF8
Write-Host ('ACM_UAT_V2_REPORT: ' + $out)
Write-Host ('UAT_HEAD: ' + $head)
Write-Host ('TRACKED_MODIFIED: ' + $groups.modified.Count)
Write-Host ('STAGED: ' + $groups.staged.Count)
Write-Host ('DELETED: ' + $groups.deleted.Count)
Write-Host ('UNTRACKED: ' + $groups.untracked.Count)
Write-Host ('ALLOWED_PATHS: ' + $included.Count)
Write-Host ('SHA256_REPORT: ' + (Get-FileHash -LiteralPath $out -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host 'METADATA_ONLY_NO_GIT_WRITE_NO_DB_WRITE'
