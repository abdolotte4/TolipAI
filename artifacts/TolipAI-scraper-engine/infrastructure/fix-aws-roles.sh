#!/bin/bash
# Run this in AWS CloudShell: https://console.aws.amazon.com/cloudshell/
# Creates the missing IAM roles for ECS Fargate
# This fixes: "ECS was unable to assume the role"

set -e

REGION="us-east-1"
ACCOUNT_ID="583299526161"

echo "========================================"
echo "Creating IAM Roles for ECS Fargate"
echo "========================================"

# ── Execution Role (for pulling images + reading Secrets Manager) ──
EXEC_ROLE="TolipAI-scraper-execution-role"

echo ""
echo "Checking execution role: $EXEC_ROLE"
if aws iam get-role --role-name "$EXEC_ROLE" > /dev/null 2>&1; then
    echo "  ✓ Execution role already exists"
else
    echo "  Creating execution role..."
    aws iam create-role \
        --role-name "$EXEC_ROLE" \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "ecs-tasks.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }'
    echo "  ✓ Execution role created"
fi

echo "  Attaching AmazonECSTaskExecutionRolePolicy..."
aws iam attach-role-policy \
    --role-name "$EXEC_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy || true

echo "  Adding Secrets Manager access..."
aws iam put-role-policy \
    --role-name "$EXEC_ROLE" \
    --policy-name "SecretsManagerAccess" \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": "arn:aws:secretsmanager:'$REGION':'$ACCOUNT_ID':secret:TolipAI/scraper/*"
        }]
    }' || true

# ── Task Role (for the container to access AWS services) ──
TASK_ROLE="TolipAI-scraper-task-role"

echo ""
echo "Checking task role: $TASK_ROLE"
if aws iam get-role --role-name "$TASK_ROLE" > /dev/null 2>&1; then
    echo "  ✓ Task role already exists"
else
    echo "  Creating task role..."
    aws iam create-role \
        --role-name "$TASK_ROLE" \
        --assume-role-policy-document '{
            "Version": "2012-10-17",
            "Statement": [{
                "Effect": "Allow",
                "Principal": {"Service": "ecs-tasks.amazonaws.com"},
                "Action": "sts:AssumeRole"
            }]
        }'
    echo "  ✓ Task role created"
fi

echo "  Adding S3 + basic permissions to task role..."
aws iam put-role-policy \
    --role-name "$TASK_ROLE" \
    --policy-name "ScraperTaskPolicy" \
    --policy-document '{
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "s3:GetObject",
                    "s3:PutObject",
                    "s3:ListBucket"
                ],
                "Resource": "*"
            },
            {
                "Effect": "Allow",
                "Action": [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents"
                ],
                "Resource": "*"
            }
        ]
    }' || true

echo ""
echo "========================================"
echo "✅ IAM Roles Fixed!"
echo "========================================"
echo ""
echo "Execution Role: $EXEC_ROLE"
echo "Task Role:      $TASK_ROLE"
echo ""
echo "Next: Run fix-secrets.sh to create the missing secrets in Secrets Manager"
