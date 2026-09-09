"""Real PyTorch models for the HealthPoint NSA/IDR platform.

All models are deliberately small (<1M parameters each) and CPU-inferable so
they can run inside the existing ai-service containers without a GPU.

Weights are serialized as JSON (float arrays) so they can be pushed to the
repo / registry as plain text artifacts. No binary blobs are used.

Models
------
- FraudNet   : tabular MLP -> P(fraud) for a dispute/submission.
- CreditNet  : tabular MLP -> provider/payer credit-risk score in [0,1].
- DisputeGNN : 2-layer GCN in PURE torch (no torch_geometric). Message passing
               uses sparse adjacency matmul over the dispute graph whose nodes
               are providers, payers, disputes and IDREs. Predicts dispute
               outcome / collusion-anomaly per node.
- OutcomeNet : tabular MLP -> P(patient-favorable IDR determination).
"""

from __future__ import annotations

import json
from typing import Dict, List

import torch
import torch.nn as nn
import torch.nn.functional as F


# --------------------------------------------------------------------------- #
# Feature dimensions (must stay in sync with ml/data/synthetic_platform_data) #
# --------------------------------------------------------------------------- #
FRAUD_FEATURE_DIM = 16
CREDIT_FEATURE_DIM = 12
GNN_NODE_FEATURE_DIM = 12
OUTCOME_FEATURE_DIM = 10


def _count_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


class FraudNet(nn.Module):
    """MLP: tabular fraud features -> fraud probability."""

    def __init__(self, in_dim: int = FRAUD_FEATURE_DIM, hidden: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Dropout(0.10),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Dropout(0.10),
            nn.Linear(hidden, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)  # logits


class CreditNet(nn.Module):
    """MLP: provider/payer financial features -> credit-risk score logit."""

    def __init__(self, in_dim: int = CREDIT_FEATURE_DIM, hidden: int = 48):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


class GCNLayer(nn.Module):
    """Pure-torch GCN layer: H' = sigma( D^-1/2 (A+I) D^-1/2 H W ).

    The normalized adjacency (with self-loops) is supplied precomputed by the
    caller so it can be a sparse or dense tensor.
    """

    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.lin = nn.Linear(in_dim, out_dim, bias=True)

    def forward(self, x: torch.Tensor, adj_norm: torch.Tensor) -> torch.Tensor:
        support = self.lin(x)
        if adj_norm.is_sparse:
            out = torch.sparse.mm(adj_norm, support)
        else:
            out = adj_norm @ support
        return out


class DisputeGNN(nn.Module):
    """2-layer GCN over the dispute graph (providers/payers/disputes/IDREs).

    Returns per-node logits for "anomalous/collusive node" classification.
    """

    def __init__(self, in_dim: int = GNN_NODE_FEATURE_DIM, hidden: int = 32):
        super().__init__()
        self.gc1 = GCNLayer(in_dim, hidden)
        self.gc2 = GCNLayer(hidden, 1)
        self.dropout = nn.Dropout(0.10)

    def forward(self, x: torch.Tensor, adj_norm: torch.Tensor) -> torch.Tensor:
        h = F.relu(self.gc1(x, adj_norm))
        h = self.dropout(h)
        return self.gc2(h, adj_norm).squeeze(-1)  # per-node logits


class OutcomeNet(nn.Module):
    """MLP: IDR case features -> P(patient-favorable determination)."""

    def __init__(self, in_dim: int = OUTCOME_FEATURE_DIM, hidden: int = 48):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x).squeeze(-1)


MODEL_REGISTRY = {
    "fraudnet": FraudNet,
    "creditnet": CreditNet,
    "disputegnn": DisputeGNN,
    "outcomenet": OutcomeNet,
}


def _round_nested(arr):
    if isinstance(arr, list):
        return [_round_nested(x) for x in arr]
    return float(f"{arr:.6g}")


def export_weights_json(model: nn.Module) -> Dict:
    """Serialize a model to a JSON-safe dict of float arrays."""
    state = {}
    for name, tensor in model.state_dict().items():
        # Round to 6 significant digits: keeps artifacts compact text for
        # repo storage with negligible effect on inference (<1e-5 logit shift).
        arr = tensor.detach().cpu().tolist()
        state[name] = _round_nested(arr)
    return {
        "class": model.__class__.__name__,
        "param_count": _count_params(model),
        "state_dict": state,
    }


def load_weights_json(model: nn.Module, payload: Dict) -> nn.Module:
    """Load weights produced by export_weights_json into `model` (in place)."""
    state = {}
    for name, arr in payload["state_dict"].items():
        ref = model.state_dict()[name]
        state[name] = torch.tensor(arr, dtype=ref.dtype).reshape(ref.shape)
    model.load_state_dict(state)
    return model


def save_weights_file(model: nn.Module, path: str) -> None:
    with open(path, "w") as f:
        json.dump(export_weights_json(model), f)


def load_weights_file(model: nn.Module, path: str) -> nn.Module:
    with open(path) as f:
        return load_weights_json(model, json.load(f))


def normalize_adjacency(edge_index: torch.Tensor, num_nodes: int) -> torch.Tensor:
    """Build symmetric-normalized adjacency D^-1/2 (A+I) D^-1/2 as dense tensor.

    edge_index: LongTensor [2, E] of undirected edges (either direction).
    """
    ei = torch.cat([edge_index, edge_index.flip(0)], dim=1)  # make symmetric
    ei = torch.cat([ei, torch.arange(num_nodes).repeat(2, 1)], dim=1)  # self loops
    adj = torch.zeros((num_nodes, num_nodes), dtype=torch.float32)
    adj[ei[0], ei[1]] = 1.0
    deg = adj.sum(dim=1).clamp(min=1.0)
    d_inv_sqrt = deg.pow(-0.5)
    return d_inv_sqrt.unsqueeze(1) * adj * d_inv_sqrt.unsqueeze(0)


if __name__ == "__main__":
    for name, cls in MODEL_REGISTRY.items():
        m = cls()
        print(f"{name}: {_count_params(m)} params")
    # GNN smoke test
    g = DisputeGNN()
    x = torch.randn(10, GNN_NODE_FEATURE_DIM)
    edges = torch.tensor([[0, 1, 2, 3], [1, 2, 3, 0]])
    adj = normalize_adjacency(edges, 10)
    print("gnn out:", g(x, adj).shape)
