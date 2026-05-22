# TolipAI Scraper Engine — AWS Fargate Deployment Guide

**Target:** `artifacts/TolipAI-scraper-engine` (Python 3.12 / FastAPI)
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
REPO_NAME=tolipai/scraper-engine

aws ecr create-repository \
  --repository-name $REPO_NAME \
  --region $AWS_REGION \
  --image-scanning-configuration scanOnPush=true \
  --encryption-configuration encryptionType=AES256

echo "ECR URI: ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${REPO_NAME}"
```

---

## Step 2 — Build & Push the ARM64 Docker Image

The scraper engine has a dedicated `Dockerfile.fargate` optimised for ARM64 (Graviton3).

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

> **Note:** If you are building on an x86 Mac/Linux, Docker buildx will emulate ARM64 via QEMU. This is slow (~15 min). Use a Graviton EC2 build instance for production CI.

---

## Step 3 — Store Secrets in AWS Secrets Manager

```bash
# Store each secret individually (never in environment variables or Dockerfile)
aws secretsmanager create-secret \
  --name /tolipai/scraper/DATABASE_URL \
  --secret-string "postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require"

aws secretsmanager create-secret \
  --name /tolipai/scraper/OPENAI_API_KEY \
  --secret-string "sk-..."

aws secretsmanager create-secret \
  --name /tolipai/scraper/REDIS_URL \
  --secret-string "redis://your-elasticache-endpoint:6379"

# To update an existing secret:
aws secretsmanager put-secret-value \
  --secret-id /tolipai/scraper/DATABASE_URL \
  --secret-string "new-value"
```

---

## Step 4 — Create the ECS Cluster

```bash
aws ecs create-cluster \
  --cluster-name tolipai-scraper \
  --capacity-providers FARGATE FARGATE_SPOT \
  --default-capacity-provider-strategy \
    capacityProvider=FARGATE_SPOT,weight=4,base=0 \
    capacityProvider=FARGATE,weight=1,base=1 \
  --region $AWS_REGION
```

---

## Step 5 — Create IAM Roles

### 5a. Task Execution Role (pulls image + reads secrets)

```bash
# Create the role
aws iam create-role \
  --role-name TolipaiScraperExecutionRole \
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
  --role-name TolipaiScraperExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

# Add Secrets Manager read access (inline policy)
aws iam put-role-policy \
  --role-name TolipaiScraperExecutionRole \
  --policy-name ReadScraperSecrets \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["secretsmanager:GetSecretValue"],
      "Resource":"arn:aws:secretsmanager:'$AWS_REGION':'$AWS_ACCOUNT':secret:/tolipai/scraper/*"
    }]
  }'
```

### 5b. Task Role (runtime permissions — S3 cache, CloudWatch)

```bash
aws iam create-role \
  --role-name TolipaiScraperTaskRole \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Principal":{"Service":"ecs-tasks.amazonaws.com"},
      "Action":"sts:AssumeRole"
    }]
  }'

# CloudWatch Logs
aws iam attach-role-policy \
  --role-name TolipaiScraperTaskRole \
  --policy-arn arn:aws:iam::aws:policy/CloudWatchLogsFullAccess

# Optional: S3 cache bucket (if S3_CACHE_BUCKET is set)
aws iam put-role-policy \
  --role-name TolipaiScraperTaskRole \
  --policy-name S3CacheAccess \
  --policy-document '{
    "Version":"2012-10-17",
    "Statement":[{
      "Effect":"Allow",
      "Action":["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket"],
      "Resource":[
        "arn:aws:s3:::tolipai-scraper-cache",
        "arn:aws:s3:::tolipai-scraper-cache/*"
      ]
    }]
  }'
