FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p data/backups

ENV PORT=3001
ENV DATABASE_PATH=/app/data/bar.db
EXPOSE 3001

CMD ["node", "src/index.js"]
