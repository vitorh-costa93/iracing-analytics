# Telemetria leve do PC (RAM, commit, CPU, GPU/VRAM, iRacing) a cada 3 s. Grava e descarrega a cada linha para sobreviver a travamentos/quedas.
$dir = Join-Path $env:USERPROFILE 'Documents\sys-monitor'; New-Item -ItemType Directory -Force $dir | Out-Null
$mutex = New-Object System.Threading.Mutex($false, 'Local\SysMonitorRacing'); if (-not $mutex.WaitOne(0)) { exit }
$os = Get-CimInstance Win32_OperatingSystem; $totalMB = [int]($os.TotalVisibleMemorySize / 1024)
$cpuCounter = New-Object System.Diagnostics.PerformanceCounter('Processor', '% Processor Time', '_Total'); [void]$cpuCounter.NextValue()
$commitCounter = New-Object System.Diagnostics.PerformanceCounter('Memory', '% Committed Bytes In Use')
$header = 'time,ramUsedMB,ramFreeMB,commitPct,cpuPct,gpuUtil,vramUsedMB,vramTotalMB,gpuTempC,gpuPowerW,gpuClockMHz,memClockMHz,gpuThrottle,iracingRunning,iracingPrivMB,iracingWsMB,agentRunning,topProc'
$file = $null; $nvidia = (Get-Command nvidia-smi -EA SilentlyContinue).Source
while ($true) {
  try {
    $now = Get-Date; $path = Join-Path $dir ("sys-{0:yyyy-MM-dd}.csv" -f $now)
    if ($path -ne $file) { $file = $path; if (-not (Test-Path $file)) { Set-Content $file $header -Encoding utf8 } }
    $m = Get-CimInstance Win32_OperatingSystem; $free = [int]($m.FreePhysicalMemory / 1024); $used = $totalMB - $free
    $gpu = @('', '', '', '', '', '', '', '')
    if ($nvidia) { $r = & $nvidia --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,clocks.gr,clocks.mem,clocks_throttle_reasons.active --format=csv,noheader,nounits 2>$null; if ($r) { $gpu = ($r -split ',\s*') } }
    $ir = Get-Process iRacingSim64DX11 -EA SilentlyContinue | Select -First 1
    $agent = [bool](Get-Process RacingAnalyticsAgent -EA SilentlyContinue)
    $top = Get-Process | Sort WorkingSet64 -desc | Select -First 1
    $ci=[Globalization.CultureInfo]::InvariantCulture; $line = [string]::Format($ci, '{0:yyyy-MM-ddTHH:mm:ss},{1},{2},{3:N1},{4:N1},{5},{6},{7},{8},{9},{10},{11},{12},{13},{14},{15},{16},{17}' , $now, $used, $free, $commitCounter.NextValue(), $cpuCounter.NextValue(), $gpu[0], $gpu[1], $gpu[2], $gpu[3], $gpu[4], $gpu[5], $gpu[6], $gpu[7], [bool]$ir, $(if ($ir) { [int]($ir.PrivateMemorySize64 / 1MB) } else { '' }), $(if ($ir) { [int]($ir.WorkingSet64 / 1MB) } else { '' }), $agent, ('{0}:{1}' -f $top.ProcessName, [int]($top.WorkingSet64 / 1MB)))
    $sw = New-Object System.IO.StreamWriter($file, $true); $sw.WriteLine($line); $sw.Flush(); $sw.Dispose()
  } catch {}
  Start-Sleep -Seconds 3
}
