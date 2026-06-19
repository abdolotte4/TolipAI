#!/usr/bin/env bash
# ecs-diagnose.sh — Comprehensive ECS diagnostic script for TolipAI Scraper Engine
# Run this in AWS CloudShell to diagnose why the ECS task is stopping immediately.
#
# Usage:  ./ecs-diagnose.sh [CLUSTER_NAME] [SERVICE_NAME]
# If CLUSTER_NAME/SERVICE_NAME are omitted, the script attempts auto-discovery.

set -euo pipefail

ACCOUNT_ID="583299526161"
REGION="us-east-1"
TASK_FAMILY="tolipai-scraper-engine"
ALB_DNS="tolip-scraper-url-323311724.us-east-1.elb.amazonaws.com"

# ── ANSI colours ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Colour

# ── Helpers ──────────────────────────────────────────────────────────────────
header()  { echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; echo -e "${BLUE}  $1${NC}"; }
ok()      { echo -e "${GREEN}  ✓${NC} $1"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $1"; }
fail()    { echo -e "${RED}  ✗${NC} $1"; }
info()    { echo -e "    $1"; }
separator() { echo -e "${BLUE}─────────────────────────────────────────────────────────────────────${NC}"; }

# ── Auto-discover cluster / service ──────────────────────────────────────────
if [ -z "${1:-}" ]; then
  CLUSTERS=$(aws ecs list-clusters --region "$REGION" --query 'clusterArns[*]' --output text 2>/dev/null || true)
  if [ -z "$CLUSTERS" ]; then
    echo "ERROR: No ECS clusters found in $REGION."
    exit 1
  fi
  CLUSTER_COUNT=$(echo "$CLUSTERS" | wc -w)
  if [ "$CLUSTER_COUNT" -eq 1 ]; then
    CLUSTER_NAME=$(echo "$CLUSTERS" | awk -F'/' '{print $NF}')
    ok "Auto-discovered cluster: $CLUSTER_NAME"
  else
    echo "Multiple ECS clusters found:"
    echo "$CLUSTERS" | awk -F'/' '{print "  - " $NF}'
    read -r -p "Enter cluster name: " CLUSTER_NAME
  fi
else
  CLUSTER_NAME="$1"
  info "Using cluster: $CLUSTER_NAME"
fi

if [ -z "${2:-}" ]; then
  SERVICES=$(aws ecs list-services --cluster "$CLUSTER_NAME" --region "$REGION" --query 'serviceArns[*]' --output text 2>/dev/null || true)
  if [ -z "$SERVICES" ]; then
    echo "ERROR: No services found in cluster $CLUSTER_NAME."
    exit 1
  fi
  SERVICE_COUNT=$(echo "$SERVICES" | wc -w)
  if [ "$SERVICE_COUNT" -eq 1 ]; then
    SERVICE_NAME=$(echo "$SERVICES" | awk -F'/' '{print $NF}')
    ok "Auto-discovered service: $SERVICE_NAME"
  else
    echo "Multiple services found in cluster $CLUSTER_NAME:"
    echo "$SERVICES" | awk -F'/' '{print "  - " $NF}'
    read -r -p "Enter service name: " SERVICE_NAME
  fi
else
  SERVICE_NAME="$2"
  info "Using service: $SERVICE_NAME"
fi

# ── 1. Service & Task Definition ───────────────────────────────────────────
header "1. ECS Service & Task Definition"
separator

SERVICE_JSON=$(aws ecs describe-services \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --region "$REGION" \
  --output json 2>/dev/null || echo '{}')

if [ "$SERVICE_JSON" = '{}' ]; then
  fail "Could not describe service $SERVICE_NAME"
else
  CURRENT_TD_ARN=$(echo "$SERVICE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['services'][0]['taskDefinition'] if d.get('services') else 'UNKNOWN')" 2>/dev/null || echo 'UNKNOWN')
  DESIRED=$(echo "$SERVICE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['services'][0]['desiredCount'] if d.get('services') else 'UNKNOWN')" 2>/dev/null || echo 'UNKNOWN')
  RUNNING=$(echo "$SERVICE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['services'][0]['runningCount'] if d.get('services') else 'UNKNOWN')" 2>/dev/null || echo 'UNKNOWN')
  PENDING=$(echo "$SERVICE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['services'][0]['pendingCount'] if d.get('services') else 'UNKNOWN')" 2>/dev/null || echo 'UNKNOWN')
  STATUS=$(echo "$SERVICE_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['services'][0]['status'] if d.get('services') else 'UNKNOWN')" 2>/dev/null || echo 'UNKNOWN')

  info "Current task definition: $CURRENT_TD_ARN"
  info "Desired count: $DESIRED | Running: $RUNNING | Pending: $PENDING | Status: $STATUS"

  if [ "$RUNNING" = "0" ] && [ "$DESIRED" -gt 0 ]; then
    warn "No tasks running but desired=$DESIRED — service is failing to launch tasks"
  fi
  if [ "$STATUS" != "ACTIVE" ]; then
    fail "Service status is $STATUS (expected ACTIVE)"
  fi
fi

# ── 2. Latest Stopped Task ───────────────────────────────────────────────────
header "2. Latest Stopped Task(s)"
separator

STOPPED_TASKS=$(aws ecs list-tasks \
  --cluster "$CLUSTER_NAME" \
  --service-name "$SERVICE_NAME" \
  --desired-status STOPPED \
  --region "$REGION" \
  --query 'taskArns[*]' --output text 2>/dev/null || true)

if [ -z "$STOPPED_TASKS" ] || [ "$STOPPED_TASKS" = "None" ]; then
  warn "No stopped tasks found in the last few minutes."
else
  # Get the most recent stopped task details
  LATEST_STOPPED=$(echo "$STOPPED_TASKS" | awk '{print $1}')
  info "Latest stopped task: $LATEST_STOPPED"

  TASK_DETAIL=$(aws ecs describe-tasks \
    --cluster "$CLUSTER_NAME" \
    --tasks "$LATEST_STOPPED" \
    --region "$REGION" \
    --output json 2>/dev/null || echo '{}')

  STOP_REASON=$(echo "$TASK_DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('tasks',[])[0] if d.get('tasks') else {}; print(t.get('stoppedReason','UNKNOWN'))" 2>/dev/null || echo 'UNKNOWN')
  STOP_CODE=$(echo "$TASK_DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('tasks',[])[0] if d.get('tasks') else {}; print(t.get('stopCode','UNKNOWN'))" 2>/dev/null || echo 'UNKNOWN')
  EXIT_CODE=$(echo "$TASK_DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('tasks',[])[0] if d.get('tasks') else {}; c=t.get('containers',[]); print(c[0].get('exitCode','UNKNOWN') if c else 'UNKNOWN')" 2>/dev/null || echo 'UNKNOWN')
  LAST_STATUS=$(echo "$TASK_DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('tasks',[])[0] if d.get('tasks') else {}; print(t.get('lastStatus','UNKNOWN'))" 2>/dev/null || echo 'UNKNOWN')
  TASK_DEF=$(echo "$TASK_DETAIL" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('tasks',[])[0] if d.get('tasks') else {}; print(t.get('taskDefinitionArn','UNKNOWN'))" 2>/dev/null || echo 'UNKNOWN')

  info "Stop reason:  $STOP_REASON"
  info "Stop code:    $STOP_CODE"
  info "Exit code:    $EXIT_CODE"
  info "Last status:  $LAST_STATUS"
  info "Task def:     $TASK_DEF"

  # Check for common error patterns
  if echo "$STOP_REASON" | grep -qi "CannotPullContainer"; then
    fail "Image pull error — check ECR permissions and image tag"
  fi
  if echo "$STOP_REASON" | grep -qi "CannotStartContainer"; then
    fail "Container start error — check entrypoint, command, or missing env vars"
  fi
  if echo "$STOP_REASON" | grep -qi "Essential container in task exited"; then
    if [ "$EXIT_CODE" = "1" ]; then
      fail "Container exited with code 1 — likely start.fargate.sh failed (check DATABASE_URL or missing secrets)"
    fi
    if [ "$EXIT_CODE" = "137" ]; then
      warn "Container exited with code 137 (SIGKILL) — likely OOM or health check failure"
    fi
  fi
  if echo "$STOP_REASON" | grep -qi "OutOfMemory"; then
    fail "Out of memory — increase task memory or reduce concurrent browsers"
  fi
  if echo "$STOP_REASON" | grep -qi "health check"; then
    fail "Health check failed — verify /health endpoint responds on port 8765"
  fi

  # Print events
  echo ""
  info "Task events (most recent):"
  echo "$TASK_DETAIL" | python3 -c "
import sys, json, datetime
d = json.load(sys.stdin)
t = d.get('tasks', [{}])[0]
for e in reversed(t.get('events', [])[-5:]):
    ts = e.get('createdAt', 'unknown')
    msg = e.get('message', '')
    print(f'  {ts}: {msg}')
" 2>/dev/null || true
fi

# ── 3. CloudWatch Logs ───────────────────────────────────────────────────────
header "3. CloudWatch Logs (last 5 minutes)"
separator

LOG_GROUP="/ecs/tolipai-scraper-engine"
NOW=$(date -u +%s)
FIVE_MIN_AGO=$((NOW - 300))

LOGS=$(aws logs filter-log-events \
  --log-group-name "$LOG_GROUP" \
  --start-time "${FIVE_MIN_AGO}000" \
  --region "$REGION" \
  --query 'events[*].message' --output text 2>/dev/null || true)

if [ -z "$LOGS" ] || [ "$LOGS" = "None" ]; then
  warn "No CloudWatch logs found in the last 5 minutes."
  info "Possible reasons:"
  info "  • Log group doesn't exist yet (first run?)"
  info "  • Execution role lacks logs:CreateLogStream / logs:PutLogEvents"
  info "  • Container failed before logging started"
else
  # Show last 20 lines, filter for fatal/error
  echo "$LOGS" | tail -20 | while IFS= read -r line; do
    info "$line"
  done
  echo ""
  FATAL_COUNT=$(echo "$LOGS" | grep -c '"level":"fatal"' || true)
  ERROR_COUNT=$(echo "$LOGS" | grep -c '"level":"error"' || true)
  if [ "$FATAL_COUNT" -gt 0 ] || [ "$ERROR_COUNT" -gt 0 ]; then
    fail "Found $FATAL_COUNT fatal(s) and $ERROR_COUNT error(s) in recent logs"
  fi
fi

# ── 4. Execution Role & Policies ───────────────────────────────────────────
header "4. Execution Role Permissions"
separator

EXEC_ROLE="arn:aws:iam::${ACCOUNT_ID}:role/TolipAI-scraper-execution-role"

ROLE_EXISTS=$(aws iam get-role \
  --role-name "TolipAI-scraper-execution-role" \
  --query 'Role.Arn' --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$ROLE_EXISTS" = "NOT_FOUND" ]; then
  fail "Execution role TolipAI-scraper-execution-role NOT FOUND"
  info "This role must exist for ECS to pull images, read secrets, and write logs."
else
  ok "Execution role exists: $ROLE_EXISTS"

  # Check trust policy (must allow ecs-tasks.amazonaws.com)
  TRUST_POLICY=$(aws iam get-role \
    --role-name "TolipAI-scraper-execution-role" \
    --query 'Role.AssumeRolePolicyDocument' --output json 2>/dev/null || echo '{}')

  TRUST_OK=$(echo "$TRUST_POLICY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for stmt in d.get('Statement', []):
    if stmt.get('Effect') == 'Allow' and 'ecs-tasks.amazonaws.com' in str(stmt.get('Principal', {})):
        print('YES')
        sys.exit(0)
print('NO')
" 2>/dev/null || echo "NO")

  if [ "$TRUST_OK" = "YES" ]; then
    ok "Trust policy allows ecs-tasks.amazonaws.com"
  else
    fail "Trust policy does NOT allow ecs-tasks.amazonaws.com — ECS cannot assume this role!"
  fi

  # List attached policies
  info "Attached policies:"
  aws iam list-attached-role-policies \
    --role-name "TolipAI-scraper-execution-role" \
    --query 'AttachedPolicies[*].PolicyName' --output text 2>/dev/null | tr '\t' '\n' | while IFS= read -r line; do
      info "  • $line"
    done || true

  # Check inline policy for secrets manager permissions
  INLINE_POLICIES=$(aws iam list-role-policies \
    --role-name "TolipAI-scraper-execution-role" \
    --query 'PolicyNames' --output text 2>/dev/null || true)
  if [ -n "$INLINE_POLICIES" ] && [ "$INLINE_POLICIES" != "None" ]; then
    info "Inline policies: $INLINE_POLICIES"
  fi
fi

# ── 5. Task Role ─────────────────────────────────────────────────────────────
header "5. Task Role Permissions"
separator

TASK_ROLE="arn:aws:iam::${ACCOUNT_ID}:role/TolipAI-scraper-task-role"

TASK_ROLE_EXISTS=$(aws iam get-role \
  --role-name "TolipAI-scraper-task-role" \
  --query 'Role.Arn' --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$TASK_ROLE_EXISTS" = "NOT_FOUND" ]; then
  warn "Task role TolipAI-scraper-task-role NOT FOUND (app may lack S3/DB access)"
else
  ok "Task role exists: $TASK_ROLE_EXISTS"
fi

# ── 6. Secrets Manager Verification ──────────────────────────────────────────
header "6. Secrets Manager Verification"
separator

SECRETS=(
  "TolipAI/scraper/DATABASE_URL"
  "TolipAI/scraper/SCRAPER_API_KEY"
  "TolipAI/scraper/JWT_SECRET"
  "TolipAI/scraper/OPENAI_API_KEY"
  "TolipAI/scraper/ATTOM_API_KEY"
  "TolipAI/scraper/ATTOM_API_KEY_2"
  "TolipAI/scraper/BRIGHTDATA_USERNAME"
  "TolipAI/scraper/BRIGHTDATA_PASSWORD"
  "TolipAI/scraper/OXYLABS_USERNAME"
  "TolipAI/scraper/OXYLABS_PASSWORD"
  "TolipAI/scraper/PROPELIO_EMAIL"
  "TolipAI/scraper/PROPELIO_PASSWORD"
  "TolipAI/scraper/PROPWIRE_EMAIL"
  "TolipAI/scraper/PROPWIRE_PASSWORD"
  "TolipAI/scraper/GOOGLE_MAPS_API_KEY"
  "TolipAI/scraper/REDIS_URL"
  "TolipAI/scraper/S3_CACHE_BUCKET"
  "TolipAI/scraper/WEBSCRAPER_KEY"
  "TolipAI/scraper/OPENROUTER_KEY"
  "TolipAI/scraper/GROQ_KEY"
  "TolipAI/scraper/OPENAI_BASE_URL"
  "TolipAI/scraper/AI_MODEL"
  "TolipAI/scraper/MOONSHOT_KEY"
  "TolipAI/scraper/NVIDIA_KEY"
  "TolipAI/scraper/BRIGHTDATA_API"
  "TolipAI/scraper/PROXY_HOST"
  "TolipAI/scraper/CEREBRAS_KEY"
  "TolipAI/scraper/GEMINI_KEY"
  "TolipAI/scraper/PEOPLEDATALABS_KEY"
)

MISSING_SECRETS=0
for SEC in "${SECRETS[@]}"; do
  SEC_ARN="arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:${SEC}"
  EXISTS=$(aws secretsmanager describe-secret \
    --secret-id "$SEC" \
    --region "$REGION" \
    --query 'ARN' --output text 2>/dev/null || echo "NOT_FOUND")
  if [ "$EXISTS" = "NOT_FOUND" ]; then
    fail "Secret NOT FOUND: $SEC"
    MISSING_SECRETS=$((MISSING_SECRETS + 1))
  else
    ok "Secret exists: $SEC"
  fi
done

if [ "$MISSING_SECRETS" -gt 0 ]; then
  fail "$MISSING_SECRETS secret(s) missing — task cannot start without these"
fi

# ── 7. ECR Image Check ───────────────────────────────────────────────────────
header "7. ECR Image"
separator

ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/tolipai-scraper"
info "Checking ECR repository: $ECR_REPO"

ECR_JSON=$(aws ecr describe-images \
  --repository-name "tolipai-scraper" \
  --region "$REGION" \
  --image-ids imageTag=latest \
  --output json 2>/dev/null || echo '{}')

if [ "$ECR_JSON" = '{}' ]; then
  fail "Image 'latest' not found in ECR repository 'tolipai-scraper'"
  info "The task definition points to: ${ECR_REPO}:latest"
  info "You may need to build and push the image first."
else
  PUSHED=$(echo "$ECR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['imageDetails'][0].get('imagePushedAt','UNKNOWN'))" 2>/dev/null || echo 'UNKNOWN')
  TAGS=$(echo "$ECR_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(d['imageDetails'][0].get('imageTags',[])))" 2>/dev/null || echo 'UNKNOWN')
  ok "Image exists: ${ECR_REPO}:latest (pushed at $PUSHED, tags: $TAGS)"
fi

# ── 8. ALB Target Health ───────────────────────────────────────────────────────
header "8. ALB Target Group Health"
separator

info "ALB DNS: $ALB_DNS"
info "Checking if /health endpoint is reachable from CloudShell..."

HEALTH_RESPONSE=$(curl -sf --max-time 5 "http://${ALB_DNS}:8765/health" 2>/dev/null || echo "FAILED")
if [ "$HEALTH_RESPONSE" = "FAILED" ]; then
  fail "ALB health endpoint is NOT reachable (http://${ALB_DNS}:8765/health)"
  info "This is expected if all tasks are stopped."
else
  ok "ALB responds to /health"
  info "Response: $(echo "$HEALTH_RESPONSE" | head -c 200)"
fi

# Find target groups for this ALB
ALB_ARN=$(aws elbv2 describe-load-balancers \
  --names "tolip-scraper-url" \
  --region "$REGION" \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$ALB_ARN" != "NOT_FOUND" ]; then
  TGS=$(aws elbv2 describe-target-groups \
    --load-balancer-arn "$ALB_ARN" \
    --region "$REGION" \
    --query 'TargetGroups[*].TargetGroupArn' --output text 2>/dev/null || true)
  if [ -n "$TGS" ] && [ "$TGS" != "None" ]; then
    for TG in $TGS; do
      TG_NAME=$(echo "$TG" | awk -F'/' '{print $NF}')
      HEALTH=$(aws elbv2 describe-target-health \
        --target-group-arn "$TG" \
        --region "$REGION" \
        --output json 2>/dev/null || echo '{}')
      HEALTHY_COUNT=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for t in d.get('TargetHealthDescriptions',[]) if t.get('TargetHealth',{}).get('State')=='healthy'))" 2>/dev/null || echo '0')
      UNHEALTHY_COUNT=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for t in d.get('TargetHealthDescriptions',[]) if t.get('TargetHealth',{}).get('State')=='unhealthy'))" 2>/dev/null || echo '0')
      info "Target group $TG_NAME: $HEALTHY_COUNT healthy, $UNHEALTHY_COUNT unhealthy"
    done
  fi
else
  warn "Could not find ALB 'tolip-scraper-url' — checking by DNS instead..."
fi

# ── 9. Task Definition Validation ────────────────────────────────────────────
header "9. Task Definition Validation"
separator

if [ "$CURRENT_TD_ARN" != "UNKNOWN" ]; then
  TD_JSON=$(aws ecs describe-task-definition \
    --task-definition "$CURRENT_TD_ARN" \
    --region "$REGION" \
    --output json 2>/dev/null || echo '{}')

  TD_EXEC_ROLE=$(echo "$TD_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['taskDefinition'].get('executionRoleArn','MISSING'))" 2>/dev/null || echo 'MISSING')
  TD_IMAGE=$(echo "$TD_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['taskDefinition']['containerDefinitions'][0].get('image','MISSING'))" 2>/dev/null || echo 'MISSING')
  TD_SECRETS_COUNT=$(echo "$TD_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['taskDefinition']['containerDefinitions'][0].get('secrets',[])))" 2>/dev/null || echo '0')
  TD_ENV_COUNT=$(echo "$TD_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['taskDefinition']['containerDefinitions'][0].get('environment',[])))" 2>/dev/null || echo '0')

  info "Execution role ARN: $TD_EXEC_ROLE"
  info "Image URI: $TD_IMAGE"
  info "Secrets count: $TD_SECRETS_COUNT"
  info "Environment vars count: $TD_ENV_COUNT"

  # Check for placeholder ACCOUNT_ID
  if echo "$TD_EXEC_ROLE" | grep -q "ACCOUNT_ID"; then
    fail "Execution role contains literal 'ACCOUNT_ID' placeholder — must be replaced with real account ID!"
  fi
  if echo "$TD_IMAGE" | grep -q "ACCOUNT_ID"; then
    fail "Image URI contains literal 'ACCOUNT_ID' placeholder — must be replaced with real account ID!"
  fi

  # Check if secrets have ACCOUNT_ID placeholder
  BAD_SECRETS=$(echo "$TD_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
secrets = d['taskDefinition']['containerDefinitions'][0].get('secrets', [])
bad = [s['name'] for s in secrets if 'ACCOUNT_ID' in str(s.get('valueFrom',''))]
if bad:
    print(','.join(bad))
" 2>/dev/null || true)
  if [ -n "$BAD_SECRETS" ]; then
    fail "These secrets contain 'ACCOUNT_ID' placeholder: $BAD_SECRETS"
  fi
else
  warn "Could not fetch current task definition details"
fi

# ── 10. Summary & Recommendations ───────────────────────────────────────────
header "10. DIAGNOSTIC SUMMARY"
separator

if [ "$MISSING_SECRETS" -gt 0 ]; then
  echo -e "${RED}CRITICAL:${NC} $MISSING_SECRETS secret(s) are missing. Create them before the task can start."
fi
if [ "$ROLE_EXISTS" = "NOT_FOUND" ]; then
  echo -e "${RED}CRITICAL:${NC} Execution role does not exist. Create it with the required policies."
fi
if [ "${TRUST_OK:-NO}" != "YES" ]; then
  echo -e "${RED}CRITICAL:${NC} Execution role trust policy is wrong. Add 'ecs-tasks.amazonaws.com' to the trust policy."
fi
if [ "${BAD_SECRETS:-}" != "" ]; then
  echo -e "${RED}CRITICAL:${NC} Task definition contains 'ACCOUNT_ID' placeholders. Replace with 583299526161."
fi
if [ "${ECR_JSON:-}" = "{}" ]; then
  echo -e "${RED}CRITICAL:${NC} ECR image 'tolipai-scraper:latest' does not exist."
fi
if [ "$RUNNING" = "0" ] && [ "$DESIRED" -gt 0 ] && [ "$STOP_REASON" = "UNKNOWN" ]; then
  echo -e "${YELLOW}WARNING:${NC} No stopped tasks found but no tasks running. Check ECS events for scheduling errors."
fi

separator
info "Next steps:"
info "1. Fix any CRITICAL issues found above."
info "2. Run:  aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment --region $REGION"
info "3. Monitor:  aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --region $REGION"
info "4. Watch logs:  aws logs tail $LOG_GROUP --follow --region $REGION"
info "5. Run smoke test:  ./infrastructure/ecs-smoke-test.sh"
separator
