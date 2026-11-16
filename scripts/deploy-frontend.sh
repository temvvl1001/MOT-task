#!/usr/bin/env bash
# Builds the frontend against the deployed backend and publishes it: the build is copied to
# backend/web and shipped by `serverless deploy`, which serves it on the API's own HTTPS URL.
#
#   scripts/deploy-frontend.sh            (optional: STAGE=dev AWS_REGION=ap-southeast-2)
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
