FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
ARG CACHEBUST=22
RUN npm install --ignore-scripts && \
    npx prisma generate --schema=prisma/schema.prisma && \
    npx prisma generate --schema=prisma/schema-store.prisma
COPY src ./src
COPY tsconfig.json ./
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm install --omit=dev --ignore-scripts
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/dist ./dist
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
