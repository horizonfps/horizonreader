FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
# Schema must exist before install: postinstall runs `prisma generate`.
COPY prisma ./prisma
RUN npm install --include=dev --no-audit --no-fund
# Windows lockfile carries only the win32 sharp binary; force the linux one at
# the pinned version, so a fresh build never drifts onto a newer sharp.
RUN SHARP_VERSION=$(node -p "try{require('./package-lock.json').packages['node_modules/sharp'].version}catch(e){require('./package.json').dependencies.sharp}") \
  && npm install --no-audit --no-fund --os=linux --libc=glibc --cpu=x64 "sharp@$SHARP_VERSION"

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Create/update the SQLite schema on the mounted volume, then serve.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
