FROM node:22-slim
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .
# Apply the existing Client Pulse hardening and the v2 malformed-ZIP recovery.
RUN node scripts/repair-client-pulse-xlsx-parser.js
RUN node scripts/repair-client-pulse-xlsx-parser-v2.js
# The notification worker uses the approved Client Pulse XLSX template.
# Keep the root template available in the same runtime image used by the worker.
COPY templates/ ./templates/
RUN mkdir -p logs
EXPOSE 5000
CMD ["npm", "start"]
