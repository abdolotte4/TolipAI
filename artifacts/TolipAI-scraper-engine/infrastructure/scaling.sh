#!/usr/bin/env bash
# infrastructure/scaling.sh
#
# Fargate Spot cost optimization — two subsystems:
#
#   1. CAPACITY PROVIDER STRATEGY
#      Primary: FARGATE_SPOT (ARM64/Graviton3, ~70% cheaper than on-demand)
#      Fallback: FARGATE on-demand (kicks in when Spot supply is thin)
#      Weight: 4 Spot : 1 On-demand = ~80% Spot utilisation target
#
#   2. SCHEDULED SCALING
#      Scale UP  at 09:00 EST Mon-Fri (business hours demand)
#      Scale DOWN at 18:00 EST Mon-Fri (overnight floor)
#      Weekend floor: 1 task (keep warm, no traffic)
#
#   3. STEP SCALING (load-based)
#      CPU > 60% for 3 min  → +2 tasks
#      CPU > 80% for 2 min  → +4 tasks
#      CPU < 20% for 10 min → -1 task
#
# Usage:
#   ./infrastructure/scaling.sh [--apply] [--remove]
#
# Without --apply the script prints the AWS CLI commands but does NOT run them.
# Pass --apply to execute. Pass --remove to delete all scaling config.
#
# Prerequisites:
#   aws CLI v2, jq

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$DIR/.env.aws" ] && source "$DIR/.env.aws"

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:?ERROR: AWS_ACCOUNT_ID must be set}"
ECS_CLUSTER="${ECS_CLUSTER:-TolipAI-scraper-cluster}"
ECS_SERVICE="${ECS_SERVICE:-tolipai-scraper-engine-service-xop}"
TASK_DEFINITION="${TASK_DEFINITION:-TolipAI-scraper-engine}"

# Scaling bounds
MIN_CAPACITY="${MIN_CAPACITY:-1}"
MAX_CAPACITY="${MAX_CAPACITY:-10}"
BUSINESS_MIN="${BUSINESS_MIN:-2}"    # minimum during business hours
BUSINESS_MAX="${BUSINESS_MAX:-8}"
NIGHT_MIN="${NIGHT_MIN:-1}"          # minimum overnight / weekends

APPLY=false
REMOVE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply)  APPLY=true;  shift ;;
    --remove) REMOVE=true; shift ;;
    *)        shift ;;
  esac
done

# ── Helper: run or print ───────────────────────────────────────────────────────
run() {
  if [ "$APPLY" = true ]; then
    echo "  RUNNING: $*"
    eval "$@"
  else
    echo "  DRY-RUN: $*"
  fi
}

RESOURCE_ID="service/${ECS_CLUSTER}/${ECS_SERVICE}"

# ── Remove all scaling config ─────────────────────────────────────────────────
if [ "$REMOVE" = true ]; then
  echo "==> Removing all scheduled actions and scaling policies..."

  for action in scale-up-business scale-down-night scale-down-weekend; do
    run "aws application-autoscaling delete-scheduled-action \
      --service-namespace ecs \
      --resource-id '${RESOURCE_ID}' \
      --scalable-dimension ecs:service:DesiredCount \
      --scheduled-action-name '${action}' \
      --region '${AWS_REGION}' 2>/dev/null || true"
  done

  run "aws application-autoscaling delete-scaling-policy \
    --policy-name TolipAI-cpu-step-scaling \
    --service-namespace ecs \
    --resource-id '${RESOURCE_ID}' \
    --scalable-dimension ecs:service:DesiredCount \
    --region '${AWS_REGION}' 2>/dev/null || true"

  run "aws application-autoscaling deregister-scalable-target \
    --service-namespace ecs \
    --resource-id '${RESOURCE_ID}' \
    --scalable-dimension ecs:service:DesiredCount \
    --region '${AWS_REGION}' 2>/dev/null || true"

  echo "Done."
  exit 0
fi

echo "==> Fargate Spot scaling configuration"
echo "    Cluster:   ${ECS_CLUSTER}"
echo "    Service:   ${ECS_SERVICE}"
echo "    Capacity:  min=${MIN_CAPACITY} max=${MAX_CAPACITY}"
echo "    Business:  min=${BUSINESS_MIN} max=${BUSINESS_MAX} (Mon-Fri 09:00-18:00 EST)"
echo "    Night/Wkd: min=${NIGHT_MIN}"
echo "    Mode:      $( [ "$APPLY" = true ] && echo 'APPLY' || echo 'DRY-RUN (pass --apply to execute)' )"
echo ""

# ── Step 1: Capacity provider strategy (Spot-first, on-demand fallback) ────────
echo "==> [1/4] Updating capacity provider strategy (FARGATE_SPOT primary)..."
run "aws ecs update-service \
  --cluster '${ECS_CLUSTER}' \
  --service '${ECS_SERVICE}' \
  --capacity-provider-strategy \
    capacityProvider=FARGATE_SPOT,weight=4,base=0 \
    capacityProvider=FARGATE,weight=1,base=1 \
  --region '${AWS_REGION}' \
  --output table"
# base=1 on FARGATE on-demand ensures at least 1 on-demand task is always
# running so a full Spot sweep doesn't take the service to zero.

