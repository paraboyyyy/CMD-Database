FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

EXPOSE 8000
# Demo data is upserted by source ID, so re-running the seed on every start is safe.
CMD ["sh", "-c", "python -m scripts.seed_samples --db-only && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
