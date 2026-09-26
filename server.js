require("dotenv").config();

const app = require("./server/server");

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`PNR Monitor running at http://localhost:${PORT}`);
});
