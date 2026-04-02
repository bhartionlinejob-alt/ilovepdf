FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p temp

EXPOSE 3000

CMD ["npm", "start"]
