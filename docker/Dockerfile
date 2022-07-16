FROM node:current-buster-slim

WORKDIR /appealbot

COPY . .

RUN apt update

RUN npm install

RUN npm install -g pm2

CMD ["pm2-runtime", "bot.js"]
