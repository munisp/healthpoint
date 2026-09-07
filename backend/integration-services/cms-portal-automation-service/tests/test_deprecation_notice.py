"""
Guard test: the legacy CMS portal automation service must carry a prominent
module-level deprecation notice for its non-conformant 25-item batch cap.

Containment-only remediation (Wave A): the cap itself is NOT rewired here;
the canonical batched-dispute entity will be built in the TypeScript core
(server/). This guard locks in that the notice exists and stays prominent.
"""

import os
import re

MAIN_PY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "main.py")


def _source() -> str:
    with open(MAIN_PY, encoding="utf-8") as fh:
        return fh.read()


def test_module_level_deprecation_notice_exists():
    src = _source()
    assert "DEPRECATION NOTICE" in src, "prominent module-level deprecation notice is missing"
    assert "LEGACY_BATCH_CAP_DEPRECATION_NOTICE" in src


def test_notice_states_non_conformance_and_regulatory_basis():
    src = _source()
    assert "non-conformant" in src.lower() or "NON-CONFORMANT" in src
    assert "45 CFR 149.510(c)(4)" in src
    assert "CMS-9897-F" in src
    assert "91 FR 33900" in src


def test_notice_states_50_item_cap_and_applicability_date():
    src = _source()
    assert "50 line items" in src
    assert "November 1, 2026" in src
    assert "open negotiation periods beginning on or after" in src


def test_notice_prohibits_use_and_points_to_ts_core():
    src = _source()
    assert re.search(r"must not be used for federal IDR batching decisions", src, re.IGNORECASE)
    assert "server/" in src  # TypeScript core is canonical


def test_notice_is_module_level_before_batch_cap():
    src = _source()
    notice_pos = src.index("DEPRECATION NOTICE")
    cap_pos = src.index("MAX_BATCH_ITEMS = 25")
    assert notice_pos < cap_pos, "notice must precede the legacy cap definition"
    # Module-level: the notice appears before any function/class definition.
    first_def = min(p for p in (src.find("\ndef "), src.find("\nclass ")) if p != -1)
    assert notice_pos < first_def


def test_legacy_cap_not_rewired_in_wave_a():
    """Containment only: MAX_BATCH_ITEMS must remain 25 until the TS core
    lands the real batched-dispute entity (Wave B)."""
    src = _source()
    assert re.search(r"^MAX_BATCH_ITEMS = 25$", src, re.MULTILINE)
