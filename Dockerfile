FROM node:22-alpine

WORKDIR /app

# Native modüller için derleme araçları
RUN apk add --no-cache python3 make g++

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
