import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateOrReservedAddress } from "../server/networkSafety.js";

test("la remediation blocca IPv4 private, riservate e loopback", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "198.51.100.2",
    "203.0.113.10",
  ]) assert.equal(isPrivateOrReservedAddress(address), true, address);
  assert.equal(isPrivateOrReservedAddress("8.8.8.8"), false);
});

test("la remediation blocca IPv6 private e IPv4 incorporate", () => {
  for (const address of [
    "::1",
    "[::1]",
    "fc00::1",
    "fd00::1",
    "fe80::1",
    "fec0::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
  ]) assert.equal(isPrivateOrReservedAddress(address), true, address);
  assert.equal(isPrivateOrReservedAddress("2606:4700:4700::1111"), false);
});
