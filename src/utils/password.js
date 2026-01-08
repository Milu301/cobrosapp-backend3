const bcrypt = require("bcrypt");

// Detect common bcrypt hash prefixes: $2a$, $2b$, $2y$
function isBcryptHash(value) {
  return typeof value === "string" && /^\$2[aby]\$\d\d\$/.test(value);
}

/**
 * Verify a plaintext password against a stored hash.
 *
 * Back-compat: if password_hash is NOT bcrypt-looking and equals the
 * plaintext password, we accept it AND return an upgraded bcrypt hash so the
 * caller can persist it (one-time migration).
 */
async function verifyPassword(plainPassword, storedPasswordHash, { rounds = 12 } = {}) {
  if (!storedPasswordHash || typeof storedPasswordHash !== "string") {
    return { ok: false, upgraded: false, upgradedHash: null };
  }

  if (isBcryptHash(storedPasswordHash)) {
    try {
      const ok = await bcrypt.compare(plainPassword, storedPasswordHash);
      return { ok, upgraded: false, upgradedHash: null };
    } catch {
      // Invalid salt or corrupted hash
      return { ok: false, upgraded: false, upgradedHash: null };
    }
  }

  // Legacy mode: stored "hash" is actually plaintext
  if (plainPassword === storedPasswordHash) {
    const upgradedHash = await bcrypt.hash(plainPassword, rounds);
    return { ok: true, upgraded: true, upgradedHash };
  }

  return { ok: false, upgraded: false, upgradedHash: null };
}

module.exports = { isBcryptHash, verifyPassword };
