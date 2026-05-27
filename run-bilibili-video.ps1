param(
  [string[]]$SearchQuery = @(),
  [string]$SearchQueryFile = "",
  [string]$PriorityQueryFile = "",
  [string]$PriorityActionFile = "",
  [string[]]$ControversyQuery = @(),
  [string[]]$ExtraQueryTemplate = @(),
  [int]$DiscoveryLimit = 6,
  [int]$ControversialPopularQueryLimit = 4,
  [string]$ControversialPopularSearchOrder = "click",
  [int]$CommentPages = 2,
  [int]$MaxQueries = 12,
  [int]$TermsPerFamily = 4,
  [int]$QueryVariantsPerTerm = 2,
  [int]$RetryBeforeUnattemptedLimit = 3,
  [int]$StaleMissedDiscoveryLimit = 4,
  [int]$StaleMissedCommentPages = 3,
  [int]$TargetEvidence = 3,
  [int]$QueryTimeoutMs = 180000,
  [int]$Rounds = 1,
  [ValidateSet("balanced", "all-weak")]
  [string]$CoverageMode = "all-weak",
  [ValidateSet("search", "popular", "mixed", "controversial")]
  [string]$DiscoveryMode = "controversial",
  [switch]$RequireEvidenceSources,
  [switch]$RequireCommentEvidence,
  [switch]$ExistingTermsOnly,
  [switch]$IncludeDanmaku,
  [switch]$NoDanmaku,
  [switch]$IncludeGenericPopular,
  [switch]$SkipPriorityActionRefresh,
  [switch]$ResetHarvestState
)

# Runs dictionary-seeded backend video discovery and keyword training without manually entering Bilibili video links.
# Example:
#   .\run-bilibili-video.ps1
#   .\run-bilibili-video.ps1 -SearchQuery "your search term 1","your search term 2" -MaxQueries 20 -DiscoveryLimit 8 -CommentPages 3

if (Test-Path ".\set-deepseek-env.ps1") {
  . ".\set-deepseek-env.ps1"
} else {
  Write-Warning "set-deepseek-env.ps1 was not found. DeepSeek extraction will use the local fallback unless DEEPSEEK_API_KEY is already set."
}

