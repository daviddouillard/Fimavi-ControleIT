# Création initiale de l'infrastructure GCP de ControleIT (à exécuter une seule fois, par un Owner du projet).
# - Ne modifie pas la configuration gcloud par défaut : chaque commande cible explicitement le projet.
# - Les mots de passe et secrets sont générés aléatoirement et envoyés directement dans Secret Manager, sans être affichés.
# - Ré-exécutable : les ressources déjà présentes sont signalées et ignorées.

$ErrorActionPreference = 'Stop'

$Project       = 'fimavi-controleit'
$ProjectNumber = '445174732770'
$Region        = 'europe-west9'
$Repo          = 'daviddouillard/Fimavi-ControleIT'
$Instance      = 'controleit-db'
$Database      = 'controleit'
$Service       = 'controleit'
$RunSa         = "controleit-run@$Project.iam.gserviceaccount.com"
$DeployerSa    = "controleit-deployer@$Project.iam.gserviceaccount.com"

function Step($label) { Write-Host "`n== $label ==" -ForegroundColor Cyan }

function NewPassword([int]$length = 40) {
  $chars = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  $bytes = New-Object byte[] $length
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

# PowerShell 5.1 ne s'arrête pas quand une commande native échoue : on vérifie le code retour explicitement.
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "Échec : $what (code $LASTEXITCODE)" } }

function Exists([scriptblock]$probe) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { & $probe *> $null; return $LASTEXITCODE -eq 0 } catch { return $false } finally { $ErrorActionPreference = $previous }
}

function EnsureSecret($name, $value) {
  if (Exists { gcloud secrets describe $name --project $Project }) { Write-Host "secret $name : déjà présent"; return }
  # Fichier temporaire sans retour à la ligne final (un pipe PowerShell en ajouterait un), supprimé aussitôt.
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmp, $value)
    gcloud secrets create $name --project $Project --replication-policy=user-managed --locations=$Region --data-file=$tmp | Out-Null
    Check 'gcloud secrets create $name'
    Check "création du secret $name"
  } finally { Remove-Item $tmp -Force }
  Write-Host "secret $name : créé"
}

Step 'APIs'
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com `
  secretmanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com `
  cloudresourcemanager.googleapis.com --project $Project
Check 'gcloud services enable run.googleapis.com'

Step 'Artifact Registry'
if (-not (Exists { gcloud artifacts repositories describe $Service --location $Region --project $Project })) {
  gcloud artifacts repositories create $Service --repository-format=docker --location=$Region --project $Project `
    --description='Images ControleIT'
  Check 'gcloud artifacts repositories create'
}

Step 'Cloud SQL (PostgreSQL)'
if (-not (Exists { gcloud sql instances describe $Instance --project $Project })) {
  # IP publique sans réseau autorisé : seules les connexions via le connecteur Cloud SQL (IAM) sont possibles.
  gcloud sql instances create $Instance --project $Project --region=$Region `
    --database-version=POSTGRES_17 --edition=ENTERPRISE --tier=db-f1-micro `
    --storage-type=SSD --storage-size=10 --storage-auto-increase `
    --backup-start-time=01:00 --enable-point-in-time-recovery --retained-backups-count=14 `
    --maintenance-window-day=SUN --maintenance-window-hour=3 `
    --ssl-mode=ENCRYPTED_ONLY --deletion-protection
  Check 'gcloud sql instances create'
}
if (-not (Exists { gcloud sql databases describe $Database --instance $Instance --project $Project })) {
  gcloud sql databases create $Database --instance $Instance --project $Project
  Check 'gcloud sql databases create'
}

Step 'Secrets'
$ownerPassword = NewPassword
$appPassword   = NewPassword
$ownerCreated = -not (Exists { gcloud secrets describe controleit-db-owner-password --project $Project })
EnsureSecret 'controleit-db-owner-password' $ownerPassword
EnsureSecret 'controleit-db-app-password' $appPassword
EnsureSecret 'controleit-app-secret' (NewPassword 48)
EnsureSecret 'controleit-entra-client-secret' 'A-RENSEIGNER'
# Le rôle applicatif (non superutilisateur) est créé par le pipeline via scripts/db-grants.mjs.
$appPasswordStored = gcloud secrets versions access latest --secret controleit-db-app-password --project $Project
EnsureSecret 'controleit-database-url' "postgres://controleit_app:$appPasswordStored@/$Database?host=/cloudsql/${Project}:${Region}:$Instance"

Step 'Utilisateur propriétaire Cloud SQL (migrations)'
if ($ownerCreated) {
  gcloud sql users create controleit_owner --instance $Instance --project $Project --password=$ownerPassword | Out-Null
  Check 'gcloud sql users create'
  Write-Host 'utilisateur controleit_owner : créé'
} else { Write-Host 'utilisateur controleit_owner : déjà présent' }

Step 'Comptes de service'
foreach ($sa in @(@('controleit-run', 'ControleIT - exécution Cloud Run'), @('controleit-deployer', 'ControleIT - déploiement GitHub Actions'))) {
  if (-not (Exists { gcloud iam service-accounts describe "$($sa[0])@$Project.iam.gserviceaccount.com" --project $Project })) {
    gcloud iam service-accounts create $sa[0] --display-name=$sa[1] --project $Project
    Check 'gcloud iam service-accounts create'
  }
}

