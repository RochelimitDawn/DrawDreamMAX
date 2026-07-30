# Pack DrawDream clean source for Linux VPS (no node_modules, no runtime/user data)
# Usage: powershell -File scripts\pack-for-linux.ps1
# Uses Python zipfile (UTF-8 filenames) — Windows Compress-Archive corrupts Chinese paths.
$ErrorActionPreference = "Stop"
$prod = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $prod "package.json"))) {
  throw "Run from DrawDream tree; package.json not found at $prod"
}

Set-Location $prod
Write-Host "[pack] product root: $prod"

$parentDist = Join-Path (Split-Path $prod -Parent) "dist\index.html"
if (-not (Test-Path $parentDist)) {
  Write-Host "[pack] WARN: parent UI dist missing ($parentDist). Build drawdream/ first for full product shell."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outDir = Join-Path (Split-Path $prod -Parent) "_release"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipName = "DrawDream-linux-$stamp.zip"
$zipPath = Join-Path $outDir $zipName
$stage = Join-Path $env:TEMP "drawdream-pack-$stamp"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

Write-Host "[pack] staging clean source (exclude runtime data, deps, junk)..."
# Runtime / user state must NEVER ship in source packages.
# robocopy /XD matches directory *names* anywhere in the tree (e.g. all node_modules).
$xd = @(
  "node_modules",
  ".git",
  ".drawdream", ".drawdream-artifacts", ".drawdream-cache", ".drawdream-codex",
  ".drawdream-lore", ".drawdream-media", ".drawdream-skills", ".drawdream-state",
  ".drawdream-uploads", ".drawdream-media", ".drawdream-uploads",
  ".playwright-mcp",
  "ab-test", "import-test"
)
$xf = @(
  "*.log", "*.tsbuildinfo", ".DS_Store",
  "*.bak",
  ".drawdream-personas.json",
  "shot-*.png", "bug-*.png", "fix-*.png", "latest-ui.png",
  "tmp-*.png"
)
$dest = Join-Path $stage "DrawDream"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$robArgs = @($prod, $dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/nc", "/ns", "/np")
foreach ($d in $xd) { $robArgs += "/XD"; $robArgs += $d }
foreach ($f in $xf) { $robArgs += "/XF"; $robArgs += $f }
& robocopy @robArgs | Out-Null
$rc = $LASTEXITCODE
if ($rc -ge 8) { throw "robocopy failed: $rc" }
Write-Host "[pack] robocopy exit $rc (0-7 = ok)"

# Strip personal keys from shipped config → safe defaults (no private paths if possible)
$cfgPath = Join-Path $stage "DrawDream\drawdream.config.json"
if (Test-Path $cfgPath) {
  $cfg = Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json
  # keep structure; neutralize user-specific runtime pointers that break on clean install
  if ($cfg.PSObject.Properties.Name -contains "userName") { $cfg.userName = "User" }
  if ($cfg.PSObject.Properties.Name -contains "userPersona") { $cfg.userPersona = "" }
  $cfg | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $cfgPath -Encoding UTF8
}

# ensure start.sh LF endings for Linux
$sh = Join-Path $stage "DrawDream\start.sh"
if (Test-Path $sh) {
  $t = [IO.File]::ReadAllText($sh) -replace "`r`n", "`n" -replace "`r", "`n"
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($sh, $t, $utf8)
}

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# UTF-8 zip via Python (critical for Chinese filenames on Linux)
$py = @"
import zipfile, os, sys
from pathlib import Path
stage = Path(r'''$stage''') / 'DrawDream'
zip_path = Path(r'''$zipPath''')
with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(stage):
        # skip any leftover junk
        dirs[:] = [d for d in dirs if d not in {
            'node_modules', '.git', '.drawdream', '.drawdream-cache',
            '.drawdream-artifacts', '.drawdream-codex', '.drawdream-lore',
            '.drawdream-media', '.drawdream-skills', '.drawdream-state',
            '.drawdream-uploads', '.drawdream-media', '.drawdream-uploads'
        }]
        for f in files:
            if f.endswith(('.log', '.bak', '.tsbuildinfo')):
                continue
            abs_p = Path(root) / f
            # archive root = DrawDream/...
            rel = Path('DrawDream') / abs_p.relative_to(stage)
            # ZipInfo with UTF-8 flag
            zi = zipfile.ZipInfo(rel.as_posix())
            zi.flag_bits |= 0x800  # UTF-8 filenames
            zi.compress_type = zipfile.ZIP_DEFLATED
            data = abs_p.read_bytes()
            zf.writestr(zi, data)
print('wrote', zip_path, 'bytes', zip_path.stat().st_size)
"@
$pyFile = Join-Path $env:TEMP "drawdream-pack-zip-$stamp.py"
Set-Content -LiteralPath $pyFile -Value $py -Encoding UTF8
python $pyFile
if ($LASTEXITCODE -ne 0) { throw "python zip failed: $LASTEXITCODE" }
Remove-Item $pyFile -Force -ErrorAction SilentlyContinue
Remove-Item $stage -Recurse -Force

$sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "[pack] OK: $zipPath ($sizeMb MB)"
Write-Host "[pack] Clean source: no .drawdream* runtime, no node_modules, UTF-8 Chinese paths"
Write-Host "[pack] On VPS:"
Write-Host "  unzip $zipName && cd DrawDream"
Write-Host "  npm install && chmod +x start.sh && ./start.sh"
Write-Host "  # open http://<vps-ip>:7620  (firewall allow 7620)"
