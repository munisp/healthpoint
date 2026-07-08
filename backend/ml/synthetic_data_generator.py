#!/usr/bin/env python3
"""
HealthPoint Platform — US Healthcare Synthetic Training Data Generator
Generates statistically realistic US healthcare claims, transactions, and
provider/payer interactions for ML model training and validation.

Data distributions are calibrated against:
  • CMS Medicare Fee-for-Service Claims (PUF) 2019–2023
  • HCUP National Inpatient Sample (NIS) 2022
  • FAIR Health Commercial Claims Benchmarks 2023
  • NSA/IDR dispute data (CMS IDR Annual Reports 2022–2024)
  • OIG Work Plan fraud patterns (2022–2024)

All data is synthetic — no real patient or provider information.
"""

from __future__ import annotations

import random
import uuid
import hashlib
import math
import json
import logging
import os
from datetime import datetime, timedelta, date
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum

import numpy as np
import pandas as pd
from scipy import stats

logger = logging.getLogger(__name__)

# ─────────────────────────────── Constants ───────────────────────────────────

# US States with realistic claim volume weights (proportional to population + healthcare utilization)
US_STATES = {
    "CA": 0.12, "TX": 0.09, "FL": 0.08, "NY": 0.07, "PA": 0.05,
    "IL": 0.04, "OH": 0.04, "GA": 0.04, "NC": 0.03, "MI": 0.03,
    "NJ": 0.03, "VA": 0.03, "WA": 0.02, "AZ": 0.02, "MA": 0.02,
    "TN": 0.02, "IN": 0.02, "MO": 0.02, "MD": 0.02, "WI": 0.02,
    "CO": 0.02, "MN": 0.02, "SC": 0.02, "AL": 0.01, "LA": 0.01,
    "KY": 0.01, "OR": 0.01, "OK": 0.01, "CT": 0.01, "UT": 0.01,
    "IA": 0.01, "NV": 0.01, "AR": 0.01, "MS": 0.01, "KS": 0.01,
    "NM": 0.005, "NE": 0.005, "WV": 0.005, "ID": 0.005, "HI": 0.005,
    "NH": 0.005, "ME": 0.005, "MT": 0.005, "RI": 0.005, "DE": 0.005,
    "SD": 0.003, "ND": 0.003, "AK": 0.003, "VT": 0.003, "WY": 0.003,
}

# Provider specialty types with realistic NSA/IDR relevance weights
PROVIDER_SPECIALTIES = {
    "Emergency Medicine": {"weight": 0.15, "avg_charge": 1850, "std_charge": 920, "nsa_rate": 0.72},
    "Anesthesiology": {"weight": 0.12, "avg_charge": 2400, "std_charge": 1100, "nsa_rate": 0.68},
    "Radiology": {"weight": 0.10, "avg_charge": 780, "std_charge": 420, "nsa_rate": 0.61},
    "Pathology": {"weight": 0.06, "avg_charge": 520, "std_charge": 280, "nsa_rate": 0.55},
    "Surgery - General": {"weight": 0.08, "avg_charge": 4200, "std_charge": 2100, "nsa_rate": 0.48},
    "Surgery - Orthopedic": {"weight": 0.07, "avg_charge": 6800, "std_charge": 3200, "nsa_rate": 0.52},
    "Surgery - Cardiovascular": {"weight": 0.05, "avg_charge": 12000, "std_charge": 5500, "nsa_rate": 0.45},
    "Surgery - Neurosurgery": {"weight": 0.04, "avg_charge": 15000, "std_charge": 7000, "nsa_rate": 0.43},
    "Internal Medicine": {"weight": 0.08, "avg_charge": 420, "std_charge": 180, "nsa_rate": 0.12},
    "Hospitalist": {"weight": 0.06, "avg_charge": 680, "std_charge": 290, "nsa_rate": 0.35},
    "Intensivist/Critical Care": {"weight": 0.04, "avg_charge": 3200, "std_charge": 1400, "nsa_rate": 0.58},
    "Neonatology": {"weight": 0.03, "avg_charge": 4800, "std_charge": 2200, "nsa_rate": 0.62},
    "Psychiatry": {"weight": 0.04, "avg_charge": 380, "std_charge": 140, "nsa_rate": 0.08},
    "Oncology": {"weight": 0.04, "avg_charge": 8500, "std_charge": 4200, "nsa_rate": 0.22},
    "Cardiology": {"weight": 0.04, "avg_charge": 2100, "std_charge": 980, "nsa_rate": 0.31},
}

# CPT code ranges by category with realistic charge distributions
CPT_CATEGORIES = {
    "E&M_ED": {
        "codes": ["99281", "99282", "99283", "99284", "99285"],
        "weights": [0.05, 0.10, 0.25, 0.35, 0.25],
        "base_charges": [180, 280, 420, 680, 980],
    },
    "E&M_Inpatient": {
        "codes": ["99221", "99222", "99223", "99231", "99232", "99233"],
        "weights": [0.15, 0.35, 0.50, 0.30, 0.45, 0.25],
        "base_charges": [220, 340, 520, 180, 260, 380],
    },
    "Anesthesia": {
        "codes": ["00100", "00300", "00400", "00500", "00600", "00700", "00800", "00900"],
        "weights": [0.08, 0.12, 0.18, 0.10, 0.15, 0.14, 0.13, 0.10],
        "base_charges": [480, 720, 960, 1200, 1440, 1680, 1920, 2160],
    },
    "Radiology_Diagnostic": {
        "codes": ["70450", "70470", "70553", "71046", "71250", "72148", "73721", "74177"],
        "weights": [0.12, 0.08, 0.06, 0.18, 0.10, 0.14, 0.16, 0.16],
        "base_charges": [280, 380, 620, 180, 420, 520, 480, 580],
    },
    "Surgery_General": {
        "codes": ["27447", "27130", "29881", "43239", "47562", "49505", "27245", "22612"],
        "weights": [0.15, 0.12, 0.10, 0.08, 0.14, 0.12, 0.14, 0.15],
        "base_charges": [6200, 5800, 3400, 2800, 3200, 2600, 4800, 7200],
    },
    "Critical_Care": {
        "codes": ["99291", "99292"],
        "weights": [0.65, 0.35],
        "base_charges": [1200, 600],
    },
    "Lab": {
        "codes": ["80053", "85025", "80061", "83036", "84443", "86592", "87491", "88305"],
        "weights": [0.18, 0.15, 0.12, 0.10, 0.10, 0.08, 0.12, 0.15],
        "base_charges": [48, 28, 62, 38, 52, 42, 68, 88],
    },
}

