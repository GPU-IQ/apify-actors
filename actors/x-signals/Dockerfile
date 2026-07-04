FROM apify/actor-node-playwright-chrome:20

COPY --chown=myuser package*.json ./

RUN npm install --only=prod

COPY --chown=myuser dist ./dist

CMD npm start
