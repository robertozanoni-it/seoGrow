import net from "node:net";

export function isPrivateOrReservedAddress(address) {
  const addressText = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = addressText.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return isPrivateOrReservedAddress(mapped);

  if (net.isIPv4(addressText)) {
    const [a, b, c] = addressText.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && [0, 2].includes(c)) ||
      (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113);
  }

  const embeddedV4 = (value) => {
    const groups = value.split(":").filter(Boolean);
    if (groups.length < 2) return "";
    const high = Number.parseInt(groups.at(-2), 16);
    const low = Number.parseInt(groups.at(-1), 16);
    if (![high, low].every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)) return "";
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  };

  if (/^(?:::ffff:|::|64:ff9b::)/.test(addressText)) {
    const embedded = embeddedV4(addressText);
    if (embedded && isPrivateOrReservedAddress(embedded)) return true;
  }

  return addressText === "::" || addressText === "::1" ||
    addressText.startsWith("fc") || addressText.startsWith("fd") ||
    /^fe[89ab]/.test(addressText) || /^fe[c-f]/.test(addressText) ||
    addressText.startsWith("ff") || addressText.startsWith("2001:db8:");
}
