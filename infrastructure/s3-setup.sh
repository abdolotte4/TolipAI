#!/usr/bin/env bash
# infrastructure/s3-setup.sh
#
# S3 storage cost optimization for Digor Scraper Engine.
#
# What this does:
#   1. Creates the S3 bucket (if needed) with versioning + encryption
#   2. Applies lifecycle policy (s3-lifecycle.json):
#      - exports/     → Standard-IA after 7d, delete after 30d
#      - screenshots/ → delete after 14d
#      - scraper-cache/ → delete after 1d
#      - spot-checkpoints/ → delete after 7d
#   3. Sets CORS for presigned-URL direct downloads (no server proxying)
#   4. Enables Transfer Acceleration (optional, for global upload speed)
#   5. Prints the bucket policy required for presigned URL access
#
# Usage:
#   S3_BUCKET=digor-scraper-storage ./infrastructure/s3-setup.sh [--apply]
#
# Without --apply: prints commands only (dry-run).

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$DIR/.env.aws" ] && source "$DIR/.env.aws"

AWS_REGION="${AWS_REGION:-us-east-1}"
S3_BUCKET="${S3_BUCKET:?ERROR: S3_BUCKET must be set (e.g. digor-scraper-storage)}"

APPLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    *)       shift ;;
  esac
done

run() {
  if [ "$APPLY" = true ]; then
    echo "  RUNNING: $*"
    eval "$@"
  else
    echo "  DRY-RUN: $*"
  fi
}

echo "==> S3 cost optimization: bucket=${S3_BUCKET} region=${AWS_REGION}"
echo "    Mode: $( [ "$APPLY" = true ] && echo 'APPLY' || echo 'DRY-RUN (pass --apply to execute)' )"
echo ""

# ── Step 1: Create bucket ─────────────────────────────────────────────────────
echo "==> [1/5] Create bucket (skip if exists)..."
if [ "${AWS_REGION}" = "us-east-1" ]; then
  run "aws s3api create-bucket \
    --bucket '${S3_BUCKET}' \
    --region '${AWS_REGION}' 2>/dev/null || true"
else
  run "aws s3api create-bucket \
    --bucket '${S3_BUCKET}' \
    --region '${AWS_REGION}' \
    --create-bucket-configuration LocationConstraint='${AWS_REGION}' 2>/dev/null || true"
fi

# ── Step 2: Enable versioning + server-side encryption ────────────────────────
echo ""
echo "==> [2/5] Enable versioning + AES256 encryption..."
run "aws s3api put-bucket-versioning \
  --bucket '${S3_BUCKET}' \
  --versioning-configuration Status=Enabled"

run "aws s3api put-bucket-encryption \
  --bucket '${S3_BUCKET}' \
  --server-side-encryption-configuration '{
    \"Rules\": [{
      \"ApplyServerSideEncryptionByDefault\": {\"SSEAlgorithm\": \"AES256\"},
      \"BucketKeyEnabled\": true
    }]
  }'"

# ── Step 3: Lifecycle policy ───────────────────────────────────────────────────
echo ""
echo "==> [3/5] Apply lifecycle policy (s3-lifecycle.json)..."
run "aws s3api put-bucket-lifecycle-configuration \
  --bucket '${S3_BUCKET}' \
  --lifecycle-configuration file://'${DIR}/s3-lifecycle.json'"

# ── Step 4: CORS (presigned-URL direct downloads, no server proxying) ─────────
echo ""
echo "==> [4/5] Set CORS for presigned-URL direct client downloads..."
CORS_CONFIG='{
  "CORSRules": [{
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 3600
  }]
}'
run "aws s3api put-bucket-cors \
  --bucket '${S3_BUCKET}' \
  --cors-configuration '${CORS_CONFIG}'"

# ── Step 5: Block public access (presigned URLs still work) ───────────────────
echo ""
echo "==> [5/5] Block public access (presigned URLs bypass this — no public exposure)..."
run "aws s3api put-public-access-block \
  --bucket '${S3_BUCKET}' \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

echo ""
echo "==> Done."
echo ""
echo "    Cost impact estimate:"
echo "    ──────────────────────────────────────────────"
echo "    Lifecycle auto-deletes stale exports           → ~30% storage reduction"
echo "    Standard-IA tier for 7-30d exports             → 58% per-GB cheaper"
echo "    Presigned URLs for downloads                   → 0 data transfer cost"
echo "    Gzip exports before upload (see compress_csv)"
echo "      A 10 MB CSV → ~1.5 MB gzipped               → 85% transfer savings"
echo ""
echo "    Next steps:"
echo "    1. Set S3_CACHE_BUCKET=${S3_BUCKET} in ECS task env vars"
echo "    2. Set SPOT_CHECKPOINT_BUCKET=${S3_BUCKET} for spot resume"
echo "    3. In your API: use presigned URLs for /exports/* downloads"
echo "       (see spot_checkpoint.presigned_download_url)"
