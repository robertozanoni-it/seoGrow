import test from "node:test";
import assert from "node:assert/strict";
import {
  reconcileAuthoritativeInventoryWithPublicCoverage,
  validateAuthoritativeWordPressInventory,
} from "../server/elementorWordPressInventory.js";

const siteUrl = "https://example.com";
const validPayload = () => ({
  source: "seogrow-connector",
  connectorVersion: "1.3.1",
  readOnly: true,
  inventoryScope: "all-public-queryable-post-types",
  complete: true,
  truncated: false,
  totalResources: 3,
  resources: [
    { id: 1, postType: "page", status: "publish", url: "https://example.com/" },
    { id: 2, postType: "page", status: "publish", url: "https://example.com/a/" },
    { id: 3, postType: "post", status: "publish", url: "https://example.com/b/" },
  ],
});

test("inventario Connector completo e read-only viene accettato", () => {
  const result = validateAuthoritativeWordPressInventory(validPayload(), { siteUrl });
  assert.equal(result.verified, true);
  assert.equal(result.status, "verified-authoritative");
  assert.equal(result.resources.length, 3);
  assert.equal(result.sharedWriteAllowed, false);
});

test("claim client o sorgente diversa non diventa inventario autorevole", () => {
  const payload = validPayload();
  payload.source = "browser-client";
  const result = validateAuthoritativeWordPressInventory(payload, { siteUrl });
  assert.equal(result.verified, false);
  assert.equal(result.status, "invalid-contract");
});

test("inventario troncato, incompleto o oltre 30 risorse resta fail-closed", () => {
  const truncated = validPayload();
  truncated.truncated = true;
  assert.equal(validateAuthoritativeWordPressInventory(truncated, { siteUrl }).status, "truncated");

  const incomplete = validPayload();
  incomplete.complete = false;
  assert.equal(validateAuthoritativeWordPressInventory(incomplete, { siteUrl }).status, "incomplete");

  const large = validPayload();
  large.totalResources = 31;
  large.resources = Array.from({ length: 31 }, (_, index) => ({
    id: index + 1,
    postType: "page",
    status: "publish",
    url: `https://example.com/p-${index}/`,
  }));
  assert.equal(validateAuthoritativeWordPressInventory(large, { siteUrl }).status, "truncated");
});

test("duplicati, URL esterne e conteggi incoerenti bloccano l'inventario", () => {
  const duplicate = validPayload();
  duplicate.resources[2] = { id: 2, postType: "page", status: "publish", url: "https://example.com/b/" };
  assert.equal(validateAuthoritativeWordPressInventory(duplicate, { siteUrl }).status, "invalid-resources");

  const external = validPayload();
  external.resources[2].url = "https://evil.example.net/b/";
  assert.equal(validateAuthoritativeWordPressInventory(external, { siteUrl }).status, "invalid-resources");

  const mismatch = validPayload();
  mismatch.totalResources = 4;
  assert.equal(validateAuthoritativeWordPressInventory(mismatch, { siteUrl }).status, "count-mismatch");
});

test("inventario autorevole e coverage pubblica devono coincidere esattamente", () => {
  const inventory = validateAuthoritativeWordPressInventory(validPayload(), { siteUrl });
  const publicCoverage = {
    publicCoverageReconciled: true,
    sitemapUrls: [
      "https://example.com/",
      "https://example.com/a/",
      "https://example.com/b/",
    ],
  };
  const result = reconcileAuthoritativeInventoryWithPublicCoverage(inventory, publicCoverage);
  assert.equal(result.verified, true);
  assert.equal(result.status, "verified-complete");
  assert.equal(result.sharedWriteAllowed, false);
});

test("una URL WordPress assente dalla sitemap impedisce la complete site enumeration", () => {
  const inventory = validateAuthoritativeWordPressInventory(validPayload(), { siteUrl });
  const result = reconcileAuthoritativeInventoryWithPublicCoverage(inventory, {
    publicCoverageReconciled: true,
    sitemapUrls: ["https://example.com/", "https://example.com/a/"],
  });
  assert.equal(result.verified, false);
  assert.equal(result.status, "inventory-public-mismatch");
});
