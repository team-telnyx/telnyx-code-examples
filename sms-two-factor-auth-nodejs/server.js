#!/usr/bin/env node
/**
 * Production-ready OTP 2FA system with Node.js and Express.
 * Demonstrates secure OTP generation, storage, verification, and error handling.
 */

const express = require("express");
const bodyParser = require("body-parser");
const Telnyx = require("telnyx");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

// Initialize Telnyx client with the SDK pattern
const client = new Telnyx({ apiKey: process.env.TELNYX_API_KEY });

// In-memory OTP storage (use Redis or database in production)
const otpStore = new Map();

/**
 * Generate a random OTP of specified length.
 * @param {number} length - Number of digits in OTP.
 * @returns {string} Random OTP string.
 */
function generateOTP(length = 6) {
  return Math.floor(Math.pow(10, length - 1) + Math.random() * 9 * Math.pow(10, length - 1))
    .toString()
    .slice(0, length);
}

/**
 * Send OTP via SMS to the specified phone number.
 * @param {string} toNumber - Recipient phone number in E.164 format.
 * @param {string} otp - The OTP code to send.
 * @returns {Promise<object>} Response with message ID and status.
 */
async function sendOTPSMS(toNumber, otp) {
  const fromNumber = process.env.TELNYX_PHONE_NUMBER;
  if (!fromNumber) {
    throw new Error("TELNYX_PHONE_NUMBER environment variable not set");
  }

  // Validate E.164 format to prevent API errors
  if (!toNumber.startsWith("+")) {
    throw new Error("Phone number must be in E.164 format (e.g., +15551234567)");
  }

  const message = `Your verification code is: ${otp}. Do not share this code with anyone.`;

  const response = await client.messages.create({
    from_: fromNumber,
    to: toNumber,
    text: message,
  });

  // Extract serializable data — SDK objects are NOT JSON-serializable
  return {
    message_id: response.data.id,
    status: response.data.to && response.data.to[0] ? response.data.to[0].status : "pending",
    to: toNumber,
  };
}

/**
 * Store OTP with expiration timestamp.
 * @param {string} phoneNumber - Phone number to associate with OTP.
 * @param {string} otp - The OTP code.
 */
function storeOTP(phoneNumber, otp) {
  const expirySeconds = parseInt(process.env.OTP_EXPIRY_SECONDS || "300", 10);
  const expiresAt = Date.now() + expirySeconds * 1000;

  otpStore.set(phoneNumber, {
    otp,
    expiresAt,
    attempts: 0,
  });
}

/**
 * Verify OTP against stored value and expiration.
 * @param {string} phoneNumber - Phone number to verify.
 * @param {string} otp - OTP code provided by user.
 * @returns {object} Verification result with success flag and message.
 */
function verifyOTP(phoneNumber, otp) {
  const stored = otpStore.get(phoneNumber);

  if (!stored) {
    return { success: false, message: "No OTP found for this phone number" };
  }

  // Check expiration
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(phoneNumber);
    return { success: false, message: "OTP has expired. Request a new one." };
  }

  // Prevent brute force: limit attempts
  if (stored.attempts >= 3) {
    otpStore.delete(phoneNumber);
    return { success: false, message: "Too many failed attempts. Request a new OTP." };
  }

  // Verify OTP
  if (stored.otp !== otp) {
    stored.attempts += 1;
    return { success: false, message: "Invalid OTP. Please try again." };
  }

  // Success: remove OTP from store
  otpStore.delete(phoneNumber);
  return { success: true, message: "OTP verified successfully" };
}

// Simple in-memory rate limiter for OTP requests
const otpRateLimiter = new Map();
const OTP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const OTP_RATE_LIMIT_MAX = 5;

function checkOTPRateLimit(phoneNumber) {
  const now = Date.now();
  const attempts = otpRateLimiter.get(phoneNumber) || [];
  const recent = attempts.filter((t) => now - t < OTP_RATE_LIMIT_WINDOW_MS);
  if (recent.length >= OTP_RATE_LIMIT_MAX) return false;
  recent.push(now);
  otpRateLimiter.set(phoneNumber, recent);
  return true;
}

/**
 * POST /auth/request-otp
 * Request an OTP to be sent to the provided phone number.
 */
app.post("/auth/request-otp", async (req, res) => {
  const { phone_number } = req.body;

  if (!phone_number) {
    return res.status(400).json({ error: "Missing required field: 'phone_number'" });
  }

  if (!checkOTPRateLimit(phone_number)) {
    return res.status(429).json({ error: "Too many OTP requests. Try again later." });
  }

  try {
    // Generate and send OTP
    const otp = generateOTP(parseInt(process.env.OTP_LENGTH || "6", 10));
    const smsResult = await sendOTPSMS(phone_number, otp);

    // Store OTP for verification
    storeOTP(phone_number, otp);

    return res.status(200).json({
      message: "OTP sent successfully",
      message_id: smsResult.message_id,
      expires_in_seconds: parseInt(process.env.OTP_EXPIRY_SECONDS || "300", 10),
    });
  } catch (error) {
    if (error instanceof Telnyx.AuthenticationError) {
      return res.status(401).json({ error: "Invalid API key" });
    }
    if (error instanceof Telnyx.RateLimitError) {
      return res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    }
    if (error instanceof Telnyx.APIStatusError) {
      return res.status(error.status_code || 500).json({ error: error.message });
    }
    if (error instanceof Telnyx.APIConnectionError) {
      return res.status(503).json({ error: "Network error connecting to Telnyx" });
    }
    // Handle validation errors
    if (error.message.includes("E.164 format")) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /auth/verify-otp
 * Verify the OTP provided by the user.
 */
app.post("/auth/verify-otp", (req, res) => {
  const { phone_number, otp } = req.body;

  if (!phone_number || !otp) {
    return res.status(400).json({ error: "Missing required fields: 'phone_number' and 'otp'" });
  }

  try {
    const result = verifyOTP(phone_number, otp);

    if (result.success) {
      return res.status(200).json({
        message: result.message,
        authenticated: true,
        // In production, issue a session token or JWT here
        session_token: `session_${Date.now()}`,
      });
    }

    return res.status(401).json({
      message: result.message,
      authenticated: false,
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /health
 * Health check endpoint.
 */
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Error handler middleware
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OTP 2FA server running on http://localhost:${PORT}`);
});
