# Node runs the TypeScript directly, so there is no build stage — the image is
# the source. Image tooling (cwebp, ImageMagick) is deliberately absent:
# resizing happens when you import a photograph, not when a visitor loads one.
FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY views ./views
COPY data ./data

# Cloud Run and most hosts set PORT; src/config.ts reads it.
ENV PORT=8080
EXPOSE 8080

# Never run as root in a container you did not have to.
USER node

CMD ["node", "src/server.ts"]
