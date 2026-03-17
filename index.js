const express = require("express");
const path = require("path");
const app = express();
app.set('trust proxy', true);
const port = process.env.PORT || 3000;
// Sam page and assets — match /Sam and /Sam/ case-insensitively so localhost and proxies work
const samDir = path.join(__dirname, "public", "Company", "Sam");
const sendSamIndex = (req, res) => res.sendFile(path.join(samDir, "index.html"));
app.get(/^\/Sam\/?$/i, sendSamIndex);
app.use("/Sam", express.static(samDir));
app.use("/sam", express.static(samDir));
app.use("/Company/Sam", express.static(samDir));
// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, "public")));
// Fallback to index.html for root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.listen(port, "0.0.0.0",() => {
  console.log(`Server running on port ${port}`);
});