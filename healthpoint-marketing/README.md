# HealthPoint Marketing Site

Public-facing landing page for the HealthPoint NSA/IDR platform.

## Features
- Hero section with animated NSA/IDR stats
- 19-step workflow visual grid
- AI ReAct terminal demo
- Audience-specific sections (Providers, Hospitals, Payers, IDR Entities)
- Testimonials and social proof
- 3-tier pricing (Starter / Professional / Enterprise)
- NSA regulatory reference guide
- Lead-capture form with role-based Keycloak sign-up redirect
- Regulatory footer (CMS NSA Hub, 45 CFR § 149.510, § 149.140, HRSA)

## Usage
Single self-contained HTML file. Serve with any static HTTP server:
```bash
python3 -m http.server 8080
```
Or deploy as a static site on any CDN.

## Auth Integration
Sign-in and sign-up CTAs redirect to `/api/auth/login` and `/api/auth/register` on the IDR platform,
with `?role=<stakeholder_type>` pre-populated for role-based onboarding.
