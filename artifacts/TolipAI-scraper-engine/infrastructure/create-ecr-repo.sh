#!/bin/bash
set -euo pipefail

AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-583299526161}"

REPOS=("tolipai-scraper-base" "tolipai-scraper")

LIFECYCLE_POLICY='{
    "rules": [
        {
            "rulePriority": 1,
            "description": "Keep only last 30 images",
            "selection": {
                "tagStatus": "any",
                "countType": "imageCountMoreThan",
                "countNumber": 30
            },
            "action": {
                "type": "expire"
            }
        }
    ]
}'

for repo in "${REPOS[@]}"; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Checking ECR repository: $repo"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if aws ecr describe-repositories --repository-names "$repo" --region "$AWS_REGION" > /dev/null 2>&1; then
        echo "✅ Repository $repo already exists"
    else
        echo "🆕 Creating repository: $repo"
        aws ecr create-repository \
            --repository-name "$repo" \
            --region "$AWS_REGION"
        echo "✅ Repository $repo created"
    fi

    echo "📋 Applying lifecycle policy (keep last 30 images)..."
    aws ecr put-lifecycle-policy \
        --repository-name "$repo" \
        --region "$AWS_REGION" \
        --lifecycle-policy-text "$LIFECYCLE_POLICY" > /dev/null 2>&1 && \
        echo "✅ Lifecycle policy applied" || \
        echo "⚠️ Lifecycle policy may already exist or failed"

    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 All ECR repositories verified"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
