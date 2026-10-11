export type NetSnapshot = {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
};

/** Airplane mode reports isConnected false. Unknown reachability does not count as offline. */
export function onlineFromNetState(state: NetSnapshot): boolean {
  if (state.isConnected !== true) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}
