#!/usr/bin/env python3
"""
deploy_ecs.py — TolipAI Scraper Engine deployment script.

What this script does:
  1. Fetches ALL live secret ARNs from Secrets Manager (TolipAI/scraper/ prefix)
  2. Fetches the current task definition from ECS
  3. Replaces every secret's valueFrom with the correct full ARN (with suffix)
     — handles plain names, partial ARNs, and full ARNs with stale/wrong suffixes
  4. Ensures the ECS execution role has secretsmanager:GetSecretValue permission
  5. Registers a new task definition revision
  6. Updates the ECS service with --force-new-deployment
  7. Waits for the service to reach a stable running state

Usage:
    python deploy_ecs.py
    python deploy_ecs.py --dry-run          # preview changes, do not deploy
    python deploy_ecs.py --skip-iam-check   # skip IAM policy verification
"""

import argparse
import json
import re
import sys
import time
import boto3
from botocore.exceptions import ClientError

# ── Configuration ─────────────────────────────────────────────────────────────
AWS_REGION         = "us-east-1"
SECRET_PREFIX      = "TolipAI/scraper/"
TASK_FAMILY        = "tolipai-scraper-engine"
ECS_CLUSTER        = "TolipAI-scraper-cluster"
ECS_SERVICE        = "tolipai-scraper-engine-service-xop"
EXECUTION_ROLE     = "TolipAI-scraper-execution-role"
INLINE_POLICY_NAME = "SecretsManagerAccess"
STABILITY_TIMEOUT  = 600   # seconds to wait for service stability
POLL_INTERVAL      = 15    # seconds between stability polls

