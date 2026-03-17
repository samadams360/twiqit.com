const express = require("express");
const path = require("path");
const app = express();
app.set('trust proxy', true);
const port = process.env.PORT || 3000;
// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, "public")));
// Sam page at twiqit.com/Sam (and /Sam/)
const samDir = path.join(__dirname, "public", "Company", "Sam");
app.get("/Sam", (req, res) => {
  res.sendFile(path.join(samDir, "index.html"));
});
app.get("/Sam/", (req, res) => {
  res.sendFile(path.join(samDir, "index.html"));
});
app.use("/Sam", express.static(samDir));
// Fallback to index.html for root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.listen(port, "0.0.0.0",() => {
  console.log(`Server running on port ${port}`);
});