if ($SearchQuery.Count -gt 0) {
  $env:BILIBILI_VIDEO_SEARCH_QUERIES = ($SearchQuery -join "`n")
} else {
  Remove-Item Env:\BILIBILI_VIDEO_SEARCH_QUERIES -ErrorAction SilentlyContinue
}
if ($SearchQueryFile) {
  $env:BILIBILI_VIDEO_SEARCH_QUERY_FILE = $SearchQueryFile
} else {
  Remove-Item Env:\BILIBILI_VIDEO_SEARCH_QUERY_FILE -ErrorAction SilentlyContinue
}
if ($PriorityQueryFile) {
  $env:BILIBILI_HARVEST_PRIORITY_QUERY_FILE = $PriorityQueryFile
} else {
  Remove-Item Env:\BILIBILI_HARVEST_PRIORITY_QUERY_FILE -ErrorAction SilentlyContinue
}
if ($PriorityActionFile) {
  $env:BILIBILI_HARVEST_PRIORITY_ACTION_FILE = $PriorityActionFile
  $env:BILIBILI_COVERAGE_ACTION_FILE_PATH = $PriorityActionFile
} else {
  Remove-Item Env:\BILIBILI_HARVEST_PRIORITY_ACTION_FILE -ErrorAction SilentlyContinue
  Remove-Item Env:\BILIBILI_COVERAGE_ACTION_FILE_PATH -ErrorAction SilentlyContinue
}
if ($ControversyQuery.Count -gt 0) {
  $env:BILIBILI_CONTROVERSY_SEARCH_QUERIES = ($ControversyQuery -join "`n")
} else {
  Remove-Item Env:\BILIBILI_CONTROVERSY_SEARCH_QUERIES -ErrorAction SilentlyContinue
}
if ($ExtraQueryTemplate.Count -gt 0) {
  $env:BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES = ($ExtraQueryTemplate -join "`n")
} else {
  Remove-Item Env:\BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES -ErrorAction SilentlyContinue
}
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT = [string]$DiscoveryLimit
$env:BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT = [string]$ControversialPopularQueryLimit
$env:BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER = $ControversialPopularSearchOrder
if ($IncludeGenericPopular) {
  $env:BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR = "1"
} else {
  Remove-Item Env:\BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR -ErrorAction SilentlyContinue
}
if ($NoDanmaku) {
  Remove-Item Env:\BILIBILI_HARVEST_INCLUDE_DANMAKU -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_INCLUDE_DANMAKU = "1"
}
$env:BILIBILI_VIDEO_COMMENT_PAGES = [string]$CommentPages
$env:BILIBILI_HARVEST_MAX_QUERIES = [string]$MaxQueries
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY = [string]$TermsPerFamily
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM = [string]$QueryVariantsPerTerm
$effectiveRetryBeforeUnattemptedLimit = $RetryBeforeUnattemptedLimit
if ($RequireCommentEvidence -and -not $PSBoundParameters.ContainsKey("RetryBeforeUnattemptedLimit")) {
  $effectiveRetryBeforeUnattemptedLimit = 1
}
$env:BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT = [string]$effectiveRetryBeforeUnattemptedLimit
$env:BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT = [string]$StaleMissedDiscoveryLimit
$env:BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES = [string]$StaleMissedCommentPages
$env:BILIBILI_HARVEST_TARGET_EVIDENCE = [string]$TargetEvidence
$env:BILIBILI_HARVEST_QUERY_TIMEOUT_MS = [string]$QueryTimeoutMs
if ($RequireCommentEvidence -and $ExistingTermsOnly -and -not $env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS) {
  $strictCooldownMs = [Math]::Max(1000, [Math]::Floor($QueryTimeoutMs / 10))
  $env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS = [string]$strictCooldownMs
}
if ($RequireCommentEvidence -and $ExistingTermsOnly -and -not $env:BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS) {
  $strictRequestTimeoutMs = [Math]::Max(5000, [Math]::Floor($QueryTimeoutMs / 2))
  $env:BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS = [string]$strictRequestTimeoutMs
}
if ($RequireCommentEvidence -and $ExistingTermsOnly -and -not $env:BILIBILI_CRAWLER_MIN_DELAY_MS) {
  $strictMinDelayMs = [Math]::Max(200, [Math]::Floor($QueryTimeoutMs / 100))
  $env:BILIBILI_CRAWLER_MIN_DELAY_MS = [string]$strictMinDelayMs
}
if ($RequireCommentEvidence -and $ExistingTermsOnly -and -not $env:BILIBILI_CRAWLER_JITTER_MS) {
  $strictJitterMs = [Math]::Max(100, [Math]::Floor($QueryTimeoutMs / 200))
  $env:BILIBILI_CRAWLER_JITTER_MS = [string]$strictJitterMs
}
$env:BILIBILI_HARVEST_ROUNDS = [string]$Rounds
$env:BILIBILI_HARVEST_COVERAGE_MODE = $CoverageMode
$env:BILIBILI_VIDEO_DISCOVERY_MODE = $DiscoveryMode
if ($RequireEvidenceSources -or $RequireCommentEvidence) {
  $env:BILIBILI_HARVEST_REQUIRE_SOURCES = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_REQUIRE_SOURCES -ErrorAction SilentlyContinue
}
if ($RequireCommentEvidence) {
  $env:BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS = "1"
} else {
  Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS -ErrorAction SilentlyContinue
}
if ($ExistingTermsOnly) {
  $env:BILIBILI_HARVEST_EXISTING_TERMS_ONLY = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_EXISTING_TERMS_ONLY -ErrorAction SilentlyContinue
}
if ($ResetHarvestState) {
  $env:BILIBILI_HARVEST_RESET = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_RESET -ErrorAction SilentlyContinue
}

