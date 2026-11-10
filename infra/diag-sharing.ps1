# Diagnostic (lecture seule) : comment Microsoft Graph signale les éléments partagés des bibliothèques d'un site.
# Compare plusieurs variantes du parcours delta sur les premiers éléments de chaque bibliothèque, puis affiche
# éventuellement les permissions d'un élément connu comme partagé (adresses masquées : seul le domaine reste visible).
# Exemples :
#   .\infra\diag-sharing.ps1 -TenantId <tenant> -Site https://fimavi.sharepoint.com/sites/tsi
#   .\infra\diag-sharing.ps1 -TenantId <tenant> -Site <url> -Library "Documents de la collection de sites" -ItemPath "Dossier/fichier.xlsx"
param(
  [Parameter(Mandatory)][string]$TenantId,
  [Parameter(Mandatory)][string]$Site,
  [string]$Library,
  [string]$ItemPath,
  [int]$MaxItems = 3000
)
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.Graph.Authentication
Connect-MgGraph -TenantId $TenantId -Scopes 'Sites.Read.All' -NoWelcome

function Mask($value) {
  if ($value -is [string]) { return ($value -replace '[^\s@|#:/"]+@([A-Za-z0-9.-]+)', '***@$1') -replace '\|[^|#]+_([A-Za-z0-9.-]+)#ext#', '|***_$1#ext#' }
  return $value
}
function Get-Pages($uri, $headers, $max) {
  $items = @()
  while ($uri -and $items.Count -lt $max) {
    $r = Invoke-MgGraphRequest -Method GET -Uri $uri -Headers $headers
    $items += $r.value
    $uri = $r.'@odata.nextLink'
  }
  return $items
}

$u = [uri]$Site.TrimEnd('/')
$siteObj = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/sites/$($u.Host):$($u.AbsolutePath)?`$select=id,displayName"
$drives = @((Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/sites/$($siteObj.id)/drives?`$select=id,name").value)
Write-Host "Site : $($siteObj.displayName) - bibliothèques : $(($drives | ForEach-Object { '« ' + $_.name + ' »' }) -join ' ; ')"
if ($Library) {
  $drives = @($drives | Where-Object { $_.name -eq $Library })
  if (-not $drives.Count) { throw "Bibliothèque « $Library » introuvable : reprenez un nom de la liste ci-dessus, ou omettez -Library" }
}

foreach ($drive in $drives) {
  Write-Host "`n=== Bibliothèque « $($drive.name) » ==="
  $base = "https://graph.microsoft.com/v1.0/drives/$($drive.id)/root/delta"
  $variants = @(
    @{ Name = 'A. delta + $select + hierarchicalsharing (méthode actuelle)'; Uri = "$base`?`$select=id,name,parentReference,folder,root,shared,deleted"; Headers = @{ Prefer = 'hierarchicalsharing' } },
    @{ Name = 'B. delta sans $select, avec hierarchicalsharing'; Uri = $base; Headers = @{ Prefer = 'hierarchicalsharing' } },
    @{ Name = 'C. delta sans $select ni en-tête'; Uri = $base; Headers = @{} }
  )
  foreach ($v in $variants) {
    $items = @(Get-Pages $v.Uri $v.Headers $MaxItems)
    $shared = @($items | Where-Object { $_.ContainsKey('shared') })
    Write-Host ("{0} : {1} éléments lus, {2} avec la facette shared" -f $v.Name, $items.Count, $shared.Count)
    $shared | Select-Object -First 3 | ForEach-Object { Write-Host ("    ex. {0} -> shared = {1}" -f $_.name, (Mask ($_.shared | ConvertTo-Json -Compress -Depth 5))) }
  }
}

if ($ItemPath) {
  if (-not $Library) { throw 'Précisez -Library avec -ItemPath' }
  $drive = $drives[0]
  $path = ($ItemPath.Trim('/') -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
  $item = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/drives/$($drive.id)/root:/$path`?`$select=id,name,shared"
  Write-Host "`nÉlément : $($item.name) - facette shared présente : $($item.ContainsKey('shared'))"
  $perms = @((Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/drives/$($drive.id)/items/$($item.id)/permissions").value)
  Write-Host "Permissions ($($perms.Count)) :"
  foreach ($p in $perms) { Write-Host ('  ' + (Mask ($p | ConvertTo-Json -Compress -Depth 8))) }
}
Disconnect-MgGraph | Out-Null
