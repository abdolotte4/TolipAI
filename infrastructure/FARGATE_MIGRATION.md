# TolipAI Scraper Engine — AWS Fargate Deployment Guide

**Target:** `artifacts/TolipAI-scraper-engine` (Python 3.11 / FastAPI)
**Platform:** AWS ECS on Fargate Spot (ARM64 / Graviton3)
**Database:** Neon PostgreSQL (serverless — same as Railway monorepo)
**Status:** Strategy document — Railway monorepo stays on Railway; only the scraper engine migrates to Fargate.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Railway (unchanged)                                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  api-server + CRM + Tools + Website SPAs                   │   │
│  │  Proxies scraper requests → AWS ALB (via API_SCRAPER_URL)  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                              │  HTTPS (mTLS optional)
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  AWS (us-east-1 recommended — same region as Neon)                 │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ALB (Application Load Balancer)                            │  │
│  │  Listener: HTTPS 443 → Target Group → ECS Service          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ECS Cluster — "tolipai-scraper"                            │  │
│  │  Service: scraper-engine (FARGATE_SPOT, ARM64)              │  │
│  │  Tasks: 1–4 replicas (auto-scaling on CPU ≥ 60%)           │  │
│  │                                                              │  │
│  │  Container: tolipai-scraper-engine                          │  │
│  │    Image: ECR repo (ARM64 build)                            │  │
│  │    Port: 8000                                               │  │
│  │    CPU: 1024 (1 vCPU)  Memory: 3072 MB                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ECR Repository: tolipai/scraper-engine                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Secrets Manager: /tolipai/scraper/*                        │  │
│  │  (DATABASE_URL, OPENAI_API_KEY, REDIS_URL, etc.)            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ElastiCache (Redis) — optional job queue / rate-limit cache│  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

---

## Quick Deploy (Recommended)

All manual steps below are automated in the provided scripts. Copy and fill in `infrastructure/.env.aws.example` → `infrastructure/.env.aws`, then:

```bash
# 1. One-time infrastructure setup (IAM, ECR, ECS cluster, ALB, scaling)
#    — run each step once, then never again unless you tear down the stack.

# 2. Every release: build image + update ECS service
./infrastructure/deploy.sh

# 3. Optional: configure Spot-first scaling + scheduled scale-in/out
./infrastructure/scaling.sh --apply

# 4. Optional: create S3 bucket for job artifacts / screenshots
S3_BUCKET=TolipAI-scraper-storage ./infrastructure/s3-setup.sh --apply
```

> All scripts read `infrastructure/.env.aws` for credentials and resource names. See `infrastructure/.env.aws.example` for the full variable reference.

The step-by-step instructions below document the one-time setup commands behind each script.

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| AWS CLI | v2 | `brew install awscli` |
| Docker (with buildx) | 24+ | docker.com |
| jq | any | `brew install jq` |

Configure your AWS credentials:
```bash
aws configure
# AWS Access Key ID: <your key>
# AWS Secret Access Key: <your secret>
# Default region: us-east-1
# Default output: json
```

---

## Step 1 — Create the ECR Repository

```bash
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=us-east-1
REPO_NAME=TolipAI-scraper

aws ecr create-repository \
  --repository-name $REPO_NAME \
  --region $AWS_REGION \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256

echo "ECR URI: ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"
```

---

## Step 2 — Build & Push the ARM64 Docker Image

The scraper engine has a dedicated `Dockerfile.fargate` (Python 3.11-slim-bookworm, port **8765**).

```bash
# Authenticate Docker to ECR
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS \
    --password-stdin ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com

# Build for linux/arm64 (Graviton3 Fargate Spot)
cd artifacts/TolipAI-scraper-engine

docker buildx build \
  --platform linux/arm64 \
  --file Dockerfile.fargate \
  --tag ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}:latest \
  --push \
  .
```

> **Note:** If you are building on an x86 Mac/Linux, Docker buildx will emulate ARM64 via QEMU. This is slow (~15 min). Use `infrastructure/ecr-push.sh` which handles builder setup automatically.
> **Shortcut:** `./infrastructure/ecr-push.sh` handles Docker login, buildx setup, and push in one command.

---

## Step 3 — Store Secrets in AWS Secrets Manager

Secret paths use the prefix `TolipAI/scraper/` (case-sensitive — must match `infrastructure/ecs-task-definition.json`).

```bash
# Store each secret individually (never in environment variables or Dockerfile)
# Core infrastructure
aws secretsmanager create-secret --name TolipAI/scraper/database-url \
  --secret-string "postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require"
aws secretsmanager create-secret --name TolipAI/scraper/redis-url \
  --secret-string "redis://your-elasticache-endpoint:6379"
aws secretsmanager create-secret --name TolipAI/scraper/api-key \
  --secret-string "your-internal-scraper-api-key"

# AI providers
aws secretsmanager create-secret --name TolipAI/scraper/openrouter-key \
  --secret-string "sk-or-..."
aws secretsmanager create-secret --name TolipAI/scraper/groq-key \
  --secret-string "gsk_..."

# Real estate data APIs
aws secretsmanager create-secret --name TolipAI/scraper/attom-key \
  --secret-string "your-attom-api-key"

# Proxy (BrightData)
aws secretsmanager create-secret --name TolipAI/scraper/brightdata-username \
  --secret-string "your-brightdata-username"
aws secretsmanager create-secret --name TolipAI/scraper/brightdata-password \
  --secret-string "your-brightdata-password"

# Scraper credentials (Propelio / PropWire)
aws secretsmanager create-secret --name TolipAI/scraper/propelio-email \
  --secret-string "scraper@yourdomain.com"
aws secretsmanager create-secret --name TolipAI/scraper/propelio-password \
  --secret-string "your-propelio-password"
aws secretsmanager create-secret --name TolipAI/scraper/propwire-email \
  --secret-string "scraper@yourdomain.com"
aws secretsmanager create-secret --name TolipAI/scraper/propwire-password \
  --secret-string "your-propwire-password"

# S3 + Twilio (optional — used if S3_CACHE_BUCKET is configured)
aws secretsmanager create-secret --name TolipAI/scraper/s3-cache-bucket \
  --secret-string "TolipAI-scraper-storage"
aws secretsmanager create-secret --name TolipAI/scraper/twilio-account-sid \
  --secret-string "ACxxxxx"
aws secretsmanager create-secret --name TolipAI/scraper/twilio-auth-token \
  --secret-string "your-auth-token"

# To update an existing secret:
aws secretsmanager put-secret-value \
  --secret-id TolipAI/scraper/database-url \
  --secret-string "new-value"
```

---

## Step 4 — Create the ECS Cluster

```bash
aws ecs create-cluster \
  --cluster-name TolipAI-scraper-cluster \
  --capacity-providers FARGATE FARGATE_SPOT \
  --default-capacity-provider-strategy \
    capacityProvider=FARGATE_SPOT,weight=4,base=0 \
    capacityProvider=FARGATE,weight=1,base=1 \
  --region $AWS_REGION
```

---

## Step 5 — Create IAM Roles

### 5a. Task Execution Role (pulls image + reads secrets)

> Role names must match `infrastructure/ecs-task-definition.json`: `TolipAI-scraper-execution-role` and `TolipAI-scraper-task-role`.

```bash
# Create the role
aws iam create-role \
  --role-name TolipAI-scraper-execution-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

# Attach managed policies
aws iam attach-role-policy \
  --role-name TolipAI-scraper-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Add Secrets Manager read access (inline policy)
aws iam put-role-policy \
  --role-name TolipAI-scraper-execution-role \
  --policy-name ReadScraperSecrets \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["secretsmanager:GetSecretValue"],
      "Resource":"arn:aws:secretsmanager:'$AWS_REGION':'$AWS_ACCOUNT':secret:TolipAI/scraper/*"
    }]
  }'
```

### 5b. Task Role (runtime permissions — S3 cache, CloudWatch, ECS Exec)

```bash
aws iam create-role \
  --role-name TolipAI-scraper-task-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

# S3 cache + exports
aws iam put-role-policy \
  --role-name TolipAI-scraper-task-role \
  --policy-name S3CacheAccess \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket"],
      "Resource":[
        "arn:aws:s3:::TolipAI-scraper-cache",
        "arn:aws:s3:::TolipAI-scraper-cache/*",
        "arn:aws:s3:::TolipAI-exports",
        "arn:aws:s3:::TolipAI-exports/*"
      ]
    }]
  }'

# CloudWatch Logs
aws iam put-role-policy \
  --role-name TolipAI-scraper-task-role \
  --policy-name CloudWatchLogs \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["logs:CreateLogStream","logs:PutLogEvents","logs:CreateLogGroup"],
      "Resource":"arn:aws:logs:'$AWS_REGION':'$AWS_ACCOUNT':log-group:/ecs/TolipAI-scraper:*"
    }]
  }'

# ECS Exec (interactive debugging — enables `aws ecs execute-command`)
aws iam put-role-policy \
  --role-name TolipAI-scraper-task-role \
  --policy-name ECSExec \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["ssmmessages:CreateControlChannel","ssmmessages:CreateDataChannel","ssmmessages:OpenControlChannel","ssmmessages:OpenDataChannel"],
      "Resource":"*"
    }]
  }'
```

> Full inline policies with all three permissions are in `infrastructure/iam-policies.json`.

---

## Step 6 — Register the Task Definition

The task definition is pre-configured in `infrastructure/ecs-task-definition.json`. Key specs:

| Setting | Value |
|---|---|
| Family | `TolipAI-scraper-engine` |
| Container name | `scraper` |
| Port | **8765** (matches `Dockerfile.fargate EXPOSE 8765`) |
| CPU | 2048 (2 vCPU) — Playwright requires extra headroom |
| Memory | 4096 MB |
| Architecture | ARM64 (Graviton3) |
| Log group | `/ecs/TolipAI-scraper` |
| Execution role | `TolipAI-scraper-execution-role` |
| Task role | `TolipAI-scraper-task-role` |

```bash
# Replace ACCOUNT_ID placeholder, then register
sed "s|ACCOUNT_ID|${AWS_ACCOUNT}|g" infrastructure/ecs-task-definition.json \
  | aws ecs register-task-definition \
      --cli-input-json file:///dev/stdin \
      --region $AWS_REGION
```

> The `deploy.sh` script does this step automatically on every release — you only need the manual command for the initial registration.

---

## Step 7 — Create an Application Load Balancer

```bash
# Get your default VPC and subnets
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

SUBNET_IDS=$(aws ec2 describe-subnets \
  --filters Name=vpcId,Values=$VPC_ID \
  --query 'Subnets[*].SubnetId' --output text | tr '\t' ',')

# Security group: allow HTTPS inbound, all outbound
ALB_SG=$(aws ec2 create-security-group \
  --group-name tolipai-scraper-alb-sg \
  --description "Scraper Engine ALB" \
  --vpc-id $VPC_ID \
  --query GroupId --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG --protocol tcp --port 443 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress \
  --group-id $ALB_SG --protocol tcp --port 80 --cidr 0.0.0.0/0

# Create ALB
ALB_ARN=$(aws elbv2 create-load-balancer \
  --name tolipai-scraper-alb \
  --subnets $(echo $SUBNET_IDS | tr ',' ' ') \
  --security-groups $ALB_SG \
  --scheme internet-facing \
  --type application \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

# Target group (healthcheck on /health)
TG_ARN=$(aws elbv2 create-target-group \
  --name tolipai-scraper-tg \
  --protocol HTTP --port 8000 \
  --vpc-id $VPC_ID \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

# HTTP → HTTPS redirect listener (add ACM cert ARN for HTTPS)
aws elbv2 create-listener \
  --load-balancer-arn $ALB_ARN \
  --protocol HTTP --port 80 \
  --default-actions Type=redirect,RedirectConfig='{Protocol=HTTPS,Port=443,StatusCode=HTTP_301}'
```

> **TLS Certificate:** Request a cert in ACM (`aws acm request-certificate --domain-name scraper.yourdomain.com --validation-method DNS`), validate it via DNS, then add an HTTPS listener pointing to `$TG_ARN`.

---

## Step 8 — Create the ECS Service

The service config is in `infrastructure/ecs-service.json`. It uses **private subnets** (`assignPublicIp=DISABLED`) so tasks are not directly reachable from the internet — all traffic flows through the ALB.

```bash
# Task SG: allow traffic from ALB SG only (port 8765)
TASK_SG=$(aws ec2 create-security-group \
  --group-name TolipAI-scraper-task-sg \
  --description "Scraper Engine Tasks" \
  --vpc-id $VPC_ID \
  --query GroupId --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $TASK_SG --protocol tcp --port 8765 \
  --source-group $ALB_SG

# Substitute placeholders in ecs-service.json, then create the service
sed "s|ACCOUNT_ID|${AWS_ACCOUNT}|g; \
     s|subnet-PRIVATE_SUBNET_1|${PRIVATE_SUBNET_1}|g; \
     s|subnet-PRIVATE_SUBNET_2|${PRIVATE_SUBNET_2}|g; \
     s|sg-SCRAPER_SG_ID|${TASK_SG}|g; \
     s|targetgroup/TolipAI-scraper-tg/XXXX|$(echo $TG_ARN | cut -d: -f6)|g" \
  infrastructure/ecs-service.json \
  | aws ecs create-service \
      --cli-input-json file:///dev/stdin \
      --region $AWS_REGION

# After initial create, use deploy.sh for all subsequent updates
```

> **Private subnet requirement:** You need at least 2 private subnets in your VPC. If you only have public subnets (default VPC), either create private subnets with a NAT Gateway, or temporarily use `assignPublicIp=ENABLED` for testing.
>
> **Target group port:** Must be **8765** to match the container port in `ecs-task-definition.json`.

---

## Step 9 — Auto-Scaling

```bash
# Use scaling.sh for full scheduled + step scaling setup (recommended):
./infrastructure/scaling.sh --apply

# Or register the scalable target manually:
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/TolipAI-scraper-cluster/TolipAI-scraper-engine \
  --min-capacity 1 \
  --max-capacity 10

# Target tracking: scale out when CPU > 60%
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/TolipAI-scraper-cluster/TolipAI-scraper-engine \
  --policy-name TolipAI-cpu-step-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 60.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleInCooldown": 300,
    "ScaleOutCooldown": 60
  }'
```

> `scaling.sh` also sets up business-hours scheduled scaling (Mon-Fri 09:00-18:00 EST) and wires a CloudWatch step-scaling alarm. Run it once after the service is created.

---

## Step 10 — Update Railway to Point at Fargate

In your Railway project, set the environment variable:

```
API_SCRAPER_URL=https://scraper.yourdomain.com
```

The api-server's `scraperEngine.ts` already reads `process.env.API_SCRAPER_URL` to proxy requests. No code changes required.

---

## Step 11 — CI/CD (GitHub Actions)

Create `.github/workflows/deploy-scraper.yml`:

```yaml
name: Deploy Scraper Engine to Fargate

on:
  push:
    branches: [main]
    paths:
      - 'artifacts/TolipAI-scraper-engine/**'
      - 'infrastructure/task-definition.json'

env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: TolipAI-scraper
  ECS_CLUSTER: TolipAI-scraper-cluster
  ECS_SERVICE: TolipAI-scraper-engine
  TASK_DEFINITION: infrastructure/ecs-task-definition.json

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/GithubActionsECRPush
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build, tag, and push ARM64 image
        id: build-image
        env:
          ECR_REGISTRY: ${{ steps.login-ecr.outputs.registry }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          docker buildx create --use
          docker buildx build \
            --platform linux/arm64 \
            --file artifacts/TolipAI-scraper-engine/Dockerfile.fargate \
            --tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG \
            --tag $ECR_REGISTRY/$ECR_REPOSITORY:latest \
            --push \
            artifacts/TolipAI-scraper-engine/
          echo "image=$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG" >> $GITHUB_OUTPUT

      - name: Render ECS task definition with new image
        id: render-task-def
        uses: aws-actions/amazon-ecs-render-task-definition@v1
        with:
          task-definition: ${{ env.TASK_DEFINITION }}
          container-name: scraper-engine
          image: ${{ steps.build-image.outputs.image }}

      - name: Deploy to ECS
        uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: ${{ steps.render-task-def.outputs.task-definition }}
          service: ${{ env.ECS_SERVICE }}
          cluster: ${{ env.ECS_CLUSTER }}
          wait-for-service-stability: true
```

**Required GitHub Secrets:**
- `AWS_ACCOUNT_ID` — your 12-digit AWS account ID

**Required AWS IAM Role:** Create `GithubActionsECRPush` with OIDC trust for `token.actions.githubusercontent.com` and permissions: `ecr:*`, `ecs:UpdateService`, `ecs:RegisterTaskDefinition`, `iam:PassRole`.

> **Shortcut:** `./infrastructure/deploy.sh` performs the same build → register → update-service flow and can be run from any machine with AWS credentials. The GitHub Actions workflow is the recommended path for automated releases from CI.

---

## Cost Estimate (us-east-1, Fargate Spot ARM64)

| Resource | Spec | Cost/month |
|---|---|---|
| Fargate Spot (1 task, 1 vCPU / 3 GB) | ~720h | ~$11 |
| ALB | 1 LCU baseline | ~$18 |
| ECR storage | 2 GB image | ~$0.20 |
| CloudWatch Logs | 5 GB/month | ~$2.50 |
| **Total** | | **~$32/month** |

> Fargate Spot is ~70% cheaper than on-demand. The service uses a 1 on-demand base task for reliability, with spot handling overflow.

---

## Monitoring & Health Checks

```bash
# View running tasks
aws ecs list-tasks --cluster TolipAI-scraper-cluster --service-name TolipAI-scraper-engine

# Describe a task (get IP, status, stopped reason)
aws ecs describe-tasks --cluster TolipAI-scraper-cluster \
  --tasks $(aws ecs list-tasks --cluster TolipAI-scraper-cluster \
    --service-name TolipAI-scraper-engine --query taskArns[0] --output text)

# Tail live logs
aws logs tail /ecs/TolipAI-scraper --follow

# Force a new deployment (rolling update)
aws ecs update-service --cluster TolipAI-scraper-cluster \
  --service TolipAI-scraper-engine --force-new-deployment

# Interactive shell into a running task (requires ECSExec policy on task role)
TASK_ARN=$(aws ecs list-tasks --cluster TolipAI-scraper-cluster \
  --service-name TolipAI-scraper-engine --query taskArns[0] --output text)
aws ecs execute-command --cluster TolipAI-scraper-cluster \
  --task $TASK_ARN --container scraper --interactive --command "/bin/bash"
```

---

## Rollback

```bash
# List recent task definition revisions
aws ecs list-task-definitions --family-prefix TolipAI-scraper-engine \
  --sort DESC --query taskDefinitionArns[:5] --output table

# Roll back to a specific revision
aws ecs update-service --cluster TolipAI-scraper-cluster \
  --service TolipAI-scraper-engine \
  --task-definition TolipAI-scraper-engine:42
```

---

## Separation of Concerns Summary

| Service | Host | Notes |
|---|---|---|
| api-server | Railway | Express 5 + 3 SPAs — stays on Railway |
| Neon PostgreSQL | Neon (serverless) | Shared by both services |
| scraper-engine | AWS Fargate Spot | ARM64, auto-scaling, isolated |
| Redis job queue | AWS ElastiCache | Optional — required for distributed job retry |

---

## Resource Name Reference

All resource names match the scripts and JSON files in `infrastructure/`. Use this table as the authoritative reference:

| Resource | Name |
|---|---|
| ECR repository | `TolipAI-scraper` |
| ECS cluster | `TolipAI-scraper-cluster` |
| ECS service | `TolipAI-scraper-engine` |
| Task definition family | `TolipAI-scraper-engine` |
| Container name | `scraper` |
| Container port | **8765** |
| Execution IAM role | `TolipAI-scraper-execution-role` |
| Task IAM role | `TolipAI-scraper-task-role` |
| CloudWatch log group | `/ecs/TolipAI-scraper` |
| Secrets Manager prefix | `TolipAI/scraper/` |
| S3 bucket | `TolipAI-scraper-storage` |
| CloudWatch namespace | `TolipAI/Scraper` |
| Buildx builder name | `TolipAI-builder` |

---

*Last updated: May 22, 2026 — TolipAI Platform v2.1.0*
