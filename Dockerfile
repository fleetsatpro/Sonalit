FROM node:22-slim
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ .
RUN mkdir -p logs
EXPOSE 5000
CMD ["npm", "start"]
