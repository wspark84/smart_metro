import test from "node:test";
import assert from "node:assert/strict";

import { getMailConfig, sendAccountEmail } from "../src/server/mail-service.mjs";

test("mail service stays in preview mode without an SMTP configuration", async () => {
  const config = getMailConfig({});
  assert.deepEqual(config, {
    configured: false,
    mode: "preview",
    from: "",
    host: null,
    port: 587,
    secure: false,
    hasAuthentication: false,
    credentialSource: "",
  });

  const result = await sendAccountEmail(
    { to: "user@example.com", subject: "Verify", text: "Body" },
    {},
  );
  assert.equal(result.mode, "preview");
  assert.equal(result.delivered, false);
});

test("mail configuration exposes only safe, non-secret status information", () => {
  const config = getMailConfig({
    SMTP_HOST: "smtp.example.com",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_USER: "mailer",
    SMTP_PASS: "secret-value",
    EMAIL_FROM: " Bus Wakeup <noreply@example.com>\r\nBcc: attacker@example.com ",
  });

  assert.equal(config.configured, true);
  assert.equal(config.mode, "smtp");
  assert.equal(config.host, "smtp.example.com");
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.hasAuthentication, true);
  assert.equal(config.from.includes("\n"), false);
  assert.equal("secret-value" in config, false);
});
