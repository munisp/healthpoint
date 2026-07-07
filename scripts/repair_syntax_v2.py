"""
Targeted syntax repair v2.
Fixes two root-cause patterns found in the 36 remaining broken files:

Pattern A: OTel injection placed instrument_fastapi(app) INSIDE the FastAPI() constructor call
  Before:
    app = FastAPI(
    instrument_fastapi(app)
        title="...",
  After:
    app = FastAPI(
        title="...",
    )
    instrument_fastapi(app)

Pattern B: Spurious lone comma in function parameter list
  Before:
    async def func(
        param1: str,
    ,
        current_user = Depends(...),
  After:
    async def func(
        param1: str,
        current_user = Depends(...),

Pattern C: import inside a from...import tuple
  Before:
    from reportlab.platypus import (
    from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer
        SimpleDocTemplate, ...
  After:
    from shared.telemetry import setup_telemetry, instrument_fastapi, get_tracer
    from reportlab.platypus import (
        SimpleDocTemplate, ...
"""
import ast
import re
import os


def fix_pattern_a(content):
    """Fix instrument_fastapi(app) injected inside FastAPI() constructor."""
    # Match: app = FastAPI(\ninstrument_fastapi(app)\n[optional middleware]\n    title=
    fixed = re.sub(
        r'(app\s*=\s*FastAPI\()\s*\n'
        r'(instrument_fastapi\(app\))\s*\n'
        r'((?:app\.middleware\([^)]+\)\([^)]+\)\s*\n)?)'
        r'(\s+title\s*=)',
        lambda m: (
            f'{m.group(1)}\n'
            f'{m.group(4)}'
        ),
        content
    )
    # Now add instrument_fastapi after the closing paren of FastAPI(...)
    # Find ")\n" after the FastAPI block and add instrument_fastapi after it
    if 'instrument_fastapi(app)' not in fixed and 'instrument_fastapi(app)' in content:
        # Find where FastAPI constructor ends
        fixed = re.sub(
            r'(app\s*=\s*FastAPI\([^)]+\))\s*\n',
            lambda m: m.group(1) + '\ninstrument_fastapi(app)\n',
            fixed,
            count=1
        )
    return fixed


def fix_pattern_a_v2(content):
    """More aggressive fix for the broken FastAPI constructor pattern."""
    lines = content.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Detect: app = FastAPI(
        if re.match(r'\s*app\s*=\s*FastAPI\(\s*$', line):
            # Collect everything until the closing )
            constructor_lines = [line]
            injected_before = []
            j = i + 1
            while j < len(lines):
                next_line = lines[j]
                # Check if this line is an injected statement (not part of FastAPI kwargs)
                if re.match(r'\s*(instrument_fastapi|setup_telemetry|app\.middleware|app\.add_middleware)\s*\(', next_line):
                    injected_before.append(next_line)
                    j += 1
                elif re.match(r'\s*(title|description|version|docs_url|redoc_url|openapi_url)\s*=', next_line):
                    # This is a FastAPI kwarg - belongs inside
                    constructor_lines.append(next_line)
                    j += 1
                elif next_line.strip() == ')':
                    constructor_lines.append(next_line)
                    j += 1
                    break
                elif next_line.strip() == '':
                    j += 1
                    break
                else:
                    constructor_lines.append(next_line)
                    j += 1
            # Rebuild: constructor first, then injected lines
            result.extend(constructor_lines)
            result.extend(injected_before)
            i = j
        else:
            result.append(line)
            i += 1
    return '\n'.join(result)


def fix_pattern_b(content):
    """Fix spurious lone comma in function parameter list."""
    # Pattern: \n,\n    current_user  →  \n    current_user
    fixed = re.sub(r'\n\s*,\s*\n(\s+\w)', r'\n\1', content)
    return fixed


def fix_pattern_c(content):
    """Fix import statement injected inside a from...import block."""
    lines = content.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Detect: from X import (
        if re.match(r'\s*from\s+\S+\s+import\s+\(\s*$', line):
            # Collect the block
            block = [line]
            injected = []
            j = i + 1
            while j < len(lines):
                next_line = lines[j]
                if re.match(r'\s*from\s+\S+\s+import\s+', next_line) and '(' not in next_line:
                    # This is an injected import statement
                    injected.append(next_line)
                    j += 1
                elif next_line.strip() == ')':
                    block.append(next_line)
                    j += 1
                    break
                else:
                    block.append(next_line)
                    j += 1
            # Output injected imports BEFORE the block
            result.extend(injected)
            result.extend(block)
            i = j
        else:
            result.append(line)
            i += 1
    return '\n'.join(result)


def repair_file(path):
    with open(path) as f:
        original = f.read()

    content = original

    # Apply all patterns
    content = fix_pattern_a_v2(content)
    content = fix_pattern_b(content)
    content = fix_pattern_c(content)

    if content == original:
        return False, "no_change"

    try:
        ast.parse(content)
        with open(path, 'w') as f:
            f.write(content)
        return True, "fixed"
    except SyntaxError as e:
        # Try original patterns
        content2 = original
        content2 = fix_pattern_a(content2)
        content2 = fix_pattern_b(content2)
        try:
            ast.parse(content2)
            with open(path, 'w') as f:
                f.write(content2)
            return True, "fixed_v1"
        except SyntaxError as e2:
            return False, f"still_broken:{e2.lineno}:{e2.msg}"


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
        else:
            still_broken.append((path, reason))

    print(f"Fixed: {fixed_count}")
    print(f"Still broken: {len(still_broken)}")
    for path, reason in still_broken:
        print(f"  {path}: {reason}")


if __name__ == '__main__':
    main()
