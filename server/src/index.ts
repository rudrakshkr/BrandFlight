import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "BrandFlight API" });
});

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`BrandFlight API running on port ${port}`);
});