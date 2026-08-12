#!/usr/bin/env python3
"""
Inject Keycloak authentication into all FastAPI services that are missing it.
Strategy:
- If service has NO auth at all: add get_current_user to all non-health endpoints
- If service has partial auth: add to remaining unprotected endpoints
- Skip health check endpoints (they must remain public)
"""
import os, re, sys

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fixes = []
errors = []

AUTH_IMPORT = "from backend.shared.auth import get_current_user, require_admin, require_role, TokenPayload\n"
AUTH_IMPORT_SIMPLE = "from backend.shared.auth import get_current_user, TokenPayload\n"

def has_auth_import(content):
    return "from backend.shared.auth import" in content or "get_current_user" in content

def add_auth_import(content):
    """Add auth import after existing shared imports or at top of imports."""
    if has_auth_import(content):
        return content
    # Try to insert after last 'from backend.shared' import
    lines = content.splitlines(keepends=True)
    insert_at = 0
    for i, line in enumerate(lines):
        if line.startswith("from backend.shared") or line.startswith("import backend"):
            insert_at = i + 1
    if insert_at == 0:
        # Insert after last import block
        for i, line in enumerate(lines):
            if line.startswith("from ") or line.startswith("import "):
                insert_at = i + 1
    lines.insert(insert_at, AUTH_IMPORT)
    return "".join(lines)


def inject_auth_into_endpoints(content, path):
    """
    Add current_user: TokenPayload = Depends(get_current_user) to endpoint signatures
    that don't already have auth.
    """
    # Pattern: async def endpoint_name(... without Depends(get_current_user) or Depends(require_
    # We look for @app.{method} followed by async def
    
    lines = content.splitlines()
    new_lines = []
    i = 0
    injected = 0
    
    while i < len(lines):
        line = lines[i]
        new_lines.append(line)
        
        # Detect route decorator
        if re.match(r'\s*@app\.(get|post|put|delete|patch)\(', line):
            # Find the function definition (may be next line or after more decorators)
            j = i + 1
            while j < len(lines) and not re.match(r'\s*async def ', lines[j]):
                new_lines.append(lines[j])
                j += 1
            
            if j < len(lines):
                func_line = lines[j]
                
                # Skip health check endpoints
                if "/health" in line or "health_check" in func_line:
                    new_lines.append(func_line)
                    i = j + 1
                    continue
                
                # Check if this function already has auth
                # Collect the full function signature (may span multiple lines)
                sig_lines = [func_line]
                k = j + 1
                while k < len(lines) and "):" not in "".join(sig_lines):
                    sig_lines.append(lines[k])
                    k += 1
                full_sig = "\n".join(sig_lines)
                
                already_has_auth = (
                    "Depends(get_current_user)" in full_sig or
                    "Depends(require_" in full_sig or
                    "Depends(verify_admin" in full_sig
                )
                
                if not already_has_auth:
                    # Inject auth parameter
                    # Find the closing paren of the function signature
                    if "):" in func_line:
                        # Single-line signature
                        indent = len(func_line) - len(func_line.lstrip())
                        param_indent = " " * (indent + 4)
                        new_func = func_line.replace(
                            "):",
                            f",\n{param_indent}current_user: TokenPayload = Depends(get_current_user),\n{' ' * indent}):"
                        )
                        new_lines.append(new_func)
                        injected += 1
                    else:
                        # Multi-line signature — add before closing ):
                        new_lines.append(func_line)
                        for sig_line in sig_lines[1:]:
                            if "):" in sig_line:
                                indent = len(sig_line) - len(sig_line.lstrip())
                                param_indent = " " * (indent + 4)
                                new_sig_line = sig_line.replace(
                                    "):",
                                    f",\n{param_indent}current_user: TokenPayload = Depends(get_current_user),\n{' ' * indent}):"
                                )
                                new_lines.append(new_sig_line)
                                injected += 1
                            else:
                                new_lines.append(sig_line)
                    i = k
                    continue
                else:
                    # Already has auth — add all sig lines
                    for sig_line in sig_lines:
                        new_lines.append(sig_line)
                    i = k
                    continue
        
        i += 1
    
    return "\n".join(new_lines), injected


def process_file(path):
    with open(path) as f:
        original = f.read()
    
    content = original
    
    # Only process files with FastAPI endpoints
    if "@app.get" not in content and "@app.post" not in content:
        return False
    
    # Skip files that already have comprehensive auth
    auth_count = content.count("Depends(get_current_user)") + content.count("Depends(require_")
    endpoint_count = len(re.findall(r'@app\.(get|post|put|delete|patch)\(', content))
    health_count = content.count("/health")
    
    # If all non-health endpoints already have auth, skip
    non_health_endpoints = endpoint_count - health_count
    if auth_count >= non_health_endpoints and non_health_endpoints > 0:
        return False
    
    # Add auth import
    content = add_auth_import(content)
    
    # Inject auth into unprotected endpoints
    content, injected = inject_auth_into_endpoints(content, path)
    
    if injected > 0 or content != original:
        with open(path, 'w') as f:
            f.write(content)
        fixes.append(f"AUTH_INJECTED ({injected} endpoints): {path}")
        return True
    return False


def main():
    total_files = 0
    total_changed = 0
    
    for root, dirs, files in os.walk(os.path.join(repo_root, "backend")):
        dirs[:] = [d for d in dirs if d != "__pycache__"]
        for fname in files:
            if not fname.endswith(".py"):
                continue
            path = os.path.join(root, fname)
            total_files += 1
            try:
                if process_file(path):
                    total_changed += 1
            except Exception as e:
                errors.append(f"ERROR in {path}: {e}")
    
    print(f"\n=== AUTH INJECTION RESULTS ===")
    print(f"Files scanned: {total_files}")
    print(f"Files changed: {total_changed}")
    print(f"\nFixes applied ({len(fixes)}):")
    for fix in fixes:
        print(f"  ✓ {fix}")
    if errors:
        print(f"\nErrors ({len(errors)}):")
        for err in errors:
            print(f"  ✗ {err}")


if __name__ == "__main__":
    main()
