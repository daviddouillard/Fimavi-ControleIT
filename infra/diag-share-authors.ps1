# Diagnostic (lecture seule) : Microsoft Graph indique-t-il QUI a créé les partages d'un site ?
# Parcourt les bibliothèques du site, lit les permissions des éléments partagés et compte :
#   - la facette « shared » : sharedBy (auteur) et sharedDateTime (date) ;
#   - les invitations : invitation.invitedBy ;
#   - les liens de partage, et les champs qu'ils exposent.
# Aucune écriture. Adresses masquées (seul le domaine reste visible).
# Exemple :
#   .\infra\diag-share-authors.ps1 -TenantId <tenant> -Site https://fimavi.sharepoint.com/sites/tsi
param(
  [Parameter(Mandatory)][string]$TenantId,
  [Parameter(Mandatory)][string]$Site,
  [int]$MaxItems = 20000,
  [int]$MaxShared = 150
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
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
function Has($obj, $key) { return $obj -and $obj.ContainsKey($key) -and $obj[$key] }

$u = [uri]$Site.TrimEnd('/')
$siteObj = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/sites/$($u.Host):$($u.AbsolutePath)?`$select=id,displayName"
$drives = @((Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/sites/$($siteObj.id)/drives?`$select=id,name").value)
Write-Host "Site : $($siteObj.displayName) - $($drives.Count) bibliothèque(s)"

$c = [ordered]@{
  'Éléments partagés analysés'                 = 0
  '  dont facette shared.sharedBy (auteur)'    = 0
  '  dont facette shared.sharedDateTime (date)' = 0
  'Permissions lues (hors héritées)'           = 0
  'Invitations'                                = 0
  '  dont invitation.invitedBy (auteur)'       = 0
  'Liens de partage'                           = 0
}
$linkKeys = @{}
$examples = @()

foreach ($drive in $drives) {
  $uri = "https://graph.microsoft.com/v1.0/drives/$($drive.id)/root/delta?`$select=id,name,root,shared,deleted"
  $shared = @(Get-Pages $uri @{ Prefer = 'hierarchicalsharing' } $MaxItems | Where-Object { $_.ContainsKey('shared') -and -not $_.ContainsKey('root') -and -not $_.ContainsKey('deleted') })
  foreach ($item in $shared) {
    if ($c['Éléments partagés analysés'] -ge $MaxShared) { break }
    $c['Éléments partagés analysés']++
    if (Has $item.shared 'sharedBy') { $c['  dont facette shared.sharedBy (auteur)']++ }
    if (Has $item.shared 'sharedDateTime') { $c['  dont facette shared.sharedDateTime (date)']++ }
    $perms = @((Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/drives/$($drive.id)/items/$($item.id)/permissions").value)
    foreach ($p in $perms) {
      if (Has $p 'inheritedFrom') { continue }
      $c['Permissions lues (hors héritées)']++
      if (Has $p 'invitation') {
        $c['Invitations']++
        if (Has $p.invitation 'invitedBy') { $c['  dont invitation.invitedBy (auteur)']++ }
      }
      if (Has $p 'link') {
        $c['Liens de partage']++
        foreach ($k in $p.Keys) { $linkKeys[$k] = 1 + [int]$linkKeys[$k] }
        foreach ($k in $p.link.Keys) { $linkKeys["link.$k"] = 1 + [int]$linkKeys["link.$k"] }
      }
      if ($examples.Count -lt 3 -and ((Has $p 'invitation') -or (Has $p 'link'))) {
        $examples += "  [$($item.name)] " + (Mask ($p | ConvertTo-Json -Compress -Depth 8))
      }
    }
  }
}

Write-Host "`n=== Résultat ==="
foreach ($k in $c.Keys) { Write-Host ("{0,-45} {1}" -f $k, $c[$k]) }
Write-Host "`nChamps présents sur les liens (nombre de liens) :"
foreach ($k in ($linkKeys.Keys | Sort-Object)) { Write-Host ("  {0,-30} {1}" -f $k, $linkKeys[$k]) }
Write-Host "`nExemples (adresses masquées) :"
$examples | ForEach-Object { Write-Host $_ }
Disconnect-MgGraph | Out-Null
