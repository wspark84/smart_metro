import nodemailer from "nodemailer";

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeSingleLine(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function parsePort(value, fallback = 587) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

function parseBoolean(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function getMailConfig(env = process.env) {
  const smtpUrl = String(env.SMTP_URL || "").trim();
  const host = String(env.SMTP_HOST || "").trim();
  const from = normalizeSingleLine(env.EMAIL_FROM || "");
  const user = String(env.SMTP_USER || "").trim();
  const pass = String(env.SMTP_PASS || "").trim();
  const configured = Boolean(from && (smtpUrl || host));

  return {
    configured,
    mode: configured ? "smtp" : "preview",
    from,
    host: host || null,
    port: parsePort(env.SMTP_PORT),
    secure: parseBoolean(env.SMTP_SECURE),
    hasAuthentication: Boolean(user && pass),
    credentialSource: smtpUrl ? "env.SMTP_URL" : host ? "env.SMTP_HOST" : "",
  };
}

function createTransport(config, env) {
  const smtpUrl = String(env.SMTP_URL || "").trim();
  if (smtpUrl) {
    return nodemailer.createTransport(smtpUrl, {
      disableFileAccess: true,
      disableUrlAccess: true,
      connectionTimeout: 8_000,
      greetingTimeout: 8_000,
      socketTimeout: 8_000,
    });
  }

  const user = String(env.SMTP_USER || "").trim();
  const pass = String(env.SMTP_PASS || "").trim();
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: user && pass ? { user, pass } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 8_000,
  });
}

export async function sendAccountEmail({ to, subject, text, html = "" }, env = process.env) {
  const config = getMailConfig(env);
  const recipient = normalizeEmail(to);
  if (!recipient || !recipient.includes("@")) {
    throw new Error("A valid email recipient is required.");
  }

  if (!config.configured) {
    return {
      delivered: false,
      mode: "preview",
      reason: "SMTP is not configured. The account action was created but no email was sent.",
    };
  }

  const transporter = createTransport(config, env);
  const result = await transporter.sendMail({
    from: config.from,
    to: recipient,
    subject: normalizeSingleLine(subject),
    text: String(text || ""),
    html: String(html || ""),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    delivered: true,
    mode: "smtp",
    messageId: String(result.messageId || ""),
  };
}