Step 'Droits (moindre privilège)'
gcloud projects add-iam-policy-binding $Project --member="serviceAccount:$RunSa" --role=roles/cloudsql.client --condition=None | Out-Null
Check 'gcloud projects add-iam-policy-binding $Project'
foreach ($s in 'controleit-app-secret', 'controleit-database-url', 'controleit-entra-client-secret') {
  gcloud secrets add-iam-policy-binding $s --project $Project --member="serviceAccount:$RunSa" --role=roles/secretmanager.secretAccessor | Out-Null
  Check 'gcloud secrets add-iam-policy-binding $s'
}
gcloud projects add-iam-policy-binding $Project --member="serviceAccount:$DeployerSa" --role=roles/run.developer --condition=None | Out-Null
Check 'gcloud projects add-iam-policy-binding $Project'
gcloud projects add-iam-policy-binding $Project --member="serviceAccount:$DeployerSa" --role=roles/cloudsql.client --condition=None | Out-Null
Check 'gcloud projects add-iam-policy-binding $Project'
gcloud artifacts repositories add-iam-policy-binding $Service --location $Region --project $Project `
  --member="serviceAccount:$DeployerSa" --role=roles/artifactregistry.writer | Out-Null
Check 'gcloud artifacts repositories add-iam-policy-binding'
gcloud iam service-accounts add-iam-policy-binding $RunSa --project $Project `
  --member="serviceAccount:$DeployerSa" --role=roles/iam.serviceAccountUser | Out-Null
Check 'gcloud iam service-accounts add-iam-policy-binding'
foreach ($s in 'controleit-db-owner-password', 'controleit-db-app-password') {
  gcloud secrets add-iam-policy-binding $s --project $Project --member="serviceAccount:$DeployerSa" --role=roles/secretmanager.secretAccessor | Out-Null
  Check 'gcloud secrets add-iam-policy-binding $s'
}

Step 'Workload Identity Federation (GitHub, sans clé)'
if (-not (Exists { gcloud iam workload-identity-pools describe github --location global --project $Project })) {
  gcloud iam workload-identity-pools create github --location global --project $Project --display-name='GitHub Actions'
  Check 'gcloud iam workload-identity-pools create'
}
if (-not (Exists { gcloud iam workload-identity-pools providers describe github-oidc --workload-identity-pool github --location global --project $Project })) {
  # Seule la branche main du dépôt ControleIT peut obtenir un jeton.
  gcloud iam workload-identity-pools providers create-oidc github-oidc --project $Project --location global `
    --workload-identity-pool github --display-name='GitHub OIDC' `
    --issuer-uri='https://token.actions.githubusercontent.com' `
    --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' `
    --attribute-condition="assertion.repository=='$Repo' && assertion.ref=='refs/heads/main'"
  Check 'gcloud iam workload-identity-pools providers'
}
gcloud iam service-accounts add-iam-policy-binding $DeployerSa --project $Project --role=roles/iam.workloadIdentityUser `
  --member="principalSet://iam.googleapis.com/projects/$ProjectNumber/locations/global/workloadIdentityPools/github/attribute.repository/$Repo" | Out-Null
Check 'gcloud iam service-accounts add-iam-policy-binding'

Step 'Service Cloud Run (image provisoire, remplacée par le pipeline)'
if (-not (Exists { gcloud run services describe $Service --region $Region --project $Project })) {
  gcloud run deploy $Service --project $Project --region $Region --image=us-docker.pkg.dev/cloudrun/container/hello `
    --service-account=$RunSa --no-allow-unauthenticated
  Check 'gcloud run deploy $Service'
}
# L'application gère sa propre authentification (Entra ID) : le service doit être joignable publiquement.
# La politique d'organisation interdit allUsers (partage restreint au domaine) : on désactive le contrôle IAM
# de l'appelant sur ce seul service au lieu d'ajouter allUsers.
gcloud run services update $Service --region $Region --project $Project --no-invoker-iam-check | Out-Null
Check 'gcloud run services update --no-invoker-iam-check'

Step 'Variables GitHub (non secrètes)'
gh variable set GCP_PROJECT_ID --repo $Repo --body $Project
Check 'gh variable set GCP_PROJECT_ID'
gh variable set GCP_REGION --repo $Repo --body $Region
Check 'gh variable set GCP_REGION'
gh variable set GCP_PROJECT_NUMBER --repo $Repo --body $ProjectNumber
Check 'gh variable set GCP_REGION'
gh variable set GCP_DEPLOYER_SA --repo $Repo --body $DeployerSa
Check 'gh variable set GCP_DEPLOYER_SA'
gh variable set GCP_WIF_PROVIDER --repo $Repo --body "projects/$ProjectNumber/locations/global/workloadIdentityPools/github/providers/github-oidc"
Check 'gh variable set GCP_WIF_PROVIDER'

$url = gcloud run services describe $Service --region $Region --project $Project --format='value(status.url)'
Write-Host "`nTerminé. URL du service : $url" -ForegroundColor Green
Write-Host "URL de retour à déclarer dans l'app registration Entra : $url/auth/microsoft"
