# Edit these links, then run this script from PowerShell:
#   .\run-bilibili-video.ps1

$bilibiliVideoLinks = @(
  "https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=d3f6474bdf9e6de8d027785f1120afd4"
  "https://www.bilibili.com/video/BV18SLt6qEp9/?vd_source=d3f6474bdf9e6de8d027785f1120afd4"
  "https://www.bilibili.com/video/BV12MABzGEZq/"
  "https://www.bilibili.com/video/BV1S1W1zQEcq/"
  "https://www.bilibili.com/video/BV125nMzqEsM/"
  "https://www.bilibili.com/video/BV1sKhRzdEBD/"
  "https://www.bilibili.com/video/BV1cLbQzKEnu/"
  "https://www.bilibili.com/video/BV1MZ421K7x8/?vd_source=d3f6474bdf9e6de8d027785f1120afd4"
  "https://www.bilibili.com/video/BV1ECF8zvEUW?spm_id_from=333.788.recommend_more_video.0&trackid=web_related_0.router-related-2479604-fc7wt.1779601733788.445&vd_source=d3f6474bdf9e6de8d027785f1120afd4"
  “https://www.bilibili.com/video/BV1K44y1z7iu/?vd_source=d3f6474bdf9e6de8d027785f1120afd4”
  
)

$env:BILIBILI_DEFAULT_VIDEO_LINKS = ($bilibiliVideoLinks -join "`n")
$env:BILIBILI_DEFAULT_VIDEO_LINK = $bilibiliVideoLinks[0]

if (Test-Path ".\set-deepseek-env.ps1") {
  . ".\set-deepseek-env.ps1"
} else {
  Write-Warning "set-deepseek-env.ps1 was not found. DeepSeek extraction will use the local fallback unless DEEPSEEK_API_KEY is already set."
}

Write-Host "Backend default Bilibili videos:"
$bilibiliVideoLinks | ForEach-Object { Write-Host " - $_" }
Write-Host ""
Write-Host "Starting API and frontend. Open the Vite URL printed below, then click 后端默认视频."

npm run server
