param(
  [Parameter(Mandatory = $true)]
  [string]$Task,
  [ValidateSet("auto", "light", "complex", "flash", "pro")]
  [string]$Mode = "auto",
  [string]$BriefPath = ".deepseek\brief.md",
  [string]$OutputPath = ".deepseek\output.md",
  [string]$CommitMessage = "",
  [switch]$SkipVerify,
  [switch]$Commit,
  [switch]$Push
)

# Runs a DeepSeek executor round from this repo. DeepSeek implements and can
# auto-apply files; this script verifies and optionally submits the result.

if (Test-Path ".\set-deepseek-env.ps1") {
  . ".\set-deepseek-env.ps1"
}

$executor = if ($env:CODEX_HOME) {
  Join-Path $env:CODEX_HOME "tools\deepseek-executor.mjs"
} else {
  Join-Path $env:USERPROFILE ".codex\tools\deepseek-executor.mjs"
}
if (-not (Test-Path $executor)) {
  if (Test-Path ".\.tools\deepseek-executor.mjs") {
    $executor = ".\.tools\deepseek-executor.mjs"
  } else {
    throw "DeepSeek executor not found. Expected $executor or .\.tools\deepseek-executor.mjs"
  }
}

if (-not $env:DEEPSEEK_API_KEY -or $env:DEEPSEEK_API_KEY -eq "put-your-deepseek-api-key-here") {
  throw "Set a real DEEPSEEK_API_KEY first. Copy set-deepseek-env.example.ps1 to set-deepseek-env.ps1 and put your key there."
}

$lowerTask = $Task.ToLowerInvariant()
$complexSignals = @("complex", "thinking", "reason", "language", "dictionary", "crawler", "coverage", "backend", "accuracy", "model", "merge", "analysis", "semantic")
$isComplex = $false
foreach ($signal in $complexSignals) {
  if ($lowerTask.Contains($signal)) {
    $isComplex = $true
    break
  }
}

$model = switch ($Mode) {
  "light" { "deepseek-v4-flash" }
  "flash" { "deepseek-v4-flash" }
  "complex" { "deepseek-v4-pro" }
  "pro" { "deepseek-v4-pro" }
  default {
    if ($isComplex) { "deepseek-v4-pro" } else { "deepseek-v4-flash" }
  }
}

$env:DEEPSEEK_MODEL = $model
$env:DEEPSEEK_REASONING_EFFORT = "max"
$env:DEEPSEEK_MAX_TOKENS = if ($model -eq "deepseek-v4-pro") { "16384" } else { "8192" }

$briefDir = Split-Path -Parent $BriefPath
if ($briefDir) {
  New-Item -ItemType Directory -Force -Path $briefDir | Out-Null
}

$timestamp = (Get-Date).ToString("o")
$brief = @"
# DeepSeek Implementation Brief
Generated: $timestamp

## Task
$Task

## Repository
- Node/Vite/React project.
- Follow existing code style.
- Use `apply` output blocks with complete file contents.
- For light mechanical work use deepseek-v4-flash; for complex language, crawler, backend, dictionary, or semantic work use deepseek-v4-pro.
- Reasoning effort for repo DeepSeek API flows must be max.

## Verification Required
- npm test
- npm run build
- git diff --check

## Output Format Required
For each changed file output fenced full-file blocks like:
```js:path/to/file.js
<complete file content>
```
End with:
<!-- CHANGED_FILES: file1, file2 -->
"@
Set-Content -LiteralPath $BriefPath -Value $brief -Encoding UTF8

Write-Host "DeepSeek model: $model"
Write-Host "DeepSeek effort: $env:DEEPSEEK_REASONING_EFFORT"
node $executor --brief $BriefPath --out $OutputPath --model $model --apply
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if (-not $SkipVerify) {
  npm test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  git diff --check
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($Commit) {
  $changed = git status --short
  if ($changed) {
    if (-not $CommitMessage) {
      $CommitMessage = "Apply DeepSeek job"
    }
    git add -A
    git commit -m $CommitMessage
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } else {
    Write-Host "No changes to commit."
  }
}

if ($Push) {
  git push
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
