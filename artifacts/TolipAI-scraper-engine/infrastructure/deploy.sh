#!/usr/bin/env bash
# infrastructure/deploy.sh
#
# Deploy the TolipAI Scraper Engine to AWS Fargate Spot.
# Builds the ARM64 Docker image, pushes to ECR, and updates the ECS service.
#
# Works from TWO contexts:
#   1. Inside the monorepo (path: artifacts/TolipAI-scraper-engine/infrastructure/)
#      ROOT resolves to the monorepo root; SCRAPER_DIR is computed as needed.
#   2. Standalone Python-Worker repo (path: infrastructure/)
#      ROOT resolves to the repo root which IS the scraper engine.
#
# Prerequisites:
#   • aws CLI v2 configured with appropriate credentials/profile
#   • docker buildx with QEMU (for cross-platform ARM64 build on x86)
#   • python3 (for IAM policy inspection)
#
# Usage:
#   ./infrastructure/deploy.sh [--env production|staging] [--no-build]
#
# Environment variables (can also be set in infrastructure/.env.aws):
#   AWS_REGION         — default: us-east-1
#   AWS_ACCOUNT_ID     — your 12-digit AWS account ID
#   ECR_REPO_NAME      — default: tolipai-scraper
#   ECS_CLUSTER        — default: TolipAI-scraper-cluster
#   ECS_SERVICE        — default: tolipai-scraper-engine-service-xop
#   TASK_DEFINITION    — default: tolipai-scraper-engine

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"

# When used inside the monorepo, ROOT is the monorepo root and the scraper
# source lives under artifacts/TolipAI-scraper-engine/.
# When used in the standalone Python-Worker repo, ROOT is the repo root which
# IS the scraper engine — no subdirectory needed.
if [ -d "$ROOT/artifacts/TolipAI-scraper-engine" ]; then
  SCRAPER_DIR="$ROOT/artifacts/TolipAI-scraper-engine"
else
  SCRAPER_DIR="$ROOT"
fi

[ -f "$DIR/.env.aws" ] && source "$DIR/.env.aws"

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:?ERROR: AWS_ACCOUNT_ID must be set}"
ECR_REPO_NAME="${ECR_REPO_NAME:-tolipai-scraper}"
ECS_CLUSTER="${ECS_CLUSTER:-TolipAI-scraper-cluster}"
ECS_SERVICE="${ECS_SERVICE:-tolipai-scraper-engine-service-xop}"
TASK_DEFINITION="${TASK_DEFINITION:-tolipai-scraper-engine}"
EXEC_ROLE="TolipAI-scraper-execution-role"
INLINE_POLICY="SecretsManagerAccess"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)}"

DO_BUILD=true
ENV="production"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-build) DO_BUILD=false; shift ;;
    --env=*)    ENV="${1#--env=}"; shift ;;
    --env)      ENV="${2:?--env requires a value}"; shift 2 ;;
    *)          shift ;;
  esac
done

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_IMAGE="${ECR_REGISTRY}/${ECR_REPO_NAME}:${IMAGE_TAG}"
ECR_LATEST="${ECR_REGISTRY}/${ECR_REPO_NAME}:latest"

echo "==> Deploy config"
echo "    Region:         $AWS_REGION"
echo "    Account:        $AWS_ACCOUNT_ID"
echo "    ECR image:      $ECR_IMAGE"
echo "    Scraper dir:    $SCRAPER_DIR"
echo "    ECS cluster:    $ECS_CLUSTER"
echo "    ECS service:    $ECS_SERVICE"
echo "    Environment:    $ENV"
echo "    Build:          $DO_BUILD"
echo ""

# ── Step 1: ECR Login ─────────────────────────────────────────────────────────
echo "==> [1/6] ECR login..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

# ── Step 2: Create ECR repo if not exists ─────────────────────────────────────
echo "==> [2/6] Ensure ECR repository exists..."
aws ecr describe-repositories \
    --repository-names "$ECR_REPO_NAME" \
    --region "$AWS_REGION" > /dev/null 2>&1 || \
  aws ecr create-repository \
    --repository-name "$ECR_REPO_NAME" \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 \
    --region "$AWS_REGION"

# ── Step 3: Build + push image ────────────────────────────────────────────────
if [ "$DO_BUILD" = true ]; then
  echo "==> [3/6] Building ARM64 image (this may take 5-10 min first time)..."

  docker buildx use TolipAI-builder 2>/dev/null || \
    docker buildx create --name TolipAI-builder --use --bootstrap

  docker buildx build \
    --platform linux/arm64 \
    --file "$SCRAPER_DIR/Dockerfile.fargate" \
    --tag "$ECR_IMAGE" \
    --tag "$ECR_LATEST" \
    --push \
    --cache-from "type=registry,ref=${ECR_LATEST}" \
    --cache-to   "type=inline" \
    --build-arg BUILD_DATE="$(date -u +%FT%TZ)" \
    --build-arg GIT_SHA="$IMAGE_TAG" \
    "$SCRAPER_DIR"

  echo "    Image pushed: $ECR_IMAGE"