# ICD-10 diagnosis codes with realistic prevalence (top US inpatient/ED diagnoses)
ICD10_CODES = {
    # Cardiovascular
    "I21.9": {"desc": "Acute MI unspecified", "weight": 0.04, "avg_los": 4.2},
    "I50.9": {"desc": "Heart failure unspecified", "weight": 0.05, "avg_los": 5.1},
    "I10": {"desc": "Essential hypertension", "weight": 0.08, "avg_los": 2.8},
    "I48.91": {"desc": "Unspecified atrial fibrillation", "weight": 0.03, "avg_los": 3.4},
    # Respiratory
    "J18.9": {"desc": "Pneumonia unspecified", "weight": 0.04, "avg_los": 4.8},
    "J44.1": {"desc": "COPD with acute exacerbation", "weight": 0.03, "avg_los": 4.2},
    "J96.00": {"desc": "Acute respiratory failure", "weight": 0.02, "avg_los": 7.6},
    # Musculoskeletal
    "M17.11": {"desc": "Primary osteoarthritis right knee", "weight": 0.04, "avg_los": 2.1},
    "S72.001A": {"desc": "Femur fracture", "weight": 0.02, "avg_los": 5.8},
    "M54.5": {"desc": "Low back pain", "weight": 0.06, "avg_los": 1.8},
    # Neurological
    "I63.9": {"desc": "Cerebral infarction unspecified", "weight": 0.03, "avg_los": 5.2},
    "G40.909": {"desc": "Epilepsy unspecified", "weight": 0.02, "avg_los": 2.4},
    # Metabolic
    "E11.9": {"desc": "Type 2 diabetes without complications", "weight": 0.07, "avg_los": 3.1},
    "E11.65": {"desc": "Type 2 diabetes with hyperglycemia", "weight": 0.03, "avg_los": 3.8},
    "E87.1": {"desc": "Hyponatremia", "weight": 0.02, "avg_los": 3.6},
    # Gastrointestinal
    "K92.1": {"desc": "Melena", "weight": 0.02, "avg_los": 3.9},
    "K57.30": {"desc": "Diverticulosis of large intestine", "weight": 0.02, "avg_los": 3.2},
    "K80.20": {"desc": "Cholelithiasis without obstruction", "weight": 0.03, "avg_los": 2.4},
    # Sepsis
    "A41.9": {"desc": "Sepsis unspecified", "weight": 0.04, "avg_los": 8.4},
    "A41.51": {"desc": "Sepsis due to E. coli", "weight": 0.02, "avg_los": 9.1},
    # Mental Health
    "F32.9": {"desc": "Major depressive disorder single episode", "weight": 0.03, "avg_los": 6.2},
    "F20.9": {"desc": "Schizophrenia unspecified", "weight": 0.02, "avg_los": 8.8},
    # Trauma/ED
    "S09.90XA": {"desc": "Unspecified head injury", "weight": 0.03, "avg_los": 2.1},
    "T14.91": {"desc": "Suicide attempt", "weight": 0.01, "avg_los": 3.4},
    # Obstetric
    "O80": {"desc": "Encounter for full-term uncomplicated delivery", "weight": 0.04, "avg_los": 2.0},
    "O34.21": {"desc": "Maternal care for scar from previous cesarean", "weight": 0.02, "avg_los": 3.2},
}

# Payer types with market share weights
PAYER_TYPES = {
    "Commercial_PPO": {"weight": 0.32, "avg_allowed_pct": 0.42, "std_allowed_pct": 0.12},
    "Commercial_HMO": {"weight": 0.18, "avg_allowed_pct": 0.38, "std_allowed_pct": 0.10},
    "Medicare_FFS": {"weight": 0.22, "avg_allowed_pct": 0.28, "std_allowed_pct": 0.06},
    "Medicare_Advantage": {"weight": 0.12, "avg_allowed_pct": 0.31, "std_allowed_pct": 0.08},
    "Medicaid": {"weight": 0.10, "avg_allowed_pct": 0.22, "std_allowed_pct": 0.07},
    "Self_Pay": {"weight": 0.04, "avg_allowed_pct": 0.55, "std_allowed_pct": 0.20},
    "Workers_Comp": {"weight": 0.02, "avg_allowed_pct": 0.48, "std_allowed_pct": 0.15},
}

