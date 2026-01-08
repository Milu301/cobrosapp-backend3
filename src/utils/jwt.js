const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

/**
 * Firma un JWT consistente con el backend (role/adminId/vendorId/tv).
 * - sub: el id principal (adminId o vendorId)
 */
function signAccessToken({ sub, role, adminId, vendorId, tokenVersion = 0 }) {
  return jwt.sign(
    {
      role,
      adminId,
      vendorId,
      tv: Number(tokenVersion || 0)
    },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_EXPIRES_IN,
      subject: String(sub)
    }
  );
}

function verifyToken(token) {
  return jwt.verify(token, env.JWT_SECRET);
}

module.exports = { signAccessToken, verifyToken };
