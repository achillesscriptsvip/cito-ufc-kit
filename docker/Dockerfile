# Cito UFC API — self-contained demo image.
#
# Build from packages/cito-ufc-kit:
#   docker build -f docker/Dockerfile -t citoapi/ufc-api-demo .
#
# Run:
#   docker run --rm -e CITO_API_KEY=your-key citoapi/ufc-api-demo
#
# The API key is supplied at runtime only and is never baked into a layer.

FROM python:3.12-alpine

LABEL org.opencontainers.image.title="Cito UFC API Demo" \
      org.opencontainers.image.description="Self-contained UFC data demo built on the Cito UFC API — fighters, fight cards, round stats, rankings and odds." \
      org.opencontainers.image.url="https://citoapi.com/ufc-api/" \
      org.opencontainers.image.documentation="https://citoapi.com/docs/api/ufc/" \
      org.opencontainers.image.source="https://github.com/achillesscriptsvip/cito-ufc-kit" \
      org.opencontainers.image.licenses="MIT"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# The SDK and the demo script are the only things needed.
COPY docker/demo.py /app/demo.py
RUN pip install --no-cache-dir "httpx>=0.24"

# Run as a non-root user.
RUN adduser -D -u 10001 ufc
USER ufc

ENTRYPOINT ["python", "/app/demo.py"]
