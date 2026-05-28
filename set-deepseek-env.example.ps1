# Copy this file to set-deepseek-env.ps1, then put your real API key there.
# Run it from PowerShell with dot-sourcing so the variables stay in the current shell:
#   . .\set-deepseek-env.ps1
#
# Then start the app:
#   npm run server

$env:DEEPSEEK_API_KEY = "put-your-deepseek-api-key-here"
$env:DEEPSEEK_BASE_URL = "https://api.deepseek.com"
$env:DEEPSEEK_MODEL = "deepseek-v4-pro"
$env:DEEPSEEK_REASONING_EFFORT = "max"

if ($env:DEEPSEEK_API_KEY -eq "put-your-deepseek-api-key-here") {
  Write-Warning "Replace the placeholder in set-deepseek-env.ps1 with your real DeepSeek API key."
} else {
  Write-Host "DeepSeek environment configured for model $env:DEEPSEEK_MODEL with reasoning effort $env:DEEPSEEK_REASONING_EFFORT"
}
