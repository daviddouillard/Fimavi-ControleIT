# Job Cloud Run des collectes SharePoint (idempotent, à exécuter par un Owner du projet).
# Appelé par gcp-setup.ps1 ; peut aussi être lancé seul sur une installation existante.
#
# Chaque collecte s'exécute dans une exécution de ce Job (même image que le service, lancée par l'application
# avec NUXT_COLLECTION_RUN_ID) : elle va au bout même si plus personne n'utilise l'application.
# L'image et la configuration réelles sont posées par le pipeline (.github/workflows/deploy.yml).
$ErrorActionPreference = 'Stop'

$Project = 'fimavi-controleit'
$Region  = 'europe-west9'
$Job     = 'controleit-collect'
$RunSa   = "controleit-run@$Project.iam.gserviceaccount.com"

function Check($what) { if ($LASTEXITCODE -ne 0) { throw "Échec : $what (code $LASTEXITCODE)" } }

Write-Host "`n== Job Cloud Run $Job ==" -ForegroundColor Cyan
$ErrorActionPreference = 'Continue'
gcloud run jobs describe $Job --region $Region --project $Project --format='value(name)' 2>$null | Out-Null
$exists = $LASTEXITCODE -eq 0
$ErrorActionPreference = 'Stop'
if (-not $exists) {
  gcloud run jobs create $Job --project $Project --region $Region --image=us-docker.pkg.dev/cloudrun/container/job `
    --service-account=$RunSa --tasks=1 --max-retries=0
  Check 'gcloud run jobs create'
} else { Write-Host "Job $Job : déjà présent" }

# Le service (compte controleit-run) lance ce seul Job, avec la variable NUXT_COLLECTION_RUN_ID.
gcloud run jobs add-iam-policy-binding $Job --region $Region --project $Project `
  --member="serviceAccount:$RunSa" --role=roles/run.jobsExecutorWithOverrides | Out-Null
Check 'gcloud run jobs add-iam-policy-binding'
Write-Host "Droit roles/run.jobsExecutorWithOverrides accordé à $RunSa sur $Job" -ForegroundColor Green