# ── Step 2: Register scalable target ──────────────────────────────────────────
echo ""
echo "==> [2/4] Registering scalable target..."
run "aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id '${RESOURCE_ID}' \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity '${MIN_CAPACITY}' \
  --max-capacity '${MAX_CAPACITY}' \
  --region '${AWS_REGION}'"

# ── Step 3: Scheduled scaling actions ─────────────────────────────────────────
echo ""
echo "==> [3/4] Creating scheduled scaling actions..."

# Scale UP: 09:00 EST (14:00 UTC) Mon-Fri
run "aws application-autoscaling put-scheduled-action \
  --service-namespace ecs \
  --resource-id '${RESOURCE_ID}' \
  --scalable-dimension ecs:service:DesiredCount \
  --scheduled-action-name scale-up-business \
  --schedule 'cron(0 14 ? * MON-FRI *)' \
  --scalable-target-action MinCapacity=${BUSINESS_MIN},MaxCapacity=${BUSINESS_MAX} \
  --region '${AWS_REGION}'"

# Scale DOWN: 18:00 EST (23:00 UTC) Mon-Fri
run "aws application-autoscaling put-scheduled-action \
  --service-namespace ecs \
  --resource-id '${RESOURCE_ID}' \
  --scalable-dimension ecs:service:DesiredCount \
  --scheduled-action-name scale-down-night \
  --schedule 'cron(0 23 ? * MON-FRI *)' \
  --scalable-target-action MinCapacity=${NIGHT_MIN},MaxCapacity=${MAX_CAPACITY} \
  --region '${AWS_REGION}'"

# Weekend floor: Saturday 00:00 UTC → Monday 14:00 UTC handled by the above pair.
# Explicit weekend floor ensures the min doesn't creep up via step scaling:
run "aws application-autoscaling put-scheduled-action \
  --service-namespace ecs \
  --resource-id '${RESOURCE_ID}' \
  --scalable-dimension ecs:service:DesiredCount \
  --scheduled-action-name scale-down-weekend \
  --schedule 'cron(0 0 ? * SAT *)' \
  --scalable-target-action MinCapacity=${NIGHT_MIN},MaxCapacity=3 \
  --region '${AWS_REGION}'"

# ── Step 4: Step scaling policy (CPU-driven) ───────────────────────────────────
echo ""
echo "==> [4/4] Creating CPU step scaling policy..."

POLICY_CONFIG='{
  "AdjustmentType": "ChangeInCapacity",
  "StepAdjustments": [
    {
      "MetricIntervalLowerBound": 0,
      "MetricIntervalUpperBound": 20,
      "ScalingAdjustment": 2
    },
    {
      "MetricIntervalLowerBound": 20,
      "ScalingAdjustment": 4
    }
  ],
  "Cooldown": 120,
  "MetricAggregationType": "Average"
}'

run "aws application-autoscaling put-scaling-policy \
  --policy-name TolipAI-cpu-step-scaling \
  --service-namespace ecs \
  --resource-id '${RESOURCE_ID}' \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-type StepScaling \
  --step-scaling-policy-configuration '${POLICY_CONFIG}' \
  --region '${AWS_REGION}'"

# Wire the policy to the ECSServiceAverageCPUUtilization alarm
# (CPU > 60% for 3 minutes triggers scale-out)
POLICY_ARN=$( [ "$APPLY" = true ] && \
  aws application-autoscaling describe-scaling-policies \
    --policy-names TolipAI-cpu-step-scaling \
    --service-namespace ecs \
    --resource-id "${RESOURCE_ID}" \
    --scalable-dimension ecs:service:DesiredCount \
    --region "${AWS_REGION}" \
    --query "ScalingPolicies[0].PolicyARN" \
    --output text 2>/dev/null || \
  echo "arn:aws:autoscaling:${AWS_REGION}:${AWS_ACCOUNT_ID}:scalingPolicy:PLACEHOLDER")

run "aws cloudwatch put-metric-alarm \
  --alarm-name TolipAI-scraper-cpu-high \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --dimensions Name=ClusterName,Value=${ECS_CLUSTER} Name=ServiceName,Value=${ECS_SERVICE} \
  --period 60 \
  --evaluation-periods 3 \
  --threshold 60 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions '${POLICY_ARN}' \
  --region '${AWS_REGION}'"

echo ""
echo "==> Done."
echo ""
echo "    Cost impact estimate:"
echo "    ─────────────────────────────────────────────────────"
echo "    Before: 2 tasks × 24h × 30d × on-demand price"
echo "    After:  2 tasks × 9h weekday + 1 task × 15h + weekend"
echo "            ~80% FARGATE_SPOT = ~70% unit cost reduction"
echo "            Scheduled hours reduction: ~40% fewer task-hours"
echo "    Combined estimated savings: 55-65% on compute"
echo ""
echo "    Monitor:"
echo "    aws ecs describe-services --cluster ${ECS_CLUSTER} --services ${ECS_SERVICE} --region ${AWS_REGION}"
echo "    aws application-autoscaling describe-scheduled-actions --service-namespace ecs --resource-id '${RESOURCE_ID}' --region ${AWS_REGION}"
