param(
  [string[]]$SearchQuery = @(),
  [string[]]$ControversyQuery = @(),
  [string[]]$ExtraQueryTemplate = @(),
  [int]$MaxCycles = 3,
  [int]$RoundsPerCycle = 1,
  [int]$DiscoveryLimit = 6,
  [int]$ControversialPopularQueryLimit = 4,
  [string]$ControversialPopularSearchOrder = "click",
  [int]$CommentPages = 2,
  [int]$MaxQueries = 12,
  [int]$TermsPerFamily = 4,
  [int]$QueryVariantsPerTerm = 2,
  [int]$RetryBeforeUnattemptedLimit = 3,
  [int]$TargetEvidence = 3,
  [ValidateSet("balanced", "all-weak")]
  [string]$CoverageMode = "all-weak",
  [ValidateSet("search", "popular", "mixed", "controversial")]
  [string]$DiscoveryMode = "controversial",
  [switch]$AllowNewTerms,
  [switch]$AllowUnsourcedEvidence,
  [switch]$StopOnNoProgress,
  [switch]$ResetHarvestState,
  [switch]$Strict
)

# Runs the backend coverage loop. It audits weak dictionary terms, exports priority
# queries, harvests Bilibili comments, and repeats until coverage passes or MaxCycles is reached.

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

$env:BILIBILI_COVERAGE_LOOP_MAX_CYCLES = [string]$MaxCycles
$env:BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE = [string]$RoundsPerCycle
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT = [string]$DiscoveryLimit
$env:BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT = [string]$ControversialPopularQueryLimit
$env:BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER = $ControversialPopularSearchOrder
$env:BILIBILI_VIDEO_COMMENT_PAGES = [string]$CommentPages
$env:BILIBILI_HARVEST_MAX_QUERIES = [string]$MaxQueries
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY = [string]$TermsPerFamily
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM = [string]$QueryVariantsPerTerm
$env:BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT = [string]$RetryBeforeUnattemptedLimit
$env:BILIBILI_HARVEST_TARGET_EVIDENCE = [string]$TargetEvidence
$env:BILIBILI_HARVEST_COVERAGE_MODE = $CoverageMode
$env:BILIBILI_VIDEO_DISCOVERY_MODE = $DiscoveryMode

if ($AllowNewTerms) {
  Remove-Item Env:\BILIBILI_HARVEST_EXISTING_TERMS_ONLY -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_EXISTING_TERMS_ONLY = "1"
}
if ($AllowUnsourcedEvidence) {
  Remove-Item Env:\BILIBILI_HARVEST_REQUIRE_SOURCES -ErrorAction SilentlyContinue
  Remove-Item Env:\BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES -ErrorAction SilentlyContinue
} else {
  $env:BILIBILI_HARVEST_REQUIRE_SOURCES = "1"
  $env:BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES = "1"
}
if ($StopOnNoProgress) {
  $env:BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS = "1"
} else {
  Remove-Item Env:\BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS -ErrorAction SilentlyContinue
}
if ($ResetHarvestState) {
  $env:BILIBILI_HARVEST_RESET = "1"
} else {
  Remove-Item Env:\BILIBILI_HARVEST_RESET -ErrorAction SilentlyContinue
}
if ($Strict) {
  $env:BILIBILI_COVERAGE_LOOP_STRICT = "1"
} else {
  Remove-Item Env:\BILIBILI_COVERAGE_LOOP_STRICT -ErrorAction SilentlyContinue
}

Write-Host "Backend Bilibili dictionary coverage loop"
Write-Host "Max cycles: $MaxCycles"
Write-Host "Rounds per cycle: $RoundsPerCycle"
Write-Host "Max harvest queries per cycle: $MaxQueries"
Write-Host "Retry-before-unattempted limit: $RetryBeforeUnattemptedLimit"
Write-Host "Target evidence per term: $TargetEvidence"
Write-Host "Coverage mode: $CoverageMode"
Write-Host "Discovery mode: $DiscoveryMode"
Write-Host "Discovery limit: $DiscoveryLimit"
Write-Host "Comment pages per video: $CommentPages"
Write-Host "Controversial popular query limit: $ControversialPopularQueryLimit"
Write-Host "Controversial popular search order: $ControversialPopularSearchOrder"
Write-Host "Existing dictionary terms only: $(!$AllowNewTerms)"
Write-Host "Require Bilibili evidence sources: $(!$AllowUnsourcedEvidence)"
Write-Host "Reset harvest state: $ResetHarvestState"
Write-Host ""
Write-Host "Auditing coverage, harvesting priority queries, and repeating until the gate passes or the cycle limit is reached..."

node .\server\runCoverageHarvestLoop.js
