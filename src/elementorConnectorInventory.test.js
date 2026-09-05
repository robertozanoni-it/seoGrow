import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const connector = await readFile(
  new URL("../wordpress-plugin/seogrow-connector/seogrow-connector.php", import.meta.url),
  "utf8",
);

test("Connector espone inventario WordPress autorevole strettamente read-only", () => {
  assert.match(connector, /\/wordpress-public-inventory/);
  assert.match(connector, /seogrow_connector_wordpress_public_inventory/);
  assert.match(connector, /'source' => 'seogrow-connector'/);
  assert.match(connector, /'inventoryScope' => 'all-public-queryable-post-types'/);
  assert.match(connector, /'readOnly' => true/);
  assert.match(connector, /'wordpressPublicInventoryReadOnly' => true/);
});

test("inventario usa post type pubblici e publicly_queryable e solo risorse publish", () => {
  const start = connector.indexOf("function seogrow_connector_wordpress_public_inventory");
  const end = connector.indexOf("function seogrow_connector_status", start);
  assert.ok(start >= 0 && end > start);
  const inventory = connector.slice(start, end);
  assert.match(inventory, /get_post_types/);
  assert.match(inventory, /'public' => true/);
  assert.match(inventory, /'publicly_queryable' => true/);
  assert.match(inventory, /'post_status' => 'publish'/);
  assert.match(inventory, /'posts_per_page' => 31/);
  assert.match(inventory, /'no_found_rows' => false/);
  assert.match(inventory, /get_permalink/);
  assert.doesNotMatch(inventory, /update_post_meta|delete_post_meta|wp_update_post|update_option|set_value/i);
});

test("inventario dichiara completezza solo se non troncato e il conteggio coincide", () => {
  assert.match(connector, /'complete' => !\$truncated && count\(\$resources\) === \$total_resources/);
  assert.match(connector, /'truncated' => \$truncated/);
  assert.match(connector, /'totalResources' => \$total_resources/);
  assert.match(connector, /'connectorVersion' => SEOGROW_CONNECTOR_VERSION/);
});

test("endpoint inventario è READABLE e non accetta argomenti di scrittura", () => {
  const route = connector.indexOf("'/wordpress-public-inventory'");
  assert.ok(route >= 0);
  const fragment = connector.slice(route, route + 800);
  assert.match(fragment, /'methods' => WP_REST_Server::READABLE/);
  assert.match(fragment, /'callback' => 'seogrow_connector_wordpress_public_inventory'/);
  assert.doesNotMatch(fragment, /WP_REST_Server::CREATABLE|expectedCurrent|value/);
});
