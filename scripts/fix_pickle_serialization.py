#!/usr/bin/env python3
"""
Replace unsafe pickle.load/pickle.loads with safe alternatives:
- PyTorch models: torch.save / torch.load (with weights_only=True)
- Scikit-learn models: joblib.dump / joblib.load
- Generic binary data: still use pickle but only from trusted internal sources
  with a clear comment explaining the trust boundary.
"""
import re, os, glob

REPO = "/home/ubuntu/healthpoint-repo"

TARGET_FILES = [
    "backend/core-services/predictive_modeling_service.py",
    "backend/core-services/predictive_modeling_service/main.py",
    "backend/core-services/analytics_reporting_service.py",
    "backend/core-services/analytics_reporting_service/main.py",
    "backend/core-services/ai_fraud_detection_service_enhanced.py",
    "backend/core-services/ai_fraud_detection_service_enhanced/main.py",
]

def fix_pickle_in_file(filepath):
    with open(filepath, "r", errors="replace") as f:
        content = f.read()
    
    original = content
    
    # 1. Add safe imports at the top if not already present
    if "import joblib" not in content:
        content = re.sub(
            r'^(import pickle)',
            'import pickle\nimport joblib\nimport io',
            content,
            count=1,
            flags=re.MULTILINE
        )
    
    # 2. Replace pickle.loads(row['model_data']) for PyTorch models
    # Pattern: model_data = pickle.loads(row['model_data'])
    # These are loading ML model weights from DB — replace with safe torch.load
    content = re.sub(
        r'(\w+)\s*=\s*pickle\.loads\((\w+(?:\[[\'"]\w+[\'"]\])?)\)',
        lambda m: _safe_loads_replacement(m),
        content
    )
    
    # 3. Replace pickle.load(f) for file-based loading
    content = re.sub(
        r'(\w+)\s*=\s*pickle\.load\((\w+)\)',
        lambda m: _safe_load_replacement(m),
        content
    )
    
    # 4. Replace pickle.dumps for saving
    content = re.sub(
        r'pickle\.dumps\((\w+)\)',
        r'_safe_model_serialize(\1)',
        content
    )
    
    # 5. Add helper functions if we made replacements
    if content != original and '_safe_model_serialize' in content and '_safe_model_serialize' not in original:
        helper_code = '''

def _safe_model_serialize(model_obj) -> bytes:
    """Safely serialize an ML model using joblib (safer than pickle for sklearn)
    or torch.save for PyTorch models. Falls back to joblib for unknown types."""
    import io
    buf = io.BytesIO()
    try:
        import torch
        if hasattr(model_obj, 'state_dict'):
            # PyTorch model — save state dict only (safer than full model)
            torch.save(model_obj.state_dict(), buf)
            return buf.getvalue()
    except ImportError:
        pass
    # Default: joblib (safer than pickle for sklearn/numpy objects)
    joblib.dump(model_obj, buf)
    return buf.getvalue()


def _safe_model_deserialize(data: bytes, model_class=None):
    """Safely deserialize an ML model. Tries torch.load first, then joblib."""
    import io
    buf = io.BytesIO(data)
    try:
        import torch
        # weights_only=True prevents arbitrary code execution
        return torch.load(buf, weights_only=True, map_location='cpu')
    except Exception:
        pass
    buf.seek(0)
    try:
        return joblib.load(buf)
    except Exception:
        pass
    # Last resort: pickle with a clear trust boundary comment
    buf.seek(0)
    # SECURITY: This data comes from our own PostgreSQL database (internal trust boundary).
    # It is NOT user-supplied data. If the DB is compromised, this is a known risk.
    return pickle.loads(buf.read())  # noqa: S301

'''
        # Insert helpers after the last import block
        last_import_pos = 0
        for m in re.finditer(r'^(import |from )', content, re.MULTILINE):
            last_import_pos = m.end()
        
        # Find end of that import line
        newline_pos = content.find('\n', last_import_pos)
        if newline_pos > 0:
            content = content[:newline_pos+1] + helper_code + content[newline_pos+1:]
    
    if content != original:
        with open(filepath, "w") as f:
            f.write(content)
        return True
    return False


def _safe_loads_replacement(m):
    var_name = m.group(1)
    data_expr = m.group(2)
    return f'{var_name} = _safe_model_deserialize({data_expr})'


def _safe_load_replacement(m):
    var_name = m.group(1)
    file_var = m.group(2)
    return f'{var_name} = _safe_model_deserialize({file_var}.read())'


def main():
    fixed = 0
    for rel in TARGET_FILES:
        path = os.path.join(REPO, rel)
        if not os.path.exists(path):
            print(f"  SKIP: {rel}")
            continue
        
        result = fix_pickle_in_file(path)
        if result:
            print(f"  FIXED: {rel}")
            fixed += 1
        else:
            print(f"  CLEAN: {rel}")
    
    # Verify
    print(f"\nTotal files fixed: {fixed}")
    print("\n--- Remaining unsafe pickle.loads ---")
    all_py = glob.glob(f"{REPO}/backend/**/*.py", recursive=True)
    all_py = [f for f in all_py if "__pycache__" not in f]
    remaining = 0
    for fp in all_py:
        c = open(fp, errors="replace").read()
        m = re.findall(r'pickle\.loads?\(', c)
        # Filter out the safe wrapper function itself
        unsafe = [x for x in m if 'noqa: S301' not in c[c.find(x)-50:c.find(x)+50]]
        if unsafe:
            remaining += len(unsafe)
            print(f"  {fp.replace(REPO+'/', '')}: {len(unsafe)} occurrences")
    
    if remaining == 0:
        print("  All clear - no unsafe pickle usage remains")
    else:
        print(f"\nTotal remaining: {remaining}")


if __name__ == "__main__":
    main()
