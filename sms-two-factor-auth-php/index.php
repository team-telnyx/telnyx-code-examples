<?php
// app/Services/OtpService.php
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

    public function generateAndSend(string $phoneNumber): Otp
    {
        if (!preg_match('/^\+\d{1,15}$/', $phoneNumber)) {
            throw new \InvalidArgumentException('Phone number must be in E.164 format (e.g., +15551234567)');
        }

        $code = str_pad(random_int(0, 10 ** $this->otpLength - 1), $this->otpLength, '0', STR_PAD_LEFT);

        $otp = Otp::create([
            'phone_number' => $phoneNumber,
            'code' => $code,
            'expires_at' => Carbon::now()->addMinutes($this->otpExpiryMinutes),
            'verified' => false,
        ]);

        $this->sendOtpSms($phoneNumber, $code);

        return $otp;
    }

    private function sendOtpSms(string $toNumber, string $code): void
    {
        $message = "Your verification code is: {$code}. Valid for {$this->otpExpiryMinutes} minutes.";

        $this->client->messages->create([
            'from' => $this->fromNumber,
            'to' => $toNumber,
            'text' => $message,
        ]);
    }

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

    public function getLatestOtp(string $phoneNumber): ?Otp
    {
        return Otp::where('phone_number', $phoneNumber)
            ->where('verified', false)
            ->where('expires_at', '>', Carbon::now())
            ->latest()
            ->first();
    }
}

// app/Models/Otp.php
namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Otp extends Model
{
    protected $fillable = ['phone_number', 'code', 'expires_at', 'verified'];

    protected $casts = [
        'expires_at' => 'datetime',
        'verified' => 'boolean',
    ];

    public function isValid(): bool
    {
        return !$this->verified && $this->expires_at->isFuture();
    }
}

// app/Http/Controllers/Auth/TwoFactorController.php
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

    public function requestOtp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone_number' => 'required|string|regex:/^\+\d{1,15}$/',
        ]);

        try {
            $otp = $this->otpService->generateAndSend($validated['phone_number']);

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

    public function resendOtp(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'phone_number' => 'required|string|regex:/^\+\d{1,15}$/',
        ]);

        try {
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

// config/telnyx.php
return [
    'api_key' => env('TELNYX_API_KEY'),
    'from_number' => env('TELNYX_PHONE_NUMBER'),
    'otp_expiry_minutes' => env('OTP_EXPIRY_MINUTES', 10),
    'otp_length' => env('OTP_LENGTH', 6),
];

// routes/api.php
use App\Http\Controllers\Auth\TwoFactorController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/2fa/request-otp', [TwoFactorController::class, 'requestOtp']);
Route::post('/auth/2fa/verify-otp', [TwoFactorController::class, 'verifyOtp']);
Route::post('/auth/2fa/resend-otp', [TwoFactorController::class, 'resendOtp']);
