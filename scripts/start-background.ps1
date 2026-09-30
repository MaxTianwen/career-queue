param([switch]$Install)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
if ($Install) {
    $entry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $launcher = Join-Path $PSScriptRoot 'start-background.ps1'
    $command = 'powershell.exe -NoProfile -WindowStyle Hidden -File "' + $launcher + '"'
    New-ItemProperty -Path $entry -Name 'Career Queue' -Value $command -PropertyType String -Force | Out-Null
    Write-Output 'Career Queue will start when the current user signs in.'
}
$backgroundScript = Join-Path $PSScriptRoot 'background.mjs'
Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $backgroundScript + '"') -WorkingDirectory $projectDirectory -WindowStyle Hidden
