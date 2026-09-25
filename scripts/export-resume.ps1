param([Parameter(Mandatory=$true)][string]$InputDocx, [Parameter(Mandatory=$true)][string]$OutputPdf)
$ErrorActionPreference = 'Stop'
$inputFile = (Resolve-Path -LiteralPath $InputDocx).Path
$outputFile = [System.IO.Path]::GetFullPath($OutputPdf)
if (Test-Path -LiteralPath $outputFile) { throw 'PDF output already exists; use a new version.' }
$word = $null
$document = $null
$previousUpdateLinks = $null
try {
    $word = New-Object -ComObject Word.Application
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
            if ($null -ne $previousUpdateLinks) { $word.Options.UpdateLinksAtOpen = $previousUpdateLinks }
            $word.Quit([ref]$doNotSave)
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
        }
    }
}
