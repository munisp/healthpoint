"""
Ultra Enhanced Confidence System
Advanced multi-model confidence scoring and ensemble weighting for fraud detection.
Provides calibrated probability estimates, uncertainty quantification, and
model disagreement detection for the HealthPoint AI Fraud Detection pipeline.
"""
import logging
import math
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)


class ConfidenceLevel(str, Enum):
    VERY_HIGH = "very_high"    # >= 0.90
    HIGH = "high"              # >= 0.75
    MEDIUM = "medium"          # >= 0.55
    LOW = "low"                # >= 0.35
    VERY_LOW = "very_low"      # < 0.35


class CalibrationMethod(str, Enum):
    PLATT_SCALING = "platt_scaling"
    ISOTONIC_REGRESSION = "isotonic_regression"
    TEMPERATURE_SCALING = "temperature_scaling"
    BETA_CALIBRATION = "beta_calibration"


@dataclass
class ModelScore:
    """Score from a single model in the ensemble."""
    model_name: str
    raw_score: float          # Raw probability output [0, 1]
    calibrated_score: float   # Calibrated probability [0, 1]
    weight: float             # Ensemble weight [0, 1]
    confidence: float         # Model's own confidence estimate [0, 1]
    features_used: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class EnsembleResult:
    """Final ensemble confidence result."""
    final_score: float
    confidence_level: ConfidenceLevel
    weighted_score: float
    uncertainty: float
    model_agreement: float
    model_scores: List[ModelScore]
    explanation: str
    is_reliable: bool
    calibration_quality: str


class PlattScaler:
    """Platt scaling for probability calibration."""

    def __init__(self, a: float = 1.0, b: float = 0.0):
        self.a = a
        self.b = b

    def calibrate(self, score: float) -> float:
        """Apply Platt scaling: P = 1 / (1 + exp(a * score + b))"""
        try:
            return 1.0 / (1.0 + math.exp(self.a * score + self.b))
        except OverflowError:
            return 0.0 if self.a * score + self.b > 0 else 1.0

    def fit(self, scores: List[float], labels: List[int]) -> None:
        """Fit Platt scaling parameters using maximum likelihood."""
        if len(scores) < 2:
            return
        # Simplified gradient descent for Platt scaling
        lr = 0.01
        for _ in range(1000):
            grad_a = grad_b = 0.0
            for s, y in zip(scores, labels):
                p = self.calibrate(s)
                err = p - y
                grad_a += err * s
                grad_b += err
            self.a -= lr * grad_a / len(scores)
            self.b -= lr * grad_b / len(scores)


class TemperatureScaler:
    """Temperature scaling for neural network calibration."""

    def __init__(self, temperature: float = 1.5):
        self.temperature = max(0.1, temperature)

    def calibrate(self, logit: float) -> float:
        """Scale logit by temperature and apply sigmoid."""
        scaled = logit / self.temperature
        try:
            return 1.0 / (1.0 + math.exp(-scaled))
        except OverflowError:
            return 1.0 if scaled > 0 else 0.0

    def optimal_temperature(self, logits: List[float], labels: List[int]) -> float:
        """Find optimal temperature using NLL minimization."""
        best_t = 1.0
        best_nll = float("inf")
        for t in np.arange(0.1, 5.0, 0.1):
            self.temperature = float(t)
            nll = 0.0
            for logit, y in zip(logits, labels):
                p = self.calibrate(logit)
                p = max(1e-7, min(1 - 1e-7, p))
                nll -= y * math.log(p) + (1 - y) * math.log(1 - p)
            nll /= len(logits)
            if nll < best_nll:
                best_nll = nll
                best_t = float(t)
        self.temperature = best_t
        return best_t


