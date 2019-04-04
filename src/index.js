import { typeDefs, resolvers } from "./graphql-schema";
import { ApolloServer, makeExecutableSchema } from "apollo-server";
import dotenv from "dotenv";

dotenv.config();

const schema = makeExecutableSchema({
  typeDefs,
  resolvers
});

const server = new ApolloServer({
  schema: schema
});

server.listen(process.env.GRAPHQL_LISTEN_PORT, "0.0.0.0").then(({ url }) => {
  console.log(`GraphQL API ready at ${url}`);
});
