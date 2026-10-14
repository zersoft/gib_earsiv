FROM node:22-alpine

WORKDIR /app

# Paket bağımlılıklarını kopyala
COPY package*.json ./

RUN npm ci --only=production

# Kaynak kodları kopyala
COPY . .

# Port
EXPOSE 3005

ENV PORT=3005
ENV NODE_ENV=production

CMD ["node", "server.js"]
