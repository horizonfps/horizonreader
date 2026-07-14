FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
# Schema must exist before install: postinstall runs `prisma generate`.
COPY prisma ./prisma
RUN npm install --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Create/update the SQLite schema on the mounted volume, then serve.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
