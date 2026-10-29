# ACM UAT Stage4C source-review export — local-only, explicit 9-file allowlist.
# This does NOT upload, fetch, checkout, commit, write database, or run SQL.
param(
  [string]$RepoPath = 'D:\ACM_QLLK_UAT',
  [Parameter(Mandatory=$true)][string]$ManifestPath,
  [string]$OutputDirectory = (Join-Path $env:USERPROFILE 'Downloads')
)
$ErrorActionPreference = 'Stop'
$expectedManifestSha256 = '1d5ee2865492fbce2fcfeb3126273f91c211b00c55c284f23711138c842d2fdf'
$expectedHead = '0847a73088b98d8b00fb6ac06f02b2f56d288b78'
$allowed = @(
  'apps/api/prisma/schema.prisma',
  'apps/api/prisma/Stage4C2A_MIGRATION_REVIEW_ONLY.sql.txt',
  'apps/api/prisma/Stage4C2B_CONSTRAINTS_REVIEW_ONLY.sql.txt',
  'apps/api/src/modules/borrow/borrow.return-operation-foundation.ts',
  'apps/api/src/modules/borrow/borrow.router.ts',
  'apps/api/src/modules/borrow/borrow.service.ts',
  'apps/api/tests/borrow.return-operations.stage4c2a.unit.test.ts',
  'apps/api/tests/borrow.return-operations.stage4c2b.schema-contract.unit.test.ts',
  'apps/api/tests/uat.phase11.ledger.integration.test.ts'
)
if (-not (Test-Path -LiteralPath $RepoPath -PathType Container)) { throw 'UAT_REPO_NOT_FOUND' }
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw 'MANIFEST_NOT_FOUND' }
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { throw 'OUTPUT_DIR_NOT_FOUND' }
$sha = (Get-FileHash -LiteralPath $ManifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sha -ne $expectedManifestSha256) { throw 'MANIFEST_SHA256_MISMATCH' }
$data = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($data.format -ne 'ACM_UAT_RECONCILE_METADATA_V2' -or $data.headCommit -ne $expectedHead) { throw 'MANIFEST_IDENTITY_MISMATCH' }
if (@($data.files).Count -ne $allowed.Count) { throw 'UNEXPECTED_FILE_COUNT' }
$git = (Get-Command git -ErrorAction Stop).Source
$root = (& $git -C $RepoPath rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0) { throw 'INVALID_GIT_REPOSITORY' }
$head = (& $git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $expectedHead) { throw 'UAT_HEAD_CHANGED' }
if ([IO.Path]::GetFullPath($root).TrimEnd('\') -ine [IO.Path]::GetFullPath($RepoPath).TrimEnd('\')) { throw 'UNEXPECTED_UAT_ROOT' }
$rootPrefix = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$outFull = [IO.Path]::GetFullPath($OutputDirectory).TrimEnd('\') + '\'
if ($outFull.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'OUTPUT_MUST_BE_OUTSIDE_UAT_REPOSITORY' }
# Validate ALL paths and file contents against the signed-off metadata BEFORE writing the package.
$selected = @()
foreach ($entry in @($data.files)) {
  $relative = [string]$entry.path
  if ($allowed -cnotcontains $relative -or @($selected | Where-Object { $_.path -ceq $relative }).Count -gt 0) { throw 'UNEXPECTED_OR_DUPLICATE_FILE' }
  $filePath = [IO.Path]::GetFullPath((Join-Path $root ($relative.Replace('/','\'))))
  if (-not $filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'UNSAFE_PATH' }
  if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw ('MISSING_SOURCE_FILE: ' + $relative) }
  $item = Get-Item -LiteralPath $filePath -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw ('SYMLINK_NOT_ALLOWED: ' + $relative) }
  if ($item.Length -ne [int64]$entry.lengthBytes -or $item.Length -gt 1048576) { throw ('SIZE_MISMATCH: ' + $relative) }
  $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne ([string]$entry.sha256).ToLowerInvariant()) { throw ('SOURCE_SHA256_MISMATCH: ' + $relative) }
  # Basic key/credential guard. Not exhaustive: human review is still mandatory.
  $text = [IO.File]::ReadAllText($filePath)
  if ($text -match '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' -or
      $text -match 'sb_secret_[A-Za-z0-9_-]{12,}' -or
      $text -match '(?i)(postgres(?:ql)?://)[^\s''"]+:[^\s''"]+@') {
      throw ('POTENTIAL_SECRET_FOUND_REVIEW_LOCALLY: ' + $relative)
  }
  $selected += [pscustomobject]@{ path=$relative; fullPath=$filePath; sha256=$hash }
}
if ($selected.Count -ne $allowed.Count) { throw 'INCOMPLETE_SOURCE_SET' }
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$folder = Join-Path $OutputDirectory ('ACM_UAT_SourceReview_ONLY_' + $stamp)
New-Item -ItemType Directory -Path $folder -ErrorAction Stop | Out-Null
foreach ($item in $selected) {
  $destination = Join-Path $folder ($item.path.Replace('/','\'))
  New-Item -ItemType Directory -Path (Split-Path -Path $destination -Parent) -Force | Out-Null
  Copy-Item -LiteralPath $item.fullPath -Destination $destination -ErrorAction Stop
  $copiedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($copiedHash -ne $item.sha256) { throw ('COPY_HASH_MISMATCH: ' + $item.path) }
}
Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $folder 'verified-metadata.json')
$zip = $folder + '.zip'
Compress-Archive -Path (Join-Path $folder '*') -DestinationPath $zip -CompressionLevel Optimal -ErrorAction Stop
Write-Host ('REVIEW_FOLDER: ' + $folder)
Write-Host ('REVIEW_ZIP: ' + $zip)
Write-Host ('SHA256_ZIP: ' + (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host 'ALL_NINE_SOURCE_HASHES_VERIFIED'
Write-Host 'LOCAL_ONLY_NOT_UPLOADED_NO_GIT_WRITE_NO_DB_WRITE'
Write-Host 'MANUAL_SECRET_AND_REAL_DATA_REVIEW_REQUIRED_BEFORE_SHARING'
