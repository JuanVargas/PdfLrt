FROM python:3.10-slim

# Install system dependencies needed for PyMuPDF and Python libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Copy requirements and install them
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Run the ingestion script
CMD ["python3", "build_knowledge_base.py"]
