---
name: Scraper engine AWS infrastructure
description: ECS cluster, service, task definition, and secret management for the Fargate scraper engine.
---

## Key identifiers

- **Cluster**: `TolipAI-scraper-cluster` (us-east-1)
- **Service**: `tolipai-scraper-engine-service-xop`
- **Task def family**: `tolipai-scraper-engine` — revision was 32 at initial setup; multiple deploys have been made since. Check AWS Console for current revision.
- **ELB**: `tolip-scraper-url-323311724.us-east-1.elb.amazonaws.com:8765`

## Deployment method
Deployments are triggered via `bash deploy.sh` which calls **GitHub Actions** (`Agawish24/Python-Worker` → `deploy.yml` workflow). The GitHub Action builds the Docker image and updates the ECS service. There is no direct boto3 register_task_definition step from Replit.

## Secret → env var mapping (essential secrets)

The task definition maps AWS Secrets Manager secrets to container env vars:
- `TolipAI/scraper/api-key` → `SCRAPER_API_KEY` (inbound X-API-Key auth — must match Replit's `WEBSCRAPER_API_KEY`)
- `TolipAI/scraper/database-url` → `DATABASE_URL`
- `TolipAI/scraper/redis-url` → `REDIS_URL`
- `TolipAI/scraper/openai-key` → `OPENAI_API_KEY` (required — llm.py is OpenAI-only as of Fix 12)

**Obsolete secrets** (removed from task def after Fix 11/12 cleanup):
- `TolipAI/scraper/groq-key`, `TolipAI/scraper/moonshot-key`, `TolipAI/scraper/openrouter-key`, nvidia, cerebras — no longer referenced by the Python code. If still present in the task def they will cause `ResourceInitializationError` if the secret is deleted from Secrets Manager.

**Why this matters:** If you delete a secret from AWS Secrets Manager that is referenced in the task definition, the Fargate container FAILS TO START with `ResourceInitializationError`. Always update the task definition (register new revision, remove the deleted secret reference, update the service) before or immediately after deleting a secret.

## Updating the task definition

```python
import boto3, copy
ecs = boto3.client('ecs', region_name='us-east-1')
td = ecs.describe_task_definition(taskDefinition='tolipai-scraper-engine')['taskDefinition']
containers = copy.deepcopy(td['containerDefinitions'])
# ... modify containers ...
new_td = ecs.register_task_definition(family=td['family'], containerDefinitions=containers, ...)
ecs.update_service(cluster='TolipAI-scraper-cluster',
                   service='tolipai-scraper-engine-service-xop',
                   taskDefinition=new_td['taskDefinition']['taskDefinitionArn'],
                   forceNewDeployment=True)
```
