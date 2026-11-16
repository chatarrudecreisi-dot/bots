FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV BOT_COUNT=5
ENV GAME_WS_URL=wss://cosa-random-1.onrender.com
CMD ["npm", "start"]
