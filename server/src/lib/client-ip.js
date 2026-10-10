export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}
