$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath ".env")) {
  Copy-Item -LiteralPath ".env.example" -Destination ".env"
  $password = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 20 | ForEach-Object {[char]$_})
  $secretBytes = New-Object byte[] 48
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
  $secret = [Convert]::ToBase64String($secretBytes)
  $content = Get-Content -Raw -LiteralPath ".env"
  $content = $content.Replace("change-this-strong-password", $password).Replace("replace-with-at-least-32-random-characters", $secret)
  Set-Content -LiteralPath ".env" -Value $content -Encoding utf8
  Write-Host "Da tao .env an toan. Mat khau admin: $password" -ForegroundColor Green
  Write-Host "Hay luu mat khau nay, sau do dien AI_API_KEY va SEARCH_API_KEY vao .env." -ForegroundColor Yellow
} else {
  Write-Host ".env da ton tai, khong ghi de." -ForegroundColor Yellow
}
npm install
Write-Host "Cai dat xong. Chay: npm run dev" -ForegroundColor Cyan
