'''
# AI/ML/DL Implementation for Healthcare Claims Platform

**Author:** Manus AI
**Date:** October 7, 2025

## Overview

This project transforms the Healthcare Claims Platform's mock AI/ML/DL implementation into a fully functional system with real trained models, historical data, and continuous learning capabilities. The new system provides a robust and scalable solution for detecting fraudulent healthcare claims.

## Key Features

*   **Real-time Fraud Detection:** A FastAPI-based service provides real-time fraud detection for incoming claims.
*   **Hybrid Approach:** The system combines rule-based detection, traditional machine learning models (Isolation Forest, Random Forest), and Graph Neural Networks (GCN, GAT, GraphSAGE) for a comprehensive and accurate fraud detection solution.
*   **Continuous Learning:** A feedback loop allows for continuous improvement of the models based on user feedback.
*   **Experiment Tracking:** MLflow is integrated for experiment tracking, model registry, and versioning.
*   **Scalable Architecture:** The system is designed to be scalable and can be deployed in a multi-tenant environment.

## Project Structure

```
/home/ubuntu/ai-ml-dl-implementation/
├── ai_fraud_detection_service_v2.py  # The main fraud detection service
├── model_training_pipeline.py       # Script for training the ML/DL/GNN models
├── training_data_collection_system.py # Script for generating and storing training data
├── testing_suite.py                 # Script for testing the fraud detection service
├── models/                            # Directory for storing trained models
└── README.md                        # This file
```

## Getting Started

### Prerequisites

*   Python 3.11+
*   PostgreSQL
*   Redis

### Installation

1.  **Clone the repository:**

    ```bash
    git clone <repository_url>
    cd <repository_directory>
    ```

2.  **Install the required Python libraries:**

    ```bash
    pip3 install -r requirements.txt
    ```

3.  **Set up the PostgreSQL database:**

    *   Create a user and a database.
    *   Update the `DATABASE_URL` in the configuration files.

4.  **Set up the Redis server:**

    *   Update the `REDIS_URL` in the configuration files.

### Running the System

1.  **Generate training data:**

    ```bash
    python3 /home/ubuntu/ai-ml-dl-implementation/training_data_collection_system.py
    ```

2.  **Train the models:**

    ```bash
    python3 /home/ubuntu/ai-ml-dl-implementation/model_training_pipeline.py
    ```

3.  **Start the MLflow tracking server:**

    ```bash
    mlflow server --host 0.0.0.0 --port 5000 &
    ```

4.  **Start the fraud detection service:**

    ```bash
    uvicorn ai-ml-dl-implementation.ai_fraud_detection_service_v2:app --host 0.0.0.0 --port 8000
    ```

5.  **Run the testing suite:**

    ```bash
    python3 /home/ubuntu/ai-ml-dl-implementation/testing_suite.py
    ```

## Continuous Learning

The system includes a `/feedback` endpoint to receive feedback on fraud detection results. This feedback is used to update the training data and trigger model retraining, ensuring that the models continuously improve over time.
'''
