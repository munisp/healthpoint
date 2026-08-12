#!/usr/bin/env python3
"""
Healthcare Claims Platform - Model Training Pipeline

This script trains various ML, DL, and GNN models on the collected healthcare claims data.

Author: Manus AI
Date: October 7, 2025
"""

import asyncio
import asyncpg
import joblib
import logging
import numpy as np
import os
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from torch_geometric.data import Data
from torch_geometric.nn import GCNConv, GATConv, SAGEConv
import mlflow
import mlflow.pytorch
import mlflow.sklearn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://claimuser:password@localhost/healthcare_platform")
MODEL_DIR = "/home/ubuntu/ai-ml-dl-implementation/models"
MLFLOW_TRACKING_URI = "http://127.0.0.1:5000"

# Set up MLflow
mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
mlflow.set_experiment("Healthcare Claims Fraud Detection")

# Create model directory if it doesn't exist
os.makedirs(MODEL_DIR, exist_ok=True)

# --- Model Definitions ---

class GraphConvolutionalNetwork(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 64, output_dim: int = 2, num_layers: int = 3):
        super(GraphConvolutionalNetwork, self).__init__()
        self.convs = nn.ModuleList()
        self.convs.append(GCNConv(input_dim, hidden_dim))
        for _ in range(num_layers - 2):
            self.convs.append(GCNConv(hidden_dim, hidden_dim))
        self.convs.append(GCNConv(hidden_dim, output_dim))
        self.dropout = nn.Dropout(0.5)

    def forward(self, x, edge_index):
        for i, conv in enumerate(self.convs[:-1]):
            x = conv(x, edge_index)
            x = F.relu(x)
            x = self.dropout(x)
        x = self.convs[-1](x, edge_index)
        return F.log_softmax(x, dim=1)

class GraphAttentionNetwork(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 64, output_dim: int = 2, num_heads: int = 4):
        super(GraphAttentionNetwork, self).__init__()
        self.conv1 = GATConv(input_dim, hidden_dim, heads=num_heads, dropout=0.6)
        self.conv2 = GATConv(hidden_dim * num_heads, output_dim, heads=1, dropout=0.6)
        self.dropout = nn.Dropout(0.6)

    def forward(self, x, edge_index):
        x = self.dropout(x)
        x = F.elu(self.conv1(x, edge_index))
        x = self.dropout(x)
        x = self.conv2(x, edge_index)
        return F.log_softmax(x, dim=1)

class GraphSAGE(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 64, output_dim: int = 2, num_layers: int = 2):
        super(GraphSAGE, self).__init__()
        self.convs = nn.ModuleList()
        self.convs.append(SAGEConv(input_dim, hidden_dim))
        for _ in range(num_layers - 2):
            self.convs.append(SAGEConv(hidden_dim, hidden_dim))
        self.convs.append(SAGEConv(hidden_dim, output_dim))

    def forward(self, x, edge_index):
        for conv in self.convs[:-1]:
            x = conv(x, edge_index)
            x = F.relu(x)
            x = F.dropout(x, p=0.5, training=self.training)
        x = self.convs[-1](x, edge_index)
        return F.log_softmax(x, dim=1)

