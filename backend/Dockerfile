FROM node:22-alpine AS runtime

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate && npm prune --omit=dev
COPY src ./src

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]

