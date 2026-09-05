import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const connector = await readFile(
  new URL("../wordpress-plugin/seogrow-connector/seogrow-connector.php", import.meta.url),
  "utf8",
);

test("Connector espone un endpoint Elementor impact autenticato e strettamente read-only", () => {
  assert.match(connector, /\/elementor-impact-inspect/);
  assert.match(connector, /seogrow_connector_elementor_impact_inspect/);
  assert.match(connector, /'methods' => WP_REST_Server::READABLE/);
  assert.match(connector, /'elementorImpactReadOnly' => true/);
  assert.match(connector, /'readOnly' => true/);
  assert.match(connector, /'sharedWriteAllowed' => false/);
});

test("Connector legge type e Display Conditions direttamente dai meta Elementor senza registrarli come campi scrivibili", () => {
  assert.match(connector, /get_post_meta\(\$id, '_elementor_template_type', true\)/);
  assert.match(connector, /metadata_exists\('post', \$id, '_elementor_conditions'\)/);
  assert.match(connector, /get_post_meta\(\$id, '_elementor_conditions', true\)/);
  assert.doesNotMatch(connector, /register_post_meta\([^\n]*'_elementor_conditions'/);
  assert.doesNotMatch(connector, /register_post_meta\([^\n]*'_elementor_template_type'/);
});

test("Connector limita gli ID, verifica elementor_library e richiede permesso sul singolo documento", () => {
  assert.match(connector, /array_slice\(explode\(',', \$raw_ids\), 0, 20\)/);
  assert.match(connector, /\$post->post_type !== 'elementor_library'/);
  assert.match(connector, /current_user_can\('edit_post', \$id\)/);
});

test("endpoint impact non contiene primitive di scrittura Elementor", () => {
  const start = connector.indexOf("function seogrow_connector_elementor_impact_inspect");
  const end = connector.indexOf("function seogrow_connector_url_identity", start);
  assert.ok(start >= 0 && end > start);
  const impact = connector.slice(start, end);
  assert.doesNotMatch(impact, /update_post_meta|delete_post_meta|wp_update_post|set_value|update_option/i);
});
