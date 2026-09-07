"""Distributed compute integration (Ray Train/Tune) with local fallback.

If `ray` is importable, this wraps hyperparameter sweeps (Ray Tune) and
data-parallel training (Ray Train) for the platform models. If ray is NOT
installed — the current repo state — it cleanly falls back to the local
training loop in ml.training.train with a log line.

Cluster bring-up notes live in ml/ray_cluster.yaml (a Ray autoscaler config
annotated for the platform's CPU workers).

STATUS: STATIC-ONLY as shipped (ray not installed in repo images). The local
fallback path is exercised by ml/training/train.py.

CLI:
    python -m ml.ray_cluster --model fraudnet --sweep lr,hidden --num-samples 8
"""

from __future__ import annotations

import argparse
import logging

log = logging.getLogger("ml.ray_cluster")
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")


def ray_available() -> bool:
    try:
        import ray  # noqa: F401
        return True
    except ImportError:
        return False


def run_distributed(model_name: str, num_samples: int = 8,
                    seed: int = 42, epochs: int = 200) -> None:
    if not ray_available():
        log.warning("ray not installed; falling back to LOCAL training loop "
                    "(ml.training.train). Install with: pip install ray[train,tune]")
        import subprocess, sys
        subprocess.run([sys.executable, "-m", "ml.training.train",
                        "--seed", str(seed), "--epochs", str(epochs)],
                       check=True)
        return

    import ray
    from ray import tune, train as ray_train
    from ray.train.torch import TorchTrainer
    from ray.train import ScalingConfig

    ray.init(ignore_reinit_error=True)

    def train_loop(config):
        # Reuses the same training body; each Ray worker trains on its shard.
        from ml.training.train import set_seed, train_tabular
        from ml.data.synthetic_platform_data import generate_platform_data
        from ml.models.pytorch_models import MODEL_REGISTRY
        set_seed(seed)
        data = generate_platform_data(seed=seed)
        cls = MODEL_REGISTRY[model_name]
        if model_name == "disputegnn":
            raise ValueError("GNN sweep uses local loop; graph is small")
        model = cls(hidden=config["hidden"]) if "hidden" in config else cls()
        X, y = {"fraudnet": (data.fraud_X, data.fraud_y),
                "creditnet": (data.credit_X, data.credit_y),
                "outcomenet": (data.outcome_X, data.outcome_y)}[model_name]
        metrics = train_tabular(model, X, y, seed, epochs,
                                config.get("lr", 1e-3), 25, model_name)
        ray_train.report(metrics)

    if num_samples > 1:
        tuner = tune.Tuner(
            tune.with_parameters(train_loop),
            param_space={"lr": tune.loguniform(1e-4, 1e-2),
                         "hidden": tune.choice([32, 48, 64])},
            tune_config=tune.TuneConfig(num_samples=num_samples,
                                        metric="val_auc", mode="max"),
        )
        best = tuner.fit().get_best_result()
        log.info("Best config: %s metrics: %s", best.config, best.metrics)
    else:
        trainer = TorchTrainer(train_loop,
                               scaling_config=ScalingConfig(num_workers=2))
        trainer.fit()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="fraudnet")
    ap.add_argument("--num-samples", type=int, default=8)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--epochs", type=int, default=200)
    args = ap.parse_args()
    run_distributed(args.model, args.num_samples, args.seed, args.epochs)


if __name__ == "__main__":
    main()