class UncertaintyQuantifier:
    """Quantifies epistemic and aleatoric uncertainty."""

    @staticmethod
    def epistemic_uncertainty(scores: List[float]) -> float:
        """
        Epistemic (model) uncertainty: variance across model predictions.
        High variance = models disagree = high uncertainty.
        """
        if len(scores) < 2:
            return 0.0
        return float(np.var(scores))

    @staticmethod
    def aleatoric_uncertainty(score: float) -> float:
        """
        Aleatoric (data) uncertainty: entropy of the prediction.
        Maximised at score = 0.5, minimised at 0 or 1.
        """
        p = max(1e-7, min(1 - 1e-7, score))
        return -(p * math.log(p) + (1 - p) * math.log(1 - p))

    @staticmethod
    def total_uncertainty(scores: List[float]) -> float:
        """Combined uncertainty measure [0, 1]."""
        if not scores:
            return 1.0
        mean_score = float(np.mean(scores))
        epistemic = UncertaintyQuantifier.epistemic_uncertainty(scores)
        aleatoric = UncertaintyQuantifier.aleatoric_uncertainty(mean_score)
        # Normalise: epistemic max ≈ 0.25 (variance of [0,1]), aleatoric max = ln(2) ≈ 0.693
        norm_epistemic = min(1.0, epistemic / 0.25)
        norm_aleatoric = min(1.0, aleatoric / 0.693)
        return round((norm_epistemic * 0.4 + norm_aleatoric * 0.6), 4)


class ModelAgreementAnalyzer:
    """Analyses agreement between ensemble models."""

    @staticmethod
    def pairwise_agreement(scores: List[float], threshold: float = 0.5) -> float:
        """
        Fraction of model pairs that agree on the binary prediction.
        Returns 1.0 if all models agree, 0.0 if maximum disagreement.
        """
        if len(scores) < 2:
            return 1.0
        predictions = [1 if s >= threshold else 0 for s in scores]
        n = len(predictions)
        agreements = sum(
            1 for i in range(n) for j in range(i + 1, n)
            if predictions[i] == predictions[j]
        )
        total_pairs = n * (n - 1) / 2
        return agreements / total_pairs if total_pairs > 0 else 1.0

    @staticmethod
    def score_spread(scores: List[float]) -> float:
        """Range of scores as a measure of disagreement."""
        if len(scores) < 2:
            return 0.0
        return float(max(scores) - min(scores))

    @staticmethod
    def coefficient_of_variation(scores: List[float]) -> float:
        """CV as relative measure of spread."""
        if len(scores) < 2:
            return 0.0
        mean = float(np.mean(scores))
        if mean == 0:
            return 0.0
        return float(np.std(scores)) / mean


class EnsembleWeightOptimizer:
    """Optimises ensemble weights based on model performance history."""

    def __init__(self):
        self._performance_history: Dict[str, List[float]] = {}

    def update_performance(self, model_name: str, accuracy: float) -> None:
        if model_name not in self._performance_history:
            self._performance_history[model_name] = []
        self._performance_history[model_name].append(accuracy)
        # Keep last 100 measurements
        self._performance_history[model_name] = self._performance_history[model_name][-100:]

    def get_weight(self, model_name: str) -> float:
        """Get performance-based weight for a model."""
        history = self._performance_history.get(model_name, [])
        if not history:
            return 1.0  # Default equal weight
        # Exponentially weighted moving average (recent performance matters more)
        weights = [0.9 ** (len(history) - 1 - i) for i in range(len(history))]
        weighted_avg = sum(a * w for a, w in zip(history, weights)) / sum(weights)
        return max(0.1, weighted_avg)

    def normalise_weights(self, model_weights: Dict[str, float]) -> Dict[str, float]:
        """Normalise weights to sum to 1.0."""
        total = sum(model_weights.values())
        if total == 0:
            n = len(model_weights)
            return {k: 1.0 / n for k in model_weights}
        return {k: v / total for k, v in model_weights.items()}


