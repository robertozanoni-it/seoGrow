<?php
/**
 * Plugin Name: SeoGrow Connector
 * Description: Espone a SeoGrow, tramite la REST API autenticata di WordPress, solo i campi necessari per Elementor, Rank Math e Yoast.
 * Version: 1.3.0
 * Author: SeoGrow AI
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

const SEOGROW_CONNECTOR_VERSION = '1.3.0';

function seogrow_connector_can_edit_meta($allowed, $meta_key, $object_id) {
    $post_id = absint($object_id);
    return $post_id > 0 && current_user_can('edit_post', $post_id);
}

function seogrow_connector_string_schema() {
    return array(
        'single' => true,
        'type' => 'string',
        'show_in_rest' => true,
        'auth_callback' => 'seogrow_connector_can_edit_meta',
        'sanitize_callback' => static function ($value) {
            return is_scalar($value) ? wp_check_invalid_utf8((string) $value) : '';
        },
    );
}

function seogrow_connector_register_string_meta($post_type, $key) {
    register_post_meta($post_type, $key, seogrow_connector_string_schema());
}

function seogrow_connector_register_array_meta($post_type, $key) {
    register_post_meta($post_type, $key, array(
        'single' => true,
        'type' => 'array',
        'show_in_rest' => array(
            'schema' => array(
                'type' => 'array',
                'items' => array('type' => 'string'),
                'default' => array(),
            ),
        ),
        'auth_callback' => 'seogrow_connector_can_edit_meta',
        'sanitize_callback' => static function ($value) {
            if (!is_array($value)) {
                return array();
            }
            return array_values(array_unique(array_map(static function ($item) {
                return sanitize_text_field((string) $item);
            }, array_slice($value, 0, 30))));
        },
    ));
}

function seogrow_connector_register_elementor_meta($post_type) {
    register_post_meta($post_type, '_elementor_data', array(
        'single' => true,
        'type' => 'string',
        'show_in_rest' => true,
        'auth_callback' => 'seogrow_connector_can_edit_meta',
    ));
}

function seogrow_connector_register_meta() {
    $post_types = array('page', 'post');
    $has_elementor = defined('ELEMENTOR_VERSION') || class_exists('Elementor\\Plugin');
    $has_rank_math = defined('RANK_MATH_VERSION') || class_exists('RankMath\\Helper');
    $has_yoast = defined('WPSEO_VERSION') || class_exists('WPSEO_Options');

    foreach ($post_types as $post_type) {
        if ($has_elementor) {
            seogrow_connector_register_elementor_meta($post_type);
        }
        if ($has_rank_math) {
            foreach (array('rank_math_title', 'rank_math_description', 'rank_math_canonical_url') as $key) {
                seogrow_connector_register_string_meta($post_type, $key);
            }
            seogrow_connector_register_array_meta($post_type, 'rank_math_robots');
        }
        if ($has_yoast) {
            foreach (array('_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_canonical', '_yoast_wpseo_meta-robots-noindex') as $key) {
                seogrow_connector_register_string_meta($post_type, $key);
            }
        }
    }
}
add_action('init', 'seogrow_connector_register_meta', 99);

function seogrow_connector_clear_elementor_cache($meta_id, $post_id, $meta_key) {
    if ($meta_key !== '_elementor_data') {
        return;
    }
    try {
        if (class_exists('Elementor\\Plugin') && isset(\Elementor\Plugin::$instance->files_manager)) {
            \Elementor\Plugin::$instance->files_manager->clear_cache();
        }
    } catch (Throwable $error) {
        // La scrittura del contenuto resta valida anche se la cache verrà rigenerata da Elementor in seguito.
    }
}
add_action('updated_post_meta', 'seogrow_connector_clear_elementor_cache', 10, 3);
add_action('added_post_meta', 'seogrow_connector_clear_elementor_cache', 10, 3);

function seogrow_connector_elementor_shared_template_types() {
    if (!(defined('ELEMENTOR_VERSION') || class_exists('Elementor\\Plugin'))) {
        return array();
    }

    $ids = get_posts(array(
        'post_type' => 'elementor_library',
        'post_status' => 'publish',
        'fields' => 'ids',
        'posts_per_page' => 200,
        'no_found_rows' => true,
        'orderby' => 'ID',
        'order' => 'DESC',
    ));
    if (!is_array($ids) || !$ids) {
        return array();
    }

    $shared = array('header', 'footer', 'single', 'archive', 'popup', 'widget');
    $types = array();
    foreach ($ids as $id) {
        $type = sanitize_key((string) get_post_meta(absint($id), '_elementor_template_type', true));
        if ($type && in_array($type, $shared, true)) {
            $types[$type] = true;
        }
    }
    return array_values(array_keys($types));
}

function seogrow_connector_url_identity($value) {
    $parts = wp_parse_url((string) $value);
    if (!is_array($parts) || empty($parts['host'])) {
        return null;
    }
    $path = isset($parts['path']) ? rawurldecode((string) $parts['path']) : '/';
    $path = untrailingslashit($path);
    if ($path === '') {
        $path = '/';
    }
    return array(
        'host' => strtolower((string) $parts['host']),
        'path' => $path,
    );
}

function seogrow_connector_term_matches_url($term, $target_identity) {
    $link = get_term_link($term);
    if (is_wp_error($link)) {
        return false;
    }
    $identity = seogrow_connector_url_identity($link);
    return is_array($identity)
        && $identity['host'] === $target_identity['host']
        && $identity['path'] === $target_identity['path'];
}

function seogrow_connector_find_exact_taxonomy_term($target_url) {
    $target_identity = seogrow_connector_url_identity($target_url);
    if (!is_array($target_identity)) {
        return new WP_Error('seogrow_invalid_taxonomy_url', 'URL tassonomia non valido.', array('status' => 400));
    }

    $path = $target_identity['path'];
    $slug_candidate = sanitize_title(rawurldecode(basename($path)));
    if ($slug_candidate === '') {
        return new WP_Error('seogrow_taxonomy_not_found', 'La URL non identifica una categoria o un tag.', array('status' => 404));
    }

    $terms = get_terms(array(
        'taxonomy' => array('category', 'post_tag'),
        'hide_empty' => false,
        'slug' => $slug_candidate,
        'number' => 20,
    ));
    if (is_wp_error($terms)) {
        return $terms;
    }

    $matches = array();
    foreach ($terms as $term) {
        if (seogrow_connector_term_matches_url($term, $target_identity)) {
            $matches[] = $term;
        }
    }

    if (count($matches) !== 1) {
        $message = count($matches) > 1
            ? 'Più tassonomie WordPress corrispondono alla stessa URL: ownership ambigua.'
            : 'Nessuna categoria o tag WordPress coincide esattamente con la URL richiesta.';
        return new WP_Error('seogrow_taxonomy_identity_unresolved', $message, array('status' => 409));
    }
    return $matches[0];
}

function seogrow_connector_rank_math_term_values($term_id) {
    $robots = array_values(array_filter((array) get_term_meta($term_id, 'rank_math_robots', true), 'is_scalar'));
    return array(
        'title' => (string) get_term_meta($term_id, 'rank_math_title', true),
        'meta_description' => (string) get_term_meta($term_id, 'rank_math_description', true),
        'canonical' => (string) get_term_meta($term_id, 'rank_math_canonical_url', true),
        'robots' => $robots,
        'noindex' => in_array('noindex', array_map('strtolower', array_map('strval', $robots)), true),
    );
}

function seogrow_connector_yoast_term_values($term) {
    if (!class_exists('WPSEO_Taxonomy_Meta') || !method_exists('WPSEO_Taxonomy_Meta', 'get_term_meta')) {
        return null;
    }
    $noindex = strtolower((string) WPSEO_Taxonomy_Meta::get_term_meta($term, $term->taxonomy, 'noindex'));
    return array(
        'title' => (string) WPSEO_Taxonomy_Meta::get_term_meta($term, $term->taxonomy, 'title'),
        'meta_description' => (string) WPSEO_Taxonomy_Meta::get_term_meta($term, $term->taxonomy, 'desc'),
        'canonical' => (string) WPSEO_Taxonomy_Meta::get_term_meta($term, $term->taxonomy, 'canonical'),
        'noindex' => in_array($noindex, array('noindex', '1', 'true'), true),
        'noindex_raw' => $noindex,
    );
}

function seogrow_connector_taxonomy_plugins() {
    return array(
        'rankMath' => defined('RANK_MATH_VERSION') || class_exists('RankMath\\Helper'),
        'yoast' => defined('WPSEO_VERSION') || class_exists('WPSEO_Options'),
    );
}

function seogrow_connector_taxonomy_values_for_adapter($term, $adapter) {
    if ($adapter === 'rank-math') {
        return seogrow_connector_rank_math_term_values($term->term_id);
    }
    if ($adapter === 'yoast') {
        return seogrow_connector_yoast_term_values($term);
    }
    return null;
}

function seogrow_connector_taxonomy_field_value($values, $field) {
    if (!is_array($values) || !array_key_exists($field, $values)) {
        return null;
    }
    if ($field === 'noindex') {
        return (bool) $values[$field];
    }
    return (string) $values[$field];
}

function seogrow_connector_taxonomy_inspection_payload($term) {
    $link = get_term_link($term);
    if (is_wp_error($link)) {
        return $link;
    }
    $plugins = seogrow_connector_taxonomy_plugins();
    return array(
        'ok' => true,
        'readOnly' => true,
        'resource' => 'taxonomy',
        'term' => array(
            'id' => (int) $term->term_id,
            'taxonomy' => (string) $term->taxonomy,
            'slug' => (string) $term->slug,
            'name' => (string) $term->name,
            'description' => (string) $term->description,
            'link' => (string) $link,
        ),
        'seo' => array(
            'rankMath' => $plugins['rankMath'] ? seogrow_connector_rank_math_term_values($term->term_id) : null,
            'yoast' => $plugins['yoast'] ? seogrow_connector_yoast_term_values($term) : null,
        ),
        'plugins' => $plugins,
    );
}

function seogrow_connector_taxonomy_inspect(WP_REST_Request $request) {
    $target_url = esc_url_raw((string) $request->get_param('url'));
    if (!$target_url) {
        return new WP_Error('seogrow_taxonomy_url_required', 'URL tassonomia obbligatorio.', array('status' => 400));
    }
    $term = seogrow_connector_find_exact_taxonomy_term($target_url);
    if (is_wp_error($term)) {
        return $term;
    }
    if (!current_user_can('edit_term', $term->term_id)) {
        return new WP_Error('seogrow_taxonomy_forbidden', 'Permessi insufficienti per modificare questa tassonomia.', array('status' => 403));
    }
    $payload = seogrow_connector_taxonomy_inspection_payload($term);
    return is_wp_error($payload) ? $payload : rest_ensure_response($payload);
}

function seogrow_connector_taxonomy_validate_write($term, $adapter, $field, $value, $expected_current) {
    $allowed_fields = array('title', 'meta_description', 'canonical', 'noindex');
    if (!in_array($field, $allowed_fields, true)) {
        return new WP_Error('seogrow_taxonomy_field_unsupported', 'Campo tassonomia non supportato.', array('status' => 400));
    }

    $plugins = seogrow_connector_taxonomy_plugins();
    if ($plugins['rankMath'] && $plugins['yoast']) {
        return new WP_Error('seogrow_taxonomy_owner_ambiguous', 'Rank Math e Yoast risultano entrambi attivi: ownership SEO tassonomia ambigua.', array('status' => 409));
    }
    if (!$plugins['rankMath'] && !$plugins['yoast']) {
        return new WP_Error('seogrow_taxonomy_owner_missing', 'Nessun plugin SEO tassonomia supportato è attivo.', array('status' => 409));
    }
    if (($adapter === 'rank-math' && !$plugins['rankMath']) || ($adapter === 'yoast' && !$plugins['yoast']) || !in_array($adapter, array('rank-math', 'yoast'), true)) {
        return new WP_Error('seogrow_taxonomy_adapter_mismatch', 'L’adapter richiesto non coincide con il plugin SEO attivo.', array('status' => 409));
    }

    $values = seogrow_connector_taxonomy_values_for_adapter($term, $adapter);
    if (!is_array($values)) {
        return new WP_Error('seogrow_taxonomy_adapter_unavailable', 'L’adapter SEO non espone valori tassonomia leggibili.', array('status' => 409));
    }
    $current = seogrow_connector_taxonomy_field_value($values, $field);
    $expected = $field === 'noindex' ? rest_sanitize_boolean($expected_current) : (string) $expected_current;
    if ($current !== $expected) {
        return new WP_Error('seogrow_taxonomy_stale', 'Il valore tassonomia è cambiato dopo l’anteprima. Rigenera l’anteprima prima di applicare.', array('status' => 409));
    }

    $next = $field === 'noindex' ? rest_sanitize_boolean($value) : wp_check_invalid_utf8((string) $value);
    if ($field === 'canonical' && $next !== '' && !wp_http_validate_url($next)) {
        return new WP_Error('seogrow_taxonomy_canonical_invalid', 'Canonical tassonomia non valida.', array('status' => 400));
    }
    if (in_array($field, array('title', 'meta_description'), true) && trim($next) === '') {
        return new WP_Error('seogrow_taxonomy_empty_value', 'Il nuovo valore SEO non può essere vuoto.', array('status' => 400));
    }
    if ($current === $next) {
        return new WP_Error('seogrow_taxonomy_no_change', 'Il nuovo valore coincide con quello corrente.', array('status' => 409));
    }
    return array('current' => $current, 'next' => $next, 'plugins' => $plugins);
}

function seogrow_connector_taxonomy_write_rank_math($term, $field, $value) {
    $keys = array(
        'title' => 'rank_math_title',
        'meta_description' => 'rank_math_description',
        'canonical' => 'rank_math_canonical_url',
    );
    if ($field === 'noindex') {
        $robots = array_values(array_filter((array) get_term_meta($term->term_id, 'rank_math_robots', true), 'is_scalar'));
        $robots = array_values(array_filter($robots, static function ($item) {
            return !in_array(strtolower((string) $item), array('index', 'noindex'), true);
        }));
        array_unshift($robots, $value ? 'noindex' : 'index');
        return update_term_meta($term->term_id, 'rank_math_robots', array_values(array_unique($robots)));
    }
    return update_term_meta($term->term_id, $keys[$field], $value);
}

function seogrow_connector_taxonomy_write_yoast($term, $field, $value) {
    if (!class_exists('WPSEO_Taxonomy_Meta') || !method_exists('WPSEO_Taxonomy_Meta', 'set_value')) {
        return new WP_Error('seogrow_yoast_taxonomy_write_unavailable', 'Yoast non espone la API tassonomia necessaria alla scrittura controllata.', array('status' => 409));
    }
    $keys = array(
        'title' => 'title',
        'meta_description' => 'desc',
        'canonical' => 'canonical',
        'noindex' => 'noindex',
    );
    $stored = $field === 'noindex' ? ($value ? 'noindex' : 'index') : $value;
    WPSEO_Taxonomy_Meta::set_value($term->term_id, $term->taxonomy, $keys[$field], $stored);
    do_action('wpseo_save_taxonomy_meta', $term->term_id, $term->taxonomy);
    return true;
}

function seogrow_connector_taxonomy_write(WP_REST_Request $request) {
    $target_url = esc_url_raw((string) $request->get_param('url'));
    $term_id = absint($request->get_param('termId'));
    $taxonomy = sanitize_key((string) $request->get_param('taxonomy'));
    $adapter = sanitize_key((string) $request->get_param('adapter'));
    $field = sanitize_key((string) $request->get_param('field'));
    $expected_current = $request->get_param('expectedCurrent');
    $value = $request->get_param('value');

    if (!$target_url || !$term_id || !in_array($taxonomy, array('category', 'post_tag'), true)) {
        return new WP_Error('seogrow_taxonomy_identity_required', 'Identità tassonomia completa obbligatoria.', array('status' => 400));
    }
    $term = seogrow_connector_find_exact_taxonomy_term($target_url);
    if (is_wp_error($term)) {
        return $term;
    }
    if ((int) $term->term_id !== $term_id || (string) $term->taxonomy !== $taxonomy) {
        return new WP_Error('seogrow_taxonomy_identity_changed', 'ID o tassonomia non coincidono con la risorsa richiesta.', array('status' => 409));
    }
    if (!current_user_can('edit_term', $term->term_id)) {
        return new WP_Error('seogrow_taxonomy_forbidden', 'Permessi insufficienti per modificare questa tassonomia.', array('status' => 403));
    }

    $validation = seogrow_connector_taxonomy_validate_write($term, $adapter, $field, $value, $expected_current);
    if (is_wp_error($validation)) {
        return $validation;
    }
    $before = $validation['current'];
    $result = $adapter === 'rank-math'
        ? seogrow_connector_taxonomy_write_rank_math($term, $field, $validation['next'])
        : seogrow_connector_taxonomy_write_yoast($term, $field, $validation['next']);
    if (is_wp_error($result)) {
        return $result;
    }

    clean_term_cache($term->term_id, $term->taxonomy);
    $fresh = get_term($term->term_id, $term->taxonomy);
    if (!$fresh || is_wp_error($fresh)) {
        return new WP_Error('seogrow_taxonomy_reread_failed', 'Scrittura eseguita ma rilettura tassonomia non riuscita: verifica manuale necessaria.', array('status' => 500));
    }
    $after_values = seogrow_connector_taxonomy_values_for_adapter($fresh, $adapter);
    $after = seogrow_connector_taxonomy_field_value($after_values, $field);
    if ($after !== $validation['next']) {
        return new WP_Error('seogrow_taxonomy_persistence_unverified', 'WordPress non ha restituito il valore richiesto dopo la scrittura. Nessun successo viene dichiarato.', array('status' => 409));
    }

    return rest_ensure_response(array(
        'ok' => true,
        'resource' => 'taxonomy',
        'staleChecked' => true,
        'singleField' => true,
        'term' => array(
            'id' => (int) $fresh->term_id,
            'taxonomy' => (string) $fresh->taxonomy,
            'slug' => (string) $fresh->slug,
            'link' => (string) get_term_link($fresh),
        ),
        'adapter' => $adapter,
        'field' => $field,
        'before' => $before,
        'after' => $after,
    ));
}

function seogrow_connector_status() {
    $has_elementor = defined('ELEMENTOR_VERSION') || class_exists('Elementor\\Plugin');
    return rest_ensure_response(array(
        'ok' => true,
        'connector' => 'SeoGrow Connector',
        'version' => SEOGROW_CONNECTOR_VERSION,
        'elementor' => $has_elementor,
        'elementorPro' => defined('ELEMENTOR_PRO_VERSION'),
        'elementorSharedTemplateTypes' => $has_elementor ? seogrow_connector_elementor_shared_template_types() : array(),
        'taxonomyInspect' => true,
        'taxonomyWriteSingleField' => true,
        'rankMath' => defined('RANK_MATH_VERSION') || class_exists('RankMath\\Helper'),
        'yoast' => defined('WPSEO_VERSION') || class_exists('WPSEO_Options'),
    ));
}

add_action('rest_api_init', static function () {
    register_rest_route('seogrow/v1', '/status', array(
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'seogrow_connector_status',
        'permission_callback' => static function () {
            return current_user_can('edit_posts') || current_user_can('edit_pages');
        },
    ));

    register_rest_route('seogrow/v1', '/taxonomy-inspect', array(
        'methods' => WP_REST_Server::READABLE,
        'callback' => 'seogrow_connector_taxonomy_inspect',
        'permission_callback' => static function () {
            return current_user_can('edit_posts') || current_user_can('manage_categories');
        },
        'args' => array(
            'url' => array(
                'required' => true,
                'type' => 'string',
                'sanitize_callback' => 'esc_url_raw',
            ),
        ),
    ));

    register_rest_route('seogrow/v1', '/taxonomy-write', array(
        'methods' => WP_REST_Server::CREATABLE,
        'callback' => 'seogrow_connector_taxonomy_write',
        'permission_callback' => static function () {
            return current_user_can('edit_posts') || current_user_can('manage_categories');
        },
        'args' => array(
            'url' => array('required' => true, 'type' => 'string', 'sanitize_callback' => 'esc_url_raw'),
            'termId' => array('required' => true, 'type' => 'integer'),
            'taxonomy' => array('required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_key'),
            'adapter' => array('required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_key'),
            'field' => array('required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_key'),
            'expectedCurrent' => array('required' => true),
            'value' => array('required' => true),
        ),
    ));
});
