import { app } from "./index.js";

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`BrandFlight API running on port ${port}`);
});