# Known OIG fraud patterns for generating labeled fraud cases
FRAUD_PATTERNS = {
    "upcoding": {
        "description": "Billing higher-complexity E&M codes than documented",
        "prevalence": 0.04,
        "amount_multiplier": (1.4, 2.2),
        "indicators": ["high_em_complexity_ratio", "no_documentation_complexity"],
    },
    "unbundling": {
        "description": "Billing separately for services that should be bundled",
        "prevalence": 0.025,
        "amount_multiplier": (1.3, 1.8),
        "indicators": ["multiple_procedure_same_day", "modifier_abuse"],
    },
    "phantom_billing": {
        "description": "Billing for services not rendered",
        "prevalence": 0.015,
        "amount_multiplier": (1.0, 1.0),
        "indicators": ["no_corresponding_facility_record", "patient_denial"],
    },
    "duplicate_billing": {
        "description": "Submitting same claim multiple times",
        "prevalence": 0.03,
        "amount_multiplier": (1.0, 1.0),
        "indicators": ["same_date_same_code_same_patient"],
    },
    "kickback_scheme": {
        "description": "Referral patterns inconsistent with clinical need",
        "prevalence": 0.01,
        "amount_multiplier": (1.5, 3.0),
        "indicators": ["high_referral_concentration", "unusual_referral_network"],
    },
    "medical_necessity": {
        "description": "Services not medically necessary for diagnosis",
        "prevalence": 0.05,
        "amount_multiplier": (1.0, 1.6),
        "indicators": ["diagnosis_procedure_mismatch", "high_frequency_same_procedure"],
    },
    "identity_theft": {
        "description": "Using stolen patient/provider identities",
        "prevalence": 0.005,
        "amount_multiplier": (1.0, 2.5),
        "indicators": ["new_provider_high_volume", "geographic_inconsistency"],
    },
}

# ─────────────────────────────── Data Classes ────────────────────────────────

@dataclass
class SyntheticProvider:
    provider_id: str
    npi: str
    name: str
    specialty: str
    state: str
    city: str
    zip_code: str
    network_status: str  # in_network / out_of_network
    years_in_practice: int
    avg_monthly_claims: int
    fraud_risk_score: float  # 0.0–1.0
    fraud_pattern: Optional[str] = None

@dataclass
class SyntheticPayer:
    payer_id: str
    name: str
    payer_type: str
    state: str
    plan_id: str
    member_count: int
    avg_allowed_pct: float

@dataclass
class SyntheticClaim:
    claim_id: str
    patient_id: str
    provider_id: str
    payer_id: str
    service_date_from: date
    service_date_to: date
    submitted_at: datetime
    billed_amount: float
    allowed_amount: float
    paid_amount: float
    patient_responsibility: float
    diagnosis_codes: List[str]
    procedure_codes: List[str]
    place_of_service: str
    claim_type: str
    is_out_of_network: bool
    is_emergency: bool
    is_fraud: bool
    fraud_pattern: Optional[str]
    fraud_score_label: float  # ground truth for training
    nsa_eligible: bool
    qpa_amount: Optional[float]
    idr_initiated: bool
    state: str
    specialty: str
    # Derived features for ML
    num_diagnosis_codes: int = 0
    num_procedure_codes: int = 0
    service_duration_days: int = 0
    submission_delay_days: int = 0
    billed_to_allowed_ratio: float = 0.0
    provider_90d_avg_amount: float = 0.0
    provider_monthly_claim_count: int = 0

    def __post_init__(self):
        self.num_diagnosis_codes = len(self.diagnosis_codes)
        self.num_procedure_codes = len(self.procedure_codes)
        self.service_duration_days = max(0, (self.service_date_to - self.service_date_from).days)
        self.submission_delay_days = max(0, (self.submitted_at.date() - self.service_date_to).days)
        self.billed_to_allowed_ratio = (
            self.billed_amount / self.allowed_amount if self.allowed_amount > 0 else 1.0
        )

# ─────────────────────────────── Generator ───────────────────────────────────

