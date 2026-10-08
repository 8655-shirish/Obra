import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  contractorLoginRedirect,
  contractorResumeTo,
  safeContractorReturnPath,
} from "@/lib/auth/contractor-return-path";

const userId = "11111111-1111-4111-8111-111111111111";
const websiteId = "22222222-2222-4222-8222-222222222222";

assert.equal(
  safeContractorReturnPath(`/user/${userId}?websiteId=${websiteId}`),
  `/user/${userId}?websiteId=${websiteId}`,
);
assert.equal(
  safeContractorReturnPath(`/setup/${websiteId}/calendar?connect=success`),
  `/setup/${websiteId}/calendar?connect=success`,
);
assert.equal(safeContractorReturnPath("/leads"), "/leads");
assert.equal(safeContractorReturnPath(`/bookings?view=future`), "/bookings?view=future");
assert.equal(safeContractorReturnPath("//evil.example/user"), null);
assert.equal(safeContractorReturnPath("https://evil.example/user"), null);
assert.equal(safeContractorReturnPath("/login"), null);
assert.equal(safeContractorReturnPath("/admin"), null);
assert.equal(
  contractorLoginRedirect(`/user/${userId}?websiteId=${websiteId}`).search?.next,
  `/user/${userId}?websiteId=${websiteId}`,
);
assert.deepEqual(contractorLoginRedirect("/admin"), { to: "/login" });
assert.deepEqual(
  contractorResumeTo(`/user/${userId}?websiteId=${websiteId}#step-3`, userId),
  {
    to: "/user/$userId",
    params: { userId },
    search: { websiteId },
    hash: "step-3",
  },
);
assert.deepEqual(
  contractorResumeTo(`/user/${userId}?websiteId=${websiteId}&connect=success`, userId),
  {
    to: "/user/$userId",
    params: { userId },
    search: { websiteId, connect: "success" },
  },
);
assert.deepEqual(
  contractorResumeTo(`/user/${userId}?websiteId=${websiteId}&templateId=tpl_landscape`, userId),
  {
    to: "/user/$userId",
    params: { userId },
    search: { websiteId, templateId: "tpl_landscape" },
  },
);
assert.deepEqual(contractorResumeTo(`/setup/${websiteId}/calendar?connect=success`, userId), {
  to: "/user/$userId",
  params: { userId },
  search: { websiteId, connect: "success" },
  hash: "step-2",
});
assert.deepEqual(contractorResumeTo(`/setup/${websiteId}/availability`, userId), {
  to: "/user/$userId",
  params: { userId },
  search: { websiteId },
  hash: "step-3",
});
assert.deepEqual(contractorResumeTo(`/setup/${websiteId}/payments?connect=return`, userId), {
  to: "/user/$userId",
  params: { userId },
  search: { websiteId, connect: "return" },
  hash: "step-4",
});
assert.deepEqual(contractorResumeTo("/leads", userId), { to: "/leads" });
assert.deepEqual(contractorResumeTo("https://evil.example", userId), {
  to: "/user/$userId",
  params: { userId },
});
assert.ok(!("href" in contractorResumeTo(`/user/${userId}`, userId)));

const loginSource = readFileSync("src/routes/login.tsx", "utf8");
const verifyOtpSource = readFileSync("src/routes/verify-otp.tsx", "utf8");
const userRouteSource = readFileSync("src/routes/user/$userId.tsx", "utf8");
assert.ok(loginSource.includes("contractorResumeTo"));
assert.ok(verifyOtpSource.includes("contractorResumeTo"));
assert.ok(!loginSource.includes("href:"));
assert.ok(!verifyOtpSource.includes("href:"));
assert.ok(userRouteSource.includes("<PurchaserOverview"));
assert.ok(!userRouteSource.includes("WorkspaceShell"));

console.log("contractor-return-path ok");
