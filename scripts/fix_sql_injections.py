#!/usr/bin/env python3
"""
Fix all SQL injection vulnerabilities by replacing f-string SQL queries
with parameterized queries using asyncpg $1, $2 placeholders.
"""
import re
import os
import glob

REPO = "/home/ubuntu/healthpoint-repo"

# Map of service files to their specific SQL injection patterns to fix
# Each entry: (file_path, old_pattern, new_pattern)
# We use a comprehensive AST-aware replacement approach

def fix_fstring_sql(filepath):
    """Replace f-string SQL queries with parameterized versions."""
    with open(filepath, "r", errors="replace") as f:
        content = f.read()
    
    original = content
    changes = 0
    
    # Pattern 1: Simple f-string SELECT with WHERE clause
    # f"SELECT ... WHERE column = '{var}'" -> parameterized
    # We'll do targeted replacements per service
    
    # Generic fix: find f-strings containing SQL keywords and variable interpolation
    # Replace {variable} in SQL f-strings with $N placeholders
    
    def replace_sql_fstring(match):
        nonlocal changes
        full_match = match.group(0)
        # Check if this is actually SQL (contains SQL keywords)
        if not re.search(r'\b(SELECT|INSERT|UPDATE|DELETE|WHERE|FROM|INTO|SET)\b', full_match, re.I):
            return full_match
        
        # Extract the f-string content
        quote_char = full_match[1]  # ' or "
        inner = full_match[2:-1]  # content between quotes
        
        # Find all {variable} interpolations
        vars_found = re.findall(r'\{([^}]+)\}', inner)
        if not vars_found:
            return full_match
        
        # Replace each {var} with $N
        new_inner = inner
        param_vars = []
        for i, var in enumerate(vars_found, 1):
            new_inner = new_inner.replace('{' + var + '}', f'${i}', 1)
            param_vars.append(var)
        
        changes += 1
        # Return as a tuple string for parameterized query
        params_str = ', '.join(param_vars)
        return f'"{new_inner}", {params_str}'
    
    # More targeted approach - fix specific patterns we know are in these files
    
    # Pattern: f"SELECT ... WHERE id = '{var}'" 
    content = re.sub(
        r'f"(SELECT[^"]*WHERE[^"]*)\{(\w+)\}([^"]*)"',
        lambda m: f'"{m.group(1)}$1{m.group(3)}", {m.group(2)}',
        content
    )
    
    # Pattern: f"UPDATE ... SET ... WHERE id = '{var}'"
    content = re.sub(
        r"f'(UPDATE[^']*WHERE[^']*)\{(\w+)\}([^']*)'",
        lambda m: f"'{m.group(1)}$1{m.group(3)}', {m.group(2)}",
        content
    )
    
    if content != original:
        with open(filepath, "w") as f:
            f.write(content)
        return True
    return False


def fix_service_sql_injections(filepath):
    """
    Targeted fix for each known vulnerable service.
    Reads the file, applies specific parameterization fixes, writes back.
    """
    with open(filepath, "r", errors="replace") as f:
        content = f.read()
    
    original = content
    
    # Fix 1: notification-service - SELECT with f-string user_id
    content = re.sub(
        r'f["\']SELECT \* FROM notifications WHERE user_id = \'\{([^}]+)\}\'["\']',
        r'"SELECT * FROM notifications WHERE user_id = $1", \1',
        content
    )
    content = re.sub(
        r'f["\']SELECT \* FROM notifications WHERE user_id = \{([^}]+)\}["\']',
        r'"SELECT * FROM notifications WHERE user_id = $1", \1',
        content
    )
    
    # Fix 2: cms-portal-automation - SELECT with dispute_id
    content = re.sub(
        r'f["\']SELECT \* FROM cms_submissions WHERE dispute_id = \'\{([^}]+)\}\'["\']',
        r'"SELECT * FROM cms_submissions WHERE dispute_id = $1", \1',
        content
    )
    content = re.sub(
        r'f["\']SELECT \* FROM cms_submissions WHERE dispute_id = \{([^}]+)\}["\']',
        r'"SELECT * FROM cms_submissions WHERE dispute_id = $1", \1',
        content
    )
    
    # Fix 3: Generic pattern - any f-string SQL with single variable
    # f"SELECT ... WHERE {col} = '{val}'" -> parameterized
    def parameterize_single_var(m):
        prefix = m.group(1)
        var = m.group(2)
        suffix = m.group(3)
        return f'"{prefix}$1{suffix}", {var}'
    
    content = re.sub(
        r'f"((?:SELECT|INSERT|UPDATE|DELETE)[^"]*?)\{(\w+)\}([^"]*)"',
        parameterize_single_var,
        content,
        flags=re.IGNORECASE
    )
    
    content = re.sub(
        r"f'((?:SELECT|INSERT|UPDATE|DELETE)[^']*?)\{(\w+)\}([^']*)'",
        lambda m: f"'{m.group(1)}$1{m.group(3)}', {m.group(2)}",
        content,
        flags=re.IGNORECASE
    )
    
    if content != original:
        with open(filepath, "w") as f:
            f.write(content)
        return True
    return False


def main():
    # Services known to have SQL injection vulnerabilities
    vulnerable_services = [
        "backend/integration-services/notification-service/main.py",
        "backend/integration-services/cms-portal-automation-service/main.py",
        "backend/core-services/configuration_service/main.py",
        "backend/core-services/configuration_service.py",
        "backend/core-services/backup_service/main.py",
        "backend/core-services/backup_service.py",
        "backend/core-services/patient_management_service/main.py",
        "backend/core-services/patient_management_service.py",
        "backend/core-services/training_support_service/main.py",
        "backend/core-services/training_support_service.py",
        "backend/core-services/appeal_escalation_service/main.py",
        "backend/core-services/appeal_escalation_service.py",
        "backend/core-services/idr-entity-selection-service/main.py",
        "backend/core-services/file-upload-service/main.py",
        "backend/core-services/gfe-management-service/main.py",
    ]
    
    fixed = 0
    for rel_path in vulnerable_services:
        full_path = os.path.join(REPO, rel_path)
        if not os.path.exists(full_path):
            print(f"  SKIP (not found): {rel_path}")
            continue
        
        result = fix_service_sql_injections(full_path)
        if result:
            print(f"  FIXED: {rel_path}")
            fixed += 1
        else:
            print(f"  CLEAN (no f-string SQL found): {rel_path}")
    
    # Also scan ALL Python files for any remaining f-string SQL patterns
    print("\n--- Scanning all Python files for remaining f-string SQL ---")
    all_py = glob.glob(f"{REPO}/backend/**/*.py", recursive=True)
    all_py = [f for f in all_py if "__pycache__" not in f]
    
    remaining = 0
    for filepath in all_py:
        with open(filepath, "r", errors="replace") as fh:
            content = fh.read()
        
        # Check for f-string SQL patterns
        matches = re.findall(r'f["\'](?:SELECT|INSERT|UPDATE|DELETE)[^"\']*\{[^}]+\}[^"\']*["\']', content, re.I)
        if matches:
            remaining += len(matches)
            rel = filepath.replace(REPO + "/", "")
            print(f"  REMAINING in {rel}: {len(matches)} patterns")
            for m in matches[:3]:
                print(f"    -> {m[:100]}")
    
    print(f"\nTotal files fixed: {fixed}")
    print(f"Remaining f-string SQL patterns: {remaining}")


if __name__ == "__main__":
    main()
