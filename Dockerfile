FROM node
WORKDIR /app
COPY package*.json .

RUN npm install

ENV NEO4J_URI = "bolt://localhost:7687"
ENV NEO4J_USER = "neo4j"
ENV NEO4J_PASSWORD = "neo4j"
ENV GRAPHQL_LISTEN_PORT="3000"
EXPOSE 3000
COPY . .

RUN npm run build

CMD ["node", "build/index.js"]