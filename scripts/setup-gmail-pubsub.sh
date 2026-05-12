#!/usr/bin/env bash
# Pošta — Gmail Pub/Sub setup (jednorázový GCP setup pro fázi 5).
#
# Executable dokumentace per Petrovo zadání:
# "vytvor scripts/setup-gmail-pubsub.sh se vsemi gcloud prikazy jako
#  executable dokumentaci (ne nutne spustet, ale plati jako truth source)"
#
# Petr to může spustit přímo (pokud má gcloud nainstalovaný a auth k projektu)
# nebo postupně copy-paste do GCP Console — oba flow jsou ekvivalentní.
#
# Detailní vysvětlení: docs/email-intelligence/INFRASTRUCTURE.md

set -euo pipefail

# ===========================================================================
# KONFIGURACE — uprav před spuštěním
# ===========================================================================

PROJECT_ID="${PROJECT_ID:-raseliniste-prod}"          # GCP projekt
TOPIC_NAME="${TOPIC_NAME:-gmail-watch-petr}"          # Pub/Sub topic
SUBSCRIPTION_NAME="${SUBSCRIPTION_NAME:-gmail-push-to-raseliniste}"
WEBHOOK_URL="${WEBHOOK_URL:-https://www.raseliniste.cz/api/posta/gmail-webhook}"
SA_NAME="${SA_NAME:-gmail-push-sa}"                   # service account pro auth push
SA_EMAIL="${SA_EMAIL:-${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com}"

echo "===> Konfigurace:"
echo "  PROJECT_ID         = $PROJECT_ID"
echo "  TOPIC_NAME         = $TOPIC_NAME"
echo "  SUBSCRIPTION_NAME  = $SUBSCRIPTION_NAME"
echo "  WEBHOOK_URL        = $WEBHOOK_URL"
echo "  SA_EMAIL           = $SA_EMAIL"
echo ""

# ===========================================================================
# 1) Aktivace Pub/Sub API
# ===========================================================================
echo "===> 1) Aktivace Cloud Pub/Sub API"
gcloud services enable pubsub.googleapis.com --project="$PROJECT_ID"

# ===========================================================================
# 2) Vytvoření topic
# ===========================================================================
echo "===> 2) Vytvoření topicu $TOPIC_NAME"
gcloud pubsub topics create "$TOPIC_NAME" --project="$PROJECT_ID" \
  || echo "  (topic už existuje, pokračuju)"

# ===========================================================================
# 3) Grant Gmail service accountu publish permission
# Gmail push notifications jdou ze service accountu gmail-api-push@system.gserviceaccount.com
# (toto je Google-owned SA, nemusíme nic vytvářet, jen mu povolit publish do našeho topicu)
# ===========================================================================
echo "===> 3) Grant pro gmail-api-push@system.gserviceaccount.com (publish)"
gcloud pubsub topics add-iam-policy-binding "$TOPIC_NAME" \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" \
  --project="$PROJECT_ID"

# ===========================================================================
# 4) Vytvoření service accountu pro push subscription auth
# Tento SA bude podepisovat JWT v Pub/Sub push requestech k našemu webhooku
# ===========================================================================
echo "===> 4) Vytvoření service accountu $SA_NAME"
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Gmail Push SA pro Rašeliniště" \
  --project="$PROJECT_ID" \
  || echo "  (SA už existuje, pokračuju)"

# ===========================================================================
# 5) Grant SA právo invokovat naše Pub/Sub subscriptions (push delivery)
# (Pub/Sub interně potřebuje, aby SA mohl publish ack na completion)
# ===========================================================================
echo "===> 5) Service Agent token creator role"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"

# ===========================================================================
# 6) Vytvoření push subscription s OIDC auth
# Subscription pushuje JSON envelope na náš webhook URL.
# OIDC token: Pub/Sub podepíše JWT jako $SA_EMAIL, audience = $WEBHOOK_URL.
# Náš webhook tento JWT verifikuje (google-auth-library `verifyIdToken`).
# ===========================================================================
echo "===> 6) Vytvoření push subscription $SUBSCRIPTION_NAME"
gcloud pubsub subscriptions create "$SUBSCRIPTION_NAME" \
  --topic="$TOPIC_NAME" \
  --push-endpoint="$WEBHOOK_URL" \
  --push-auth-service-account="$SA_EMAIL" \
  --push-auth-token-audience="$WEBHOOK_URL" \
  --ack-deadline=30 \
  --message-retention-duration=1d \
  --project="$PROJECT_ID" \
  || echo "  (subscription už existuje, pokračuju)"

# ===========================================================================
# 7) Final report
# ===========================================================================
echo ""
echo "===> ✓ Setup hotový"
echo ""
echo "Doplň do .env (Rašeliniště Synology container):"
echo "  GMAIL_PUBSUB_TOPIC=projects/${PROJECT_ID}/topics/${TOPIC_NAME}"
echo "  GMAIL_PUBSUB_AUDIENCE=${WEBHOOK_URL}"
echo "  GMAIL_PUBSUB_SA_EMAIL=${SA_EMAIL}"
echo ""
echo "Pak v Rašeliniště UI:"
echo "  /settings/integrations/google → tlačítko 'Spustit push' (faze 5)"
echo "  → zavolá POST /api/integrations/google/posta-watch s action=start"
echo "  → Gmail begin pushing notifikace, watch lifetime 7d"
echo ""
echo "Renewal: cron 'posta-watch-renew' daily 04:00 zavolá startWatch"
echo "kdykoli expirace < 48h."
