import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const EXPECT_BACKPRESSURE = (__ENV.MOONSHOT_EXPECT_BACKPRESSURE || "false").toLowerCase() === "true";

const response429 = new Counter("moonshot_429_total");
const response429RetryAfter = new Counter("moonshot_429_retry_after_total");
const response5xx = new Counter("moonshot_5xx_total");
const responseSocketErrors = new Counter("moonshot_socket_error_total");
const timeToFirst429 = new Trend("moonshot_time_to_first_429_ms", true);

const dynamicThresholds = {
  // Source: packages/shared/src/types/inference.ts DEFAULT_LAYER_TIMEOUTS
  http_req_duration: ["p(95)<480"],
  "http_req_failed{expected_response:true}": ["rate<0.05"],
};

if (EXPECT_BACKPRESSURE) {
  dynamicThresholds["moonshot_429_total"] = ["count>0"];
  dynamicThresholds["moonshot_429_retry_after_total"] = ["count>0"];
  dynamicThresholds["moonshot_5xx_total"] = ["count==0"];
  dynamicThresholds["moonshot_socket_error_total"] = ["count==0"];
}

export const options = {
  scenarios: {
    breakpoint: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 1000,
      stages: [
        { target: 50, duration: "30s" },
        { target: 250, duration: "30s" },
        { target: 750, duration: "45s" },
        { target: 2000, duration: "45s" },
      ],
    },
  },
  thresholds: dynamicThresholds,
};

const startTs = Date.now();
let first429Recorded = false;

export default function () {
  const res = http.post(
    `${BASE_URL}/v1/inference`,
    JSON.stringify({ input: "Moonshot ramp load request" }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": "tenant-123",
        "x-session-id": `moonshot-ramp-${__VU}`,
      },
      timeout: "10s",
    },
  );

  if (res.status === 429) {
    response429.add(1);
    if (res.headers["Retry-After"]) {
      response429RetryAfter.add(1);
    }
    if (!first429Recorded) {
      first429Recorded = true;
      timeToFirst429.add(Date.now() - startTs);
    }
  }

  if (res.status >= 500) {
    response5xx.add(1);
  }

  if (res.status === 0) {
    responseSocketErrors.add(1);
  }

  check(res, {
    "response avoids transport failure": (r) => r.status !== 0,
  });
}
