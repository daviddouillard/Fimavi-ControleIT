# Accorde à l'application ControleIT le contrôle total (Sites.Selected, rôle « fullcontrol ») sur des sites précis.
# Nécessaire pour détecter tous les partages de dossiers et de fichiers (delta « Prefer: hierarchicalsharing »).
# L'application elle-même ne peut pas s'accorder ce droit : à lancer par un administrateur SharePoint du tenant
# concerné (connexion déléguée Sites.FullControl.All), membre des sites visés.
#
# Prérequis (une fois) : Install-Module Microsoft.Graph.Sites -Scope CurrentUser
#                        App registration : permission d'application Microsoft Graph « Sites.Selected » consentie.
# Exemple :
#   powershell -ExecutionPolicy Bypass -File infra\grant-site-fullcontrol.ps1 -TenantId <tenant> -ClientId <app id> `
#     -Sites https://fimavi.sharepoint.com/sites/tsi, https://fimavi.sharepoint.com/sites/direction
param(
  [Parameter(Mandatory)][string]$TenantId,
  [Parameter(Mandatory)][string]$ClientId,
  [Parameter(Mandatory)][string[]]$Sites,
  [string]$DisplayName = 'ControleIT'
)
$ErrorActionPreference = 'Stop'
Import-Module Microsoft.Graph.Sites
Connect-MgGraph -TenantId $TenantId -Scopes 'Sites.FullControl.All' -NoWelcome

foreach ($url in $Sites) {
  try {
    $uri = [uri]$url.TrimEnd('/')
    if ($uri.Host -notlike '*.sharepoint.com') { throw "URL SharePoint attendue : $url" }
    $site = Get-MgSite -SiteId "$($uri.Host):$($uri.AbsolutePath)"
    $existing = Get-MgSitePermission -SiteId $site.Id -All |
      Where-Object { $_.GrantedToIdentitiesV2.Application.Id -contains $ClientId -or $_.GrantedToIdentities.Application.Id -contains $ClientId }
    if ($existing | Where-Object { $_.Roles -contains 'fullcontrol' }) {
      Write-Host "[déjà accordé] $url" -ForegroundColor DarkGray
      continue
    }
    # Un droit inférieur déjà accordé est remplacé (la modification n'est pas possible en délégué).
    foreach ($p in $existing) { Remove-MgSitePermission -SiteId $site.Id -PermissionId $p.Id }
    New-MgSitePermission -SiteId $site.Id -BodyParameter @{
      roles               = @('fullcontrol')
      grantedToIdentities = @(@{ application = @{ id = $ClientId; displayName = $DisplayName } })
    } | Out-Null
    Write-Host "[accordé] $url" -ForegroundColor Green
  } catch {
    Write-Host "[échec] $url : $($_.Exception.Message)" -ForegroundColor Red
  }
}
Disconnect-MgGraph | Out-Null
