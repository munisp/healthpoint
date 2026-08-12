"""
Repair syntax v3: examine all remaining broken files and apply targeted fixes.
"""
import ast
import os
import re


def get_error_context(path):
    try:
        with open(path) as f:
            content = f.read()
        ast.parse(content)
        return None, content
    except SyntaxError as e:
        lines = content.split('\n')
        lineno = e.lineno - 1
        ctx_lines = lines[max(0, lineno-4):min(len(lines), lineno+4)]
        ctx = '\n'.join(f'{max(0,lineno-4)+i+1}: {l}' for i, l in enumerate(ctx_lines))
        return (e, ctx), content


def fix_spurious_comma_in_params(content):
    """Fix lone comma lines in function parameter lists."""
    # Pattern: \n    ,\n    param  →  \n    param
    fixed = re.sub(r'\n(\s*),(\s*)\n(\s+\w)', lambda m: '\n' + m.group(3), content)
    # Also: param,\n,\n    next_param
    fixed = re.sub(r',\s*\n\s*,\s*\n(\s+)', r',\n\1', fixed)
    return fixed


def fix_instrument_fastapi_inside_constructor(content):
    """
    Fix: instrument_fastapi(app) placed between app = FastAPI( and the kwargs.
    Also handles app.middleware injected inside constructor.
    """
    # Find all occurrences of app = FastAPI( followed by non-kwarg lines
    lines = content.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Detect start of FastAPI constructor
        if re.match(r'\s*app\s*=\s*FastAPI\(\s*$', line):
            # Collect the full constructor block
            constructor_kwargs = []
            injected_after = []
            j = i + 1
            depth = 1
            while j < len(lines) and depth > 0:
                l = lines[j]
                stripped = l.strip()
                # Count parens
                depth += l.count('(') - l.count(')')
                if depth <= 0:
                    # This is the closing paren
                    break
                # Check if this line is an injected call (not a FastAPI kwarg)
                if re.match(r'\s*(instrument_fastapi|setup_telemetry|app\.middleware|app\.add_middleware)\s*\(', l):
                    injected_after.append(l)
                else:
                    constructor_kwargs.append(l)
                j += 1

            # Reconstruct
            result.append(line)  # app = FastAPI(
            result.extend(constructor_kwargs)
            if j < len(lines):
                result.append(lines[j])  # closing )
            result.extend(injected_after)
            i = j + 1
        else:
            result.append(line)
            i += 1
    return '\n'.join(result)


def fix_import_inside_from_import(content):
    """Fix import statement injected inside a from X import ( block."""
    lines = content.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Detect: from X import (
        if re.match(r'\s*from\s+\S+\s+import\s+\(\s*$', line):
            block = [line]
            injected = []
            j = i + 1
            while j < len(lines):
                l = lines[j]
                stripped = l.strip()
                if stripped == ')':
                    block.append(l)
                    j += 1
                    break
                # Injected import statement inside the block
                elif re.match(r'\s*(from|import)\s+\S', l) and '(' not in l:
                    injected.append(l)
                    j += 1
                else:
                    block.append(l)
                    j += 1
            # Output injected imports BEFORE the block
            result.extend(injected)
            result.extend(block)
            i = j
        else:
            result.append(line)
            i += 1
    return '\n'.join(result)


def fix_missing_fastapi_kwargs(content):
    """
    Fix: app = FastAPI(\n)\n with no kwargs — add minimal title/version.
    """
    fixed = re.sub(
        r'(app\s*=\s*FastAPI\()\s*\n(\s*\))',
        r'\1\n    title="Service",\n    version="1.0.0"\n\2',
        content
    )
    return fixed


def repair_file(path):
    err_info, content = get_error_context(path)
    if err_info is None:
        return True, "already_ok"

    original = content
    # Apply all fixes in sequence
    for fix_fn in [
        fix_spurious_comma_in_params,
        fix_instrument_fastapi_inside_constructor,
        fix_import_inside_from_import,
        fix_missing_fastapi_kwargs,
    ]:
        content = fix_fn(content)

    if content == original:
        return False, "no_change"

    try:
        ast.parse(content)
        with open(path, 'w') as f:
            f.write(content)
        return True, "fixed"
    except SyntaxError as e:
        return False, f"still_broken:{e.lineno}:{e.msg[:50]}"


def main():
    broken_before = []
    for root, dirs, files in os.walk('backend'):
        for fname in files:
            if fname.endswith('.py'):
                path = os.path.join(root, fname)
                try:
                    with open(path) as f:
                        ast.parse(f.read())
                except SyntaxError:
                    broken_before.append(path)

    print(f"Files with syntax errors: {len(broken_before)}")

    fixed_count = 0
    still_broken = []
    for path in broken_before:
        ok, reason = repair_file(path)
        if ok:
            fixed_count += 1
            print(f"  ✅ {path}: {reason}")
        else:
            still_broken.append((path, reason))

    print(f"\nFixed: {fixed_count}")
    print(f"Still broken: {len(still_broken)}")
    for path, reason in still_broken:
        print(f"  ❌ {path}: {reason}")
        # Show context
        err_info, _ = get_error_context(path)
        if err_info:
            e, ctx = err_info
            print(f"     Context:\n{ctx}")
        print()


if __name__ == '__main__':
    main()
