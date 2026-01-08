const express = require("express");
const helmet = require("helmet");
const cors = require("cors");

const { env } = require("./config/env");
const { apiRouter } = require("./routes/index");
const { requestContext } = require("./middlewares/requestContext");
const { notFound } = require("./middlewares/notFound");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();

// ✅ Railway/Render/Heroku/NGINX: vienen con X-Forwarded-For
app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(",").map((s) => s.trim()),
    credentials: true
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(requestContext);

app.use("/api", apiRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = { app };
