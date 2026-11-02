<?php
/** PHP built-in server router for the loopback-only native fixture. */
$root = realpath(__DIR__ . '/../.runtime/site');
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
$file = realpath($root . $path);
if ($file && str_starts_with($file, $root . DIRECTORY_SEPARATOR) &&
    (is_file($file) || (is_dir($file) && is_file($file . '/index.php')))) {
    return false;
}
require $root . '/index.php';
