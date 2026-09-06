FROM node:22-slim
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .
# The notification worker uses the approved Client Pulse XLSX template.
# Keep the root template available in the same runtime image used by the worker.
COPY templates/ ./templates/
RUN mkdir -p logs
EXPOSE 5000
CMD ["npm", "start"]
