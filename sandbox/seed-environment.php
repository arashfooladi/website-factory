<?php
require '/tools/seed.php';
update_option('factory_environment_id', getenv('FACTORY_ENVIRONMENT_ID'));
update_option('blogname', 'سایت آزمایشی ' . substr(getenv('FACTORY_PROJECT_ID'), 0, 8));
