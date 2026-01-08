const http = require("http");
const { app } = require("./app");
const { env } = require("./config/env");

const server = http.createServer(app);

// ✅ bind a 0.0.0.0 para que Railway exponga el servicio
server.listen(env.PORT, env.HOST, () => {
  console.log(`✅ Backend running on http://${env.HOST}:${env.PORT}`);
  console.log(`   Local (PC):        http://localhost:${env.PORT}`);
  console.log(`   Android Emulator:  http://10.0.2.2:${env.PORT}`);
});