Write-Host "Backend Bilibili video discovery queries:"
if ($SearchQuery.Count -gt 0) {
  $SearchQuery | ForEach-Object { Write-Host " - $_" }
} else {
  Write-Host " - using backend default search query"
}
if ($SearchQueryFile) {
  Write-Host "Search query file: $SearchQueryFile"
}
if ($PriorityQueryFile) {
  Write-Host "Priority query file: $PriorityQueryFile"
}
if ($PriorityActionFile) {
  Write-Host "Priority action file: $PriorityActionFile"
}
if ($DiscoveryMode -eq "controversial") {
  Write-Host "Controversy discovery queries:"
  if ($ControversyQuery.Count -gt 0) {
    $ControversyQuery | ForEach-Object { Write-Host " - $_" }
  } else {
    Write-Host " - using backend default controversy seeds"
  }
}
Write-Host "Discovery limit: $DiscoveryLimit"
Write-Host "Controversial popular query limit: $ControversialPopularQueryLimit"
Write-Host "Controversial popular search order: $ControversialPopularSearchOrder"
Write-Host "Include generic popular feed in controversial mode: $IncludeGenericPopular"
Write-Host "Include public danmaku in video scans: $(!$NoDanmaku)"
Write-Host "Comment pages per video: $CommentPages"
Write-Host "Max harvest queries: $MaxQueries"
Write-Host "Dictionary terms per family: $TermsPerFamily"
Write-Host "Query variants per term: $QueryVariantsPerTerm"
Write-Host "Retry-before-unattempted limit: $effectiveRetryBeforeUnattemptedLimit"
Write-Host "Stale missed discovery limit: $StaleMissedDiscoveryLimit"
Write-Host "Stale missed comment pages: $StaleMissedCommentPages"
Write-Host "Extra query templates: $($ExtraQueryTemplate.Count)"
Write-Host "Target evidence per term: $TargetEvidence"
Write-Host "Per-query timeout ms: $QueryTimeoutMs"
Write-Host "Harvest rounds: $Rounds"
Write-Host "Coverage mode: $CoverageMode"
Write-Host "Discovery mode: $DiscoveryMode"
Write-Host "Require evidence sources: $($RequireEvidenceSources -or $RequireCommentEvidence)"
Write-Host "Require Bilibili comment evidence: $RequireCommentEvidence"
Write-Host "Existing dictionary terms only: $ExistingTermsOnly"
Write-Host "Reset harvest state: $ResetHarvestState"
Write-Host "Refresh priority action file: $($PriorityActionFile -and -not $SkipPriorityActionRefresh)"
Write-Host ""

if ($PriorityActionFile -and -not $SkipPriorityActionRefresh) {
  Write-Host "Refreshing priority action file from current dictionary coverage..."
  $previousMaxActions = $env:BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS
  $previousStrict = $env:BILIBILI_COVERAGE_AUDIT_STRICT
  if (-not $previousMaxActions) {
    $env:BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS = [string]([Math]::Max(20, $MaxQueries * 4))
  }
  $env:BILIBILI_COVERAGE_AUDIT_STRICT = "0"
  node .\server\runDictionaryCoverageAudit.js
  $coverageExitCode = $LASTEXITCODE
  if ($previousMaxActions) {
    $env:BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS = $previousMaxActions
  } else {
    Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS -ErrorAction SilentlyContinue
  }
  if ($previousStrict) {
    $env:BILIBILI_COVERAGE_AUDIT_STRICT = $previousStrict
  } else {
    Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_STRICT -ErrorAction SilentlyContinue
  }
  if ($coverageExitCode -ne 0) {
    exit $coverageExitCode
  }
  Write-Host ""
}

Write-Host "Harvesting dictionary-seeded Bilibili videos, scanning comments, and training the local keyword dictionary..."

node .\server\runVideoKeywordDiscovery.js
