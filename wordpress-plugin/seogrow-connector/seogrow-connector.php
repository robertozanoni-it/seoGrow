<?php
/**
 * Plugin Name: SeoGrow Connector
 * Description: Espone a SeoGrow, tramite la REST API autenticata di WordPress, solo i campi necessari per Elementor, Rank Math e Yoast.
 * Version: 1.2.0
 * Author: SeoGrow AI
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

const SEOGROW_CONNECTOR_VERSION = '1.2.0';

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
    return array(
        'title' => (string) get_term_meta($term_id, 'rank_math_title', true),
        'meta_description' => (string) get_term_meta($term_id, 'rank_math_description', true),
        'canonical' => (string) get_term_meta($term_id, 'rank_math_canonical_url', true),
        'robots' => array_values(array_filter((array) get_term_meta($term_id, 'rank_math_robots', true), 'is_scalar')),
    );
}

function seogrow_connector_yoast_term_values($term) {
    if (!class_exists('WPSEO_Taxonomy_Meta') || !method_exists('WPSEO_Taxonomy_Meta', 'get_term_meta')) {
        return null;
    }
    return array(
        'title' => (string) WPSEO_Taxonomy_Meta::get_term_meta($term, $term->taxonomy, 'title'),
        'meta_description' => (string) WPSEO_Taxonomy_Meta::get_term_meta($term, $term->taxonomy, 'desc'),
        'canonical' => (string) WPSEO_Taxonomy_Meta::get_term_meta($term, $term->taxonomy, 'canonical'),
        'noindex' => (string) WPSEO_Taxonomy_Meta::get_term_meta($term, $term->taxonomy, 'noindex'),
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
    $taxonomy = get_taxonomy($term->taxonomy);
    if (!$taxonomy || !current_user_can('edit_term', $term->term_id)) {
        return new WP_Error('seogrow_taxonomy_forbidden', 'Permessi insufficienti per modificare questa tassonomia.', array('status' => 403));
    }

    $link = get_term_link($term);
    if (is_wp_error($link)) {
        return $link;
    }
    $has_rank_math = defined('RANK_MATH_VERSION') || class_exists('RankMath\\Helper');
    $has_yoast = defined('WPSEO_VERSION') || class_exists('WPSEO_Options');

    return rest_ensure_response(array(
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
            'rankMath' => $has_rank_math ? seogrow_connector_rank_math_term_values($term->term_id) : null,
            'yoast' => $has_yoast ? seogrow_connector_yoast_term_values($term) : null,
        ),
        'plugins' => array(
            'rankMath' => $has_rank_math,
            'yoast' => $has_yoast,
        ),
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
});
