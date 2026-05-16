#!/usr/bin/env bash
# infrastructure/deploy.sh
#
# Deploy the TolipAI Scraper Engine to AWS Fargate Spot.
# Builds the ARM64 Docker image, pushes to ECR, and updates the ECS service.
#
# Prerequisites:
#   • aws CLI v2 configured with appropriate credentials/profile
#   • docker buildx with QEMU (for cross-platform ARM64 build on x86)
#   • jq installed
#
# Usage:
#   ./infrastructure/deploy.sh [--env production|staging] [--no-build]
#
# Environment variables (can also be set in .env.aws):
#   AWS_REGION         — default: us-east-1
#   AWS_ACCOUNT_ID     — your 12-digit AWS account ID
#   ECR_REPO_NAME      — default: TolipAI-scraper
#   ECS_CLUSTER        — default: TolipAI-scraper-cluster
#   ECS_SERVICE        — default: TolipAI-scraper-engine
#   TASK_DEFINITION    — default: TolipAI-scraper-engine

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
SCRAPER_DIR="$ROOT/artifacts/TolipAI-scraper-engine"

[ -f "$DIR/.env.aws" ] && source "$DIR/.env.aws"

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:?ERROR: AWS_ACCOUNT_ID must be set}"
ECR_REPO_NAME="${ECR_REPO_NAME:-TolipAI-scraper}"
ECS_CLUSTER="${ECS_CLUSTER:-TolipAI-scraper-cluster}"
ECS_SERVICE="${ECS_SERVICE:-TolipAI-scraper-engine}"
TASK_DEFINITION="${TASK_DEFINITION:-TolipAI-scraper-engine}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)}"

DO_BUILD=true
ENV="production"

# Use a while loop so we can safely advance past two-word flags (--env production)
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
echo "    ECS cluster:    $ECS_CLUSTER"
echo "    ECS service:    $ECS_SERVICE"
echo "    Environment:    $ENV"
echo "    Build:          $DO_BUILD"
echo ""

# ── Step 1: ECR Login ─────────────────────────────────────────────────────────
echo "==> [1/5] ECR login..."
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

# ── Step 2: Create ECR repo if not exists ────────────────────────────────────
echo "==> [2/5] Ensure ECR repository exists..."
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
  echo "==> [3/5] Building ARM64 image (this may take 5-10 min first time)..."

  # Ensure buildx builder with ARM64 support
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
  echo "==> [3/5] Skipping build (--no-build flag set)"
fi

# ── Step 4: Register new task definition ─────────────────────────────────────
echo "==> [4/5] Registering ECS task definition..."

TASK_DEF_JSON=$(cat "$DIR/ecs-task-definition.json" | \
  sed "s|ACCOUNT_ID|${AWS_ACCOUNT_ID}|g" | \
  sed "s|:latest|:${IMAGE_TAG}|g")

NEW_TASK_DEF=$(aws ecs register-task-definition \
  --cli-input-json "$TASK_DEF_JSON" \
  --region "$AWS_REGION" \
  --query "taskDefinition.taskDefinitionArn" \
  --output text)

echo "    New task def: $NEW_TASK_DEF"

# ── Step 5: Update ECS service ────────────────────────────────────────────────
echo "==> [5/5] Updating ECS service ($ECS_SERVICE)..."

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
echo "    Logs:    aws logs tail /ecs/TolipAI-scraper --follow --region $AWS_REGION"
