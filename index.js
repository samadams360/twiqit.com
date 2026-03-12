const express = require("express");
app.set('trust proxy', true);
const path = require("path");
const app = express();
const port = process.env.PORT || 3000;
// Serve static files from the "public" folder
app.use(express.static(path.join(__dirname, "public")));
// Fallback to index.html for root path
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.listen(port, "0.0.0.0",() => {
  console.log(`Server running on port ${port}`);
});