class USHealthcareSyntheticDataGenerator:
    """
    Generates statistically realistic US healthcare synthetic data for ML training.
    Calibrated against CMS PUF, HCUP NIS, FAIR Health, and OIG fraud patterns.
    """

    def __init__(self, seed: int = 42):
        self.rng = np.random.default_rng(seed)
        random.seed(seed)
        np.random.seed(seed)
        self._providers: List[SyntheticProvider] = []
        self._payers: List[SyntheticPayer] = []
        self._provider_history: Dict[str, List[float]] = {}  # provider_id -> recent claim amounts

    # ── Provider generation ───────────────────────────────────────────────────

    def generate_providers(self, n: int = 500) -> List[SyntheticProvider]:
        """Generate a realistic pool of US healthcare providers."""
        providers = []
        states = list(US_STATES.keys())
        state_weights = list(US_STATES.values())
        specialties = list(PROVIDER_SPECIALTIES.keys())
        specialty_weights = [PROVIDER_SPECIALTIES[s]["weight"] for s in specialties]

        # Normalize weights
        state_weights = np.array(state_weights) / sum(state_weights)
        specialty_weights = np.array(specialty_weights) / sum(specialty_weights)

        # ~15% of providers are out-of-network (NSA context)
        oon_count = int(n * 0.15)

        for i in range(n):
            specialty = self.rng.choice(specialties, p=specialty_weights)
            state = self.rng.choice(states, p=state_weights)
            spec_data = PROVIDER_SPECIALTIES[specialty]

            # Fraud risk: ~8% of providers have elevated fraud risk
            is_fraud_provider = self.rng.random() < 0.08
            fraud_pattern = None
            fraud_risk = float(self.rng.beta(1.5, 10))  # mostly low risk

            if is_fraud_provider:
                fraud_pattern = self.rng.choice(list(FRAUD_PATTERNS.keys()))
                fraud_risk = float(self.rng.beta(5, 3))  # elevated

            # NPI: 10-digit number starting with 1 (individual) or 2 (organization)
            npi_prefix = "1" if self.rng.random() < 0.6 else "2"
            npi = npi_prefix + "".join([str(self.rng.integers(0, 10)) for _ in range(9)])

            # City/ZIP by state (simplified)
            city = self._get_city_for_state(state)
            zip_code = self._get_zip_for_state(state)

            provider = SyntheticProvider(
                provider_id=str(uuid.uuid4()),
                npi=npi,
                name=self._generate_provider_name(specialty),
                specialty=specialty,
                state=state,
                city=city,
                zip_code=zip_code,
                network_status="out_of_network" if i < oon_count else "in_network",
                years_in_practice=int(self.rng.integers(1, 35)),
                avg_monthly_claims=int(self.rng.integers(20, 400)),
                fraud_risk_score=round(fraud_risk, 4),
                fraud_pattern=fraud_pattern,
            )
            providers.append(provider)
            self._provider_history[provider.provider_id] = []

        self._providers = providers
        return providers

    def generate_payers(self, n: int = 50) -> List[SyntheticPayer]:
        """Generate a realistic pool of US health insurance payers."""
        payers = []
        payer_types = list(PAYER_TYPES.keys())
        payer_weights = [PAYER_TYPES[p]["weight"] for p in payer_types]
        payer_weights = np.array(payer_weights) / sum(payer_weights)

        states = list(US_STATES.keys())
        state_weights = np.array(list(US_STATES.values()))
        state_weights = state_weights / state_weights.sum()

        for i in range(n):
            payer_type = self.rng.choice(payer_types, p=payer_weights)
            pt_data = PAYER_TYPES[payer_type]
            state = self.rng.choice(states, p=state_weights)

            allowed_pct = float(self.rng.normal(pt_data["avg_allowed_pct"], pt_data["std_allowed_pct"]))
            allowed_pct = max(0.15, min(0.85, allowed_pct))

            plan_id = f"{self.rng.integers(10000, 99999)}{self.rng.choice(['A', 'B', 'C', 'D', 'E'])}{self.rng.integers(10, 99)}"

            payer = SyntheticPayer(
                payer_id=str(uuid.uuid4()),
                name=self._generate_payer_name(payer_type),
                payer_type=payer_type,
                state=state,
                plan_id=plan_id,
                member_count=int(self.rng.integers(5_000, 2_000_000)),
                avg_allowed_pct=round(allowed_pct, 4),
            )
            payers.append(payer)

        self._payers = payers
        return payers

    # ── Claim generation ──────────────────────────────────────────────────────

    def generate_claims(
        self,
        n: int = 100_000,
        start_date: date = date(2022, 1, 1),
        end_date: date = date(2024, 12, 31),
        fraud_rate: float = 0.06,
    ) -> pd.DataFrame:
        """
        Generate n synthetic US healthcare claims with realistic distributions.
        fraud_rate: fraction of claims that are fraudulent (OIG estimates ~3–10%).
        """
        if not self._providers:
            self.generate_providers(500)
        if not self._payers:
            self.generate_payers(50)

        claims = []
        date_range_days = (end_date - start_date).days

        # Pre-compute provider claim history for anomaly features
        provider_amounts: Dict[str, List[float]] = {p.provider_id: [] for p in self._providers}

        for i in range(n):
            # Select provider (weighted by avg_monthly_claims)
            provider = self._select_provider_weighted()
            payer = self._payers[int(self.rng.integers(0, len(self._payers)))]
            spec_data = PROVIDER_SPECIALTIES[provider.specialty]

            # Service date
            service_start_offset = int(self.rng.integers(0, date_range_days - 30))
            service_date_from = start_date + timedelta(days=service_start_offset)

            # Length of stay / service duration
            primary_dx = self.rng.choice(list(ICD10_CODES.keys()))
            avg_los = ICD10_CODES[primary_dx]["avg_los"]
            los = max(0, int(self.rng.poisson(avg_los)))
            service_date_to = service_date_from + timedelta(days=los)

            # Submission delay: 1–90 days, log-normal (most submit within 30 days)
            submission_delay = int(max(1, self.rng.lognormal(2.5, 0.8)))
            submission_delay = min(submission_delay, 180)
            submitted_at = datetime.combine(
                service_date_to + timedelta(days=submission_delay),
                datetime.min.time(),
            ).replace(
                hour=int(self.rng.integers(7, 18)),
                minute=int(self.rng.integers(0, 59)),
            )

            # Procedure codes
            procedure_codes, cpt_charges = self._select_procedure_codes(provider.specialty)

            # Diagnosis codes (1–6 codes, first is primary)
            n_dx = int(self.rng.choice([1, 2, 3, 4, 5, 6], p=[0.20, 0.30, 0.25, 0.15, 0.07, 0.03]))
            dx_codes = [primary_dx]
            all_dx = list(ICD10_CODES.keys())
            for _ in range(n_dx - 1):
                dx_codes.append(self.rng.choice(all_dx))

            # Billed amount: sum of CPT charges with provider-specific markup
            base_charge = sum(cpt_charges)
            # Providers charge 2–8x Medicare rates (realistic US chargemaster)
            markup = float(self.rng.uniform(2.0, 8.0))
            billed_amount = round(base_charge * markup, 2)

            # Allowed amount: payer-specific percentage of billed
            allowed_pct = payer.avg_allowed_pct * float(self.rng.normal(1.0, 0.15))
            allowed_pct = max(0.10, min(0.90, allowed_pct))
            allowed_amount = round(billed_amount * allowed_pct, 2)

            # Patient responsibility: deductible + coinsurance
            coinsurance_rate = float(self.rng.choice([0.10, 0.20, 0.30], p=[0.40, 0.45, 0.15]))
            deductible_applied = float(self.rng.uniform(0, min(500, allowed_amount * 0.3)))
            patient_responsibility = round(
                deductible_applied + (allowed_amount - deductible_applied) * coinsurance_rate, 2
            )
            paid_amount = round(allowed_amount - patient_responsibility, 2)

            # NSA eligibility: out-of-network + (emergency or ancillary at in-network facility)
            is_oon = provider.network_status == "out_of_network"
            is_emergency = provider.specialty == "Emergency Medicine" or self.rng.random() < 0.05
            nsa_eligible = is_oon and (is_emergency or provider.specialty in (
                "Anesthesiology", "Radiology", "Pathology", "Intensivist/Critical Care", "Neonatology"
            ))

            # QPA: 50th percentile of in-network rates for specialty/geography
            qpa_amount = None
            if nsa_eligible:
                qpa_amount = round(allowed_amount * float(self.rng.uniform(0.55, 0.75)), 2)

            # IDR: ~18% of NSA-eligible disputes go to IDR (per CMS 2023 report)
            idr_initiated = nsa_eligible and self.rng.random() < 0.18

            # Fraud determination
            is_fraud = False
            fraud_pattern_applied = None
            fraud_score_label = float(self.rng.beta(1.2, 12))  # baseline low fraud score

            if provider.fraud_pattern and self.rng.random() < 0.35:
                # Provider with known fraud pattern — apply it
                is_fraud = True
                fraud_pattern_applied = provider.fraud_pattern
                fp_data = FRAUD_PATTERNS[fraud_pattern_applied]
                mult_low, mult_high = fp_data["amount_multiplier"]
                billed_amount = round(billed_amount * float(self.rng.uniform(mult_low, mult_high)), 2)
                fraud_score_label = float(self.rng.beta(8, 2))  # high fraud score
            elif self.rng.random() < fraud_rate * 0.3:
                # Random fraud (not provider-specific pattern)
                is_fraud = True
                fraud_pattern_applied = self.rng.choice(list(FRAUD_PATTERNS.keys()))
                fraud_score_label = float(self.rng.beta(6, 3))

            # Update provider history for anomaly features
            provider_amounts[provider.provider_id].append(billed_amount)
            recent = provider_amounts[provider.provider_id][-90:]
            provider_90d_avg = float(np.mean(recent)) if recent else billed_amount

            claim = SyntheticClaim(
                claim_id=str(uuid.uuid4()),
                patient_id=str(uuid.uuid4()),
                provider_id=provider.provider_id,
                payer_id=payer.payer_id,
                service_date_from=service_date_from,
                service_date_to=service_date_to,
                submitted_at=submitted_at,
                billed_amount=billed_amount,
                allowed_amount=allowed_amount,
                paid_amount=paid_amount,
                patient_responsibility=patient_responsibility,
                diagnosis_codes=dx_codes,
                procedure_codes=procedure_codes,
                place_of_service=self._get_place_of_service(provider.specialty, is_emergency),
                claim_type=self._get_claim_type(provider.specialty),
                is_out_of_network=is_oon,
                is_emergency=is_emergency,
                is_fraud=is_fraud,
                fraud_pattern=fraud_pattern_applied,
                fraud_score_label=round(fraud_score_label, 4),
                nsa_eligible=nsa_eligible,
                qpa_amount=qpa_amount,
                idr_initiated=idr_initiated,
                state=provider.state,
                specialty=provider.specialty,
                provider_90d_avg_amount=round(provider_90d_avg, 2),
                provider_monthly_claim_count=provider.avg_monthly_claims,
            )
            claims.append(asdict(claim))

        df = pd.DataFrame(claims)
        # Convert date objects to strings for serialization
        df["service_date_from"] = pd.to_datetime(df["service_date_from"])
        df["service_date_to"] = pd.to_datetime(df["service_date_to"])
        df["submitted_at"] = pd.to_datetime(df["submitted_at"])
        logger.info(
            "Generated %d synthetic claims: %.1f%% fraud, %.1f%% NSA-eligible, %.1f%% IDR",
            n,
            df["is_fraud"].mean() * 100,
            df["nsa_eligible"].mean() * 100,
            df["idr_initiated"].mean() * 100,
        )
        return df

    def generate_idr_disputes(self, n: int = 10_000) -> pd.DataFrame:
        """
        Generate synthetic IDR dispute records calibrated against
        CMS IDR Annual Report 2023 (288,000+ disputes in first year).
        """
        if not self._providers:
            self.generate_providers(200)
        if not self._payers:
            self.generate_payers(30)

        records = []
        specialties = list(PROVIDER_SPECIALTIES.keys())
        specialty_weights = np.array([PROVIDER_SPECIALTIES[s]["weight"] for s in specialties])
        specialty_weights = specialty_weights / specialty_weights.sum()

        # NSA-eligible specialties only
        nsa_specialties = ["Emergency Medicine", "Anesthesiology", "Radiology",
                           "Pathology", "Intensivist/Critical Care", "Neonatology"]

        for i in range(n):
            specialty = self.rng.choice(nsa_specialties)
            spec_data = PROVIDER_SPECIALTIES[specialty]
            state = self.rng.choice(list(US_STATES.keys()),
                                    p=np.array(list(US_STATES.values())) / sum(US_STATES.values()))

            billed = round(float(self.rng.lognormal(
                math.log(spec_data["avg_charge"]), 0.6
            )), 2)

            # QPA: typically 40–65% of billed
            qpa_pct = float(self.rng.uniform(0.35, 0.65))
            qpa = round(billed * qpa_pct, 2)

            # Provider offer: typically 70–95% of billed
            provider_offer_pct = float(self.rng.uniform(0.65, 0.95))
            provider_offer = round(billed * provider_offer_pct, 2)

            # Plan offer: typically 45–75% of billed
            plan_offer_pct = float(self.rng.uniform(0.40, 0.75))
            plan_offer = round(billed * plan_offer_pct, 2)

            # IDR outcome: per CMS 2023, ~71% of decisions favor providers
            provider_wins = self.rng.random() < 0.71
            if provider_wins:
                final_payment = round(provider_offer * float(self.rng.uniform(0.85, 1.0)), 2)
                outcome = "provider_prevailed"
            else:
                final_payment = round(plan_offer * float(self.rng.uniform(1.0, 1.15)), 2)
                outcome = "plan_prevailed"

            # Timeline
            dispute_date = date(2022, 1, 1) + timedelta(days=int(self.rng.integers(0, 730)))
            open_neg_days = int(self.rng.integers(25, 35))  # NSA: 30 business days
            idr_initiation_days = int(self.rng.integers(1, 5))
            decision_days = int(self.rng.integers(25, 35))  # NSA: 30 business days

            records.append({
                "dispute_id": str(uuid.uuid4()),
                "specialty": specialty,
                "state": state,
                "billed_amount": billed,
                "qpa_amount": qpa,
                "provider_final_offer": provider_offer,
                "plan_final_offer": plan_offer,
                "final_payment": final_payment,
                "outcome": outcome,
                "dispute_date": dispute_date,
                "open_neg_days": open_neg_days,
                "idr_initiation_days": idr_initiation_days,
                "decision_days": decision_days,
                "total_resolution_days": open_neg_days + idr_initiation_days + decision_days,
                "provider_offer_vs_qpa_ratio": round(provider_offer / qpa if qpa > 0 else 1.0, 4),
                "plan_offer_vs_qpa_ratio": round(plan_offer / qpa if qpa > 0 else 1.0, 4),
                "billed_to_qpa_ratio": round(billed / qpa if qpa > 0 else 1.0, 4),
                "is_batched": self.rng.random() < 0.12,  # ~12% batched disputes
                "is_air_ambulance": specialty == "Emergency Medicine" and self.rng.random() < 0.08,
            })

        df = pd.DataFrame(records)
        logger.info("Generated %d synthetic IDR disputes: %.1f%% provider wins", n,
                    (df["outcome"] == "provider_prevailed").mean() * 100)
        return df

    def generate_credit_scoring_data(self, n: int = 50_000) -> pd.DataFrame:
        """
        Generate synthetic provider credit/payment risk data for credit scoring DNN.
        Represents provider payment reliability for the per-provider billing service.
        """
        records = []
        for i in range(n):
            specialty = self.rng.choice(list(PROVIDER_SPECIALTIES.keys()))
            state = self.rng.choice(list(US_STATES.keys()),
                                    p=np.array(list(US_STATES.values())) / sum(US_STATES.values()))

            years_practice = int(self.rng.integers(1, 40))
            monthly_volume = int(self.rng.lognormal(4.5, 0.8))
            avg_claim_amount = float(self.rng.lognormal(
                math.log(PROVIDER_SPECIALTIES[specialty]["avg_charge"]), 0.5
            ))

            # Payment history features
            on_time_payment_rate = float(self.rng.beta(8, 2))  # mostly good
            late_payment_count_12m = int(self.rng.poisson(on_time_payment_rate * 2))
            dispute_rate = float(self.rng.beta(2, 15))
            chargeback_count_12m = int(self.rng.poisson(dispute_rate * 3))
            days_to_pay_avg = float(self.rng.lognormal(2.8, 0.6))

            # Financial stability indicators
            practice_size = self.rng.choice(["solo", "small_group", "large_group", "hospital_employed"],
                                             p=[0.25, 0.35, 0.25, 0.15])
            ehr_adoption = self.rng.random() < 0.82  # 82% EHR adoption (ONC 2023)
            accepts_medicare = self.rng.random() < 0.92
            accepts_medicaid = self.rng.random() < 0.71

            # Credit risk label: 0=low risk, 1=medium risk, 2=high risk
            risk_score = (
                (1 - on_time_payment_rate) * 0.35
                + min(late_payment_count_12m / 12, 1.0) * 0.25
                + dispute_rate * 0.20
                + min(chargeback_count_12m / 6, 1.0) * 0.20
            )
            if risk_score < 0.25:
                risk_label = 0
            elif risk_score < 0.55:
                risk_label = 1
            else:
                risk_label = 2

            records.append({
                "provider_id": str(uuid.uuid4()),
                "specialty": specialty,
                "state": state,
                "years_practice": years_practice,
                "monthly_volume": monthly_volume,
                "avg_claim_amount": round(avg_claim_amount, 2),
                "on_time_payment_rate": round(on_time_payment_rate, 4),
                "late_payment_count_12m": late_payment_count_12m,
                "dispute_rate": round(dispute_rate, 4),
                "chargeback_count_12m": chargeback_count_12m,
                "days_to_pay_avg": round(days_to_pay_avg, 1),
                "practice_size": practice_size,
                "ehr_adoption": int(ehr_adoption),
                "accepts_medicare": int(accepts_medicare),
                "accepts_medicaid": int(accepts_medicaid),
                "risk_score": round(risk_score, 4),
                "risk_label": risk_label,
            })

        df = pd.DataFrame(records)
        logger.info("Generated %d credit scoring records: risk distribution %s",
                    n, df["risk_label"].value_counts().to_dict())
        return df

    def generate_transaction_graph(self, claims_df: pd.DataFrame) -> Dict[str, Any]:
        """
        Build a provider-patient-payer transaction graph for GNN training.
        Returns node features and edge index tensors (PyTorch Geometric format).
        """
        # Nodes: providers + payers (patients are edges)
        provider_ids = claims_df["provider_id"].unique().tolist()
        payer_ids = claims_df["payer_id"].unique().tolist()

        node_id_map = {}
        node_features = []
        node_labels = []  # fraud label per node

        # Provider nodes
        for pid in provider_ids:
            node_id_map[pid] = len(node_features)
            provider_claims = claims_df[claims_df["provider_id"] == pid]
            features = [
                float(provider_claims["billed_amount"].mean()),
                float(provider_claims["billed_to_allowed_ratio"].mean()),
                float(provider_claims["is_fraud"].mean()),
                float(provider_claims["submission_delay_days"].mean()),
                float(provider_claims["num_procedure_codes"].mean()),
                float(provider_claims["num_diagnosis_codes"].mean()),
                float(len(provider_claims)),
                float(provider_claims["is_out_of_network"].mean()),
                float(provider_claims["nsa_eligible"].mean()),
                float(provider_claims["idr_initiated"].mean()),
            ]
            node_features.append(features)
            node_labels.append(float(provider_claims["is_fraud"].mean() > 0.1))

        # Payer nodes
        for pay_id in payer_ids:
            node_id_map[pay_id] = len(node_features)
            payer_claims = claims_df[claims_df["payer_id"] == pay_id]
            features = [
                float(payer_claims["allowed_amount"].mean()),
                float(payer_claims["billed_to_allowed_ratio"].mean()),
                0.0,  # payers don't have fraud label
                float(payer_claims["submission_delay_days"].mean()),
                float(payer_claims["num_procedure_codes"].mean()),
                float(payer_claims["num_diagnosis_codes"].mean()),
                float(len(payer_claims)),
                0.0,
                float(payer_claims["nsa_eligible"].mean()),
                float(payer_claims["idr_initiated"].mean()),
            ]
            node_features.append(features)
            node_labels.append(0.0)

        # Edges: provider → payer (connected by claim)
        edge_index_src = []
        edge_index_dst = []
        edge_features = []

        for _, row in claims_df.iterrows():
            src = node_id_map.get(row["provider_id"])
            dst = node_id_map.get(row["payer_id"])
            if src is not None and dst is not None:
                edge_index_src.append(src)
                edge_index_dst.append(dst)
                edge_features.append([
                    row["billed_amount"],
                    row["allowed_amount"],
                    float(row["is_fraud"]),
                    float(row["is_out_of_network"]),
                    float(row["nsa_eligible"]),
                ])
                # Add reverse edge (undirected graph)
                edge_index_src.append(dst)
                edge_index_dst.append(src)
                edge_features.append([
                    row["billed_amount"],
                    row["allowed_amount"],
                    float(row["is_fraud"]),
                    float(row["is_out_of_network"]),
                    float(row["nsa_eligible"]),
                ])

        return {
            "node_features": node_features,
            "node_labels": node_labels,
            "edge_index": [edge_index_src, edge_index_dst],
            "edge_features": edge_features,
            "node_id_map": node_id_map,
            "num_nodes": len(node_features),
            "num_edges": len(edge_index_src),
        }

    # ── Helper methods ────────────────────────────────────────────────────────

    def _select_provider_weighted(self) -> SyntheticProvider:
        weights = np.array([p.avg_monthly_claims for p in self._providers], dtype=float)
        weights = weights / weights.sum()
        idx = int(self.rng.choice(len(self._providers), p=weights))
        return self._providers[idx]

    def _select_procedure_codes(self, specialty: str) -> Tuple[List[str], List[float]]:
        """Select 1–4 CPT codes appropriate for the specialty."""
        specialty_to_cpt = {
            "Emergency Medicine": "E&M_ED",
            "Internal Medicine": "E&M_Inpatient",
            "Hospitalist": "E&M_Inpatient",
            "Anesthesiology": "Anesthesia",
            "Radiology": "Radiology_Diagnostic",
            "Pathology": "Lab",
            "Surgery - General": "Surgery_General",
            "Surgery - Orthopedic": "Surgery_General",
            "Surgery - Cardiovascular": "Surgery_General",
            "Surgery - Neurosurgery": "Surgery_General",
            "Intensivist/Critical Care": "Critical_Care",
            "Neonatology": "Critical_Care",
        }
        category = specialty_to_cpt.get(specialty, "E&M_Inpatient")
        cpt_data = CPT_CATEGORIES[category]

        n_codes = int(self.rng.choice([1, 2, 3, 4], p=[0.55, 0.25, 0.12, 0.08]))
        codes = []
        charges = []
        for _ in range(n_codes):
            weights = np.array(cpt_data["weights"]) / sum(cpt_data["weights"])
            idx = int(self.rng.choice(len(cpt_data["codes"]), p=weights))
            codes.append(cpt_data["codes"][idx])
            base = cpt_data["base_charges"][idx]
            charge = float(self.rng.normal(base, base * 0.15))
            charges.append(max(10.0, charge))

        return codes, charges

    def _get_place_of_service(self, specialty: str, is_emergency: bool) -> str:
        if is_emergency or specialty == "Emergency Medicine":
            return "23"  # Emergency Room - Hospital
        if specialty in ("Intensivist/Critical Care", "Neonatology", "Hospitalist"):
            return "21"  # Inpatient Hospital
        if specialty in ("Anesthesiology", "Surgery - General", "Surgery - Orthopedic",
                         "Surgery - Cardiovascular", "Surgery - Neurosurgery"):
            return "22"  # Outpatient Hospital
        if specialty == "Radiology":
            return self.rng.choice(["22", "11", "19"], p=[0.5, 0.3, 0.2])
        if specialty == "Pathology":
            return "81"  # Independent Laboratory
        return "11"  # Office

    def _get_claim_type(self, specialty: str) -> str:
        if specialty in ("Intensivist/Critical Care", "Neonatology", "Hospitalist"):
            return "institutional"
        return "professional"

    def _generate_provider_name(self, specialty: str) -> str:
        first_names = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer",
                       "Michael", "Linda", "William", "Barbara", "David", "Susan"]
        last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia",
                      "Miller", "Davis", "Wilson", "Anderson", "Taylor", "Thomas",
                      "Jackson", "White", "Harris", "Martin", "Thompson", "Moore"]
        suffix = self.rng.choice(["MD", "DO", "MD PhD", "MD FACS", "MD FACC"], p=[0.55, 0.20, 0.10, 0.08, 0.07])
        first = self.rng.choice(first_names)
        last = self.rng.choice(last_names)
        return f"Dr. {first} {last}, {suffix}"

    def _generate_payer_name(self, payer_type: str) -> str:
        prefixes = ["United", "Aetna", "Cigna", "Humana", "Anthem", "BlueCross",
                    "Centene", "Molina", "WellCare", "CVS Health", "Elevance"]
        suffixes = {
            "Commercial_PPO": "Health PPO",
            "Commercial_HMO": "Health HMO",
            "Medicare_FFS": "Medicare",
            "Medicare_Advantage": "Medicare Advantage",
            "Medicaid": "Medicaid",
            "Self_Pay": "Self-Pay",
            "Workers_Comp": "Workers Compensation",
        }
        prefix = self.rng.choice(prefixes)
        suffix = suffixes.get(payer_type, "Health Plan")
        return f"{prefix} {suffix}"

    def _get_city_for_state(self, state: str) -> str:
        state_cities = {
            "CA": ["Los Angeles", "San Francisco", "San Diego", "Sacramento"],
            "TX": ["Houston", "Dallas", "Austin", "San Antonio"],
            "FL": ["Miami", "Orlando", "Tampa", "Jacksonville"],
            "NY": ["New York City", "Buffalo", "Albany", "Rochester"],
            "PA": ["Philadelphia", "Pittsburgh", "Allentown", "Erie"],
        }
        cities = state_cities.get(state, [f"{state} City", f"North {state}", f"South {state}"])
        return self.rng.choice(cities)

    def _get_zip_for_state(self, state: str) -> str:
        state_zip_prefixes = {
            "CA": ["900", "910", "920", "930", "940", "950"],
            "TX": ["750", "760", "770", "780", "790"],
            "FL": ["320", "330", "340"],
            "NY": ["100", "110", "120", "130"],
            "PA": ["150", "160", "170", "180", "190"],
        }
        prefixes = state_zip_prefixes.get(state, ["500"])
        prefix = self.rng.choice(prefixes)
        return prefix + "".join([str(self.rng.integers(0, 10)) for _ in range(2)])

    def get_feature_columns(self) -> List[str]:
        """Return the feature column names used for ML training."""
        return [
            "billed_amount", "allowed_amount", "paid_amount", "patient_responsibility",
            "num_diagnosis_codes", "num_procedure_codes", "service_duration_days",
            "submission_delay_days", "billed_to_allowed_ratio",
            "provider_90d_avg_amount", "provider_monthly_claim_count",
            "is_out_of_network", "is_emergency", "nsa_eligible",
        ]

    def get_fraud_feature_columns(self) -> List[str]:
        """Feature columns specifically for fraud detection."""
        return self.get_feature_columns() + [
            "idr_initiated", "qpa_amount",
        ]

    def get_idr_feature_columns(self) -> List[str]:
        """Feature columns for IDR outcome prediction."""
        return [
            "billed_amount", "qpa_amount", "provider_final_offer", "plan_final_offer",
            "provider_offer_vs_qpa_ratio", "plan_offer_vs_qpa_ratio",
            "billed_to_qpa_ratio", "open_neg_days", "is_batched", "is_air_ambulance",
        ]


