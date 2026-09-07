"""Real training loops for all four platform models (CPU).

- Proper train/val/test split (70/15/15, seeded).
- Adam optimizer, BCEWithLogitsLoss, early stopping on val AUC.
- Per-epoch metrics logged; best weights checkpointed and exported as JSON.
- Fully deterministic: fixed torch/numpy seeds. Running twice with the same
  seed regenerates identical weights (verified by determinism check).

CLI:
    python -m ml.training.train --seed 42 --epochs 200 --out ml/artifacts
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import accuracy_score, roc_auc_score

from ml.data.synthetic_platform_data import generate_platform_data
from ml.models.pytorch_models import (
    FraudNet, CreditNet, DisputeGNN, OutcomeNet,
    export_weights_json, normalize_adjacency,
)


def set_seed(seed: int) -> None:
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(False)  # not needed for CPU MLP/GCN
    np.random.seed(seed)


def split_indices(n: int, seed: int) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed + 1)
    idx = rng.permutation(n)
    n_tr, n_va = int(0.70 * n), int(0.15 * n)
    return idx[:n_tr], idx[n_tr:n_tr + n_va], idx[n_tr + n_va:]


def train_tabular(model: nn.Module, X: np.ndarray, y: np.ndarray, seed: int,
                  epochs: int, lr: float, patience: int,
                  log_prefix: str) -> Dict:
    tr, va, te = split_indices(len(X), seed)
    Xt, yt = torch.tensor(X), torch.tensor(y)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCEWithLogitsLoss()
    best_val_auc, best_state, bad = -1.0, None, 0
    history = []
    for ep in range(epochs):
        model.train()
        opt.zero_grad()
        loss = loss_fn(model(Xt[tr]), yt[tr])
        loss.backward()
        opt.step()
        model.eval()
        with torch.no_grad():
            pv = torch.sigmoid(model(Xt[va])).numpy()
        va_auc = roc_auc_score(yt[va].numpy(), pv)
        va_acc = accuracy_score(yt[va].numpy(), pv > 0.5)
        history.append({"epoch": ep, "train_loss": float(loss.item()),
                        "val_auc": float(va_auc), "val_acc": float(va_acc)})
        if ep % 20 == 0 or ep == epochs - 1:
            print(f"[{log_prefix}] ep={ep:3d} loss={loss.item():.4f} "
                  f"val_auc={va_auc:.4f} val_acc={va_acc:.4f}", flush=True)
        if va_auc > best_val_auc + 1e-4:
            best_val_auc, best_state, bad = va_auc, \
                {k: v.clone() for k, v in model.state_dict().items()}, 0
        else:
            bad += 1
            if bad >= patience:
                print(f"[{log_prefix}] early stop at epoch {ep}", flush=True)
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        pt = torch.sigmoid(model(Xt[te])).numpy()
    return {
        "val_auc": float(best_val_auc),
        "test_auc": float(roc_auc_score(yt[te].numpy(), pt)),
        "test_acc": float(accuracy_score(yt[te].numpy(), pt > 0.5)),
        "epochs_trained": len(history),
    }


def train_gnn(model: DisputeGNN, x: np.ndarray, edge_index: np.ndarray,
              y: np.ndarray, seed: int, epochs: int, lr: float,
              patience: int) -> Dict:
    n = len(x)
    tr, va, te = split_indices(n, seed)
    Xt = torch.tensor(x)
    yt = torch.tensor(y)
    adj = normalize_adjacency(torch.tensor(edge_index), n)
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.BCEWithLogitsLoss()
    best_val_auc, best_state, bad = -1.0, None, 0
    for ep in range(epochs):
        model.train()
        opt.zero_grad()
        out = model(Xt, adj)
        loss = loss_fn(out[tr], yt[tr])
        loss.backward()
        opt.step()
        model.eval()
        with torch.no_grad():
            pv = torch.sigmoid(model(Xt, adj)[va]).numpy()
        va_auc = roc_auc_score(yt[va].numpy(), pv)
        if ep % 20 == 0 or ep == epochs - 1:
            print(f"[disputegnn] ep={ep:3d} loss={loss.item():.4f} "
                  f"val_auc={va_auc:.4f}", flush=True)
        if va_auc > best_val_auc + 1e-4:
            best_val_auc, best_state, bad = va_auc, \
                {k: v.clone() for k, v in model.state_dict().items()}, 0
        else:
            bad += 1
            if bad >= patience:
                print(f"[disputegnn] early stop at epoch {ep}", flush=True)
                break
    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    with torch.no_grad():
        pt = torch.sigmoid(model(Xt, adj)[te]).numpy()
    return {
        "val_auc": float(best_val_auc),
        "test_auc": float(roc_auc_score(yt[te].numpy(), pt)),
        "test_acc": float(accuracy_score(yt[te].numpy(), pt > 0.5)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--patience", type=int, default=25)
    ap.add_argument("--n-disputes", type=int, default=6000)
    ap.add_argument("--out", type=str, default="ml/artifacts")
    ap.add_argument("--tag", type=str, default="")
    args = ap.parse_args()

    print(f"torch_version={torch.__version__} device=cpu seed={args.seed}",
          flush=True)
    set_seed(args.seed)
    t0 = time.time()

    data = generate_platform_data(seed=args.seed, n_disputes=args.n_disputes)
    print(f"data meta: {json.dumps(data.meta)}", flush=True)

    out_dir = Path(args.out)
    weights_dir = out_dir / "weights"
    weights_dir.mkdir(parents=True, exist_ok=True)

    metrics: Dict = {"torch_version": torch.__version__, "seed": args.seed,
                     "data_meta": data.meta, "models": {}}

    jobs = [
        ("fraudnet", FraudNet(), data.fraud_X, data.fraud_y),
        ("creditnet", CreditNet(), data.credit_X, data.credit_y),
        ("outcomenet", OutcomeNet(), data.outcome_X, data.outcome_y),
    ]
    for name, model, X, y in jobs:
        start = time.time()
        m = train_tabular(model, X, y, args.seed, args.epochs, args.lr,
                          args.patience, name)
        m["params"] = sum(p.numel() for p in model.parameters())
        m["train_seconds"] = round(time.time() - start, 2)
        metrics["models"][name] = m
        tag = f"_{args.tag}" if args.tag else ""
        with open(weights_dir / f"{name}{tag}.json", "w") as f:
            json.dump(export_weights_json(model), f)
        print(f"[{name}] FINAL val_auc={m['val_auc']:.4f} "
              f"test_auc={m['test_auc']:.4f} test_acc={m['test_acc']:.4f} "
              f"params={m['params']} time={m['train_seconds']}s", flush=True)

    gnn = DisputeGNN()
    start = time.time()
    gm = train_gnn(gnn, data.gnn_x, data.gnn_edge_index, data.gnn_y,
                   args.seed, args.epochs, args.lr, args.patience)
    gm["params"] = sum(p.numel() for p in gnn.parameters())
    gm["train_seconds"] = round(time.time() - start, 2)
    metrics["models"]["disputegnn"] = gm
    tag = f"_{args.tag}" if args.tag else ""
    with open(weights_dir / f"disputegnn{tag}.json", "w") as f:
        json.dump(export_weights_json(gnn), f)
    print(f"[disputegnn] FINAL val_auc={gm['val_auc']:.4f} "
          f"test_auc={gm['test_auc']:.4f} test_acc={gm['test_acc']:.4f} "
          f"params={gm['params']} time={gm['train_seconds']}s", flush=True)

    metrics["total_seconds"] = round(time.time() - t0, 2)
    with open(out_dir / f"metrics{tag}.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"total_seconds={metrics['total_seconds']}", flush=True)


if __name__ == "__main__":
    main()
