#!/usr/bin/env bash
# ecs-smoke-test.sh — Poll the scraper /health endpoint after an ECS deployment.
#
# Usage:
#   bash infrastructure/ecs-smoke-test.sh                          # auto-detect IP from ECS
#   bash infrastructure/ecs-smoke-test.sh http://1.2.3.4:8765     # explicit URL
#   SCRAPER_URL=http://1.2.3.4:8765 bash infrastructure/ecs-smoke-test.sh
#
# Exit codes:
#   0 — /health returned HTTP 200 and "status":"ok" within timeout
#   1 — timed out or returned an error
#
# Requirements: aws-cli (for auto-detect), curl, python3 (for JSON parse)

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
CLUSTER="${ECS_CLUSTER:-TolipAI-scraper-cluster}"
SERVICE="${ECS_SERVICE:-tolipai-scraper-engine-service-xop}"
PORT="${SCRAPER_PORT:-8765}"
TIMEOUT="${SMOKE_TIMEOUT:-300}"      # total seconds to wait
POLL_INTERVAL="${SMOKE_POLL:-10}"    # seconds between polls
SCRAPER_API_KEY="${SCRAPER_API_KEY:-}"

# ── Resolve URL ───────────────────────────────────────────────────────────────
SCRAPER_URL="${1:-${SCRAPER_URL:-}}"

if [ -z "${SCRAPER_URL}" ]; then
  if ! command -v aws &>/dev/null; then
    echo "ERROR: No URL supplied and aws CLI not found." >&2
    echo "Usage: bash infrastructure/ecs-smoke-test.sh http://<SCRAPER_HOST>:${PORT}" >&2
    exit 1
  fi

  echo "==> Auto-detecting running ECS task public IP..."
  TASK_ARN=$(aws ecs list-tasks \
    --cluster "${CLUSTER}" \
    --service-name "${SERVICE}" \
    --desired-status RUNNING \
    --query "taskArns[0]" \
    --output text 2>/dev/null || echo "None")

  if [ "${TASK_ARN}" = "None" ] || [ -z "${TASK_ARN}" ]; then
    echo "ERROR: No running tasks found in ${CLUSTER}/${SERVICE}" >&2
    echo "Wait for ECS to finish deploying, then retry." >&2
    exit 1
  fi

  ENI_ID=$(aws ecs describe-tasks \
    --cluster "${CLUSTER}" \
    --tasks "${TASK_ARN}" \
    --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" \
    --output text 2>/dev/null || echo "")

  if [ -z "${ENI_ID}" ]; then
    echo "ERROR: Could not find network interface for task ${TASK_ARN}" >&2
    echo "Make sure assignPublicIp=ENABLED in the ECS service network config," >&2
    echo "or supply the URL manually: bash $0 http://<HOST>:${PORT}" >&2
    exit 1
  fi

  PUBLIC_IP=$(aws ec2 describe-network-interfaces \
    --network-interface-ids "${ENI_ID}" \
    --query "NetworkInterfaces[0].Association.PublicIp" \
    --output text 2>/dev/null || echo "")

  if [ -z "${PUBLIC_IP}" ] || [ "${PUBLIC_IP}" = "None" ]; then
    PRIVATE_IP=$(aws ec2 describe-network-interfaces \
      --network-interface-ids "${ENI_ID}" \
      --query "NetworkInterfaces[0].PrivateIpAddress" \
      --output text 2>/dev/null || echo "")
    echo "WARN: Task has no public IP (private only: ${PRIVATE_IP})." >&2
    echo "      The ECS service may not have assignPublicIp=ENABLED." >&2
    echo "      For a permanent public URL, create an ALB — see docs below." >&2
    echo "" >&2
    echo "      To test from within VPC: http://${PRIVATE_IP}:${PORT}/health" >&2
    exit 1
  fi

  SCRAPER_URL="http://${PUBLIC_IP}:${PORT}"
  echo "==> Detected scraper URL: ${SCRAPER_URL}"
fi

HEALTH_URL="${SCRAPER_URL%/}/health"

# ── Poll /health ──────────────────────────────────────────────────────────────
echo ""
echo "==> Polling ${HEALTH_URL} (timeout=${TIMEOUT}s, interval=${POLL_INTERVAL}s)"
echo ""

START_TS=$(date +%s)
ATTEMPT=0

while true; do
  ATTEMPT=$((ATTEMPT + 1))
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TS))

  if [ "${ELAPSED}" -ge "${TIMEOUT}" ]; then
    echo ""
    echo "TIMEOUT: /health did not return 200 within ${TIMEOUT}s" >&2
    echo "Check ECS task logs in CloudWatch: /ecs/tolipai-scraper" >&2
    exit 1
  fi

  # Build curl args
  CURL_ARGS=(-sf --max-time 8 --connect-timeout 5)
  if [ -n "${SCRAPER_API_KEY}" ]; then
    CURL_ARGS+=(-H "X-API-Key: ${SCRAPER_API_KEY}")
  fi

  HTTP_CODE=$(curl "${CURL_ARGS[@]}" -o /tmp/smoke_body.json -w "%{http_code}" \
    "${HEALTH_URL}" 2>/dev/null || echo "000")

  TIMESTAMP=$(date -u '+%H:%M:%S')

  if [ "${HTTP_CODE}" = "200" ]; then
    STATUS=$(python3 -c "
import json, sys
try:
    d = json.load(open('/tmp/smoke_body.json'))
    print(d.get('status', 'unknown'))
except Exception:
    print('parse_error')
" 2>/dev/null || echo "parse_error")

    if [ "${STATUS}" = "ok" ]; then
      echo "[${TIMESTAMP}] attempt=${ATTEMPT} elapsed=${ELAPSED}s → HTTP 200  status=${STATUS}"
      echo ""
      echo "SUCCESS: Scraper engine is healthy at ${SCRAPER_URL}"
      echo ""
      # Print key fields from the health response
      python3 -c "
import json, sys
try:
    d = json.load(open('/tmp/smoke_body.json'))
    print(f'  version     : {d.get(\"version\", \"unknown\")}')
    rev = d.get('fargate', {})
    print(f'  task_arn    : {rev.get(\"task_arn\", \"local\")}')
    cb = d.get('circuit_breakers', {})
    print(f'  breakers    : {list(cb.keys()) if cb else \"none\"}')
    rq = d.get('retry_queue', {})
    print(f'  retry_queue : backend={rq.get(\"backend\",\"?\")}  size={rq.get(\"size\",\"?\")}')
except Exception as e:
    print(f'  (could not parse health body: {e})')
" 2>/dev/null
      echo ""
      echo "Set this in Railway → SCRAPER_ENGINE_URL=${SCRAPER_URL}"
      exit 0
    else
      echo "[${TIMESTAMP}] attempt=${ATTEMPT} elapsed=${ELAPSED}s → HTTP 200  status=${STATUS} (not yet ready)"
    fi
  else
    echo "[${TIMESTAMP}] attempt=${ATTEMPT} elapsed=${ELAPSED}s → HTTP ${HTTP_CODE} (waiting for task to start...)"
  fi

  sleep "${POLL_INTERVAL}"
done
