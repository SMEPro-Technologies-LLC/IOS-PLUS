import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const TARGET_RPS = Number.parseInt(__ENV.TARGET_RPS || "120", 10);

export const options = {
  scenarios: {
    soak: {
      executor: "constant-arrival-rate",
      duration: "30m",
      rate: TARGET_RPS,
      timeUnit: "1s",
      preAllocatedVUs: 80,
      maxVUs: 400,
    },
  },
  thresholds: {
    http_req_duration: ["p(99)<700"],
    http_req_failed: ["rate<0.02"],
    checks: ["rate>0.98"],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/v1/inference`,
    JSON.stringify({ input: "Moonshot soak request" }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": "tenant-123",
        "x-session-id": `moonshot-soak-${__VU}`,
      },
      timeout: "15s",
    },
  );

  check(res, {
    "response status is non-5xx": (r) => r.status < 500,
  });

  sleep(0.01);
}