class ModelTrainer:
    def __init__(self, db_url):
        self.db_url = db_url
        self.pool = None

    async def connect(self):
        self.pool = await asyncpg.create_pool(self.db_url)

    async def disconnect(self):
        if self.pool:
            await self.pool.close()

    async def load_data(self):
        async with self.pool.acquire() as conn:
            records = await conn.fetch("SELECT * FROM historical_claims")
            if not records:
                return pd.DataFrame()
            columns = list(records[0].keys())
            data = [tuple(r) for r in records]
            return pd.DataFrame(data, columns=columns)

    def preprocess_data(self, df):
        # Feature Engineering
        df["service_duration"] = (df["service_date_to"] - df["service_date_from"]).dt.days
        df["claim_submission_delay"] = (df["submitted_at"] - df["service_date_to"]).dt.days

        # Label Encoding for categorical features
        categorical_features = ["provider_id", "patient_id", "tenant_id"]
        for col in categorical_features:
            le = LabelEncoder()
            df[col] = le.fit_transform(df[col])

        # For simplicity, we'll use a subset of features for training
        features = ["total_amount", "service_duration", "claim_submission_delay"] + categorical_features
        target = "is_fraud"

        X = df[features]
        y = df[target]

        # Scaling numerical features
        scaler = StandardScaler()
        X.loc[:, ["total_amount", "service_duration", "claim_submission_delay"]] = scaler.fit_transform(
            X[["total_amount", "service_duration", "claim_submission_delay"]])

        return train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    def train_sklearn_models(self, X_train, y_train, X_test, y_test):
        with mlflow.start_run(run_name="scikit-learn-models", nested=True):
            # Train Isolation Forest
            iso_forest = IsolationForest(contamination=0.05, random_state=42)
            iso_forest.fit(X_train)
            mlflow.sklearn.log_model(iso_forest, "isolation_forest")
            logger.info("Isolation Forest model trained and logged to MLflow.")

            # Train Random Forest
            rand_forest = RandomForestClassifier(n_estimators=100, random_state=42)
            rand_forest.fit(X_train, y_train)
            y_pred = rand_forest.predict(X_test)
            report = classification_report(y_test, y_pred, output_dict=True)
            mlflow.log_metrics({"rf_accuracy": report["accuracy"], "rf_roc_auc": roc_auc_score(y_test, y_pred)})
            mlflow.sklearn.log_model(rand_forest, "random_forest")
            logger.info("Random Forest model trained and logged to MLflow.")

    def create_graph_data(self, df):
        all_provider_ids = df["provider_id"].unique()
        all_patient_ids = df["patient_id"].unique()

        all_node_ids = np.concatenate([all_provider_ids, all_patient_ids])
        unique_node_ids = pd.unique(all_node_ids)

        node_to_idx = {node_id: i for i, node_id in enumerate(unique_node_ids)}

        num_nodes = len(unique_node_ids)

        # Create edges using the mapping
        edge_index = df.apply(lambda row: [node_to_idx[row.provider_id], node_to_idx[row.patient_id]], axis=1, result_type="expand")
        edge_index = edge_index.to_numpy().T

        # Simplified node features
        x = torch.randn((num_nodes, 16))  # Using random features for now

        # Simplified node labels
        y = torch.randint(0, 2, (num_nodes,))

        return Data(x=x, edge_index=torch.tensor(edge_index, dtype=torch.long), y=y)

    def train_gnn_model(self, model, data, model_name):
        with mlflow.start_run(run_name=model_name, nested=True):
            optimizer = torch.optim.Adam(model.parameters(), lr=0.01, weight_decay=5e-4)
            model.train()

            for epoch in range(200):
                optimizer.zero_grad()
                out = model(data.x, data.edge_index)
                loss = F.nll_loss(out, data.y)
                loss.backward()
                optimizer.step()

                if (epoch + 1) % 10 == 0:
                    logger.info(f"Epoch {epoch + 1}, Loss: {loss.item():.4f}")
                    mlflow.log_metric("loss", loss.item(), step=epoch)

            mlflow.pytorch.log_model(model, model_name)
            logger.info(f"{model_name} model trained and logged to MLflow.")

async def main():
    trainer = ModelTrainer(DATABASE_URL)
    await trainer.connect()

    logger.info("Loading and preprocessing data...")
    df = await trainer.load_data()
    X_train, X_test, y_train, y_test = trainer.preprocess_data(df)

    logger.info("Training scikit-learn models...")
    trainer.train_sklearn_models(X_train, y_train, X_test, y_test)

    logger.info("Creating graph data...")
    graph_data = trainer.create_graph_data(df)

    with mlflow.start_run(run_name="GNN Models"):
        logger.info("Training GNN models...")
        gcn = GraphConvolutionalNetwork(input_dim=16)
        trainer.train_gnn_model(gcn, graph_data, "gcn_model")

        gat = GraphAttentionNetwork(input_dim=16)
        trainer.train_gnn_model(gat, graph_data, "gat_model")

        graphsage = GraphSAGE(input_dim=16)
        trainer.train_gnn_model(graphsage, graph_data, "graphsage_model")

    await trainer.disconnect()

if __name__ == "__main__":
    asyncio.run(main())

