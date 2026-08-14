FROM python:3.10-slim

# Install system dependencies needed for PyMuPDF and Python libraries
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Set up working directory
WORKDIR /app

# Optionally install custom CA certificates for corporate SSL intercept proxies
# The pattern *proxy-ca.cr[t] makes the copy optional (will not fail if file doesn't exist)
COPY Dockerfile *proxy-ca.cr[t] /usr/local/share/ca-certificates/
RUN if ls /usr/local/share/ca-certificates/*proxy-ca.crt >/dev/null 2>&1; then \
        echo "Installing custom CA certificates..." && \
        update-ca-certificates; \
    fi

# Copy requirements and install them
COPY requirements.txt /app/requirements.txt
RUN pip install \
    --trusted-host pypi.org \
    --trusted-host files.pythonhosted.org \
    --trusted-host pypi.python.org \
    --trusted-host huggingface.co \
    --no-cache-dir -r /app/requirements.txt

# Run the ingestion script
CMD ["python3", "build_knowledge_base.py", "--pdf-dir", "/pdf_input", "--output-dir", "/output_dir"]

