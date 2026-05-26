---
name: Scraper engine AWS infrastructure
description: ECS cluster, service, task definition, and secret management for the Fargate scraper engine.
---

## Key identifiers

- **Cluster**: `TolipAI-scraper-cluster` (us-east-1)
- **Service**: `tolipai-scraper-engine-service-xop`
- **Task def family**: `tolipai-scraper-engine` — current revision: 32
- **ELB**: `tolip-scraper-url-323311724.us-east-1.elb.amazonaws.com:8765`

## Secret → env var mapping (task def rev 32)

The task definition maps AWS Secrets Manager secrets to container env vars:
- `TolipAI/scraper/api-key` → `SCRAPER_API_KEY` (inbound auth)
- `TolipAI/scraper/database-url` → `DATABASE_URL`
- `TolipAI/scraper/redis-url` → `REDIS_URL`
- `TolipAI/scraper/openrouter-key` → `OPENROUTER_API_KEY`
- `TolipAI/scraper/groq-key` → `GROQ_API_KEY`
- `TolipAI/scraper/moonshot-key` → `MOONSHOT_KIMI_API_KEY`
- and others (brightdata, oxylabs, propelio, propwire, google-maps, nvidia, cerebras)

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
