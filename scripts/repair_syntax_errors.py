"""
Comprehensive syntax repair script.
Fixes common patterns introduced by earlier batch transformations:
1. Broken app = FastAPI(...) constructor split by middleware injection
2. Spurious commas in function signatures
3. Misplaced middleware calls inside FastAPI constructor
4. logger.info("...$1...", var) → logger.info(f"...{var}...")
5. Truncated lines from heredoc writes
"""
import ast
import re
import os
import sys

FIXES_APPLIED = 0
FILES_FIXED = 0

def fix_file(path):
    global FIXES_APPLIED, FILES_FIXED
    with open(path) as f:
        original = f.read()

    content = original

    # Fix 1: Broken FastAPI constructor where middleware got injected inside it
    # Pattern: app = FastAPI(\n\napp.middleware(...)\n\n    title=...
    content = re.sub(
        r'app\s*=\s*FastAPI\(\s*\n+app\.middleware\([^)]+\)\([^)]+\)\s*\n+\s*(title\s*=)',
        lambda m: f'app = FastAPI(\n    {m.group(1)}',
        content
    )

    # Fix 2: Spurious comma at start of function parameter list
    # Pattern: async def func(,\n    param
    content = re.sub(r'(async def \w+)\(,\n', r'\1(\n', content)
    content = re.sub(r'(def \w+)\(,\n', r'\1(\n', content)

    # Fix 3: logger.info("...$1...", var) → logger.info(f"...{var}...")
    # This was introduced by a sed command that used $1 instead of f-string
    def fix_logger_dollar(m):
        msg = m.group(1)
        var = m.group(2)
        # Replace $1 with the variable
        msg_fixed = msg.replace('$1', '{' + var.strip() + '}')
        if '{' in msg_fixed:
            return f'logger.info(f"{msg_fixed}")'
        return f'logger.info("{msg_fixed}")'

    content = re.sub(
        r'logger\.info\("([^"]*\$1[^"]*)",\s*([^)]+)\)',
        fix_logger_dollar,
        content
    )

    # Fix 4: Truncated lines ending with "appeal.statu" or similar
    content = re.sub(r'appeal\.statu\s*$', 'appeal.status = AppealStatus.REJECTED', content, flags=re.M)

    # Fix 5: app.middleware call placed before FastAPI closing paren
    # Pattern: app.middleware("http")(fn)\n    title=...
    content = re.sub(
        r'(app\s*=\s*FastAPI\()\s*\n\napp\.middleware\("http"\)\([^)]+\)\n\n\s*(title\s*=)',
        lambda m: f'{m.group(1)}\n    {m.group(2)}',
        content
    )

    # Fix 6: Double app = FastAPI definitions (from injection scripts)
    # Keep only the first complete one
    matches = list(re.finditer(r'^app\s*=\s*FastAPI\(', content, re.M))
    if len(matches) > 1:
        # Find the second one and remove it if it's a duplicate incomplete one
        second_start = matches[1].start()
        # Check if the second one has a proper closing paren
        bracket_depth = 0
        i = second_start
        end_pos = None
        while i < len(content):
            if content[i] == '(':
                bracket_depth += 1
            elif content[i] == ')':
                bracket_depth -= 1
                if bracket_depth == 0:
                    end_pos = i + 1
                    break
            i += 1
        if end_pos:
            second_block = content[second_start:end_pos]
            # If the second block is shorter/simpler than the first, remove it
            first_block_len = matches[1].start() - matches[0].start()
            second_block_len = end_pos - second_start
            if second_block_len < 50:  # Very short duplicate
                content = content[:second_start] + content[end_pos:]

    # Fix 7: Misplaced closing brace/paren after middleware injection
    # Pattern where startup event is inside FastAPI constructor
    content = re.sub(
        r'(app\s*=\s*FastAPI\()\s*\n\n(@app\.on_event)',
        lambda m: f'{m.group(1)}\n    title="Service",\n    version="1.0.0"\n)\n\n{m.group(2)}',
        content
    )

    if content != original:
        # Verify the fix didn't break syntax
        try:
            ast.parse(content)
            with open(path, 'w') as f:
                f.write(content)
            FIXES_APPLIED += 1
            FILES_FIXED += 1
            return True, "fixed"
        except SyntaxError as e:
            # Fix made it worse - revert
            return False, f"fix_failed:{e.lineno}"

    return False, "no_change"


