import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KeyValueStore } from "./types";

export const asyncStorageStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  deleteItem: (key) => AsyncStorage.removeItem(key),
};
