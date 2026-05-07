# AWS Migration Guide — Digor Scraper Engine

## Overview

The scraper engine is designed to run in two modes:
- **Local / Railway**: FastAPI server (`main.py`) — current dev mode
- **AWS Lambda**: `lambda_handler.py` — serverless, scales to 0, pay-per-use

Both modes use the same scraper logic. The Lambda handler just skips HTTP and calls scraper functions directly.

---

## Phase 1 — Containerize & Deploy Lambda

### Step 1: Build & push the Lambda image to ECR

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com

# Build the Lambda image
cd artifacts/digor-scraper-engine
docker build -f Dockerfile.lambda -t digor-scraper-lambda .

# Tag and push
docker tag digor-scraper-lambda:latest \
  <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/digor-scraper:latest
docker push <ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/digor-scraper:latest
```

### Step 2: Create Lambda functions (one per endpoint or one universal)

| Function Name | Handler | Memory | Timeout | Purpose |
|---|---|---|---|---|
| `digor-health` | `workers.lambda_handler.health_handler` | 128 MB | 5s | Health probe |
| `digor-distressed` | `workers.lambda_handler.distressed_handler` | 512 MB | 30s | Lis pendens / foreclosure search |
| `digor-satellite` | `workers.lambda_handler.satellite_handler` | 2048 MB | 120s | Drive-for-dollars AI |
| `digor-cash-buyers` | `workers.lambda_handler.cash_buyers_handler` | 1024 MB | 60s | Cash buyer discovery |
| `digor-skip-trace` | `workers.lambda_handler.skip_trace_handler` | 512 MB | 30s | OSINT skip trace |
| `digor-propwire` | `workers.lambda_handler.handler` | 3008 MB | 300s | Propwire comps / history |
| `digor-router` | `workers.lambda_handler.handler` | 1024 MB | 120s | Universal router (dev/test) |

### Step 3: Wire to API Gateway (HTTP API)

```
POST /{proxy+}  →  digor-router Lambda
```

Or use individual routes per function for tighter IAM scoping.

---

## Phase 2 — Storage (S3 + DynamoDB)

### S3 — Raw results storage
Set `S3_BUCKET=digor-scraper-results` on each Lambda. Results auto-save to:
```
s3://digor-scraper-results/distressed/YYYY/MM/DD/HHMMSS_<job_id>.json
s3://digor-scraper-results/satellite/YYYY/MM/DD/HHMMSS_<job_id>.json
```
No code changes needed — already implemented in `_maybe_store_s3()`.

### DynamoDB — Fast lead store
Replace in-memory `job_store.py` with DynamoDB:
```python
# Table: DigorJobs
# PK: job_id (String)
# TTL: expires_at (Unix timestamp, auto-delete after 30 days)
```

### Athena — Query raw S3 results with SQL
Point Athena at `s3://digor-scraper-results/` to run ad-hoc queries:
```sql
SELECT * FROM distressed_results
WHERE state = 'FL' AND score > 70
ORDER BY score DESC LIMIT 100;
```

---

## Phase 3 — Visual AI (Rekognition)

Set `USE_REKOGNITION=1` on the `digor-satellite` Lambda.

The satellite handler will automatically use `satellite_rekognition.py` instead of local YOLO.
Rekognition requires an IAM role with `rekognition:DetectLabels` permission.

### IAM policy needed:
```json
{
  "Effect": "Allow",
  "Action": ["rekognition:DetectLabels"],
  "Resource": "*"
}
```

---

## Phase 4 — Bedrock LLM

Set `USE_BEDROCK=1` on all Lambda functions. The `llm.py` provider chain will prepend Bedrock (Claude 3 Sonnet) as the first option.

### IAM policy needed:
```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-sonnet-20240229-v1:0"
}
```

Override model: `BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0` (cheaper/faster).

---

## Phase 5 — Orchestration (Step Functions)

### Pipeline: Scrape → Enrich → Score → Push to CRM

```
State: ScrapeDistressed
  → Lambda: digor-distressed
  → Output: { listings: [...] }

State: EnrichWithSkipTrace (Map — parallel per listing)
  → Lambda: digor-skip-trace
  → Output: { phone, email, owner }

State: ScoreWithSatellite (Map — parallel per listing)
  → Lambda: digor-satellite
  → Output: { score, signals }

State: StoreResults
  → Lambda: store-to-dynamodb
  → DynamoDB: DigorLeads table

State: NotifyCRM
  → SNS Topic: digor-new-leads
  → Triggers: CRM webhook, email digest
```

---

## Phase 6 — Monitoring & Security

### CloudWatch
- Set alarms on Lambda errors and throttles
- Log groups: `/aws/lambda/digor-*`
- Dashboard: scrapes/min, error rate, p99 duration

### Secrets Manager
Replace env vars with Secrets Manager references:
```
digor/google-maps-key     → GOOGLE_MAPS_API_KEY
digor/attom-api-key       → ATTOM_API_KEY
digor/proxy-credentials   → PROXY_URL
digor/openrouter-key      → OPENROUTER_API_KEY
```

### Lambda env var pattern:
```python
import boto3
secret = boto3.client("secretsmanager").get_secret_value(SecretId="digor/google-maps-key")
os.environ["GOOGLE_MAPS_API_KEY"] = secret["SecretString"]
```

### IAM — Least privilege per function
| Function | Permissions |
|---|---|
| distressed | S3:PutObject, CloudWatch:PutMetricData |
| satellite | S3:PutObject, Rekognition:DetectLabels |
| skip-trace | S3:PutObject |
| all | SecretsManager:GetSecretValue, CloudWatch:PutLogEvents |

---

## PDF & Document Parsing (Textract)

For deed PDFs from county recorders:
```python
import boto3
textract = boto3.client("textract")
response = textract.analyze_document(
    Document={"S3Object": {"Bucket": "digor-raw-docs", "Name": "deed.pdf"}},
    FeatureTypes=["FORMS", "TABLES"]
)
```
Wire into `county_deeds.py` when a PDF URL is found instead of HTML.

---

## Environment Variables Reference

| Variable | Description | Default |
|---|---|---|
| `S3_BUCKET` | S3 bucket for result storage | (disabled if unset) |
| `USE_REKOGNITION` | Use AWS Rekognition instead of YOLO | `0` |
| `USE_BEDROCK` | Use Amazon Bedrock for LLM | `0` |
| `BEDROCK_MODEL_ID` | Bedrock model ARN | `anthropic.claude-3-sonnet-*` |
| `AWS_REGION` | AWS region for all boto3 clients | `us-east-1` |
| `DATABASE_URL` | RDS/Aurora Postgres URL | (falls back to in-memory) |
| `BROWSER_STATE_DIR` | Playwright session state path | `/tmp` (Lambda) |
| `GOOGLE_MAPS_API_KEY` | Google Maps Places API | required for phone finder |
| `ATTOM_API_KEY` | ATTOM property data API | optional enrichment |

---

## Quick Cost Estimate

| Service | Usage | Est. Monthly Cost |
|---|---|---|
| Lambda (distressed) | 10K requests × 30s × 512MB | ~$8 |
| Lambda (satellite) | 1K requests × 120s × 2GB | ~$5 |
| S3 storage | 10GB results | ~$0.25 |
| Rekognition | 5K image analyses | ~$6 |
| Bedrock (Claude 3 Haiku) | 5M tokens | ~$2 |
| API Gateway | 10K requests | ~$0.04 |
| **Total** | | **~$22/mo** |

Scale up linearly — no servers to manage.
