import { describe, expect, it } from "@jest/globals";
import { onlineFromNetState } from "./online";

describe("online state", () => {
  it("treats airplane mode as offline and a connected device as online", () => {
    expect(onlineFromNetState({ isConnected: false, isInternetReachable: false })).toBe(false);
    expect(onlineFromNetState({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(onlineFromNetState({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(onlineFromNetState({ isConnected: true, isInternetReachable: true })).toBe(true);
  });
});
