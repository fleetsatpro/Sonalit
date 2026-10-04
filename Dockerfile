FROM node:22-slim

# PDF/SVG rendering uses sharp/libvips; provide a real Fontconfig runtime so
# map labels and embedded text render consistently in production containers.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .
RUN mkdir -p logs
EXPOSE 5000
CMD ["npm", "start"]
