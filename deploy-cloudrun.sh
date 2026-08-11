#!/usr/bin/env bash
#
# Déploiement du prototype sur Cloud Run.
#
#   ./deploy-cloudrun.sh <ID_DU_PROJET_GCP> [region] [nom_du_service]
#
# Les réglages ci-dessous ne sont pas cosmétiques : le mode animateur garde les
# parties en mémoire vive, ce qui impose une instance unique et non gelée.
set -euo pipefail

PROJET="${1:-}"
REGION="${2:-europe-west9}"          # Paris
SERVICE="${3:-frise-grdf}"

if [[ -z "$PROJET" ]]; then
  echo "usage : ./deploy-cloudrun.sh <ID_DU_PROJET_GCP> [region] [nom_du_service]" >&2
  echo "        gcloud projects list   pour retrouver l'identifiant" >&2
  exit 1
fi

if ! gcloud auth print-access-token >/dev/null 2>&1; then
  echo "Session gcloud expirée. Lancez d'abord :  gcloud auth login" >&2
  exit 1
fi

echo "▸ Projet $PROJET · région $REGION · service $SERVICE"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com --project "$PROJET"

gcloud run deploy "$SERVICE" \
  --project "$PROJET" \
  --region "$REGION" \
  --source . \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 --memory 512Mi \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 250 \
  --timeout 3600 \
  --no-cpu-throttling \
  --set-env-vars NODE_ENV=production

URL=$(gcloud run services describe "$SERVICE" --project "$PROJET" \
        --region "$REGION" --format='value(status.url)')

cat <<FIN

  Déployé.

  Frise      $URL/
  Quiz solo  $URL/quiz.html
  Animateur  $URL/host.html

  Le QR code du mode animateur pointera automatiquement sur ce domaine :
  l'URL est déduite de l'en-tête Host de la requête, pas de l'IP du conteneur.

FIN
