FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py terms.txt config.json user_terms.txt ./
RUN useradd --create-home --uid 10001 scanner
USER scanner
CMD ["python", "scan.py", "--out", "/out/prices.json"]
