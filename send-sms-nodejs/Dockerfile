FROM node:20-slim

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY . .

USER node

EXPOSE 3000

CMD ["node", "server.js"]
