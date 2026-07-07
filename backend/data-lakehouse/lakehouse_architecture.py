"""
HealthPoint Enhanced IDR Platform - Data Lakehouse Architecture
Comprehensive data lakehouse implementation for massive IDR data processing and analytics
"""

import os
import json
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import asyncio
import aiofiles
from pathlib import Path
import logging
from dataclasses import dataclass
from enum import Enum

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DataLayer(Enum):
    """Data lakehouse layers following medallion architecture"""
    BRONZE = "bronze"  # Raw data ingestion
    SILVER = "silver"  # Cleaned and validated data
    GOLD = "gold"     # Business-ready aggregated data
    PLATINUM = "platinum"  # ML-ready features and models

@dataclass
class LakehouseConfig:
    """Configuration for the data lakehouse"""
    base_path: str = "/data/lakehouse"
    bronze_path: str = "/data/lakehouse/bronze"
    silver_path: str = "/data/lakehouse/silver"
    gold_path: str = "/data/lakehouse/gold"
    platinum_path: str = "/data/lakehouse/platinum"
    partition_columns: List[str] = None
    compression: str = "snappy"
    file_format: str = "parquet"
    
    def __post_init__(self):
        if self.partition_columns is None:
            self.partition_columns = ["year", "month", "day"]

class HealthPointDataLakehouse:
    """
    Comprehensive data lakehouse for HealthPoint Enhanced IDR Platform
    Handles massive IDR data volumes with Georgetown research integration
    """
    
    def __init__(self, config: LakehouseConfig = None):
        self.config = config or LakehouseConfig()
        self.setup_directories()
        
    def setup_directories(self):
        """Create lakehouse directory structure"""
        directories = [
            self.config.bronze_path,
            self.config.silver_path,
            self.config.gold_path,
            self.config.platinum_path
        ]
        
        for directory in directories:
            Path(directory).mkdir(parents=True, exist_ok=True)
            
        # Create subdirectories for different data domains
        data_domains = [
            "idr_disputes",
            "georgetown_research",
            "health_affairs_data",
            "cms_puf_data",
            "provider_data",
            "payer_data",
            "entity_performance",
            "market_intelligence",
            "ai_predictions",
            "audit_logs"
        ]
        
        for layer in DataLayer:
            layer_path = getattr(self.config, f"{layer.value}_path")
            for domain in data_domains:
                Path(f"{layer_path}/{domain}").mkdir(parents=True, exist_ok=True)
    
    async def ingest_bronze_data(self, data: Dict[str, Any], domain: str, source: str) -> str:
        """
        Ingest raw data into bronze layer
        
        Args:
            data: Raw data dictionary
            domain: Data domain (e.g., 'idr_disputes', 'georgetown_research')
            source: Data source identifier
            
        Returns:
            Path to ingested data file
        """
        timestamp = datetime.now()
        partition_path = f"year={timestamp.year}/month={timestamp.month:02d}/day={timestamp.day:02d}"
        
        file_path = (
            f"{self.config.bronze_path}/{domain}/{partition_path}/"
            f"{source}_{timestamp.strftime('%Y%m%d_%H%M%S')}.parquet"
        )
        
        # Ensure directory exists
        Path(file_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Add metadata
        enriched_data = {
            **data,
            "_ingestion_timestamp": timestamp.isoformat(),
            "_source": source,
            "_domain": domain,
            "_layer": "bronze"
        }
        
        # Convert to DataFrame and save as Parquet
        df = pd.DataFrame([enriched_data] if isinstance(data, dict) else data)
        df.to_parquet(file_path, compression=self.config.compression)
        
        logger.info(f"Ingested bronze data: {file_path}")
        return file_path
    
    async def process_silver_data(self, bronze_path: str, domain: str) -> str:
        """
        Process bronze data into silver layer with cleaning and validation
        
        Args:
            bronze_path: Path to bronze data
            domain: Data domain
            
        Returns:
            Path to processed silver data
        """
        # Read bronze data
        df = pd.read_parquet(bronze_path)
        
        # Apply domain-specific cleaning and validation
        if domain == "idr_disputes":
            df = self._clean_idr_disputes(df)
        elif domain == "georgetown_research":
            df = self._clean_georgetown_data(df)
        elif domain == "cms_puf_data":
            df = self._clean_cms_puf_data(df)
        elif domain == "health_affairs_data":
            df = self._clean_health_affairs_data(df)
        
        # Add silver layer metadata
        df["_processing_timestamp"] = datetime.now().isoformat()
        df["_layer"] = "silver"
        df["_quality_score"] = self._calculate_quality_score(df)
        
        # Generate silver path
        timestamp = datetime.now()
        partition_path = f"year={timestamp.year}/month={timestamp.month:02d}/day={timestamp.day:02d}"
        silver_path = (
            f"{self.config.silver_path}/{domain}/{partition_path}/"
            f"processed_{timestamp.strftime('%Y%m%d_%H%M%S')}.parquet"
        )
        
        # Ensure directory exists
        Path(silver_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Save processed data
        df.to_parquet(silver_path, compression=self.config.compression)
        
        logger.info(f"Processed silver data: {silver_path}")
        return silver_path
    
    async def aggregate_gold_data(self, silver_paths: List[str], domain: str, aggregation_type: str) -> str:
        """
        Aggregate silver data into gold layer for business analytics
        
        Args:
            silver_paths: List of silver data paths
            domain: Data domain
            aggregation_type: Type of aggregation (daily, weekly, monthly)
            
        Returns:
            Path to gold aggregated data
        """
        # Read and combine silver data
        dfs = [pd.read_parquet(path) for path in silver_paths]
        combined_df = pd.concat(dfs, ignore_index=True)
        
        # Apply domain-specific aggregations
        if domain == "idr_disputes":
            aggregated_df = self._aggregate_idr_disputes(combined_df, aggregation_type)
        elif domain == "georgetown_research":
            aggregated_df = self._aggregate_georgetown_insights(combined_df, aggregation_type)
        elif domain == "entity_performance":
            aggregated_df = self._aggregate_entity_performance(combined_df, aggregation_type)
        elif domain == "market_intelligence":
            aggregated_df = self._aggregate_market_intelligence(combined_df, aggregation_type)
        else:
            aggregated_df = self._default_aggregation(combined_df, aggregation_type)
        
        # Add gold layer metadata
        aggregated_df["_aggregation_timestamp"] = datetime.now().isoformat()
        aggregated_df["_layer"] = "gold"
        aggregated_df["_aggregation_type"] = aggregation_type
        
        # Generate gold path
        timestamp = datetime.now()
        gold_path = (
            f"{self.config.gold_path}/{domain}/"
            f"{aggregation_type}_{timestamp.strftime('%Y%m%d_%H%M%S')}.parquet"
        )
        
        # Ensure directory exists
        Path(gold_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Save aggregated data
        aggregated_df.to_parquet(gold_path, compression=self.config.compression)
        
        logger.info(f"Aggregated gold data: {gold_path}")
        return gold_path
    
    async def create_platinum_features(self, gold_paths: List[str], domain: str, feature_type: str) -> str:
        """
        Create ML-ready features in platinum layer
        
        Args:
            gold_paths: List of gold data paths
            domain: Data domain
            feature_type: Type of features (georgetown_enhanced, proprietary_intelligence, ai_mcmc)
            
        Returns:
            Path to platinum feature data
        """
        # Read and combine gold data
        dfs = [pd.read_parquet(path) for path in gold_paths]
        combined_df = pd.concat(dfs, ignore_index=True)
        
        # Create domain and feature-specific ML features
        if feature_type == "georgetown_enhanced":
            features_df = self._create_georgetown_features(combined_df)
        elif feature_type == "proprietary_intelligence":
            features_df = self._create_proprietary_features(combined_df)
        elif feature_type == "ai_mcmc":
            features_df = self._create_ai_mcmc_features(combined_df)
        elif feature_type == "multi_approach":
            features_df = self._create_multi_approach_features(combined_df)
        else:
            features_df = self._create_default_features(combined_df)
        
        # Add platinum layer metadata
        features_df["_feature_timestamp"] = datetime.now().isoformat()
        features_df["_layer"] = "platinum"
        features_df["_feature_type"] = feature_type
        features_df["_feature_version"] = "1.0.0"
        
        # Generate platinum path
        timestamp = datetime.now()
        platinum_path = (
            f"{self.config.platinum_path}/{domain}/"
            f"{feature_type}_{timestamp.strftime('%Y%m%d_%H%M%S')}.parquet"
        )
        
        # Ensure directory exists
        Path(platinum_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Save feature data
        features_df.to_parquet(platinum_path, compression=self.config.compression)
        
        logger.info(f"Created platinum features: {platinum_path}")
        return platinum_path
    
    def _clean_idr_disputes(self, df: pd.DataFrame) -> pd.DataFrame:
        """Clean and validate IDR dispute data"""
        # Remove duplicates
        df = df.drop_duplicates()
        
        # Validate required fields
        required_fields = ["dispute_id", "provider_npi", "payer_name", "service_code", "billed_amount"]
        df = df.dropna(subset=required_fields)
        
        # Standardize data types
        df["billed_amount"] = pd.to_numeric(df["billed_amount"], errors="coerce")
        df["qpa_amount"] = pd.to_numeric(df["qpa_amount"], errors="coerce")
        
        # Add derived fields
        df["qpa_multiplier"] = df["billed_amount"] / df["qpa_amount"]
        df["dispute_date"] = pd.to_datetime(df["dispute_date"])
        
        return df
    
    def _clean_georgetown_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Clean and validate Georgetown research data"""
        # Standardize specialty codes
        specialty_mapping = {
            "emergency": "emergency_medicine",
            "radiology": "diagnostic_radiology",
            "surgery": "general_surgery",
            "neurology": "neurology"
        }
        df["specialty_standardized"] = df["specialty"].map(specialty_mapping).fillna(df["specialty"])
        
        # Validate QPA multipliers
        df = df[df["qpa_multiplier"] > 0]
        df = df[df["qpa_multiplier"] < 50]  # Remove outliers
        
        return df
    
    def _clean_cms_puf_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Clean and validate CMS PUF data"""
        # Standardize geographic regions
        df["geographic_region"] = df["geographic_region"].str.upper()
        
        # Validate dispute types
        valid_dispute_types = ["single", "bundled", "component", "batched"]
        df = df[df["dispute_type"].isin(valid_dispute_types)]
        
        return df
    
    def _clean_health_affairs_data(self, df: pd.DataFrame) -> pd.DataFrame:
        """Clean and validate Health Affairs data"""
        # Standardize entity names
        df["entity_name"] = df["entity_name"].str.strip().str.title()
        
        # Validate win rates
        df = df[(df["provider_win_rate"] >= 0) & (df["provider_win_rate"] <= 1)]
        
        return df
    
    def _calculate_quality_score(self, df: pd.DataFrame) -> float:
        """Calculate data quality score"""
        completeness = 1 - df.isnull().sum().sum() / (len(df) * len(df.columns))
        return round(completeness, 3)
    
    def _aggregate_idr_disputes(self, df: pd.DataFrame, aggregation_type: str) -> pd.DataFrame:
        """Aggregate IDR dispute data"""
        if aggregation_type == "daily":
            df["date"] = df["dispute_date"].dt.date
            group_cols = ["date", "specialty_standardized", "state"]
        elif aggregation_type == "weekly":
            df["week"] = df["dispute_date"].dt.to_period("W")
            group_cols = ["week", "specialty_standardized", "state"]
        else:  # monthly
            df["month"] = df["dispute_date"].dt.to_period("M")
            group_cols = ["month", "specialty_standardized", "state"]
        
        aggregated = df.groupby(group_cols).agg({
            "dispute_id": "count",
            "billed_amount": ["sum", "mean", "median"],
            "qpa_amount": ["sum", "mean", "median"],
            "qpa_multiplier": ["mean", "median", "std"],
            "provider_win": "mean"
        }).reset_index()
        
        # Flatten column names
        aggregated.columns = ["_".join(col).strip() if col[1] else col[0] for col in aggregated.columns]
        
        return aggregated
    
    def _aggregate_georgetown_insights(self, df: pd.DataFrame, aggregation_type: str) -> pd.DataFrame:
        """Aggregate Georgetown research insights"""
        group_cols = ["specialty_standardized"]
        
        if aggregation_type != "overall":
            if aggregation_type == "monthly":
                df["period"] = df["_processing_timestamp"].str[:7]  # YYYY-MM
                group_cols.append("period")
        
        aggregated = df.groupby(group_cols).agg({
            "qpa_multiplier": ["mean", "median", "std", "count"],
            "provider_win_rate": ["mean", "std"],
            "case_complexity": ["mean", "std"]
        }).reset_index()
        
        # Flatten column names
        aggregated.columns = ["_".join(col).strip() if col[1] else col[0] for col in aggregated.columns]
        
        return aggregated
    
    def _aggregate_entity_performance(self, df: pd.DataFrame, aggregation_type: str) -> pd.DataFrame:
        """Aggregate IDR entity performance data"""
        group_cols = ["entity_name"]
        
        aggregated = df.groupby(group_cols).agg({
            "provider_win_rate": ["mean", "std", "count"],
            "case_volume": "sum",
            "avg_processing_time": "mean",
            "bias_score": "mean"
        }).reset_index()
        
        # Flatten column names
        aggregated.columns = ["_".join(col).strip() if col[1] else col[0] for col in aggregated.columns]
        
        return aggregated
    
    def _aggregate_market_intelligence(self, df: pd.DataFrame, aggregation_type: str) -> pd.DataFrame:
        """Aggregate market intelligence data"""
        if aggregation_type == "daily":
            df["date"] = pd.to_datetime(df["_processing_timestamp"]).dt.date
            group_cols = ["date", "market_segment"]
        else:
            group_cols = ["market_segment"]
        
        aggregated = df.groupby(group_cols).agg({
            "market_share": "mean",
            "competitive_advantage": "mean",
            "trend_score": "mean",
            "prediction_accuracy": "mean"
        }).reset_index()
        
        return aggregated
    
    def _default_aggregation(self, df: pd.DataFrame, aggregation_type: str) -> pd.DataFrame:
        """Default aggregation for unknown domains"""
        numeric_columns = df.select_dtypes(include=[np.number]).columns
        
        aggregated = df.groupby("_domain").agg({
            col: ["count", "mean", "std"] for col in numeric_columns
        }).reset_index()
        
        # Flatten column names
        aggregated.columns = ["_".join(col).strip() if col[1] else col[0] for col in aggregated.columns]
        
        return aggregated
    
    def _create_georgetown_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create Georgetown-enhanced ML features"""
        features_df = df.copy()
        
        # Georgetown specialty multipliers (from 586,581 case analysis)
        georgetown_multipliers = {
            "neurology": 12.22,
            "surgery": 18.18,
            "diagnostic_radiology": 6.00,
            "emergency_medicine": 2.57
        }
        
        features_df["georgetown_expected_multiplier"] = features_df["specialty_standardized"].map(georgetown_multipliers)
        features_df["georgetown_variance"] = abs(features_df["qpa_multiplier_mean"] - features_df["georgetown_expected_multiplier"])
        features_df["georgetown_alignment_score"] = 1 / (1 + features_df["georgetown_variance"])
        
        # Geographic complexity features
        high_complexity_states = ["TX", "CA", "NY", "FL", "PA"]
        features_df["state_complexity"] = features_df["state"].apply(
            lambda x: "high" if x in high_complexity_states else "medium"
        )
        
        return features_df
    
    def _create_proprietary_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create proprietary intelligence ML features"""
        features_df = df.copy()
        
        # Market intelligence features
        features_df["market_dominance_score"] = features_df["case_volume_sum"] / features_df["case_volume_sum"].max()
        features_df["competitive_advantage"] = features_df["provider_win_mean"] * features_df["market_dominance_score"]
        
        # Behavioral economics features
        features_df["risk_aversion_score"] = 1 - features_df["qpa_multiplier_std"]
        features_df["negotiation_power"] = features_df["billed_amount_mean"] / features_df["qpa_amount_mean"]
        
        # Network relationship features
        features_df["network_centrality"] = features_df["dispute_id_count"] / features_df["dispute_id_count"].sum()
        features_df["relationship_strength"] = features_df["provider_win_mean"] * features_df["network_centrality"]
        
        return features_df
    
    def _create_ai_mcmc_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create AI-MCMC enhanced ML features"""
        features_df = df.copy()
        
        # Uncertainty quantification features
        features_df["prediction_uncertainty"] = features_df["qpa_multiplier_std"] / features_df["qpa_multiplier_mean"]
        features_df["confidence_interval_width"] = features_df["qpa_multiplier_std"] * 1.96 * 2
        
        # Bayesian prior features
        features_df["bayesian_prior_strength"] = features_df["dispute_id_count"] / (features_df["dispute_id_count"] + 10)
        features_df["posterior_adjustment"] = features_df["bayesian_prior_strength"] * features_df["qpa_multiplier_mean"]
        
        # Ensemble features
        features_df["ensemble_weight"] = features_df["provider_win_mean"] * features_df["bayesian_prior_strength"]
        features_df["model_consensus"] = (features_df["qpa_multiplier_mean"] + features_df["posterior_adjustment"]) / 2
        
        return features_df
    
    def _create_multi_approach_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create multi-approach coordination ML features"""
        features_df = df.copy()
        
        # Approach selection features
        features_df["georgetown_score"] = features_df["georgetown_alignment_score"]
        features_df["proprietary_score"] = features_df["competitive_advantage"]
        features_df["ai_mcmc_score"] = 1 - features_df["prediction_uncertainty"]
        
        # Hybrid optimization features
        features_df["approach_consensus"] = (
            features_df["georgetown_score"] + 
            features_df["proprietary_score"] + 
            features_df["ai_mcmc_score"]
        ) / 3
        
        features_df["optimal_approach"] = features_df[["georgetown_score", "proprietary_score", "ai_mcmc_score"]].idxmax(axis=1)
        features_df["approach_confidence"] = features_df[["georgetown_score", "proprietary_score", "ai_mcmc_score"]].max(axis=1)
        
        return features_df
    
    def _create_default_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Create default ML features"""
        features_df = df.copy()
        
        # Basic statistical features
        numeric_columns = features_df.select_dtypes(include=[np.number]).columns
        for col in numeric_columns:
            if col.endswith("_mean"):
                base_name = col.replace("_mean", "")
                if f"{base_name}_std" in features_df.columns:
                    features_df[f"{base_name}_cv"] = features_df[f"{base_name}_std"] / features_df[col]
        
        return features_df
    
    async def query_lakehouse(self, layer: DataLayer, domain: str, filters: Dict[str, Any] = None) -> pd.DataFrame:
        """
        Query data from lakehouse
        
        Args:
            layer: Data layer to query
            domain: Data domain
            filters: Optional filters to apply
            
        Returns:
            Queried DataFrame
        """
        layer_path = getattr(self.config, f"{layer.value}_path")
        domain_path = f"{layer_path}/{domain}"
        
        # Find all parquet files in domain
        parquet_files = list(Path(domain_path).rglob("*.parquet"))
        
        if not parquet_files:
            logger.warning(f"No data found in {domain_path}")
            return pd.DataFrame()
        
        # Read and combine all files
        dfs = []
        for file_path in parquet_files:
            try:
                df = pd.read_parquet(file_path)
                dfs.append(df)
            except Exception as e:
                logger.error(f"Error reading {file_path}: {e}")
        
        if not dfs:
            return pd.DataFrame()
        
        combined_df = pd.concat(dfs, ignore_index=True)
        
        # Apply filters if provided
        if filters:
            for column, value in filters.items():
                if column in combined_df.columns:
                    if isinstance(value, list):
                        combined_df = combined_df[combined_df[column].isin(value)]
                    else:
                        combined_df = combined_df[combined_df[column] == value]
        
        return combined_df
    
    async def get_lakehouse_statistics(self) -> Dict[str, Any]:
        """Get comprehensive lakehouse statistics"""
        stats = {
            "layers": {},
            "total_files": 0,
            "total_size_gb": 0,
            "domains": set(),
            "last_updated": datetime.now().isoformat()
        }
        
        for layer in DataLayer:
            layer_path = getattr(self.config, f"{layer.value}_path")
            layer_stats = {
                "files": 0,
                "size_gb": 0,
                "domains": {}
            }
            
            if Path(layer_path).exists():
                for file_path in Path(layer_path).rglob("*.parquet"):
                    layer_stats["files"] += 1
                    layer_stats["size_gb"] += file_path.stat().st_size / (1024**3)
                    
                    # Extract domain from path
                    domain = file_path.parts[-3] if len(file_path.parts) >= 3 else "unknown"
                    stats["domains"].add(domain)
                    
                    if domain not in layer_stats["domains"]:
                        layer_stats["domains"][domain] = {"files": 0, "size_gb": 0}
                    
                    layer_stats["domains"][domain]["files"] += 1
                    layer_stats["domains"][domain]["size_gb"] += file_path.stat().st_size / (1024**3)
            
            stats["layers"][layer.value] = layer_stats
            stats["total_files"] += layer_stats["files"]
            stats["total_size_gb"] += layer_stats["size_gb"]
        
        stats["domains"] = list(stats["domains"])
        return stats

# Example usage and testing
async def main():
    """Example usage of HealthPoint Data Lakehouse"""
    
    # Initialize lakehouse
    lakehouse = HealthPointDataLakehouse()
    
    # Example: Ingest Georgetown research data
    georgetown_data = {
        "study_id": "georgetown_586581_analysis",
        "specialty": "neurology",
        "qpa_multiplier": 12.22,
        "provider_win_rate": 0.88,
        "case_complexity": 0.95,
        "state": "TX",
        "case_count": 15432
    }
    
    bronze_path = await lakehouse.ingest_bronze_data(
        georgetown_data, 
        "georgetown_research", 
        "georgetown_university"
    )
    
    # Process to silver layer
    silver_path = await lakehouse.process_silver_data(bronze_path, "georgetown_research")
    
    # Aggregate to gold layer
    gold_path = await lakehouse.aggregate_gold_data([silver_path], "georgetown_research", "monthly")
    
    # Create platinum features
    platinum_path = await lakehouse.create_platinum_features([gold_path], "georgetown_research", "georgetown_enhanced")
    
    # Query data
    georgetown_features = await lakehouse.query_lakehouse(
        DataLayer.PLATINUM, 
        "georgetown_research",
        {"specialty_standardized": "neurology"}
    )
    
    print(f"Georgetown features shape: {georgetown_features.shape}")
    
    # Get lakehouse statistics
    stats = await lakehouse.get_lakehouse_statistics()
    print(f"Lakehouse statistics: {json.dumps(stats, indent=2)}")

if __name__ == "__main__":
    import numpy as np
    asyncio.run(main())
