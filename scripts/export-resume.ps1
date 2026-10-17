param([Parameter(Mandatory=$true)][string]$InputDocx, [Parameter(Mandatory=$true)][string]$OutputPdf)
$ErrorActionPreference = 'Stop'
$inputFile = (Resolve-Path -LiteralPath $InputDocx).Path
$outputFile = [System.IO.Path]::GetFullPath($OutputPdf)
if (Test-Path -LiteralPath $outputFile) { throw 'PDF output already exists; use a new version.' }
$word = $null
$document = $null
$previousUpdateLinks = $null
$owned = $false
$mutex = New-Object System.Threading.Mutex($false, 'Local\CareerQueueV2Word')
$locked = $false
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked -or (Get-Process WINWORD -ErrorAction SilentlyContinue)) { throw 'WORD_BUSY' }
    $word = New-Object -ComObject Word.Application
    if ($word.Visible -or $word.Documents.Count -gt 0) { throw 'WORD_BUSY' }
    $owned = $true
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $word.AutomationSecurity = 3
    $previousUpdateLinks = $word.Options.UpdateLinksAtOpen
    $word.Options.UpdateLinksAtOpen = $false
    # Read-only and not added to recent files; never save the opened DOCX.
    $document = $word.Documents.Open($inputFile, $false, $true, $false)
    $document.Repaginate()
    $pages = $document.ComputeStatistics(2)
    $document.ExportAsFixedFormat($outputFile, 17)
    @{ pages = $pages; renderer = 'Microsoft Word'; pdf = $outputFile } | ConvertTo-Json -Compress
} finally {
    $doNotSave = 0
    try {
        if ($document) { $document.Close([ref]$doNotSave); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document) }
    } finally {
        if ($word) {
            if ($owned -and $null -ne $previousUpdateLinks) { $word.Options.UpdateLinksAtOpen = $previousUpdateLinks }
            if ($owned) { $word.Quit([ref]$doNotSave) }
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
        }
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
