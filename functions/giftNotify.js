const { createMailer } = require("./carteleraAlert");

const APP_URL = "https://ucc-manager.web.app";
const PRIMARY = "#003092";
const ACCENT = "#d91f45";
const TEXT = "#001845";
const MUTED = "#5c6478";
const BORDER = "#e0e5ef";
const HEADER_GRAD = "linear-gradient(115deg, #003092 0%, #8b1a4a 55%, #d91f45 100%)";
const LOGO_URL = `${APP_URL}/icon-128.png`;

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function senderDisplayName(senderEmail) {
  const email = String(senderEmail || "").trim().toLowerCase();
  if (email.includes("@")) return email.split("@")[0];
  return email || "alguien";
}

/**
 * @param {{ kind: "code"|"ticket", senderEmail: string }} opts
 */
function buildGiftMail({ kind, senderEmail }) {
  const fromUser = senderDisplayName(senderEmail);
  const isTicket = kind === "ticket";
  const noun = isTicket ? "una entrada" : "un código";
  const nounCap = isTicket ? "Una entrada" : "Un código";
  const useIt = isTicket ? "usarla" : "usarlo";
  const openIt = isTicket ? "Ábrela" : "Ábrelo";
  const subject = `Has recibido ${noun} de ${fromUser}`;
  const headline = `Has recibido ${noun}`;
  const bodyLine = `${nounCap} de ${fromUser}. ${openIt} en la app para ${useIt}.`;
  const text = [
    headline,
    "",
    bodyLine,
    "",
    `Abrir app: ${APP_URL}`,
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="es"><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#faf6f7;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#faf6f7;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BORDER};">
  <tr>
    <td bgcolor="${PRIMARY}" style="background-color:${PRIMARY};background-image:${HEADER_GRAD};padding:22px 24px;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="44" valign="middle" style="padding-right:12px;">
            <img src="${LOGO_URL}" width="40" height="40" alt="UCC" style="display:block;border:0;border-radius:10px;">
          </td>
          <td valign="middle" style="color:#ffffff;">
            <div style="font-size:18px;font-weight:bold;line-height:1.2;color:#ffffff;">UCC Manager</div>
            <div style="font-size:12px;margin-top:2px;color:#ffffff;">Union Cine Ciudad</div>
          </td>
        </tr>
      </table>
      <div style="font-size:20px;font-weight:bold;margin-top:16px;line-height:1.3;color:#ffffff;">${escapeHtml(headline)}</div>
    </td>
  </tr>
  <tr>
    <td style="padding:28px 24px;font-family:Arial,Helvetica,sans-serif;color:${TEXT};">
      <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">Has recibido ${escapeHtml(noun)} de <strong>${escapeHtml(fromUser)}</strong>.</p>
      <p style="margin:0;font-size:15px;line-height:1.5;color:${MUTED};">En la app podrás ${escapeHtml(useIt)}.</p>
    </td>
  </tr>
  <tr>
    <td bgcolor="#ffffff" style="padding:8px 24px 28px;text-align:center;font-family:Arial,Helvetica,sans-serif;background-color:#ffffff;">
      <a href="${APP_URL}" style="display:inline-block;padding:12px 22px;background-color:${ACCENT};color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:999px;">Abrir UCC Manager</a>
      <div style="margin-top:12px;font-size:12px;color:${MUTED};"><a href="${APP_URL}" style="color:${PRIMARY};">ucc-manager.web.app</a></div>
    </td>
  </tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, text, html };
}

/**
 * Send gift notification. Throws on SMTP failure (caller should catch).
 * @param {{ toEmail: string, senderEmail: string, kind: "code"|"ticket", gmailUser: string, gmailPass: string }} opts
 */
async function sendGiftReceivedEmail({ toEmail, senderEmail, kind, gmailUser, gmailPass }) {
  const to = String(toEmail || "").trim();
  if (!to || !to.includes("@")) return;
  const { subject, text, html } = buildGiftMail({ kind, senderEmail });
  const transporter = createMailer(gmailUser, gmailPass);
  await transporter.sendMail({
    from: `UCC Manager <${gmailUser}>`,
    to,
    subject,
    text,
    html,
  });
}

module.exports = {
  buildGiftMail,
  sendGiftReceivedEmail,
  senderDisplayName,
};
