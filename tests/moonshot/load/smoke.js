import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";

export const options = {
  vus: 1,
  iterations: 5,
  thresholds: {
    checks: ["rate>0.99"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    "health is 200": (r) => r.status === 200,
  });

  const infer = http.post(
    `${BASE_URL}/v1/inference`,
    JSON.stringify({ input: "Moonshot smoke request" }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": "tenant-123",
        "x-session-id": `moonshot-smoke-${__ITER}`,
      },
    },
  );

  check(infer, {
    "inference returns structured status": (r) => [200, 202, 403, 429].includes(r.status),
  });

  sleep(0.2);
}
