<?php
/**
 * Plugin Name: SeoGrow Connector
 * Description: Espone a SeoGrow, tramite la REST API autenticata di WordPress, solo i campi necessari per Elementor, Rank Math e Yoast.
 * Version: 1.0.0
 * Author: SeoGrow AI
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

const SEOGROW_CONNECTOR_VERSION = '1.0.0';

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
        'sanitize_callback' => static function ($value) {
            if (!is_string($value)) {
                return '';
            }
            $decoded = json_decode($value, true);
            if (!is_array($decoded) && $decoded !== array()) {
                return new WP_Error('seogrow_invalid_elementor_json', 'I dati Elementor non contengono JSON valido.');
            }
            return $value;
        },
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

function seogrow_connector_status() {
    return rest_ensure_response(array(
        'ok' => true,
        'connector' => 'SeoGrow Connector',
        'version' => SEOGROW_CONNECTOR_VERSION,
        'elementor' => defined('ELEMENTOR_VERSION') || class_exists('Elementor\\Plugin'),
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
});
