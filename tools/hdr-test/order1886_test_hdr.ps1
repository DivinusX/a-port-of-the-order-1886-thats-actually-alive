# HDR test build (#66). Put this file and "Play with HDR.bat" in the unzipped test package, next to
# "Play The Order 1886.exe". Start the game once from that launcher first (it prepares the game and
# writes user\order1886\logs\last-run.json), close it, then double-click "Play with HDR.bat".
#
# The launcher does not pass the HDR switches yet, so this starts the game directly with the
# launcher's last command line and settings, plus:
#   (no option)         HDR10 output (needs an HDR display with "Use HDR" on in Windows settings)
#   -PaperWhite <nits>  brightness of SDR white: HUD, menus, normal scene (default 200)
#   -Peak <nits>        brightness of the brightest highlights (default 1000)
#   -Knee <0.2-0.95>    SDR level where highlights start to get brighter (default 0.8)
#   -Preview 1          no HDR display: HDR range squeezed into SDR
#   -Preview 2          no HDR display: pixels that HDR makes brighter tinted magenta
# The run keeps its own shader cache (user\order1886\hdr-test\gpu) and writes its console log to
# user\order1886\hdr-test\console-<time>.log. Creating user\order1886\hdr-test\hdr.trigger while the
# game runs writes that frame's HDR maps to user\order1886\hdr-test\dumps.
param([string]$Runtime = '', [ValidateSet(0, 1, 2)][int]$Preview = 0, [string]$PaperWhite = '',
      [string]$Peak = '', [string]$Knee = '', [string]$Skip = '')
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if ($Runtime -eq '') { $Runtime = $root }
$runFile = Join-Path $root 'user\order1886\logs\last-run.json'
if (-not (Test-Path -LiteralPath $runFile)) {
    throw "No $runFile yet: start the game once with ""Play The Order 1886.exe"" from this folder, then close it."
}
$run = Get-Content -LiteralPath $runFile -Raw | ConvertFrom-Json
if (Get-Process -Name 'order1886-runtime' -ErrorAction SilentlyContinue) { throw 'The game is already running. Close it first.' }

$found = Get-ChildItem -LiteralPath $Runtime -Recurse -Filter 'order1886-runtime.exe' | Select-Object -First 1
if (-not $found) { throw "No order1886-runtime.exe under $Runtime" }
$exe = $found.FullName

$work = Join-Path $root 'user\order1886\hdr-test'
$gpu = Join-Path $work 'gpu'
$dumps = Join-Path $work 'dumps'
New-Item -ItemType Directory -Force $gpu, $dumps | Out-Null

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.WorkingDirectory = Split-Path -Parent $exe
$psi.UseShellExecute = $false
$quoted = foreach ($a in $run.command[1..($run.command.Count - 1)]) { if ($a -match '[\s"]') { '"' + ($a -replace '"', '\"') + '"' } else { $a } }
$psi.Arguments = $quoted -join ' '
foreach ($k in @($psi.EnvironmentVariables.Keys)) { if ($k -like 'ORDER1886_*') { $psi.EnvironmentVariables.Remove($k) } }
foreach ($p in $run.runtime_environment.PSObject.Properties) { $psi.EnvironmentVariables[$p.Name] = [string]$p.Value }
$psi.EnvironmentVariables['PATH'] = (Split-Path -Parent $exe) + ';' + $psi.EnvironmentVariables['PATH']
$psi.EnvironmentVariables['ORDER1886_GPU_USER_DIR'] = $gpu
if ($Preview -gt 0) {
    $psi.EnvironmentVariables['ORDER1886_HDR_PREVIEW'] = [string]$Preview
} else {
    $psi.EnvironmentVariables['ORDER1886_HDR'] = '1'
}
if ($PaperWhite -ne '') { $psi.EnvironmentVariables['ORDER1886_HDR_PAPER_WHITE'] = $PaperWhite }
if ($Peak -ne '') { $psi.EnvironmentVariables['ORDER1886_HDR_PEAK'] = $Peak }
if ($Knee -ne '') { $psi.EnvironmentVariables['ORDER1886_HDR_KNEE'] = $Knee }
if ($Skip -ne '') { $psi.EnvironmentVariables['ORDER1886_HDR_SKIP'] = $Skip }
$psi.EnvironmentVariables['ORDER1886_HDR_DUMP_TRIGGER'] = (Join-Path $work 'hdr.trigger')
$psi.EnvironmentVariables['ORDER1886_DUMP_DIR'] = $dumps

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $work "console-$stamp.log"
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi
$writer = [System.IO.StreamWriter]::new($out, $false, [System.Text.UTF8Encoding]::new($false))
$writer.AutoFlush = $true
$writer.WriteLine("runtime=$exe preview=$Preview paper_white=$PaperWhite peak=$Peak knee=$Knee skip=$Skip")
$handler = { if ($EventArgs.Data) { $Event.MessageData.WriteLine($EventArgs.Data) } }
$e1 = Register-ObjectEvent $process OutputDataReceived -Action $handler -MessageData $writer
$e2 = Register-ObjectEvent $process ErrorDataReceived -Action $handler -MessageData $writer
[void]$process.Start()
$process.BeginOutputReadLine()
$process.BeginErrorReadLine()
"Started the HDR test (preview $Preview), pid $($process.Id)"
"Console log: $out"
while (-not $process.HasExited) { Start-Sleep -Milliseconds 500 }
Start-Sleep 1
Unregister-Event -SourceIdentifier $e1.Name; Unregister-Event -SourceIdentifier $e2.Name
$writer.WriteLine("exit=$($process.ExitCode)")
$writer.Close()
"Game exited ($($process.ExitCode)). Console log: $out"