else
  echo "==> [3/6] Skipping build (--no-build flag set)"
fi

# ── Step 4: Validate & patch execution role IAM policy ────────────────────────
echo "==> [4/6] Validating IAM execution role permissions..."

EXISTING_POLICY=$(aws iam get-role-policy \
  --role-name "$EXEC_ROLE" \
  --policy-name "$INLINE_POLICY" \
  --region "$AWS_REGION" \
  --query PolicyDocument \
  --output json 2>/dev/null || echo "")

if [ -z "$EXISTING_POLICY" ]; then
  echo "    Inline policy '$INLINE_POLICY' not found — creating it..."
  POLICY_ACTION="create"
else
  if echo "$EXISTING_POLICY" | \
      python3 -c "
import json, sys
doc = json.load(sys.stdin)
for s in doc.get('Statement', []):
  actions = s.get('Action', [])
  if isinstance(actions, str): actions = [actions]
  resources = s.get('Resource', [])
  if isinstance(resources, str): resources = [resources]
  if (s.get('Effect') == 'Allow'
      and 'secretsmanager:GetSecretValue' in actions
      and any('TolipAI/scraper' in r for r in resources)):
    sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
    echo "    ✓ secretsmanager:GetSecretValue already granted — no change needed."
    POLICY_ACTION="skip"
  else
    echo "    secretsmanager:GetSecretValue missing — patching policy..."
    POLICY_ACTION="patch"
  fi
fi

if [ "$POLICY_ACTION" != "skip" ]; then
  NEW_POLICY=$(python3 - <<PYEOF
import json
resource_arn = "arn:aws:secretsmanager:${AWS_REGION}:${AWS_ACCOUNT_ID}:secret:TolipAI/scraper/*"
doc = ${EXISTING_POLICY:-{"Version":"2012-10-17","Statement":[]}}
doc["Statement"] = [
  s for s in doc.get("Statement", [])
  if not (
    s.get("Effect") == "Allow"
    and (
      s.get("Action") == "secretsmanager:GetSecretValue"
      or (isinstance(s.get("Action"), list) and "secretsmanager:GetSecretValue" in s["Action"])
    )
  )
]
doc["Statement"].append({
  "Sid": "AllowScraperSecretsGetValue",
  "Effect": "Allow",
  "Action": ["secretsmanager:GetSecretValue"],
  "Resource": [resource_arn]
})
print(json.dumps(doc))
PYEOF
)
  aws iam put-role-policy \
    --role-name "$EXEC_ROLE" \
    --policy-name "$INLINE_POLICY" \
    --policy-document "$NEW_POLICY" \
    --region "$AWS_REGION"
  echo "    ✓ IAM policy patched: $EXEC_ROLE/$INLINE_POLICY"
fi

# ── Step 5: Register new task definition ──────────────────────────────────────
echo "==> [5/6] Registering ECS task definition..."

TASK_DEF_JSON=$(cat "$DIR/ecs-task-definition.json" | \
  sed "s|ACCOUNT_ID|${AWS_ACCOUNT_ID}|g" | \
  sed "s|:latest|:${IMAGE_TAG}|g")

NEW_TASK_DEF=$(aws ecs register-task-definition \
  --cli-input-json "$TASK_DEF_JSON" \
  --region "$AWS_REGION" \
  --query "taskDefinition.taskDefinitionArn" \
  --output text)

echo "    New task def: $NEW_TASK_DEF"

# ── Step 6: Update ECS service ────────────────────────────────────────────────
echo "==> [6/6] Updating ECS service ($ECS_SERVICE)..."

aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --task-definition "$NEW_TASK_DEF" \
  --force-new-deployment \
  --region "$AWS_REGION" \
  --output table

echo ""
echo "==> Waiting for service stability (max 10 min)..."
aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$AWS_REGION" && \
  echo "    Service stable!" || \
  echo "    WARNING: service did not reach stable state within timeout"

echo ""
echo "==> Deploy complete"
echo "    Image:   $ECR_IMAGE"
echo "    Task:    $NEW_TASK_DEF"
echo "    Service: $ECS_CLUSTER/$ECS_SERVICE"
echo ""
echo "    Monitor: aws ecs describe-services --cluster $ECS_CLUSTER --services $ECS_SERVICE --region $AWS_REGION"
echo "    Logs:    aws logs tail /ecs/tolipai-scraper --follow --region $AWS_REGION"
