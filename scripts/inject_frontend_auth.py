#!/usr/bin/env python3
"""
Inject Keycloak PKCE authentication into all 13 frontend apps that are missing it.
For each app:
1. Copy the shared keycloak.js module into src/auth/
2. Update main.jsx to call initKeycloak() before rendering
3. Update package.json to add keycloak env var documentation
4. Create/update .env.example with required VITE_ vars
"""
import os
import re
import shutil
import json

REPO = "/home/ubuntu/healthpoint-repo"
SHARED_AUTH = f"{REPO}/frontend/shared/auth/keycloak.js"

# All 14 apps (including the super-dashboard which we'll also ensure is correct)
APPS = [
    "admin-fee-dashboard-enhanced",
    "admin-fee-management-dashboard",
    "emergency-services-dashboard",
    "fee-communication-ui",
    "good-faith-estimate-dashboard",
    "healthcare-platform-ui",
    "member-portal",
    "nsa-compliance-dashboard",
    "nsa-idr-dispute-resolution-dashboard",
    "nsa-idr-super-dashboard",
    "nsa-idr-ui",
    "provider-payment-ui",
    "provider-portal",
    "unified-dashboard",
]

ENV_EXAMPLE = """\
# HealthPoint Keycloak Authentication
VITE_KEYCLOAK_URL=https://auth.healthpoint.gov
VITE_KEYCLOAK_REALM=healthpoint
VITE_KEYCLOAK_CLIENT_ID=healthpoint-frontend

# API Gateway
VITE_API_BASE_URL=https://api.healthpoint.gov
"""

MAIN_JSX_WRAPPER = """import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import {{ initKeycloak }} from './auth/keycloak.js';
{extra_imports}

// Initialize Keycloak PKCE auth before rendering the app.
initKeycloak().then(() => {{
  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(React.StrictMode, null, React.createElement(App))
  );
}}).catch((err) => {{
  console.error('[Auth] Keycloak initialization failed:', err);
  ReactDOM.createRoot(document.getElementById('root')).render(
    React.createElement(React.StrictMode, null, React.createElement(App))
  );
}});
"""

fixed = 0
skipped = 0

for app_name in APPS:
    app_dir = f"{REPO}/frontend/{app_name}"
    src_dir = f"{app_dir}/src"
    auth_dir = f"{src_dir}/auth"
    
    if not os.path.exists(src_dir):
        print(f"  SKIP (no src/): {app_name}")
        skipped += 1
        continue
    
    # 1. Copy shared auth module
    os.makedirs(auth_dir, exist_ok=True)
    shutil.copy2(SHARED_AUTH, f"{auth_dir}/keycloak.js")
    
    # 2. Update main.jsx
    main_jsx = f"{src_dir}/main.jsx"
    if os.path.exists(main_jsx):
        with open(main_jsx, "r") as f:
            current = f.read()
        
        # Check if already has initKeycloak
        if "initKeycloak" in current:
            print(f"  ALREADY_AUTH: {app_name}")
        else:
            # Extract any extra imports (CSS, etc.)
            extra_imports = []
            for line in current.split('\n'):
                if line.startswith('import') and ('css' in line.lower() or 'index' in line.lower()):
                    if 'App' not in line and 'React' not in line and 'ReactDOM' not in line:
                        extra_imports.append(line)
            
            new_main = MAIN_JSX_WRAPPER.format(
                extra_imports='\n'.join(extra_imports)
            )
            
            with open(main_jsx, "w") as f:
                f.write(new_main)
            print(f"  FIXED main.jsx: {app_name}")
    else:
        # Create main.jsx
        new_main = MAIN_JSX_WRAPPER.format(extra_imports='')
        with open(main_jsx, "w") as f:
            f.write(new_main)
        print(f"  CREATED main.jsx: {app_name}")
    
    # 3. Create .env.example
    env_example_path = f"{app_dir}/.env.example"
    with open(env_example_path, "w") as f:
        f.write(ENV_EXAMPLE)
    
    # 4. Update package.json to add keycloak-js if missing
    pkg_path = f"{app_dir}/package.json"
    if os.path.exists(pkg_path):
        with open(pkg_path, "r") as f:
            pkg = json.load(f)
        
        deps = pkg.get("dependencies", {})
        if "keycloak-js" not in deps:
            # We use our own PKCE implementation, no need for keycloak-js package
            # But add a comment in package.json via a custom field
            pkg["_auth"] = "Keycloak PKCE auth via frontend/shared/auth/keycloak.js"
            with open(pkg_path, "w") as f:
                json.dump(pkg, f, indent=2)
    
    fixed += 1

print(f"\nTotal apps fixed: {fixed}")
print(f"Total apps skipped: {skipped}")

# Verify
print("\n--- Verification ---")
for app_name in APPS:
    auth_file = f"{REPO}/frontend/{app_name}/src/auth/keycloak.js"
    main_file = f"{REPO}/frontend/{app_name}/src/main.jsx"
    
    has_auth = os.path.exists(auth_file)
    has_init = False
    if os.path.exists(main_file):
        with open(main_file) as f:
            has_init = "initKeycloak" in f.read()
    
    status = "OK" if (has_auth and has_init) else "MISSING"
    print(f"  {status}: {app_name} (auth={has_auth}, initKeycloak={has_init})")
