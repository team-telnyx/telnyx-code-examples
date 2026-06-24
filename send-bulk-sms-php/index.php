<?php
// config/telnyx.php
return [
    'api_key' => env('TELNYX_API_KEY'),
    'from_number' => env('TELNYX_PHONE_NUMBER'),
    'rate_limit_delay' => (int) env('RATE_LIMIT_DELAY', 100),
];
