# Apify base image with Node 20 + Playwright + Chromium
FROM apify/actor-node-playwright-chrome:20

# Copy package files and install deps
COPY package*.json ./
RUN npm install

# Copy source and compile
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

CMD npm start