def get_syntax_error(path):
    try:
        with open(path) as f:
            content = f.read()
        ast.parse(content)
        return None
    except SyntaxError as e:
        return e


def manual_fix(path, error):
    """Apply targeted manual fixes based on error location."""
    with open(path) as f:
        lines = f.readlines()

    lineno = error.lineno - 1  # 0-indexed
    changed = False

    # Check context around the error
    context_start = max(0, lineno - 5)
    context_end = min(len(lines), lineno + 5)
    context = ''.join(lines[context_start:context_end])

    # Fix: app = FastAPI(\n\napp.middleware... pattern
    if 'app = FastAPI(' in context and 'app.middleware' in context:
        content = ''.join(lines)
        # Find the broken constructor
        fixed = re.sub(
            r'(app\s*=\s*FastAPI\()\s*\n\napp\.middleware\("http"\)\(security_headers_middleware\)\n\n',
            r'\1\n    title="Service",\n    version="1.0.0"\n)\n\napp.middleware("http")(security_headers_middleware)\n\n',
            content
        )
        if fixed != content:
            try:
                ast.parse(fixed)
                with open(path, 'w') as f:
                    f.write(fixed)
                return True
            except:
                pass

    # Fix: spurious comma in function def
    if lineno < len(lines) and re.search(r'def \w+\(,', lines[lineno]):
        lines[lineno] = re.sub(r'\(,', '(', lines[lineno])
        changed = True

    # Fix: line ending with .statu (truncated)
    if lineno < len(lines) and lines[lineno].rstrip().endswith('.statu'):
        lines[lineno] = lines[lineno].rstrip()[:-6] + '.status = AppealStatus.REJECTED\n'
        changed = True

    # Fix: logger.info with $1
    if lineno < len(lines) and '$1' in lines[lineno]:
        lines[lineno] = re.sub(
            r'logger\.(info|error|warning|debug)\("([^"]*)\$1([^"]*)",\s*(\w+)\)',
            lambda m: f'logger.{m.group(1)}(f"{m.group(2)}{{{m.group(4)}}}{m.group(3)}")',
            lines[lineno]
        )
        changed = True

    if changed:
        content = ''.join(lines)
        try:
            ast.parse(content)
            with open(path, 'w') as f:
                f.write(content)
            return True
        except:
            pass

    return False


def main():
    broken = []
    for root, dirs, files in os.walk('backend'):
        for fname in files:
            if fname.endswith('.py'):
                path = os.path.join(root, fname)
                err = get_syntax_error(path)
                if err:
                    broken.append((path, err))

    print(f"Found {len(broken)} files with syntax errors")

    still_broken = []
    for path, err in broken:
        # Try automated fix first
        fixed, reason = fix_file(path)
        if not fixed:
            # Try manual targeted fix
            new_err = get_syntax_error(path)
            if new_err:
                manual_fixed = manual_fix(path, new_err)
                if not manual_fixed:
                    still_broken.append((path, new_err))
            # else: fix_file reverted but original was already broken
        else:
            # Verify
            new_err = get_syntax_error(path)
            if new_err:
                still_broken.append((path, new_err))

    print(f"\n✅ Fixed: {FILES_FIXED} files")
    print(f"❌ Still broken: {len(still_broken)} files")
    for path, err in still_broken[:10]:
        print(f"   {path}:{err.lineno} — {err.msg}")

    return still_broken


if __name__ == '__main__':
    broken = main()
    sys.exit(0 if len(broken) == 0 else 1)