class UltraEnhancedConfidenceSystem:
    """
    Ultra Enhanced Confidence System for fraud detection ensemble.

    Combines:
    - Platt scaling calibration
    - Temperature scaling for deep learning models
    - Epistemic + aleatoric uncertainty quantification
    - Model agreement analysis
    - Dynamic ensemble weight optimisation
    - Confidence level classification
    - Reliability assessment
    """

    # Default model weights (tuned on historical performance)
    DEFAULT_WEIGHTS = {
        "rule_engine": 0.15,
        "random_forest": 0.20,
        "gradient_boosting": 0.20,
        "neural_network": 0.18,
        "isolation_forest": 0.12,
        "gnn": 0.15,
    }

    # Calibration parameters per model type (fitted offline)
    PLATT_PARAMS = {
        "rule_engine": {"a": -1.2, "b": 0.1},
        "random_forest": {"a": -1.0, "b": 0.05},
        "gradient_boosting": {"a": -1.1, "b": 0.08},
        "isolation_forest": {"a": -0.9, "b": 0.0},
    }

    TEMPERATURE_PARAMS = {
        "neural_network": 1.4,
        "gnn": 1.6,
    }

    def __init__(self):
        self._platts = {
            name: PlattScaler(**params)
            for name, params in self.PLATT_PARAMS.items()
        }
        self._temps = {
            name: TemperatureScaler(temp)
            for name, temp in self.TEMPERATURE_PARAMS.items()
        }
        self._uncertainty = UncertaintyQuantifier()
        self._agreement = ModelAgreementAnalyzer()
        self._weight_optimizer = EnsembleWeightOptimizer()

    def calibrate_score(self, model_name: str, raw_score: float) -> float:
        """Apply appropriate calibration method for the model."""
        raw_score = max(0.0, min(1.0, raw_score))
        if model_name in self._platts:
            # Convert probability to logit for Platt scaling
            logit = math.log(raw_score / (1 - raw_score + 1e-7) + 1e-7)
            return self._platts[model_name].calibrate(logit)
        elif model_name in self._temps:
            logit = math.log(raw_score / (1 - raw_score + 1e-7) + 1e-7)
            return self._temps[model_name].calibrate(logit)
        return raw_score  # No calibration available

    def compute_ensemble_score(self, model_scores: List[ModelScore]) -> Tuple[float, float]:
        """
        Compute weighted ensemble score and effective weight sum.
        Returns (weighted_score, total_weight).
        """
        if not model_scores:
            return 0.5, 0.0
        total_weight = sum(ms.weight for ms in model_scores)
        if total_weight == 0:
            return float(np.mean([ms.calibrated_score for ms in model_scores])), 0.0
        weighted = sum(ms.calibrated_score * ms.weight for ms in model_scores)
        return weighted / total_weight, total_weight

    def classify_confidence(self, score: float, uncertainty: float) -> ConfidenceLevel:
        """Classify confidence level accounting for uncertainty."""
        # Penalise score by uncertainty
        adjusted = score * (1 - uncertainty * 0.3)
        if adjusted >= 0.90:
            return ConfidenceLevel.VERY_HIGH
        elif adjusted >= 0.75:
            return ConfidenceLevel.HIGH
        elif adjusted >= 0.55:
            return ConfidenceLevel.MEDIUM
        elif adjusted >= 0.35:
            return ConfidenceLevel.LOW
        return ConfidenceLevel.VERY_LOW

    def assess_reliability(self, uncertainty: float, agreement: float,
                            n_models: int) -> Tuple[bool, str]:
        """
        Assess whether the ensemble prediction is reliable.
        Returns (is_reliable, quality_description).
        """
        if n_models < 2:
            return False, "insufficient_models"
        if uncertainty > 0.7:
            return False, "high_uncertainty"
        if agreement < 0.4:
            return False, "low_model_agreement"
        if uncertainty < 0.3 and agreement > 0.7:
            return True, "excellent"
        if uncertainty < 0.5 and agreement > 0.6:
            return True, "good"
        if uncertainty < 0.6 and agreement > 0.5:
            return True, "acceptable"
        return False, "borderline_unreliable"

    def build_explanation(self, result: EnsembleResult) -> str:
        """Build human-readable explanation of the confidence assessment."""
        lines = [
            f"Ensemble score: {result.final_score:.3f} ({result.confidence_level.value} confidence)",
            f"Model agreement: {result.model_agreement:.1%} across {len(result.model_scores)} models",
            f"Uncertainty: {result.uncertainty:.3f} ({'low' if result.uncertainty < 0.3 else 'moderate' if result.uncertainty < 0.6 else 'high'})",
            f"Reliability: {result.calibration_quality}",
        ]
        if result.model_scores:
            top_models = sorted(result.model_scores, key=lambda m: m.weight, reverse=True)[:3]
            lines.append("Top contributing models: " +
                         ", ".join(f"{m.model_name} ({m.calibrated_score:.3f})" for m in top_models))
        return " | ".join(lines)

    def compute_confidence(
        self,
        raw_scores: Dict[str, float],
        custom_weights: Optional[Dict[str, float]] = None,
    ) -> EnsembleResult:
        """
        Main entry point: compute calibrated ensemble confidence from raw model scores.

        Args:
            raw_scores: Dict mapping model_name -> raw probability score [0, 1]
            custom_weights: Optional override weights for this prediction

        Returns:
            EnsembleResult with full confidence analysis
        """
        if not raw_scores:
            return EnsembleResult(
                final_score=0.5, confidence_level=ConfidenceLevel.VERY_LOW,
                weighted_score=0.5, uncertainty=1.0, model_agreement=0.0,
                model_scores=[], explanation="No model scores provided",
                is_reliable=False, calibration_quality="no_data",
            )

        # Determine weights
        base_weights = custom_weights or self.DEFAULT_WEIGHTS
        perf_weights = {
            name: self._weight_optimizer.get_weight(name)
            for name in raw_scores
        }
        # Combine base weights with performance weights
        combined = {
            name: base_weights.get(name, 1.0) * perf_weights.get(name, 1.0)
            for name in raw_scores
        }
        normalised = self._weight_optimizer.normalise_weights(combined)

        # Build ModelScore objects
        model_score_list: List[ModelScore] = []
        for model_name, raw in raw_scores.items():
            calibrated = self.calibrate_score(model_name, raw)
            ms = ModelScore(
                model_name=model_name,
                raw_score=raw,
                calibrated_score=calibrated,
                weight=normalised.get(model_name, 1.0 / len(raw_scores)),
                confidence=1.0 - abs(calibrated - 0.5) * 2,  # Distance from decision boundary
            )
            model_score_list.append(ms)

        # Ensemble aggregation
        weighted_score, _ = self.compute_ensemble_score(model_score_list)
        calibrated_scores = [ms.calibrated_score for ms in model_score_list]

        # Uncertainty
        uncertainty = self._uncertainty.total_uncertainty(calibrated_scores)

        # Model agreement
        agreement = self._agreement.pairwise_agreement(calibrated_scores)

        # Final score: weighted ensemble with slight uncertainty penalty
        final_score = round(weighted_score * (1 - uncertainty * 0.1), 4)
        final_score = max(0.0, min(1.0, final_score))

        # Confidence classification
        confidence_level = self.classify_confidence(final_score, uncertainty)

        # Reliability assessment
        is_reliable, quality = self.assess_reliability(uncertainty, agreement, len(model_score_list))

        result = EnsembleResult(
            final_score=final_score,
            confidence_level=confidence_level,
            weighted_score=round(weighted_score, 4),
            uncertainty=round(uncertainty, 4),
            model_agreement=round(agreement, 4),
            model_scores=model_score_list,
            explanation="",
            is_reliable=is_reliable,
            calibration_quality=quality,
        )
        result.explanation = self.build_explanation(result)
        return result

    def update_model_performance(self, model_name: str, was_correct: bool) -> None:
        """Update model performance history for weight optimisation."""
        self._weight_optimizer.update_performance(model_name, 1.0 if was_correct else 0.0)

    def get_model_weights(self) -> Dict[str, float]:
        """Get current normalised ensemble weights."""
        weights = {name: self._weight_optimizer.get_weight(name)
                   for name in self.DEFAULT_WEIGHTS}
        return self._weight_optimizer.normalise_weights(weights)

    def explain_score(self, score: float) -> str:
        """Provide a plain-language explanation of a fraud score."""
        if score >= 0.90:
            return "Very high fraud probability — immediate review required"
        elif score >= 0.75:
            return "High fraud probability — flag for manual review"
        elif score >= 0.55:
            return "Moderate fraud probability — monitor closely"
        elif score >= 0.35:
            return "Low fraud probability — routine processing"
        else:
            return "Very low fraud probability — likely legitimate claim"
