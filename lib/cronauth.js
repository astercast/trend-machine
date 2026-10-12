/* lib/cronauth.js — §1.11 + §8.3 of the server-program spec.
   assertCron(req) returns true iff the request carries
   `Authorization: Bearer <CRON_SECRET>`. Vercel automatically sends this
   header on cron invocations when CRON_SECRET is set.
   Fail closed: if CRON_SECRET is unset, nothing runs — the endpoint 401s
   with code UNAUTHORIZED and a log line. No query-param secrets, ever.
   Zero dependencies. Copied verbatim between the seven site repos. */
"use strict";

function assertCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.log("[cronauth] CRON_SECRET not configured — failing closed (401)");
    return false;
  }
  const auth = req.headers && req.headers.authorization;
  return auth === "Bearer " + secret;
}

module.exports = { assertCron };
