import { app } from "./app";
import { config } from "./core/config";

app.listen(config.port, "0.0.0.0", () => {
  console.log(`KenRoute API on http://0.0.0.0:${config.port}/api/v1`);
});
