#!/usr/bin/env python3
"""ACM PG17 Stage4C - OFFLINE artifact inventory only.

No database client, network calls, SQL execution, migration, or file mutation.
A successful exit means the inventory was created, NOT PG3 approval.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

MAX_BYTES = 16 * 1024 * 1024
MODELS = re.compile(r"(?m)^\s*model\s+([A-Za-z][A-Za-z0-9_]*)\s*\{")


def load_artifact(name: str, suffixes: tuple[str, ...]) -> tuple[Path, bytes]:
    path = Path(name)
    if path.is_symlink() or not path.is_file():
        raise ValueError("Input must be an existing regular file, not a symlink")
    if not path.name.lower().endswith(suffixes):
        raise ValueError("Unexpected file extension for this type of artifact")
    if path.stat().st_size > MAX_BYTES:
        raise ValueError("Artifact too large for offline review")
    raw = path.read_bytes()
    if b"\0" in raw:
        raise ValueError("Binary input refused")
    return path, raw


def inspect(name: str, suffixes: tuple[str, ...], prisma: bool = False) -> dict:
    path, raw = load_artifact(name, suffixes)
    result = {
        "filename": path.name, "size_bytes": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "execution_authorized": False,
    }
    if prisma:
        content = raw.decode("utf-8-sig")
        models = MODELS.findall(content)
        if len(models) != len(set(models)):
            result["warning"] = "Duplicate Prisma model names detected"
        result.update({
            "prisma_models": models, "model_count": len(models),
            "borrow_return_operation_model": "BorrowReturnOperation" in models,
            "evidence_registry_schema_model": "EvidenceCodeRegistry" in models,
        })
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, help="RC5 schema.prisma (read-only)")
    parser.add_argument("--candidate", help="Canonical Stage4C schema.prisma (read-only)")
    parser.add_argument("--forward", help="Forward SQL file (hash only)")
    parser.add_argument("--rollback", help="Guarded rollback SQL file (hash only)")
    args = parser.parse_args()
    try:
        baseline = inspect(args.baseline, (".prisma",), prisma=True)
        candidate = inspect(args.candidate, (".prisma",), prisma=True) if args.candidate else None
        forward = inspect(args.forward, (".sql", ".sql.txt")) if args.forward else None
        rollback = inspect(args.rollback, (".sql", ".sql.txt")) if args.rollback else None
    except (OSError, ValueError, UnicodeError) as exc:
        # Avoid echoing file contents, credentials, SQL or local absolute paths.
        print(json.dumps({"status": "INPUT_REJECTED", "reason": str(exc)}, ensure_ascii=False))
        return 2

    delta = None
    if candidate:
        old, new = set(baseline["prisma_models"]), set(candidate["prisma_models"])
        delta = {"added": sorted(new - old), "removed": sorted(old - new)}

    result = {
        "status": "PG3_ENTRY_REVIEW_ONLY_NO_GO",
        "scope": "OFFLINE_STATIC_INVENTORY_NO_DATABASE_CONNECTION",
        "baseline": baseline, "candidate": candidate, "model_delta": delta,
        "forward_sql": forward, "guarded_rollback_sql": rollback,
        "all_four_artifacts_present": all((candidate, forward, rollback)),
        "required_independent_gates": [
            "DBA_AND_OWNER_FINAL_MODEL_AND_BUSINESS_POLICY",
            "APPSEC_REVIEW_OF_EXACT_CANONICAL_SCHEMA_AND_SQL_SHA256",
            "NAMED_OPERATOR_TARGET_DATABASE_TIME_WINDOW_APPROVAL",
            "PG17_ISOLATED_IDENTITY_RECONFIRMATION",
            "BACKUP_RESTORE_AND_ABORT_PLAN_APPROVAL",
            "POST_APPROVAL_REAL_PG17_NEGATIVE_AND_CONCURRENCY_TESTS",
        ],
        "note": "File hashes are an inventory, not approval. This script never executes SQL.",
    }
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
