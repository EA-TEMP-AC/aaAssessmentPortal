import mongoose from "mongoose";

/**
 * Run `work` inside a replica-set transaction and end the session.
 * @template T
 * @param {(session: import("mongoose").ClientSession) => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
