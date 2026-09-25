const express = require("express");

const app = express();
const serverApp = require("./server/server");

app.use(serverApp);

module.exports = app;