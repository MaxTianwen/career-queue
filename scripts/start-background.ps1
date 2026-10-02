param([switch]$Install)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$taskName = 'Career Queue Background'
$backgroundScript = Join-Path $PSScriptRoot 'background.mjs'
$scheduler = New-Object -ComObject 'Schedule.Service'
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
$existing = $null
try { $existing = $folder.GetTask($taskName) } catch {
    if ($_.Exception.HResult -ne -2147024894) { throw }
}
$runner = Join-Path $PSScriptRoot 'run-background.vbs'
if ($existing -and $existing.Definition.Actions.Item(1).Arguments -notlike ('*"' + $runner + '"*')) { throw 'The background task name is already used by another workspace.' }
if ($Install) {
    $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $definition = $scheduler.NewTask(0)
    $definition.Principal.UserId = $user
    $definition.Principal.LogonType = 3 # Current interactive user; no password.
    $definition.Settings.MultipleInstances = 2 # IgnoreNew
    $definition.Settings.ExecutionTimeLimit = 'PT0S'
    $definition.Settings.DisallowStartIfOnBatteries = $false
    $definition.Settings.StopIfGoingOnBatteries = $false
    $definition.Settings.StartWhenAvailable = $true
    $definition.Settings.Hidden = $true
    $login = $definition.Triggers.Create(9)
    $login.UserId = $user
    $retry = $definition.Triggers.Create(1)
    $retry.StartBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
    $retry.Repetition.Interval = 'PT5M'
    $action = $definition.Actions.Create(0)
    $action.Path = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $action.Arguments = '//B //Nologo "' + $runner + '" "' + $nodeExecutable + '" "' + $backgroundScript + '"'
    $action.WorkingDirectory = $projectDirectory
    $existing = $folder.RegisterTaskDefinition($taskName, $definition, 6, $user, $null, 3)
    # Migrate only this workspace's old login entry after registration succeeds.
    $entry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $launcher = Join-Path $PSScriptRoot 'start-background.ps1'
    $old = (Get-ItemProperty -Path $entry -Name 'Career Queue' -ErrorAction SilentlyContinue).'Career Queue'
    if ($old -and $old.Contains('"' + $launcher + '"')) { Remove-ItemProperty -Path $entry -Name 'Career Queue' }
    Write-Output 'Career Queue hidden background task installed; checks recovery every five minutes while signed in.'
}
if ($existing) {
    $existing.Run($null) | Out-Null
} else {
    Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + $backgroundScript + '"') -WorkingDirectory $projectDirectory -WindowStyle Hidden
}
