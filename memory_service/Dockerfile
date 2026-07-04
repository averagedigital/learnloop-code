FROM python:3.12-slim

WORKDIR /app
COPY memory_service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY memory_service/service.py .

EXPOSE 8008
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8008/live', timeout=2)"
CMD ["python", "service.py"]
