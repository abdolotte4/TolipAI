#!/bin/bash
# Run this in AWS CloudShell: https://console.aws.amazon.com/cloudshell/
# This adds Secrets Manager permissions to the required IAM roles

set -e

AWS_ACCOUNT_ID="583299526161"
REGION="us-east-1"

echo "========================================"
echo "Step 1: Update GithubActionsECRPush role"
echo "========================================"

# Check existing policies
POLICIES=$(aws iam list-attached-role-policies --role-name GithubActionsECRPush --query 'AttachedPolicies[*].PolicyArn' --output text)
echo "Existing policies: $POLICIES"

# Create an inline policy with Secrets Manager permissions
aws iam put-role-policy \
  --role-name GithubActionsECRPush \
  --policy-name SecretsManagerAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "secretsmanager:ListSecrets",
          "secretsmanager:GetSecretValue"
        ],
        "Resource": "*"
      }
    ]
  }'

echo "✓ Added SecretsManagerAccess inline policy to GithubActionsECRPush"

echo ""
echo "========================================"
echo "Step 2: Update ECS Execution Role"
echo "========================================"

# Check if the ECS execution role exists
aws iam get-role --role-name TolipAI-scraper-execution-role > /dev/null 2>&1 || {
  echo "ERROR: Role TolipAI-scraper-execution-role not found"
  exit 1
}

# Add inline policy for Secrets Manager
aws iam put-role-policy \
  --role-name TolipAI-scraper-execution-role \
  --policy-name SecretsManagerAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "secretsmanager:GetSecretValue"
        ],
        "Resource": "*"
      }
    ]
  }'

echo "✓ Added SecretsManagerAccess inline policy to TolipAI-scraper-execution-role"

echo ""
echo "========================================"
echo "Step 3: Verify IAM permissions"
echo "========================================"

echo "GithubActionsECRPush inline policies:"
aws iam list-role-policies --role-name GithubActionsECRPush --query 'PolicyNames' --output table

echo ""
echo "TolipAI-scraper-execution-role inline policies:"
aws iam list-role-policies --role-name TolipAI-scraper-execution-role --query 'PolicyNames' --output table

echo ""
echo "========================================"
echo "✅ IAM permissions updated successfully!"
echo "========================================"
echo ""
echo "Next: Run update-database-secret.sh to update the DATABASE_URL"