# Read-only fields that ECS returns but rejects on register
TASK_DEF_READONLY_FIELDS = {
    "taskDefinitionArn",
    "revision",
    "status",
    "requiresAttributes",
    "compatibilities",
    "registeredAt",
    "registeredBy",
    "deregisteredAt",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def log(msg: str) -> None:
    print(msg, flush=True)


def extract_plain_name(value_from: str, arn_map: dict[str, str]) -> str | None:
    """
    Extract the canonical TolipAI/scraper/<name> from whatever is in valueFrom.

    Handles three cases:
      1. Plain name:    TolipAI/scraper/redis-url
      2. Partial ARN:   arn:aws:secretsmanager:...:secret:TolipAI/scraper/redis-url
      3. Full ARN with wrong/stale suffix:
                        arn:aws:secretsmanager:...:secret:TolipAI/scraper/redis-url-rIXWv4

    Returns the matching key from arn_map, or None if no match is found.
    """
    # Step 1: if it looks like an ARN, pull out the name segment after ':secret:'
    if value_from.startswith("arn:"):
        # ARN format: arn:aws:secretsmanager:region:account:secret:<name>
        match = re.search(r":secret:(.+)$", value_from)
        if not match:
            return None
        candidate = match.group(1)
    else:
        candidate = value_from

    # Step 2: try exact match first
    if candidate in arn_map:
        return candidate

    # Step 3: strip the random 6-char suffix (e.g. -rIXWv4) and try again
    stripped = re.sub(r"-[A-Za-z0-9]{6}$", "", candidate)
    if stripped in arn_map:
        return stripped

    # Step 4: broader strip — try removing anything after the last '-' that looks
    # like a suffix (up to 8 chars), in case the suffix length varies
    parts = candidate.rsplit("-", 1)
    if len(parts) == 2 and len(parts[1]) <= 8 and parts[0] in arn_map:
        return parts[0]

    return None


# ── Step 1: Fetch live secret ARNs ────────────────────────────────────────────

def fetch_secret_arn_map(sm_client) -> dict[str, str]:
    """Return {secret_name: full_arn_with_suffix} for all TolipAI/scraper/* secrets."""
    log(f"\n[1/6] Listing secrets under '{SECRET_PREFIX}' in Secrets Manager …")
    arn_map: dict[str, str] = {}
    paginator = sm_client.get_paginator("list_secrets")
    pages = paginator.paginate(
        Filters=[{"Key": "name", "Values": [SECRET_PREFIX]}]
    )
    for page in pages:
        for secret in page["SecretList"]:
            name = secret["Name"]
            arn  = secret["ARN"]
            arn_map[name] = arn

    if not arn_map:
        log("  ERROR: No secrets found. Check the prefix and your AWS credentials.")
        sys.exit(1)

    log(f"  Found {len(arn_map)} secrets:")
    for name, arn in sorted(arn_map.items()):
        log(f"    {name}")
        log(f"      → {arn}")

    return arn_map


# ── Step 2: Fetch current task definition ─────────────────────────────────────

def fetch_task_definition(ecs_client) -> dict:
    """Fetch the latest active revision of the task definition family."""
    log(f"\n[2/6] Fetching latest task definition for family '{TASK_FAMILY}' …")
    resp = ecs_client.describe_task_definition(
        task_definition=TASK_FAMILY,
        include=["TAGS"],
    )
    td = resp["taskDefinition"]
    tags = resp.get("tags", [])
    log(f"  Current revision: {td['revision']}  status: {td['status']}")
    return td, tags


# ── Step 3: Replace secret references ─────────────────────────────────────────

def fix_secrets(td: dict, arn_map: dict[str, str], dry_run: bool) -> tuple[dict, int]:
    """
    Walk every container's secrets array and replace valueFrom with the live ARN.
    Returns the modified task definition dict and a count of secrets updated.
    """
    log("\n[3/6] Replacing secret references with live ARNs …")
    updated = 0
    not_found = []

    for container in td.get("containerDefinitions", []):
        for secret in container.get("secrets", []):
            original = secret["valueFrom"]
            plain_name = extract_plain_name(original, arn_map)

            if plain_name is None:
                log(f"  WARNING: Could not resolve '{secret['name']}' "
                    f"(valueFrom={original!r}) — leaving unchanged")
                not_found.append(secret["name"])
                continue

            live_arn = arn_map[plain_name]
            if original != live_arn:
                action = "[DRY-RUN] would update" if dry_run else "Updated"
                log(f"  {action}: {secret['name']}")
                log(f"    old: {original}")
                log(f"    new: {live_arn}")
                if not dry_run:
                    secret["valueFrom"] = live_arn
                updated += 1
            else:
                log(f"  OK (already correct): {secret['name']}")

    if not_found:
        log(f"\n  WARNING: {len(not_found)} secret(s) could not be resolved:")
        for n in not_found:
            log(f"    - {n}")

    log(f"\n  Total secrets updated: {updated}")
    return td, updated


# ── Step 4: Ensure IAM policy on execution role ───────────────────────────────

def ensure_iam_policy(iam_client, account_id: str, dry_run: bool) -> None:
    """
    Ensure the execution role has an inline policy granting
    secretsmanager:GetSecretValue on all TolipAI/scraper/* secrets.
    """
    log(f"\n[4/6] Verifying IAM inline policy on role '{EXECUTION_ROLE}' …")

    desired_statement = {
        "Sid": "AllowScraperSecrets",
        "Effect": "Allow",
        "Action": ["secretsmanager:GetSecretValue"],
        "Resource": [
            f"arn:aws:secretsmanager:{AWS_REGION}:{account_id}:secret:{SECRET_PREFIX}*"
        ],
    }

    try:
        resp = iam_client.get_role_policy(
            RoleName=EXECUTION_ROLE,
            PolicyName=INLINE_POLICY_NAME,
        )
        existing_doc = resp["PolicyDocument"]

        # Check if the required statement is already present
        for stmt in existing_doc.get("Statement", []):
            resources = stmt.get("Resource", [])
            if isinstance(resources, str):
                resources = [resources]
            actions = stmt.get("Action", [])
            if isinstance(actions, str):
                actions = [actions]
            if (
                stmt.get("Effect") == "Allow"
                and "secretsmanager:GetSecretValue" in actions
                and any(f"secret:{SECRET_PREFIX}" in r for r in resources)
            ):
                log("  Policy already grants secretsmanager:GetSecretValue — no change needed.")
                return

        # Statement missing — add it
        log("  secretsmanager:GetSecretValue statement not found — adding it …")
        existing_doc["Statement"].append(desired_statement)
        updated_doc = existing_doc

    except ClientError as e:
        if e.response["Error"]["Code"] == "NoSuchEntity":
            log(f"  Inline policy '{INLINE_POLICY_NAME}' does not exist — creating it …")
            updated_doc = {
                "Version": "2012-10-17",
                "Statement": [desired_statement],
            }
        else:
            raise

    if dry_run:
        log(f"  [DRY-RUN] Would put inline policy:\n{json.dumps(updated_doc, indent=4)}")
        return

    iam_client.put_role_policy(
        RoleName=EXECUTION_ROLE,
        PolicyName=INLINE_POLICY_NAME,
        PolicyDocument=json.dumps(updated_doc),
    )
    log("  IAM policy updated successfully.")


# ── Step 5: Register new task definition revision ─────────────────────────────

def register_task_definition(ecs_client, td: dict, tags: list) -> str:
    """Strip read-only fields and register a new task definition revision."""
    log("\n[5/6] Registering new task definition revision …")

    clean_td = {k: v for k, v in td.items() if k not in TASK_DEF_READONLY_FIELDS}

    resp = ecs_client.register_task_definition(**clean_td, tags=tags)
    new_td = resp["taskDefinition"]
    new_arn = new_td["taskDefinitionArn"]
    log(f"  Registered: {new_arn}  (revision {new_td['revision']})")
    return new_arn


# ── Step 6: Update ECS service and wait for stability ─────────────────────────

def update_service(ecs_client, new_task_def_arn: str) -> None:
    """Force-deploy the new task definition and wait for the service to stabilise."""
    log(f"\n[6/6] Updating ECS service '{ECS_SERVICE}' in cluster '{ECS_CLUSTER}' …")

    ecs_client.update_service(
        cluster=ECS_CLUSTER,
        service=ECS_SERVICE,
        taskDefinition=new_task_def_arn,
        forceNewDeployment=True,
    )
    log("  Service update initiated — waiting for stability …")
    log(f"  (timeout: {STABILITY_TIMEOUT}s, polling every {POLL_INTERVAL}s)")

    deadline = time.time() + STABILITY_TIMEOUT
    last_running = -1

    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)
        resp = ecs_client.describe_services(
            cluster=ECS_CLUSTER,
            services=[ECS_SERVICE],
        )
        svc = resp["services"][0]
        desired  = svc["desiredCount"]
        running  = svc["runningCount"]
        pending  = svc["pendingCount"]

        if running != last_running:
            log(f"  desired={desired}  running={running}  pending={pending}")
            last_running = running

        # Find the newest deployment
        deployments = svc.get("deployments", [])
        primary = next(
            (d for d in deployments if d["status"] == "PRIMARY"),
            None,
        )

        if primary and primary.get("rolloutState") == "FAILED":
            log("\n  ERROR: Deployment FAILED (rolloutState=FAILED).")
            log("  Check ECS Events and CloudWatch logs for details.")
            sys.exit(1)

        if (
            primary
            and primary.get("rolloutState") == "COMPLETED"
            and running == desired
            and pending == 0
        ):
            log(f"\n  Service is STABLE — {running}/{desired} tasks running.")
            return

    log(f"\n  TIMEOUT: service did not stabilise within {STABILITY_TIMEOUT}s.")
    log("  The deployment may still succeed — monitor the ECS console.")
    sys.exit(1)