# ─────────────────────────── Module-level convenience ────────────────────────

_default_generator: Optional[USHealthcareSyntheticDataGenerator] = None


def get_generator(seed: int = 42) -> USHealthcareSyntheticDataGenerator:
    global _default_generator
    if _default_generator is None:
        _default_generator = USHealthcareSyntheticDataGenerator(seed=seed)
    return _default_generator


def generate_fraud_training_data(
    n_claims: int = 100_000,
    fraud_rate: float = 0.06,
    seed: int = 42,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Generate train/test split for fraud detection model.
    Returns (train_df, test_df).
    """
    gen = get_generator(seed)
    gen.generate_providers(500)
    gen.generate_payers(50)
    df = gen.generate_claims(n=n_claims, fraud_rate=fraud_rate)

    # 80/20 split, stratified by fraud label
    from sklearn.model_selection import train_test_split
    train_df, test_df = train_test_split(
        df, test_size=0.2, random_state=seed, stratify=df["is_fraud"]
    )
    return train_df.reset_index(drop=True), test_df.reset_index(drop=True)


def generate_idr_training_data(
    n_disputes: int = 50_000,
    seed: int = 42,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Generate train/test split for IDR outcome prediction."""
    gen = get_generator(seed)
    gen.generate_providers(200)
    gen.generate_payers(30)
    df = gen.generate_idr_disputes(n=n_disputes)

    from sklearn.model_selection import train_test_split
    train_df, test_df = train_test_split(
        df, test_size=0.2, random_state=seed,
        stratify=(df["outcome"] == "provider_prevailed").astype(int)
    )
    return train_df.reset_index(drop=True), test_df.reset_index(drop=True)


def generate_credit_training_data(
    n_records: int = 50_000,
    seed: int = 42,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Generate train/test split for credit scoring model."""
    gen = get_generator(seed)
    df = gen.generate_credit_scoring_data(n=n_records)

    from sklearn.model_selection import train_test_split
    train_df, test_df = train_test_split(
        df, test_size=0.2, random_state=seed, stratify=df["risk_label"]
    )
    return train_df.reset_index(drop=True), test_df.reset_index(drop=True)
