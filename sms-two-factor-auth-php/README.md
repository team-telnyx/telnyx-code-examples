# OTP 2FA with PHP and Laravel

## What Does This Example Do?

Build a production-ready Laravel application that implements two-factor authentication (2FA) using one-time passwords (OTPs) delivered via SMS. This tutorial demonstrates secure OTP generation, storage, and verification using the Telnyx PHP SDK, along with proper error handling and session management for a complete authentication flow.

## Who Is This For?

- **PHP developers** building sms features with Laravel.
- **Backend engineers** integrating telephony or messaging into existing applications.
- **DevOps teams** looking for containerized, production-ready telecom examples.
- **Startups and enterprises** replacing legacy telecom providers with a modern API-first platform.

## Why Telnyx?

Telnyx is an **AI Communications Infrastructure** platform that gives developers a single API for [voice](https://telnyx.com/products/voice-ai-agents), [messaging](https://telnyx.com/products/sms-api), [SIP](https://telnyx.com/products/sip-trunks), [AI](https://telnyx.com/ai-assistants), and [IoT](https://telnyx.com/products/iot-sim-card) — no Frankenstack required.

- **Integrated platform** — [Voice](https://telnyx.com/products/voice-ai-agents), [SMS](https://telnyx.com/products/sms-api), [SIP trunking](https://telnyx.com/products/sip-trunks), [AI assistants](https://telnyx.com/ai-assistants), and [IoT SIM management](https://telnyx.com/products/iot-sim-card) under one roof. No stitching together multiple vendors.
- **Global private network** — Calls and messages traverse the Telnyx-owned IP network for lower latency and higher reliability than the public internet.
- **Developer-first** — SDKs for Python, Node.js, Go, Ruby, Java, and PHP. Comprehensive webhook event model. Sandbox environment for testing.
- **Competitive pricing** — Pay-as-you-go with no minimums, contracts, or per-seat fees.

## Prerequisites

- PHP 8.1 or higher.
- Laravel 10 or higher.
- Composer (PHP package manager).
- A Telnyx account with an active API key from the [Telnyx Portal](https://portal.telnyx.com).
- A Telnyx phone number enabled for outbound SMS.
- A database (SQLite for development is fine).

## Quick Start

### Option 1: Local (recommended)

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-php
cp .env.example .env
# Edit .env with your Telnyx API key and phone number
make setup
make run
```

### Option 2: Docker

```bash
git clone https://github.com/team-telnyx/telnyx-code-examples.git
cd telnyx-code-examples/sms-two-factor-auth-php
cp .env.example .env
# Edit .env with your credentials
make docker-build
make docker-run
```

### Option 3: Manual

See the [Implementation Details](#implementation-details) section below for step-by-step instructions.

## Implementation Details

Create a model for the OTP table:

```bash
php artisan make:model Otp
```

Edit `app/Models/Otp.php`:

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Otp extends Model
{
    protected $fillable = ['phone_number', 'code', 'expires_at', 'verified'];

    protected $casts = [
        'expires_at' => 'datetime',
        'verified' => 'boolean',
    ];

    /**
     * Check if OTP is still valid (not expired and not verified).
     */
    public function isValid(): bool
    {
        return !$this->verified && $this->expires_at->isFuture();
    }
}
```

Create a service class to handle OTP logic:

```bash
php artisan make:class Services/OtpService
```

Edit `app/Services/OtpService.php`:

```php
<?php

namespace App\Services;

use App\Models\Otp;
use Telnyx\Client;
use Telnyx\Exception\ApiException;
use Carbon\Carbon;

class OtpService
{
    private Client $client;
    private string $fromNumber;
    private int $otpExpiryMinutes;
    private int $otpLength;

    public function __construct()
    {
        $this->client = new Client(apiKey: config('telnyx.api_key'));
        $this->fromNumber = config('telnyx.from_number');
        $this->otpExpiryMinutes = config('telnyx.otp_expiry_minutes');
        $this->otpLength = config('telnyx.otp_length');
    }

    /**
     * Generate and send OTP to phone number.
     * Returns the OTP record on success.
     */
    public function generateAndSend(string $phoneNumber): Otp
    {
        // Validate E.164 format
        if (!preg_match('/^\+\d{1,15}$/', $phoneNumber)) {
            throw new \InvalidArgumentException('Phone number must be in E.164 format (e.g., +15551234567)');
        }

        // Generate random 6-digit code
        $code = str_pad(random_int(0, 10 ** $this->otpLength - 1), $this->otpLength, '0', STR_PAD_LEFT);

        // Create OTP record
        $otp = Otp::create([
            'phone_number' => $phoneNumber,
            'code' => $code,
            'expires_at' => Carbon::now()->addMinutes($this->otpExpiryMinutes),
            'verified' => false,
        ]);

        // Send SMS via Telnyx
        $this->sendOtpSms($phoneNumber, $code);

        return $otp;
    }

    /**
     * Send OTP code via SMS.
     */
    private function sendOtpSms(string $toNumber, string $code): void
    {
        $message = "Your verification code is: {$code}. Valid for {$this->otpExpiryMinutes} minutes.";

        $this->client->messages->create([
            'from' => $this->fromNumber,
            'to' => $toNumber,
            'text' => $message,
        ]);
    }

    /**
     * Verify OTP code for a phone number.
     * Returns true if valid, false otherwise.
     */
    public function verify(string $phoneNumber, string $code): bool
    {
        $otp = Otp::where('phone_number', $phoneNumber)
            ->where('code', $code)
            ->latest()
            ->first();

        if (!$otp || !$otp->isValid()) {
            return false;
        }

        $otp->update(['verified' => true]);
        return true;
    }

    /**
     * Get the most recent valid OTP for a phone number.
     */
    public function getLatestOtp(string $phoneNumber): ?Otp
    {
        return Otp::where('phone_number', $phoneNumber)
            ->where('verified', false)
            ->where('expires_at', '>', Carbon::now())
            ->latest()
            ->first();
    }
}
```

Create a controller to handle 2FA endpoints:

```bash
php artisan make:controller Auth/TwoFactorController
```

Edit `app/Http/Controllers/Auth/TwoFactorController.php`:

```php
<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Services\OtpService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Telnyx\Exception\ApiException;

class TwoFactorController extends Controller
{
    private OtpService $otpService;

    public function __construct(OtpService $otpService)
    {
        $this->otpService = $otpService;
    }

    /**
     * Request OTP for a phone number.
     */
    public function requestOtp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone_number' => 'required|string|regex:/^\+\d{1,15}$/',
        ]);

        try {
            $otp = $this->otpService->generateAndSend($validated['phone_number']);

            // Store phone number in session for verification step
            session(['pending_2fa_phone' => $validated['phone_number']]);

            return response()->json([
                'message' => 'OTP sent successfully',
                'phone_number' => $validated['phone_number'],
                'expires_in_minutes' => config('telnyx.otp_expiry_minutes'),
            ], 200);

        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (ApiException $e) {
            return response()->json([
                'error' => 'Failed to send OTP',
                'details' => $e->getMessage(),
            ], 503);
        } catch (\Exception $e) {
            return response()->json(['error' => 'An unexpected error occurred'], 500);
        }
    }

    /**
     * Verify OTP code.
     */
    public function verifyOtp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone_number' => 'required|string|regex:/^\+\d{1,15}$/',
            'code' => 'required|string|size:' . config('telnyx.otp_length'),
        ]);

        try {
            $isValid = $this->otpService->verify(
                $validated['phone_number'],
                $validated['code']
            );

            if (!$isValid) {
                return response()->json([
                    'error' => 'Invalid or expired OTP code',
                ], 401);
            }

            // Clear session and mark 2FA as complete
            session()->forget('pending_2fa_phone');
            session(['2fa_verified' => true, '2fa_phone' => $validated['phone_number']]);

            return response()->json([
                'message' => 'OTP verified successfully',
                'phone_number' => $validated['phone_number'],
            ], 200);

        } catch (\Exception $e) {
            return response()->json(['error' => 'Verification failed'], 500);
        }
    }

    /**
     * Resend OTP (rate-limited to prevent abuse).
     */
    public function resendOtp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone_number' => 'required|string|regex:/^\+\d{1,15}$/',
        ]);

        try {
            // Simple rate limiting: allow resend only if previous OTP is expired
            $latestOtp = $this->otpService->getLatestOtp($validated['phone_number']);

            if ($latestOtp && $latestOtp->expires_at->diffInSeconds() > 30) {
                return response()->json([
                    'error' => 'Please wait before requesting a new OTP',
                    'retry_after_seconds' => 30,
                ], 429);
            }

            $otp = $this->otpService->generateAndSend($validated['phone_number']);

            return response()->json([
                'message' => 'OTP resent successfully',
                'expires_in_minutes' => config('telnyx.otp_expiry_minutes'),
            ], 200);

        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 400);
        } catch (ApiException $e) {
            return response()->json([
                'error' => 'Failed to resend OTP',
                'details' => $e->getMessage(),
            ], 503);
        } catch (\Exception $e) {
            return response()->json(['error' => 'An unexpected error occurred'], 500);
        }
    }
}
```

Register the routes in `routes/api.php`:

```php
<?php

use App\Http\Controllers\Auth\TwoFactorController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/2fa/request-otp', [TwoFactorController::class, 'requestOtp']);
Route::post('/auth/2fa/verify-otp', [TwoFactorController::class, 'verifyOtp']);
Route::post('/auth/2fa/resend-otp', [TwoFactorController::class, 'resendOtp']);
```

## Complete Code

See [`index.php`](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main/sms-two-factor-auth-php/index.php) for the full implementation.

## Troubleshooting

| Issue | Problem | Solution |
|-------|---------|----------|
| Authentication Error (401) | The endpoint returns `{"error": "Failed to send OTP", "details": "Unauthorized"}` when requesting an OTP. | Verify your `TELNYX_API_KEY` in the `.env` file matches the key shown in the [Telnyx Portal](https://portal.telnyx.com). Ensure there are no trailing spaces or quotes. Restart the Laravel development server after updating the `.env` file. |
| Invalid Phone Number Format | You receive a 422 validation error stating the phone number does not match the required regex pattern. | Ensure all phone numbers use E.164 format: start with `+`, followed by country code and number without spaces or dashes. Example: `+15551234567` (US) or `+447700900123` (UK). Update your request JSON to use properly formatted numbers. |
| OTP Code Mismatch | The verification endpoint returns `{"error": "Invalid or expired OTP code"}` even though you entered the correct code. | Verify that the code you are entering matches exactly what was sent in the SMS (case-sensitive, no spaces). Check that the OTP has not expired—the default expiry is 10 minutes. If the code expired, request a new OTP using the resend endpoint. |

## FAQ

**Q: Do I need a Telnyx account to run this example?**

Yes. Sign up at [portal.telnyx.com](https://portal.telnyx.com) to get an API key. Telnyx offers free trial credit for testing.

**Q: Can I use this SMS example in production?**

Yes. This example includes error handling, environment-based configuration, and a Dockerfile for containerized deployment. Review the security and scaling sections before deploying to production.

**Q: What PHP version do I need?**

PHP 8.1 or higher.

**Q: How is Telnyx different from Twilio?**

Telnyx is an AI Communications Infrastructure platform with a private global network, integrated voice + messaging + AI + SIP + IoT under one API, and significantly lower pricing. No need to stitch together multiple vendors.

**Q: Where do I get a Telnyx phone number?**

Log into the [Telnyx Portal](https://portal.telnyx.com), navigate to Numbers > Search & Buy, and purchase a number with the capabilities you need (SMS, voice, or both).

## Resources

- [Messaging Overview](https://developers.telnyx.com/docs/messaging)
- [Send an SMS — Quickstart](https://developers.telnyx.com/docs/messaging/messages/send-message)
- [Messaging API Reference](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx SMS API](https://telnyx.com/products/sms-api)
- [Messaging Pricing](https://telnyx.com/pricing/messaging)

## Related Examples

- [Send Bulk SMS Messages](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/send-bulk-sms).
- [Receive SMS Webhooks with Laravel](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/receive-sms-webhook).
- [Build a Two-Way SMS Chat Application](https://raw.githubusercontent.com/team-telnyx/telnyx-code-examples/main//tutorials/sms/php/two-way-sms).
