param([Parameter(Mandatory=$true)][string]$Folder)
$ErrorActionPreference = 'Stop'
$folderPath = (Resolve-Path -LiteralPath $Folder).Path
$word = $null
$document = $null
$owned = $false
$oldLinks = $null
$mutex = New-Object System.Threading.Mutex($false, 'Local\CareerQueueV2Word')
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked -or (Get-Process WINWORD -ErrorAction SilentlyContinue)) { throw 'WORD_BUSY' }
    $word = New-Object -ComObject Word.Application
    # Refuse to use an existing interactive instance, even if one appeared after the initial check.
    if ($word.Visible -or $word.Documents.Count -gt 0) { throw 'WORD_BUSY' }
    $owned = $true
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $oldLinks = $word.Options.UpdateLinksAtOpen
    $word.Options.UpdateLinksAtOpen = $false
    foreach ($stem in @('baseline','resume')) {
        [string]$inputPath = [System.IO.Path]::Combine($folderPath, $stem + '.docx')
        [string]$outputPath = [System.IO.Path]::Combine($folderPath, $stem + '.pdf')
        if (Test-Path -LiteralPath $outputPath) { throw 'OUTPUT_EXISTS' }
        $document = $word.Documents.Open($inputPath, $false, $true, $false)
        $document.Repaginate()
        if ($document.ComputeStatistics(2) -ne 1) { throw 'ONE_PAGE_REQUIRED' }
        $document.ExportAsFixedFormat($outputPath, 17)
        $doNotSave = 0
        $document.Close([ref]$doNotSave)
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
        $document = $null
    }
    Write-Output '{"passed":true}'
} catch {
    if ($_.Exception.Message -match 'WORD_BUSY|ONE_PAGE_REQUIRED') { Write-Output $_.Exception.Message }
    else { Write-Output 'WORD_EXPORT_FAILED' }
    exit 1
} finally {
    $doNotSave = 0
    if ($document) { $document.Close([ref]$doNotSave); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
    if ($word) {
        if ($owned) {
            if ($null -ne $oldLinks) { $word.Options.UpdateLinksAtOpen = $oldLinks }
            $word.Quit([ref]$doNotSave)
        }
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
    }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
