#!/usr/bin/env python3
"""Fix all hardcoded API keys by replacing with os.getenv() calls."""
import re, os

REPO = "/home/ubuntu/healthpoint-repo"

files_to_fix = [
    "backend/core-services/flexible_refund_processing_service.py",
    "backend/core-services/flexible_refund_processing_service/main.py",
    "backend/core-services/per_provider_billing_service.py",
    "backend/core-services/per_provider_billing_service/main.py",
]

for rel in files_to_fix:
    path = os.path.join(REPO, rel)
    if not os.path.exists(path):
        print(f"SKIP (not found): {rel}")
        continue
    
    with open(path, "r") as f:
        content = f.read()
    
    original = content
    
    # Fix stripe.api_key = "sk_test_..."
    content = re.sub(
        r'stripe\.api_key\s*=\s*["\'][^"\']+["\']',
        'stripe.api_key = os.getenv("STRIPE_API_KEY", "")',
        content
    )
    
    # Fix any standalone api_key = "sk_test_..."
    content = re.sub(
        r'(api_key\s*=\s*)["\']sk_test_[^"\']+["\']',
        r'\1os.getenv("STRIPE_API_KEY", "")',
        content
    )
    
    # Fix any other hardcoded api_key patterns
    content = re.sub(
        r'(api_key\s*=\s*)["\'][a-zA-Z0-9_\-]{16,}["\']',
        r'\1os.getenv("STRIPE_API_KEY", "")',
        content
    )
    
    # Ensure os is imported
    if 'import os' not in content and content != original:
        # Add os import after the first import line
        content = re.sub(
            r'^(import\s+\w+)',
            r'import os\n\1',
            content,
            count=1,
            flags=re.MULTILINE
        )
    
    if content != original:
        with open(path, "w") as f:
            f.write(content)
        print(f"FIXED: {rel}")
    else:
        print(f"CLEAN: {rel}")

# Final verification
print("\n--- Final verification ---")
import glob
all_py = glob.glob(f"{REPO}/backend/**/*.py", recursive=True)
all_py = [f for f in all_py if "__pycache__" not in f]
found = 0
for fp in all_py:
    c = open(fp, errors="replace").read()
    m = re.findall(r'api_key\s*=\s*["\'][a-zA-Z0-9_\-]{8,}["\']', c, re.I)
    if m:
        found += len(m)
        print(f"  REMAINING: {fp.replace(REPO+'/', '')}: {m[:2]}")
if found == 0:
    print("  All clear - no hardcoded API keys remain")
