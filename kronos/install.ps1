# Marvell Predict installer (Windows): sets up Kronos locally and starts it.
#   powershell -ExecutionPolicy Bypass -c "irm https://innocentbear67-mercury.github.io/Mercer-Fargo/kronos/install.ps1 | iex"
# Everything lands in %USERPROFILE%\.marvell-kronos; delete that folder to uninstall.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is 10x slower with the progress bar

$Base = if ($env:MARVELL_BASE) { $env:MARVELL_BASE } else { 'https://innocentbear67-mercury.github.io/Mercer-Fargo' }
$Dir = Join-Path $env:USERPROFILE '.marvell-kronos'
$Sha = '67b630e67f6a18c9e9be918d9b4337c960db1e9a'   # pinned shiyu-coder/Kronos commit
function Say($m) { Write-Host "`n==> $m" -ForegroundColor Yellow }

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Set-Location $Dir

Say '1/5 Python toolchain (uv)'
$env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
  $env:Path = "$env:USERPROFILE\.local\bin;$env:Path"
}

Say '2/5 Python 3.11 environment'
if (-not (Test-Path 'venv\Scripts\python.exe')) { uv venv --python 3.11 venv; if ($LASTEXITCODE) { throw 'uv venv failed' } }

Say '3/5 Kronos model code'
if (-not (Test-Path 'Kronos\model\kronos.py')) {
  if (Test-Path 'Kronos') { Remove-Item -Recurse -Force 'Kronos' }
  Invoke-WebRequest "https://codeload.github.com/shiyu-coder/Kronos/zip/$Sha" -OutFile 'kronos.zip'
  Expand-Archive 'kronos.zip' -DestinationPath '.' -Force
  Rename-Item "Kronos-$Sha" 'Kronos'
  Remove-Item 'kronos.zip'
}
Invoke-WebRequest "$Base/kronos/kronos_server.py" -OutFile 'kronos_server.py'

Say '4/5 PyTorch and libraries (about 1 GB the first time)'
uv pip install --python venv\Scripts\python.exe 'torch>=2.0' numpy 'pandas>=2.0' einops==0.8.1 huggingface_hub==0.33.1 safetensors tqdm
if ($LASTEXITCODE) { throw 'package install failed' }

$Update = "powershell -NoProfile -Command `"try { Invoke-WebRequest '$Base/kronos/kronos_server.py' -OutFile kronos_server.py.new -UseBasicParsing; Move-Item -Force kronos_server.py.new kronos_server.py } catch { }`""   # pick up server updates; offline, keep the copy we have
Set-Content -Path 'start.bat' -Value "@echo off`r`ncd /d `"$Dir`"`r`n$Update`r`nvenv\Scripts\python.exe kronos_server.py`r`npause"
$Desk = [Environment]::GetFolderPath('Desktop')
if ($Desk) { Copy-Item 'start.bat' (Join-Path $Desk 'Marvell Predict.bat') -Force }

Say '5/5 Downloading Kronos-base weights (~400 MB) and running a test forecast'
& venv\Scripts\python.exe kronos_server.py --check
if ($LASTEXITCODE) { throw 'Kronos self-check failed' }

Say "Done. Starting Marvell Predict - keep this window open, then go back to the site."
Write-Host "Next time, double-click 'Marvell Predict' on your Desktop."
& venv\Scripts\python.exe kronos_server.py
