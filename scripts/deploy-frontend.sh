#!/usr/bin/env bash
# Frontend-ийг deploy хийсэн backend-д зориулж build хийж нийтэлнэ: build-ийг
# backend/web руу хуулж `serverless deploy`-оор илгээнэ, API-ийн өөрийн HTTPS хаяг дээр үйлчилнэ.
#
#   scripts/deploy-frontend.sh            (сонголттой: STAGE=dev AWS_REGION=ap-southeast-2)
set -euo pipefail

STAGE="${STAGE:-dev}"
REGION="${AWS_REGION:-ap-southeast-2}"
STACK="notification-system-${STAGE}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

API_URL="$(output HttpApiUrl)"
if [ -z "$API_URL" ] || [ "$API_URL" = "None" ]; then
  echo "Stack $STACK was not found. Run 'npx serverless deploy' in backend/ first." >&2
  exit 1
fi

echo "Building the frontend for $STACK ..."
(
  cd "$ROOT/frontend"
  VITE_API_URL="$API_URL" \
  VITE_WS_URL="$(output ServiceEndpointWebsocket)" \
  VITE_COGNITO_REGION="$REGION" \
  VITE_COGNITO_CLIENT_ID="$(output UserPoolClientId)" \
  npm run build
)

rm -rf "$ROOT/backend/web"
cp -R "$ROOT/frontend/dist" "$ROOT/backend/web"

echo "Deploying ..."
(cd "$ROOT/backend" && npx serverless deploy --stage "$STAGE")

echo
echo "Frontend: $API_URL"
