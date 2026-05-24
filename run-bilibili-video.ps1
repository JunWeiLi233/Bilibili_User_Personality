param(
  [string[]]$SearchQuery = @(),
  [string[]]$ControversyQuery = @(),
  [string[]]$ExtraQueryTemplate = @(),
  [int]$DiscoveryLimit = 6,
  [int]$ControversialPopularQueryLimit = 4,
  [string]$ControversialPopularSearchOrder = "click",
  [int]$CommentPages = 2,
  [int]$MaxQueries = 12,
  [int]$TermsPerFamily = 4,
  [int]$QueryVariantsPerTerm = 2,
  [int]$TargetEvidence = 3,
  [int]$Rounds = 1,
  [ValidateSet("balanced", "all-weak")]
  [string]$CoverageMode = "all-weak",
  [ValidateSet("search", "popular", "mixed", "controversial")]
  [string]$DiscoveryMode = "controversial",
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
$env:BILIBILI_VIDEO_COMMENT_PAGES = [string]$CommentPages
$env:BILIBILI_HARVEST_MAX_QUERIES = [string]$MaxQueries
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY = [string]$TermsPerFamily
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM = [string]$QueryVariantsPerTerm
$env:BILIBILI_HARVEST_TARGET_EVIDENCE = [string]$TargetEvidence
$env:BILIBILI_HARVEST_ROUNDS = [string]$Rounds
$env:BILIBILI_HARVEST_COVERAGE_MODE = $CoverageMode
$env:BILIBILI_VIDEO_DISCOVERY_MODE = $DiscoveryMode
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
Write-Host "Comment pages per video: $CommentPages"
Write-Host "Max harvest queries: $MaxQueries"
Write-Host "Dictionary terms per family: $TermsPerFamily"
Write-Host "Query variants per term: $QueryVariantsPerTerm"
Write-Host "Extra query templates: $($ExtraQueryTemplate.Count)"
Write-Host "Target evidence per term: $TargetEvidence"
Write-Host "Harvest rounds: $Rounds"
Write-Host "Coverage mode: $CoverageMode"
Write-Host "Discovery mode: $DiscoveryMode"
Write-Host "Reset harvest state: $ResetHarvestState"
Write-Host ""
Write-Host "Harvesting dictionary-seeded Bilibili videos, scanning comments, and training the local keyword dictionary..."

node .\server\runVideoKeywordDiscovery.js
