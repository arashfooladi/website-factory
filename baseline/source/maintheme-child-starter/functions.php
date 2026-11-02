<?php
/** Maintheme child starter bootstrap. */
defined( 'ABSPATH' ) || exit;

/**
 * Example: add a child-specific dependency before the child stylesheet.
 */
function maintheme_child_dependencies( array $dependencies ): array {
	return $dependencies;
}
add_filter( 'maintheme_child_style_dependencies', 'maintheme_child_dependencies' );
