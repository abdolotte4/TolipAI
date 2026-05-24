#!/usr/bin/env bash
# get-scraper-url.sh — Print the current ECS task public IP and connection info.
#
# Usage: bash infrastructure/get-scraper-url.sh
#
# This prints the task's public IP (if assignPublicIp=ENABLED) so you can
# test the scraper engine from Railway or curl it locally.
#
# For a PERMANENT stable URL (required for production Railway integration):
#   → Create an Application Load Balancer (ALB) in front of the ECS service.
#   → The ALB gives you a stable DNS like:
#       http://tolipai-scraper-alb-XXXXXXX.us-east-1.elb.amazonaws.com
#   → Quick ALB setup:
#       aws elbv2 create-load-balancer --name tolipai-scraper-alb \
#         --subnets subnet-XXXX subnet-YYYY --security-groups sg-XXXX \
#         --scheme internet-facing --type application
#       (then create target group → listener → register ECS service)

set -euo pipefail

CLUSTER="${ECS_CLUSTER:-TolipAI-scraper-cluster}"
SERVICE="${ECS_SERVICE:-tolipai-scraper-engine-service-xop}"
PORT="${SCRAPER_PORT:-8765}"
REGION="${AWS_DEFAULT_REGION:-us-east-1}"

if ! command -v aws &>/dev/null; then
  echo "ERROR: aws CLI not found. Install it or run this locally with AWS credentials." >&2
  exit 1
fi

echo "==> Querying ECS cluster: ${CLUSTER}"
echo "    Service : ${SERVICE}"
echo "    Region  : ${REGION}"
echo ""

TASK_ARN=$(aws ecs list-tasks \
  --cluster "${CLUSTER}" \
  --service-name "${SERVICE}" \
  --desired-status RUNNING \
  --query "taskArns[0]" \
  --output text 2>/dev/null || echo "None")

if [ "${TASK_ARN}" = "None" ] || [ -z "${TASK_ARN}" ]; then
  echo "No running tasks found. The service may still be deploying." >&2
  exit 1
fi

echo "  Running task : ${TASK_ARN}"

TASK_DEF=$(aws ecs describe-tasks \
  --cluster "${CLUSTER}" \
  --tasks "${TASK_ARN}" \
  --query "tasks[0].taskDefinitionArn" \
  --output text 2>/dev/null || echo "unknown")
echo "  Task def     : ${TASK_DEF##*/}"

ENI_ID=$(aws ecs describe-tasks \
  --cluster "${CLUSTER}" \
  --tasks "${TASK_ARN}" \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value" \
  --output text 2>/dev/null || echo "")

if [ -z "${ENI_ID}" ]; then
  echo "ERROR: No network interface found for task." >&2
  exit 1
fi

PUBLIC_IP=$(aws ec2 describe-network-interfaces \
  --network-interface-ids "${ENI_ID}" \
  --query "NetworkInterfaces[0].Association.PublicIp" \
  --output text 2>/dev/null || echo "None")

PRIVATE_IP=$(aws ec2 describe-network-interfaces \
  --network-interface-ids "${ENI_ID}" \
  --query "NetworkInterfaces[0].PrivateIpAddress" \
  --output text 2>/dev/null || echo "unknown")

echo "  Private IP   : ${PRIVATE_IP}"

if [ "${PUBLIC_IP}" = "None" ] || [ -z "${PUBLIC_IP}" ]; then
  echo ""
  echo "WARNING: This task has no public IP."
  echo "  The ECS service was likely created with assignPublicIp=DISABLED."
  echo ""
  echo "  To expose the scraper engine to Railway (or the internet), you need one of:"
  echo ""
  echo "  Option A — Application Load Balancer (recommended for production)"
  echo "    Gives a permanent DNS: http://tolipai-scraper-alb-XXX.us-east-1.elb.amazonaws.com"
  echo "    Steps:"
  echo "      1. Create ALB in same VPC/subnets as the ECS service"
  echo "      2. Create target group: type=IP, protocol=HTTP, port=${PORT}, VPC=same"
  echo "      3. Register the ECS service with the target group"
  echo "      4. Create listener: ALB port 80 → target group"
  echo "      5. Set SCRAPER_ENGINE_URL=http://<alb-dns> in Railway"
  echo ""
  echo "  Option B — Enable public IP on the ECS service (simple, for dev/test only)"
  echo "    Update the service network config: assignPublicIp=ENABLED"
  echo "    Each new task gets a fresh public IP — use the smoke-test script to find it."
  echo ""
else
  echo "  Public IP    : ${PUBLIC_IP}"
  echo ""
  echo "==> Scraper engine URLs:"
  echo ""
  echo "    Health check : http://${PUBLIC_IP}:${PORT}/health"
  echo "    Base URL     : http://${PUBLIC_IP}:${PORT}"
  echo ""
  echo "  Set in Railway → SCRAPER_ENGINE_URL=http://${PUBLIC_IP}:${PORT}"
  echo ""
  echo "  NOTE: This IP changes every time the ECS task restarts."
  echo "  For a PERMANENT URL, create an Application Load Balancer (ALB)."
  echo "  See comments at the top of this script for ALB setup steps."
  echo ""
  echo "==> Quick test:"
  echo "    curl -s http://${PUBLIC_IP}:${PORT}/health | python3 -m json.tool"
fi
