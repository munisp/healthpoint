FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openjdk-17-jre-headless curl && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY pipeline.py opensearch_indexer.py ./
CMD ["python", "pipeline.py"]
