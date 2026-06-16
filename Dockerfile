FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/
COPY start.sh ./
RUN chmod +x start.sh

RUN npx prisma generate && npm run build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["./start.sh"]
