import request from "supertest";
import { createApp } from "../src/app.js";

describe("GET /api/v1/health", () => {
  it("returns 200 with status ok", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "ok",
      service: "aa-assessment-api",
    });
    expect(typeof res.body.timestamp).toBe("string");
  });
});
