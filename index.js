require('dotenv').config();
const express = require("express");
const path = require("path");
const app = express();
app.set('trust proxy', true);
app.use(express.json());
const port = process.env.PORT || 3000;

// Security headers
app.use((req, res, next) => {
  // HSTS: tell browsers to always use HTTPS for 1 year, include subdomains
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Deny framing (clickjacking protection)
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Basic XSS protection for older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Don't send referrer to external sites
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Sam page and assets
const samDir = path.join(__dirname, "public", "Company", "Sam");
const sendSamIndex = (req, res) => res.sendFile(path.join(samDir, "index.html"));
app.get(/^\/Sam\/?$/i, sendSamIndex);
app.use("/Sam", express.static(samDir));
app.use("/sam", express.static(samDir));
app.use("/Company/Sam", express.static(samDir));

// /commerce -> /buy (301 redirect)
app.get("/commerce", (req, res) => res.redirect(301, "/buy"));
app.get("/commerce/*", (req, res) =>
  res.redirect(301, "/buy" + req.path.replace(/^\/commerce/, ""))
);

// /buy API routes (must come before static so /buy/api/* hits the router)
const raffleRouter = require("./buy/server/raffleRouter");
const twiqRouter = require("./buy/server/twiqRouter");
const telemetryRouter = require("./buy/server/telemetryRouter");
app.use("/buy/api", raffleRouter);
app.use("/buy/api", twiqRouter);
app.use("/buy/api", telemetryRouter);

// Seed default user from ADMIN_TOKEN on startup
const crypto = require("crypto");
const das = require("./buy/server/das");
if (process.env.ADMIN_TOKEN) {
  const tokenHash = crypto.createHash("sha256").update(process.env.ADMIN_TOKEN).digest("hex");
  das.getUserByToken(tokenHash, "startup").then(existing => {
    if (!existing) {
      return das.createUser({ displayName: "Twiqit", tokenHash }, "startup");
    }
    // Update display name to Twiqit if it's still the old default
    if (existing.displayName === "Admin") {
      return das.updateUser(existing.id, { displayName: "Twiqit" }, "startup");
    }
  }).catch(err => console.error("User seed error:", err.message));
}

// /buy SPA static + catch-all
const buyDir = path.join(__dirname, "public", "buy");
app.get("/buy/admin", (req, res) =>
  res.sendFile(path.join(buyDir, "admin.html"))
);
app.use("/buy", express.static(buyDir));
app.get(/^\/buy(\/.*)?$/, (req, res) =>
  res.sendFile(path.join(buyDir, "index.html"))
);

// Main site static files
app.use(express.static(path.join(__dirname, "public")));

// Root fallback
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
  // Start raffle expiration scheduler
  const raffleScheduler = require("./buy/server/raffleScheduler");
  raffleScheduler.start();
  // Start AI Ops Agent
  const opsAgent = require("./buy/server/opsAgent");
  opsAgent.start();
});
