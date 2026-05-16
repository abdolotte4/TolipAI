#!/usr/bin/env bash
# infrastructure/ecr-push.sh
#
# Lightweight wrapper — builds + pushes just the Docker image (no ECS update).
# Useful for CI pipelines where the deploy step is separate.
#
# Usage:
#   ./infrastructure/ecr-push.sh
#   IMAGE_TAG=v1.2.3 ./infrastructure/ecr-push.sh

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"
SCRAPER_DIR="$ROOT/artifacts/TolipAI-scraper-engine"

[ -f "$DIR/.env.aws" ] && source "$DIR/.env.aws"

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:?ERROR: AWS_ACCOUNT_ID must be set}"
ECR_REPO_NAME="${ECR_REPO_NAME:-TolipAI-scraper}"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo latest)}"

ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
ECR_IMAGE="${ECR_REGISTRY}/${ECR_REPO_NAME}:${IMAGE_TAG}"
ECR_LATEST="${ECR_REGISTRY}/${ECR_REPO_NAME}:latest"

echo "Building + pushing: $ECR_IMAGE"

aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker buildx use TolipAI-builder 2>/dev/null || \
  docker buildx create --name TolipAI-builder --use --bootstrap

docker buildx build \
  --platform linux/arm64 \
  --file "$SCRAPER_DIR/Dockerfile.fargate" \
  --tag "$ECR_IMAGE" \
  --tag "$ECR_LATEST" \
  --push \
  --cache-from "type=registry,ref=${ECR_LATEST}" \
  --cache-to "type=inline" \
  "$SCRAPER_DIR"

echo "Pushed: $ECR_IMAGE"
echo "Pushed: $ECR_LATEST"
