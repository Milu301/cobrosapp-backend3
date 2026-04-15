function permTrue(permissions, key) {
  if (!permissions) return false;
  const v = permissions[key];
  return v === true || v === "true" || v === 1 || v === "1";
}

module.exports = { permTrue };
