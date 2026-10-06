import { app } from "./app";
import { config } from "./core/config";

// Bound to loopback while the temporary devTenant stub stands in for login.
app.listen(config.port, "127.0.0.1", () => {
  console.log(`KenRoute API on http://127.0.0.1:${config.port}/api/v1`);
});
