import NetInfo from "@react-native-community/netinfo";
import { onlineFromNetState } from "./online";

export type Connectivity = {
  isOnline(): Promise<boolean>;
  subscribe(listener: (online: boolean) => void): () => void;
};

export function netInfoConnectivity(): Connectivity {
  return {
    async isOnline() {
      const state = await NetInfo.fetch();
      return onlineFromNetState(state);
    },
    subscribe(listener) {
      return NetInfo.addEventListener((state) => {
        listener(onlineFromNetState(state));
      });
    },
  };
}
