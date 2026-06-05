# Use a official lightweight Python image
FROM python:3.10-slim

# Install system dependencies, including Tesseract OCR and English language pack
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# Set directory inside the container
WORKDIR /app

# Copy the requirements file first to utilize Docker build cache
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend source code
COPY . .

# Expose the port (Render/Railway will bind this dynamically)
EXPOSE 8000

# Start Uvicorn, binding to 0.0.0.0 and utilizing the PORT env var if provided (defaults to 8000)
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
