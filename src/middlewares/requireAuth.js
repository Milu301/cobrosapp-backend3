// Alias para compatibilidad: algunos módulos importan `requireAuth`
// pero el middleware real vive en `./auth` y se llama `auth`.

const { auth } = require("./auth");

// `requireAuth` es simplemente `auth`.
module.exports = { requireAuth: auth };
