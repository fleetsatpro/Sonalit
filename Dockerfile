FROM node:22-slim
WORKDIR /app
COPY backend/package*.json ./
# ExcelJS is part of the backend runtime. Use npm install so the lockfile can
# be reconciled during image creation when the backend dependency set changes.
RUN npm install --omit=dev
COPY backend/ .
# Client Pulse workbook generation no longer depends on custom ZIP/XLSX repair scripts.
COPY templates/ ./templates/
RUN mkdir -p logs
EXPOSE 5000
CMD ["npm", "start"]
