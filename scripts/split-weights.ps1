[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,
  [string]$OutputDirectory = '.\models',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$sourcePath = (Resolve-Path -LiteralPath $InputPath).Path
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
[System.IO.Directory]::CreateDirectory($outputPath) | Out-Null

$sourceLength = (Get-Item -LiteralPath $sourcePath).Length
$firstLength = [long][Math]::Floor($sourceLength / 2)
$partLengths = @($firstLength, ($sourceLength - $firstLength))
$partPaths = @(
  (Join-Path $outputPath 'cattle_breeds.onnx.data.0'),
  (Join-Path $outputPath 'cattle_breeds.onnx.data.1')
)

if (-not $Force) {
  $existing = @($partPaths | Where-Object { Test-Path -LiteralPath $_ })
  if ($existing.Count -gt 0) {
    throw "Output chunk(s) already exist. Use -Force to replace them: $($existing -join ', ')"
  }
}

$buffer = New-Object byte[] (1024 * 1024)
$source = [System.IO.File]::OpenRead($sourcePath)
try {
  for ($index = 0; $index -lt 2; $index++) {
    $remaining = $partLengths[$index]
    $destination = [System.IO.File]::Create($partPaths[$index])
    try {
      while ($remaining -gt 0) {
        $requested = [int][Math]::Min($buffer.Length, $remaining)
        $read = $source.Read($buffer, 0, $requested)
        if ($read -le 0) { throw "Source ended before chunk $index was complete." }
        $destination.Write($buffer, 0, $read)
        $remaining -= $read
      }
    }
    finally { $destination.Dispose() }
  }
  if ($source.Position -ne $sourceLength) { throw 'The source was not completely split.' }
}
finally { $source.Dispose() }

$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$combinedHash = [System.Security.Cryptography.IncrementalHash]::CreateHash([System.Security.Cryptography.HashAlgorithmName]::SHA256)
try {
  foreach ($partPath in $partPaths) {
    $partStream = [System.IO.File]::OpenRead($partPath)
    try {
      while (($read = $partStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $combinedHash.AppendData($buffer, 0, $read)
      }
    }
    finally { $partStream.Dispose() }
  }
  $reconstructedHash = [BitConverter]::ToString($combinedHash.GetHashAndReset()).Replace('-', '')
}
finally { $combinedHash.Dispose() }

if ($sourceHash -ne $reconstructedHash) { throw 'The chunk hashes do not match the source file.' }
for ($index = 0; $index -lt 2; $index++) {
  $chunkHash = (Get-FileHash -LiteralPath $partPaths[$index] -Algorithm SHA256).Hash
  [PSCustomObject]@{ File = [System.IO.Path]::GetFileName($partPaths[$index]); Bytes = $partLengths[$index]; SHA256 = $chunkHash }
}
[PSCustomObject]@{ File = 'Reconstructed source'; Bytes = $sourceLength; SHA256 = $reconstructedHash }