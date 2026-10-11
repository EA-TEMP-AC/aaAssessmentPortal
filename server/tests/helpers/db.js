import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongo;

/**
 * Replica set so assign/cancel lock work can use transactions.
 * SCHEMA §3.9. Production docker-compose is also a replica set.
 */
export async function startMongo() {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongo.getUri());
}

export async function stopMongo() {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
  mongo = undefined;
}

export async function clearCollections() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}
