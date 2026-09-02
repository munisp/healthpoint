#!/usr/bin/env python3
"""Render a local-only Alertmanager routing test config from the source fragment.

Every receiver is replaced with a distinct loopback capture path. The output has
no deployable PagerDuty/Slack credential or external notification endpoint, and
is intended only for the local test runner.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import yaml

parser = argparse.ArgumentParser()
parser.add_argument("--fragment", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--capture-port", required=True, type=int)
args = parser.parse_args()

fragment = yaml.safe_load(Path(args.fragment).read_text())
if not isinstance(fragment, dict) or not isinstance(fragment.get("route"), dict) or not isinstance(fragment.get("receivers"), list):
    raise SystemExit("invalid routing fragment: expected route mapping and receivers list")

local_paths = {
    "healthpoint-tigerbeetle-drill-pagerduty": "pagerduty-abort",
    "healthpoint-tigerbeetle-drill-slack": "slack-abort",
    "healthpoint-tigerbeetle-clock-no-go-pagerduty": "pagerduty-no-go",
    "healthpoint-tigerbeetle-clock-no-go-slack": "slack-no-go",
    "healthpoint-tigerbeetle-clock-warning-slack": "slack-warning",
}
receivers = [
    {
        "name": "local-discard",
        "webhook_configs": [{"url": f"http://127.0.0.1:{args.capture_port}/discard", "send_resolved": True}],
    },
    *fragment["receivers"],
]

for receiver in receivers:
    name = receiver["name"]
    if name not in local_paths:
        continue
    local_url = f"http://127.0.0.1:{args.capture_port}/{local_paths[name]}"
    if "pagerduty_configs" in receiver:
        config = receiver["pagerduty_configs"][0]
        config.pop("routing_key_file", None)
        config["routing_key"] = "local-test-routing-key-not-a-secret"
        config["url"] = local_url
        config["client"] = "healthpoint-local-alert-routing-test"
        config["client_url"] = "http://localhost/local-alert-routing-test"
        config["source"] = "local-test"
    elif "slack_configs" in receiver:
        config = receiver["slack_configs"][0]
        config.pop("api_url_file", None)
        config["api_url"] = local_url
        config["channel"] = "#local-alert-routing-test"

config = {
    "global": {"resolve_timeout": "1m"},
    "route": {
        "receiver": "local-discard",
        "group_by": ["alertname", "cluster", "namespace", "statefulset"],
        "group_wait": "0s",
        "group_interval": "1m",
        "repeat_interval": "5m",
        "routes": fragment["route"]["routes"],
    },
    "receivers": receivers,
}

Path(args.output).write_text(yaml.safe_dump(config, sort_keys=False))
print(f"LOCAL_ALERTMANAGER_TEST_CONFIG_RENDERED: {args.output}")
