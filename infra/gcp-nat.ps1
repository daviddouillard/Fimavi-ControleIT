# Sortie Internet à adresse IP fixe pour ControleIT (idempotent, à exécuter par un Owner du projet).
#
# L'API interne fimapi2 (modèle « Accès Sage ») filtre les adresses IP. Le service et le Job de collecte sortent
# par le réseau VPC « controleit-vpc », créé ici (Direct VPC egress, posé par le pipeline quand la variable GitHub
# VPC_EGRESS_NETWORK vaut « controleit-vpc ») puis par un Cloud NAT à IP statique réservée.
# Cette IP doit ensuite être autorisée côté Fimavi sur fimapi2.
#
# Le script donne aussi au compte controleit-run l'accès au secret de la clé de l'API Sage.
$ErrorActionPreference = 'Stop'

$Project = 'fimavi-controleit'
$Region  = 'europe-west9'
$Network = 'controleit-vpc'          # réseau et sous-réseau du même nom
$SubnetRange = '10.10.0.0/24'
$Ip      = 'controleit-nat-ip'
$Router  = 'controleit-router'
$Nat     = 'controleit-nat'
$RunSa   = "controleit-run@$Project.iam.gserviceaccount.com"
$SageKeySecret = 'controleit-sage-api-key'

function Check($what) { if ($LASTEXITCODE -ne 0) { throw "Échec : $what (code $LASTEXITCODE)" } }
function Test-Exists([scriptblock]$describe) {
  $ErrorActionPreference = 'Continue'
  & $describe 2>$null | Out-Null
  $ok = $LASTEXITCODE -eq 0
  $ErrorActionPreference = 'Stop'
  return $ok
}

Write-Host "`n== API Compute Engine ==" -ForegroundColor Cyan
gcloud services enable compute.googleapis.com --project $Project
Check 'gcloud services enable compute'

Write-Host "`n== Réseau $Network et sous-réseau $Network ($Region) ==" -ForegroundColor Cyan
if (-not (Test-Exists { gcloud compute networks describe $Network --project $Project --format='value(name)' })) {
  gcloud compute networks create $Network --subnet-mode custom --project $Project
  Check 'gcloud compute networks create'
} else { Write-Host "Réseau $Network : déjà présent" }
# Direct VPC egress : un /26 au moins ; aucune règle de pare-feu entrante (rien n'écoute dans ce réseau).
if (-not (Test-Exists { gcloud compute networks subnets describe $Network --region $Region --project $Project --format='value(name)' })) {
  gcloud compute networks subnets create $Network --network $Network --region $Region --range $SubnetRange --project $Project
  Check 'gcloud compute networks subnets create'
} else { Write-Host "Sous-réseau $Network : déjà présent" }

Write-Host "`n== IP statique $Ip ==" -ForegroundColor Cyan
if (-not (Test-Exists { gcloud compute addresses describe $Ip --region $Region --project $Project --format='value(name)' })) {
  gcloud compute addresses create $Ip --region $Region --project $Project
  Check 'gcloud compute addresses create'
} else { Write-Host "IP $Ip : déjà réservée" }

Write-Host "`n== Routeur $Router et Cloud NAT $Nat ==" -ForegroundColor Cyan
if (-not (Test-Exists { gcloud compute routers describe $Router --region $Region --project $Project --format='value(name)' })) {
  gcloud compute routers create $Router --network $Network --region $Region --project $Project
  Check 'gcloud compute routers create'
} else { Write-Host "Routeur $Router : déjà présent" }
if (-not (Test-Exists { gcloud compute routers nats describe $Nat --router $Router --region $Region --project $Project --format='value(name)' })) {
  gcloud compute routers nats create $Nat --router $Router --region $Region --project $Project `
    --nat-all-subnet-ip-ranges --nat-external-ip-pool $Ip
  Check 'gcloud compute routers nats create'
} else { Write-Host "Cloud NAT $Nat : déjà présent" }

Write-Host "`n== Secret $SageKeySecret ==" -ForegroundColor Cyan
if (Test-Exists { gcloud secrets describe $SageKeySecret --project $Project --format='value(name)' }) {
  gcloud secrets add-iam-policy-binding $SageKeySecret --project $Project `
    --member="serviceAccount:$RunSa" --role=roles/secretmanager.secretAccessor | Out-Null
  Check 'gcloud secrets add-iam-policy-binding'
  Write-Host "Accès de $RunSa au secret : accordé"
} else { Write-Host "Secret $SageKeySecret absent : le créer avant de relancer ce script." -ForegroundColor Yellow }

$address = gcloud compute addresses describe $Ip --region $Region --project $Project --format='value(address)'
Write-Host "`nIP de sortie de ControleIT : $address" -ForegroundColor Green
Write-Host 'À faire ensuite :'
Write-Host "  1. Faire autoriser cette IP sur fimapi2 (filtrage IP côté Fimavi)."
Write-Host '  2. Variables GitHub : VPC_EGRESS_NETWORK=controleit-vpc, SAGE_API_URL, SAGE_API_KEY_SECRET=controleit-sage-api-key.'
