param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=NAVIMATICS LLC') { throw 'A assinatura do instalador WinFsp não corresponde ao fornecedor oficial.' }
Write-Output 'Assinatura oficial do WinFsp validada.'
