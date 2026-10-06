import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "the-aura-funding-api" });
});

app.get("/api/v1", (_req, res) => {
  res.json({ service: "The Aura Funding API", version: "v1" });
});

app.listen(port, () => {
  console.log(`The Aura Funding API listening on :${port}`);
});
