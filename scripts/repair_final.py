"""
Final targeted repair for all remaining 19 broken Python files.
Uses direct string manipulation for the 4 known patterns.
"""
import ast
import os
import re


def fix_all(content):
    """Apply all known fixes in sequence."""

    # Fix 1: Spurious comma at start of function parameter list
    # Pattern: async def func(,\n    param  OR  async def func(\n    p1,\n,\n    p2
    content = re.sub(r'(async def \w+)\(,\s*\n', r'\1(\n', content)
    content = re.sub(r'(def \w+)\(,\s*\n', r'\1(\n', content)
    # Lone comma line between params
    content = re.sub(r'\n\s*,\s*\n(\s+\w)', r'\n\1', content)

    # Fix 2: instrument_fastapi(app) injected inside FastAPI() constructor
    # Pattern A: app = FastAPI(\ninstrument_fastapi(app)\n    title=
    content = re.sub(
        r'(app\s*=\s*FastAPI\()\s*\n'
        r'instrument_fastapi\(app\)\s*\n'
        r'(\s+title\s*=)',
        r'\1\n\2',
        content
    )
    # Pattern B: app = FastAPI(\ninstrument_fastapi(app)\n\napp.middleware(...)\n    title=
    content = re.sub(
        r'(app\s*=\s*FastAPI\()\s*\n'
        r'instrument_fastapi\(app\)\s*\n'
        r'\n?'
        r'app\.middleware\([^)]+\)\([^)]+\)\s*\n'
        r'(\s+title\s*=)',
        r'\1\n\2',
        content
    )

    # After fixing, ensure instrument_fastapi is called after the constructor closes
    # Find the FastAPI constructor and add instrument_fastapi after its closing )
    def add_instrument_after_constructor(c):
        if 'instrument_fastapi(app)' in c:
            return c  # Already present somewhere
        # Find app = FastAPI(...) block and add instrument_fastapi after it
        match = re.search(r'app\s*=\s*FastAPI\(', c)
        if not match:
            return c
        start = match.start()
        # Find the matching closing paren
        depth = 0
        i = match.end() - 1  # position of '('
        while i < len(c):
            if c[i] == '(':
                depth += 1
            elif c[i] == ')':
                depth -= 1
                if depth == 0:
                    # Insert after this position
                    return c[:i+1] + '\ninstrument_fastapi(app)\napp.middleware("http")(security_headers_middleware)\n' + c[i+1:]
            i += 1
        return c

    if 'instrument_fastapi' in content.split('app = FastAPI(')[0] if 'app = FastAPI(' in content else '':
        content = add_instrument_after_constructor(content)

    # Fix 3: import injected inside from X import ( block
    # Pattern: from X import (\nfrom Y import Z\n    item1, item2\n)
    def fix_import_block(c):
        lines = c.split('\n')
        result = []
        i = 0
        while i < len(lines):
            line = lines[i]
            if re.match(r'\s*from\s+\S+\s+import\s+\(\s*$', line):
                block = [line]
                injected = []
                j = i + 1
                while j < len(lines):
                    l = lines[j]
                    if l.strip() == ')':
                        block.append(l)
                        j += 1
                        break
                    elif re.match(r'\s*(from|import)\s+\S', l) and '(' not in l:
                        injected.append(l)
                        j += 1
                    else:
                        block.append(l)
                        j += 1
                result.extend(injected)
                result.extend(block)
                i = j
            else:
                result.append(line)
                i += 1
        return '\n'.join(result)

    content = fix_import_block(content)

    # Fix 4: Empty FastAPI() constructor (no kwargs)
    content = re.sub(
        r'(app\s*=\s*FastAPI\()\s*\n(\s*\))',
        r'\1\n    title="Service",\n    version="1.0.0"\n\2',
        content
    )

    return content


def main():
    broken = []
    for root, dirs, files in os.walk('backend'):
        for fname in files:
            if fname.endswith('.py'):
                path = os.path.join(root, fname)
                try:
                    with open(path) as f:
                        content = f.read()
                    ast.parse(content)
                except SyntaxError:
                    broken.append(path)

    print(f"Files with syntax errors: {len(broken)}")
    fixed = 0
    still_broken = []

    for path in broken:
        with open(path) as f:
            original = f.read()
        content = fix_all(original)
        if content == original:
            still_broken.append((path, "no_change"))
            continue
        try:
            ast.parse(content)
            with open(path, 'w') as f:
                f.write(content)
            fixed += 1
            print(f"  ✅ {path}")
        except SyntaxError as e:
            still_broken.append((path, f"{e.lineno}:{e.msg[:60]}"))

    print(f"\nFixed: {fixed}")
    print(f"Still broken: {len(still_broken)}")
    for path, reason in still_broken:
        print(f"  ❌ {path}: {reason}")
        # Show context
        try:
            with open(path) as f:
                c = f.read()
            ast.parse(c)
        except SyntaxError as e:
            lines = c.split('\n')
            lineno = e.lineno - 1
            for i in range(max(0, lineno-2), min(len(lines), lineno+3)):
                print(f"     {i+1}: {lines[i]}")


if __name__ == '__main__':
    main()
