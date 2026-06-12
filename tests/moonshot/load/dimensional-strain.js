import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const EXPECT_BACKPRESSURE = (__ENV.MOONSHOT_EXPECT_BACKPRESSURE || "false").toLowerCase() === "true";

const payloadNames = [
  "deep-nested.json",
  "large-raw-input.json",
  "proto-pollution.json",
  "invalid-utf8-escape.json",
  "null-byte.json",
  "bom-prefixed.json",
  "missing-tenant.json",
];

const payloads = payloadNames.map((name) => ({
  name,
  body: open(`./payloads/${name}`),
}));

const response4xx = new Counter("moonshot_dimensional_4xx_total");
const response413 = new Counter("moonshot_dimensional_413_total");
const response5xx = new Counter("moonshot_dimensional_5xx_total");
const responseSocket = new Counter("moonshot_dimensional_socket_total");

const thresholds = {
  moonshot_dimensional_4xx_total: ["count>0"],
  moonshot_dimensional_5xx_total: ["count==0"],
  moonshot_dimensional_socket_total: ["count==0"],
};

if (EXPECT_BACKPRESSURE) {
  thresholds["moonshot_dimensional_413_total"] = ["count>0"];
}

export const options = {
  vus: 4,
  iterations: payloads.length * 6,
  thresholds,
};

export default function () {
  const payload = payloads[(__ITER + __VU) % payloads.length];
  const headers = {
    "Content-Type": "application/json",
    "x-session-id": `moonshot-dimensional-${__VU}-${__ITER}`,
    "x-tenant-id": payload.name === "missing-tenant.json" ? "" : "tenant-123",
  };

  const res = http.post(`${BASE_URL}/v1/inference`, payload.body, { headers, timeout: "10s" });

  if (res.status >= 400 && res.status < 500) {
    response4xx.add(1);
  }
  if (res.status === 413) {
    response413.add(1);
  }
  if (res.status >= 500) {
    response5xx.add(1);
  }
  if (res.status === 0) {
    responseSocket.add(1);
  }

  check(res, {
    "structured client/server response": (r) => r.status !== 0,
    "never returns 5xx": (r) => r.status < 500,
  });
}
