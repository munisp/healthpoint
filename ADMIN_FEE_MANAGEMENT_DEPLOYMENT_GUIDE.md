# Admin Fee Management Deployment Guide — RETIRED

This guide documented a standalone "admin fee management" service and the
`admin-fee-dashboard-enhanced/` template app. Neither exists as deployable
software in this repository:

- `admin-fee-dashboard-enhanced/` is an orphaned UI template scheduled for
  removal by `scripts/cleanup-orphans.sh` (owner-approved).
- `Dockerfile.admin-fee` and the `admin-fee-management` /
  `admin-fee-dashboard` compose services referenced here never existed.

Admin fee functionality lives in the main application (Express 5 + tRPC
server, React client). Deploy it with the real flows in
[`DEPLOYMENT_GUIDE.md`](DEPLOYMENT_GUIDE.md).