# ── Main ──────────────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(description="Deploy TolipAI scraper engine to ECS")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without making any AWS mutations",
    )
    parser.add_argument(
        "--skip-iam-check",
        action="store_true",
        help="Skip the IAM execution-role policy verification step",
    )
    return parser.parse_args()


def get_account_id(sts_client) -> str:
    return sts_client.get_caller_identity()["Account"]


def main():
    args = parse_args()

    if args.dry_run:
        log("=" * 60)
        log("DRY-RUN MODE — no AWS resources will be modified")
        log("=" * 60)

    sm_client  = boto3.client("secretsmanager", region_name=AWS_REGION)
    ecs_client = boto3.client("ecs",            region_name=AWS_REGION)
    iam_client = boto3.client("iam",            region_name=AWS_REGION)
    sts_client = boto3.client("sts",            region_name=AWS_REGION)

    account_id = get_account_id(sts_client)
    log(f"\nAWS account: {account_id}  region: {AWS_REGION}")

    # 1. Fetch live ARN map
    arn_map = fetch_secret_arn_map(sm_client)

    # 2. Fetch current task definition
    td, tags = fetch_task_definition(ecs_client)

    # 3. Fix secret references
    td, updated_count = fix_secrets(td, arn_map, dry_run=args.dry_run)

    # 4. Ensure IAM policy (optional skip)
    if not args.skip_iam_check:
        ensure_iam_policy(iam_client, account_id, dry_run=args.dry_run)
    else:
        log("\n[4/6] Skipping IAM check (--skip-iam-check)")

    if args.dry_run:
        log("\n[DRY-RUN] Skipping task definition registration and service update.")
        log(f"  {updated_count} secret(s) would be updated.")
        return

    if updated_count == 0:
        log("\nAll secrets already reference correct live ARNs. "
            "Registering a new revision anyway to force a clean deploy …")

    # 5. Register new revision
    new_task_def_arn = register_task_definition(ecs_client, td, tags)

    # 6. Update service
    update_service(ecs_client, new_task_def_arn)

    log("\n✓ Deployment complete.")


if __name__ == "__main__":
    main()
