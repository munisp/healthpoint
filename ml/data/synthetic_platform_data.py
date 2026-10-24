"""NSA/IDR-domain synthetic platform data generator.

Improves on backend/ml/synthetic_data_generator.py by encoding documented,
seedable distributions with NSA/IDR domain rationale:

- Service-mix per specialty: emergency medicine, radiology, anesthesiology and
  ancillary dominate out-of-network NSA disputes (CMS 2023 IDR reports show
  emergency/radiology/anesthesia dominate Federal IDR volume), so the CPT
  mixture is specialty-conditional rather than uniform.
- QPA (Qualifying Payment Amount): modeled as a log-normal cluster per CPT
  code, because median in-network contracted rates are right-skewed with a
  payer-specific multiplicative factor.
- Payer behavior archetypes: {fair, lowball, slow} — "lowball" payers
  systematically deflate the QPA (the well-documented "lowball QPA" pattern
  that drives provider-favorable IDR outcomes); "slow" payers stretch payment
  latency (drives credit risk).
- Fraud rings as GRAPH MOTIFS: shared TINs / shared addresses across
  nominally-distinct providers, plus offer-herding (many disputes from the
  ring submit near-identical offers). These become edges in the dispute graph
  used by DisputeGNN.
- Temporal seasonality: dispute volume has a mild annual sinusoid plus
  end-of-quarter spike (claims backlog flush).

Everything is numpy-only and fully seeded; the same seed regenerates the same
dataset byte-for-byte (float64 -> float32 cast at tensor time).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import numpy as np

from ml.models.pytorch_models import (
    FRAUD_FEATURE_DIM,
    CREDIT_FEATURE_DIM,
    GNN_NODE_FEATURE_DIM,
    OUTCOME_FEATURE_DIM,
)

SPECIALTIES = ["emergency", "radiology", "anesthesiology", "surgery", "behavioral"]
# Specialty mixture reflecting observed Federal IDR volume dominance of
# emergency/radiology/anesthesia.
SPECIALTY_MIX = np.array([0.42, 0.24, 0.18, 0.10, 0.06])

CPTS = {
    "emergency": ["99284", "99285", "99283"],
    "radiology": ["70450", "74177", "71046"],
    "anesthesiology": ["01922", "00810", "01810"],
    "surgery": ["47562", "29881", "44970"],
    "behavioral": ["90837", "90834", "96130"],
}

PAYER_ARCHETYPES = {
    # qpa_bias: multiplicative bias applied to the true median rate
    # pay_latency_days: mean days to pay after determination
    "fair": {"qpa_bias": 1.00, "pay_latency_days": 30, "herd_offers": False},
    "lowball": {"qpa_bias": 0.72, "pay_latency_days": 34, "herd_offers": False},
    "slow": {"qpa_bias": 0.96, "pay_latency_days": 78, "herd_offers": False},
    "herder": {"qpa_bias": 0.85, "pay_latency_days": 40, "herd_offers": True},
}


@dataclass
class PlatformData:
    fraud_X: np.ndarray
    fraud_y: np.ndarray
    credit_X: np.ndarray
    credit_y: np.ndarray
    gnn_x: np.ndarray            # [num_nodes, GNN_NODE_FEATURE_DIM]
    gnn_edge_index: np.ndarray   # [2, E]
    gnn_y: np.ndarray            # per-node anomaly label
    outcome_X: np.ndarray
    outcome_y: np.ndarray
    meta: Dict


def _seasonal_volume(rng: np.random.Generator, n: int) -> np.ndarray:
    """Annual sinusoid + quarter-end bump -> sample day-of-year per dispute."""
    days = rng.integers(0, 365, size=n).astype(float)
    w = 1.0 + 0.15 * np.sin(2 * np.pi * days / 365.0)
    quarter_end = (days % 91) > 84
    w = w + 0.4 * quarter_end
    p = w / w.sum()
    return rng.choice(days, size=n, p=p)


def generate_platform_data(seed: int = 42, n_disputes: int = 6000,
                           n_entities: int = 400) -> PlatformData:
    rng = np.random.default_rng(seed)
    meta: Dict = {"seed": seed, "n_disputes": n_disputes, "n_entities": n_entities}

    # ------------------------------------------------------------------ #
    # Entities: providers (some in fraud rings sharing TIN/address), payers #
    # ------------------------------------------------------------------ #
    n_providers = int(n_entities * 0.75)
    n_payers = n_entities - n_providers
    prov_specialty = rng.choice(len(SPECIALTIES), size=n_providers, p=SPECIALTY_MIX)
    prov_tin = np.arange(n_providers)  # unique TIN per provider by default
    prov_addr = np.arange(n_providers)
    in_ring = np.zeros(n_providers, dtype=bool)

    # Fraud rings: ~4% of providers coerced into rings of 3-6 sharing TIN+addr.
    n_ring_members = max(6, int(n_providers * 0.04))
    ring_ids = rng.choice(n_providers, size=n_ring_members, replace=False)
    in_ring[ring_ids] = True
    # Shared identifiers: collapse their TIN/address onto ring leaders.
    for i, pid in enumerate(ring_ids):
        leader = ring_ids[(i // 5) * 5]
        prov_tin[pid] = prov_tin[leader]
        prov_addr[pid] = prov_addr[leader]

    payer_arch = rng.choice(list(PAYER_ARCHETYPES), size=n_payers,
                            p=[0.55, 0.25, 0.12, 0.08])

    # ------------------------------------------------------------------ #
    # Disputes: CPT -> log-normal QPA cluster; payer bias; provider offer    #
    # ------------------------------------------------------------------ #
    spec = rng.choice(len(SPECIALTIES), size=n_disputes, p=SPECIALTY_MIX)
    prov = rng.integers(0, n_providers, size=n_disputes)
    pay = rng.integers(0, n_payers, size=n_disputes)
    day = _seasonal_volume(rng, n_disputes)

    cpt_idx = np.array([rng.integers(0, 3) for _ in range(n_disputes)])
    # Log-normal base rate per specialty; CPT index shifts within specialty.
    base_mu = np.array([6.4, 6.9, 6.7, 7.3, 5.9])  # ln(median rate $)
    mu = base_mu[spec] + 0.15 * cpt_idx
    true_rate = np.exp(rng.normal(mu, 0.35))  # log-normal QPA cluster
    qpa_bias = np.array([PAYER_ARCHETYPES[payer_arch[p]]["qpa_bias"] for p in pay])
    qpa = true_rate * qpa_bias

    billed = true_rate * rng.uniform(2.0, 6.0, size=n_disputes)  # OON billed charges
    # Provider offer: near billed for aggressive/ring providers, near QPA otherwise
    offer_ratio = rng.uniform(1.2, 5.0, size=n_disputes)
    offer = qpa * offer_ratio
    # Offer-herding motif: "herder" payers and ring providers submit tightly
    # clustered offers (collusion signal).
    herder_pay = np.array([PAYER_ARCHETYPES[payer_arch[p]]["herd_offers"] for p in pay])
    herd_mask = herder_pay | in_ring[prov]
    offer[herd_mask] = qpa[herd_mask] * rng.uniform(2.4, 2.6, size=herd_mask.sum())

    offer_spread = np.log(offer / qpa)
    latency = np.array([PAYER_ARCHETYPES[payer_arch[p]]["pay_latency_days"] for p in pay])
    latency = latency + rng.normal(0, 7, size=n_disputes)

    # ------------------------------------------------------------------ #
    # Labels                                                                #
    # ------------------------------------------------------------------ #
    # Fraud probability: ring membership + shared-identifier reuse + herding +
    # abnormal billing inflate risk.
    tin_reuse = (np.bincount(prov_tin)[prov_tin[prov]] > 1).astype(float)
    logit_fraud = (
        -3.4
        + 3.6 * in_ring[prov]
        + 1.8 * tin_reuse
        + 1.6 * herd_mask
        + 0.8 * np.clip(np.log(billed / true_rate) - 1.0, 0, None)
        + rng.normal(0, 0.3, size=n_disputes)
    )
    p_fraud = 1 / (1 + np.exp(-logit_fraud))
    fraud_y = (rng.random(n_disputes) < p_fraud).astype(np.float32)

    # Credit risk (payer/provider financial distress): latency + lowballing +
    # dispute loss rate.
    logit_credit = (
        -2.0
        + 0.08 * np.clip(latency - 30, 0, None)
        + 2.2 * (qpa_bias < 0.8)
        + rng.normal(0, 0.3, size=n_disputes)
    )
    credit_y = (rng.random(n_disputes) < 1 / (1 + np.exp(-logit_credit))).astype(np.float32)

    # IDR outcome (patient/provider-favorable = 1): lowball QPAs get corrected,
    # herding is penalized by IDREs, spread matters.
    logit_outcome = (
        -0.5
        + 2.6 * (qpa_bias < 0.8)
        - 1.4 * herd_mask
        + 0.8 * np.tanh(offer_spread - 1.0)
        + 0.6 * (spec == 0)  # emergency disputes more often provider-favorable
        + rng.normal(0, 0.4, size=n_disputes)
    )
    outcome_y = (rng.random(n_disputes) < 1 / (1 + np.exp(-logit_outcome))).astype(np.float32)

    # ------------------------------------------------------------------ #
    # Feature matrices (fixed order; keep in sync with serving/inference)   #
    # ------------------------------------------------------------------ #
    spec_oh = np.eye(len(SPECIALTIES), dtype=np.float32)[spec]  # 5 dims
    fraud_X = np.column_stack([
        np.log1p(billed), np.log1p(qpa), np.log1p(offer), offer_spread,
        tin_reuse, in_ring[prov].astype(float), herd_mask.astype(float),
        latency / 100.0, day / 365.0,
        spec_oh,
        np.log(billed / true_rate),  # billing aggressiveness
        cpt_idx / 3.0,               # within-specialty CPT intensity
    ]).astype(np.float32)
    assert fraud_X.shape[1] == FRAUD_FEATURE_DIM

    credit_X = np.column_stack([
        latency / 100.0, qpa_bias, np.log1p(qpa), np.log1p(billed),
        offer_spread, day / 365.0,
        (payer_arch[pay] == "slow").astype(float),
        (payer_arch[pay] == "lowball").astype(float),
        in_ring[prov].astype(float),
        fraud_y,  # fraud propensity correlates with distress
        np.log(billed / true_rate),
        offer_spread ** 2,
    ]).astype(np.float32)
    assert credit_X.shape[1] == CREDIT_FEATURE_DIM

    outcome_X = np.column_stack([
        offer_spread, np.log1p(qpa), np.log1p(billed), qpa_bias,
        latency / 100.0, herd_mask.astype(float),
        spec_oh[:, 0], spec_oh[:, 1], spec_oh[:, 2],  # top-3 specialties
        day / 365.0,
    ]).astype(np.float32)
    assert outcome_X.shape[1] == OUTCOME_FEATURE_DIM

    # ------------------------------------------------------------------ #
    # Dispute graph for the GNN                                             #
    # Nodes: [providers | payers | sampled disputes]; edges: submission     #
    # (provider-dispute, payer-dispute) + shared-TIN/address motif edges.   #
    # ------------------------------------------------------------------ #
    n_disp_nodes = min(800, n_disputes)
    disp_sel = rng.choice(n_disputes, size=n_disp_nodes, replace=False)
    num_nodes = n_providers + n_payers + n_disp_nodes
    edges: List[Tuple[int, int]] = []
    for i, d in enumerate(disp_sel):
        dn = n_providers + n_payers + i
        edges.append((prov[d], dn))
        edges.append((n_providers + pay[d], dn))
    # Shared TIN / address motif edges among ring providers.
    for i in range(len(ring_ids)):
        for j in range(i + 1, len(ring_ids)):
            if prov_tin[ring_ids[i]] == prov_tin[ring_ids[j]]:
                edges.append((ring_ids[i], ring_ids[j]))
    gnn_edge_index = np.array(edges, dtype=np.int64).T

    # Node features: entity type one-hot (3) + aggregates (9).
    node_feat = np.zeros((num_nodes, GNN_NODE_FEATURE_DIM), dtype=np.float32)
    node_feat[:n_providers, 0] = 1.0
    node_feat[n_providers:n_providers + n_payers, 1] = 1.0
    node_feat[n_providers + n_payers:, 2] = 1.0
    for i in range(n_providers):
        node_feat[i, 3] = in_ring[i]
        node_feat[i, 4] = prov_specialty[i] / len(SPECIALTIES)
    for j in range(n_payers):
        a = payer_arch[j]
        node_feat[n_providers + j, 5] = PAYER_ARCHETYPES[a]["qpa_bias"]
        node_feat[n_providers + j, 6] = PAYER_ARCHETYPES[a]["pay_latency_days"] / 100.0
        node_feat[n_providers + j, 7] = float(PAYER_ARCHETYPES[a]["herd_offers"])
    for i, d in enumerate(disp_sel):
        dn = n_providers + n_payers + i
        node_feat[dn, 8] = offer_spread[d]
        node_feat[dn, 9] = np.log1p(qpa[d])
        node_feat[dn, 10] = herd_mask[d]
        node_feat[dn, 11] = day[d] / 365.0

    # Node anomaly labels: ring providers, herder payers, and their disputes.
    gnn_y = np.zeros(num_nodes, dtype=np.float32)
    gnn_y[:n_providers] = in_ring.astype(np.float32)
    for j in range(n_payers):
        gnn_y[n_providers + j] = float(PAYER_ARCHETYPES[payer_arch[j]]["herd_offers"])
    for i, d in enumerate(disp_sel):
        gnn_y[n_providers + n_payers + i] = float(herd_mask[d])

    meta.update({
        "n_providers": n_providers, "n_payers": n_payers,
        "n_ring_members": int(n_ring_members),
        "gnn_num_nodes": int(num_nodes), "gnn_num_edges": int(len(edges)),
        "fraud_rate": float(fraud_y.mean()),
        "credit_rate": float(credit_y.mean()),
        "outcome_rate": float(outcome_y.mean()),
    })
    return PlatformData(
        fraud_X=fraud_X, fraud_y=fraud_y,
        credit_X=credit_X, credit_y=credit_y,
        gnn_x=node_feat, gnn_edge_index=gnn_edge_index, gnn_y=gnn_y,
        outcome_X=outcome_X, outcome_y=outcome_y,
        meta=meta,
    )


if __name__ == "__main__":
    d = generate_platform_data()
    print(d.meta)
    print({k: getattr(d, k).shape for k in
           ["fraud_X", "credit_X", "outcome_X", "gnn_x", "gnn_edge_index"]})
