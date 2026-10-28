FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive TZ=America/Lima
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && ln -sf /usr/share/zoneinfo/America/Lima /etc/localtime \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY tcp_cerro_new.py panel_cerro.py interfaz.html login.html ./
COPY frontend/dist ./frontend/dist

ENV CERRO_DIR=/app/datos \
    CERRO_TCP_PORT=9985 \
    CERRO_API_PORT=9986 \
    CERRO_API_URL=http://161.132.53.51:9050/TermoKing/ \
    CERRO_API_URL2=http://161.132.206.104:9050/Datos/ \
    PYTHONUNBUFFERED=1

RUN mkdir -p /app/datos

VOLUME ["/app/datos"]
EXPOSE 9985 9986

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9986/salud', timeout=3)"

CMD ["python", "tcp_cerro_new.py"]
