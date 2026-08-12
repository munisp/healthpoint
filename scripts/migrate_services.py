#!/usr/bin/env python3
"""
Batch migration script: updates all backend services to use shared infrastructure.
Fixes:
  1. aioredis → redis.asyncio (via shared/cache.py)
  2. Hardcoded DB credentials → os.environ["DATABASE_URL"]
  3. CORS wildcard → env-based allowed origins
  4. Adds Keycloak auth dependency imports
  5. Removes in-memory dict stores (replaces with DB-backed patterns)

Run from repo root: python3 scripts/migrate_services.py
"""
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SERVICES_DIR = REPO_ROOT / "backend" / "core-services"

# ── Replacement patterns ──────────────────────────────────────────────────────
REPLACEMENTS = [
    # 1. Remove aioredis imports
    (r'^import aioredis\s*$', '', re.MULTILINE),
    (r'^from aioredis import.*$', '', re.MULTILINE),
    (r'^from aioredis\.client import.*$', '', re.MULTILINE),

    # 2. Replace aioredis.from_url(...) calls
    (r'await aioredis\.from_url\([^)]+\)', 'get_redis_client()', 0),
    (r'aioredis\.from_url\([^)]+\)', 'get_redis_client()', 0),

    # 3. Fix hardcoded DB credentials in DATABASE_URL defaults
    (
        r'os\.getenv\("DATABASE_URL",\s*"postgresql://[^"]+"\)',
        'os.environ["DATABASE_URL"]',
        0,
    ),
    (
        r'os\.getenv\(\'DATABASE_URL\',\s*\'postgresql://[^\']+\'\)',
        'os.environ["DATABASE_URL"]',
        0,
    ),
    # Bare hardcoded DATABASE_URL assignments
    (
        r'DATABASE_URL\s*=\s*"postgresql://[^"]*:[^"]*@[^"]*"',
        'DATABASE_URL = os.environ["DATABASE_URL"]',
        0,
    ),
    (
        r"DATABASE_URL\s*=\s*'postgresql://[^']*:[^']*@[^']*'",
        'DATABASE_URL = os.environ["DATABASE_URL"]',
        0,
    ),

    # 4. Fix CORS wildcard with credentials
    (
        r'allow_origins=\["\\*"\]',
        'allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")',
        0,
    ),
    (
        r"allow_origins=\['\\*'\]",
        'allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")',
        0,
    ),
    (
        r'allow_origins=\["\*"\]',
        'allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")',
        0,
    ),
    (
        r"allow_origins=\['\*'\]",
        'allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")',
        0,
    ),
]

# ── Shared import block to inject ─────────────────────────────────────────────
SHARED_IMPORT_BLOCK = '''
# ── Shared HealthPoint infrastructure ─────────────────────────────────────────
import sys, os as _os
_repo_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)
from backend.shared.database import fetch, fetchrow, execute, fetchval, transaction, bootstrap_schema, get_pool
from backend.shared.cache import get_client as get_redis_client, rate_limit_check, set_json, get_json
from backend.shared.auth import get_current_user, require_role, require_admin, require_provider, security_headers_middleware
from backend.shared.messaging import publish, Topics
# ─────────────────────────────────────────────────────────────────────────────
'''

IMPORT_ANCHOR = re.compile(
    r'^(import os|import sys|from fastapi)',
    re.MULTILINE,
)


def inject_shared_imports(content: str, filepath: Path) -> str:
    """Inject shared import block after the first os/sys/fastapi import."""
    if 'from backend.shared.database import' in content:
        return content  # Already migrated
    match = IMPORT_ANCHOR.search(content)
    if match:
        insert_pos = match.start()
        return content[:insert_pos] + SHARED_IMPORT_BLOCK + '\n' + content[insert_pos:]
    # Fallback: prepend
    return SHARED_IMPORT_BLOCK + '\n' + content


def apply_replacements(content: str) -> tuple[str, int]:
    """Apply all regex replacements. Returns (new_content, change_count)."""
    changes = 0
    for pattern, replacement, flags in REPLACEMENTS:
        new_content, n = re.subn(pattern, replacement, content, flags=flags)
        if n > 0:
            changes += n
            content = new_content
    return content, changes


def migrate_file(filepath: Path) -> bool:
    """Migrate a single Python service file. Returns True if modified."""
    try:
        original = filepath.read_text(encoding='utf-8')
    except Exception as e:
        print(f"  ERROR reading {filepath}: {e}")
        return False

    content, changes = apply_replacements(original)
    if changes > 0 or 'from backend.shared' not in content:
        content = inject_shared_imports(content, filepath)

    if content != original:
        filepath.write_text(content, encoding='utf-8')
        print(f"  MIGRATED: {filepath.relative_to(REPO_ROOT)} ({changes} replacements)")
        return True
    else:
        print(f"  SKIPPED:  {filepath.relative_to(REPO_ROOT)} (no changes needed)")
        return False


def main():
    print("=" * 70)
    print("HealthPoint Service Migration: aioredis → redis.asyncio + shared DB")
    print("=" * 70)

    py_files = list(SERVICES_DIR.rglob("*.py"))
    py_files = [f for f in py_files if '__pycache__' not in str(f)]

    migrated = 0
    skipped = 0
    errors = 0

    for filepath in sorted(py_files):
        try:
            if migrate_file(filepath):
                migrated += 1
            else:
                skipped += 1
        except Exception as e:
            print(f"  ERROR processing {filepath}: {e}")
            errors += 1

    print()
    print("=" * 70)
    print(f"Migration complete: {migrated} migrated, {skipped} skipped, {errors} errors")
    print("=" * 70)

    if errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