```

---

## Step 6 — Register the Task Definition

Save the following as `infrastructure/task-definition.json`, then register it:

```json
{
  "family": "tolipai-scraper-engine",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "3072",
  "runtimePlatform": {
    "cpuArchitecture": "ARM64",
    "operatingSystemFamily": "LINUX"
  },
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/TolipaiScraperExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/TolipaiScraperTaskRole",
  "containerDefinitions": [
    {
      "name": "scraper-engine",
      "image": "ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/tolipai/scraper-engine:latest",
      "portMappings": [
        { "containerPort": 8000, "protocol": "tcp" }
      ],
      "secrets": [
        { "name": "DATABASE_URL",   "valueFrom": "/tolipai/scraper/DATABASE_URL" },
        { "name": "OPENAI_API_KEY", "valueFrom": "/tolipai/scraper/OPENAI_API_KEY" },
        { "name": "REDIS_URL",      "valueFrom": "/tolipai/scraper/REDIS_URL" }
      ],
      "environment": [
        { "name": "PORT",      "value": "8000" },
        { "name": "LOG_LEVEL", "value": "INFO" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/tolipai-scraper-engine",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs",
          "awslogs-create-group": "true"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:8000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "essential": true
    }
  ]
}
```

```bash
# Replace ACCOUNT placeholder, then register
sed "s/ACCOUNT/$AWS_ACCOUNT/g" infrastructure/task-definition.json \
  | aws ecs register-task-definition --cli-input-json file:///dev/stdin
```

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

```bash
# Task SG: allow traffic from ALB only
TASK_SG=$(aws ec2 create-security-group \
  --group-name tolipai-scraper-task-sg \
  --description "Scraper Engine Tasks" \
  --vpc-id $VPC_ID \
  --query GroupId --output text)

aws ec2 authorize-security-group-ingress \
  --group-id $TASK_SG --protocol tcp --port 8000 \
  --source-group $ALB_SG

aws ecs create-service \
  --cluster tolipai-scraper \
  --service-name scraper-engine \
  --task-definition tolipai-scraper-engine \
  --desired-count 1 \
  --launch-type FARGATE \
  --capacity-provider-strategy \
    capacityProvider=FARGATE_SPOT,weight=4 \
    capacityProvider=FARGATE,weight=1 \
  --network-configuration "awsvpcConfiguration={
    subnets=[$SUBNET_IDS],
    securityGroups=[$TASK_SG],
    assignPublicIp=ENABLED
  }" \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=scraper-engine,containerPort=8000" \
  --health-check-grace-period-seconds 90 \
  --region $AWS_REGION
```

---

## Step 9 — Auto-Scaling

```bash
# Register the scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/tolipai-scraper/scraper-engine \
  --min-capacity 1 \
  --max-capacity 4

# Scale out when CPU > 60% for 2 consecutive 60s periods
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --scalable-dimension ecs:service:DesiredCount \
  --resource-id service/tolipai-scraper/scraper-engine \
  --policy-name scraper-cpu-scaling \
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
  ECR_REPOSITORY: tolipai/scraper-engine
  ECS_CLUSTER: tolipai-scraper
  ECS_SERVICE: scraper-engine
  TASK_DEFINITION: infrastructure/task-definition.json

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
aws ecs list-tasks --cluster tolipai-scraper --service-name scraper-engine

# Describe a task (get IP, status, stopped reason)
aws ecs describe-tasks --cluster tolipai-scraper \
  --tasks $(aws ecs list-tasks --cluster tolipai-scraper \
    --service-name scraper-engine --query taskArns[0] --output text)

# Tail live logs
aws logs tail /ecs/tolipai-scraper-engine --follow

# Force a new deployment (rolling update)
aws ecs update-service --cluster tolipai-scraper \
  --service scraper-engine --force-new-deployment
```

---

## Rollback

```bash
# List recent task definition revisions
aws ecs list-task-definitions --family-prefix tolipai-scraper-engine \
  --sort DESC --query taskDefinitionArns[:5] --output table

# Roll back to a specific revision
aws ecs update-service --cluster tolipai-scraper \
  --service scraper-engine \
  --task-definition tolipai-scraper-engine:42
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

*Last updated: May 22, 2026 — TolipAI Platform v2.1.0*
