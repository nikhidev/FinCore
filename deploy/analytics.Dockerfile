FROM python:3.12-slim
WORKDIR /srv
RUN useradd --uid 10001 --create-home fincore
COPY analytics/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=fincore:fincore analytics ./analytics
USER fincore
EXPOSE 8000
CMD ["python","-m","uvicorn","analytics.main:app","--host","0.0.0.0"]
