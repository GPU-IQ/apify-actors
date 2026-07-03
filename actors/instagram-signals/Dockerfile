FROM apify/actor-node-playwright-chrome:20

COPY package*.json ./
RUN npm install --include=dev --quiet

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN npm prune --production

CMD npm start
