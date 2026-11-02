<?php
define('ABSPATH', __DIR__ . '/');
$source_root = $argv[1] ?? dirname(__DIR__) . '/baseline/source';
require $source_root . '/maintheme-iran-commerce/includes/helpers.php';
use function Maintheme_Iran_Commerce\Helpers\normalize_digits;
use function Maintheme_Iran_Commerce\Helpers\normalize_mobile;
use function Maintheme_Iran_Commerce\Helpers\normalize_postcode;
use function Maintheme_Iran_Commerce\Helpers\valid_mobile;
use function Maintheme_Iran_Commerce\Helpers\valid_postcode;
$cases = [
  ['digits', normalize_digits('۱۲۳٤٥'), '12345'],
  ['mobile-fa', normalize_mobile('۰۹۱۲ ۳۴۵ ۶۷۸۹'), '09123456789'],
  ['mobile-plus98', normalize_mobile('+98 912 345 6789'), '09123456789'],
  ['mobile-0098', normalize_mobile('0098-912-345-6789'), '09123456789'],
  ['mobile-bare', normalize_mobile('9123456789'), '09123456789'],
  ['postcode', normalize_postcode('۱۲۳۴۵-۶۷۸۹۰'), '1234567890'],
  ['valid-mobile', valid_mobile('09123456789'), true],
  ['invalid-mobile', valid_mobile('08123456789'), false],
  ['valid-postcode', valid_postcode('۱۲۳۴۵۶۷۸۹۰'), true],
  ['invalid-postcode', valid_postcode('12345'), false],
];
$failed = 0;
foreach ($cases as [$name, $actual, $expected]) {
    $ok = $actual === $expected;
    echo ($ok ? 'PASS' : 'FAIL') . " $name" . PHP_EOL;
    if (!$ok) { var_export(['actual'=>$actual,'expected'=>$expected]); echo PHP_EOL; $failed++; }
}
exit($failed ? 1 : 0);
