import * as Location from "expo-location";
import { createGpsCapture } from "./capture";

export function expoGpsCapture(): () => Promise<import("../queue/types").GpsCapture> {
  return createGpsCapture(Location);
}
