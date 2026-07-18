#!/usr/bin/env python3
"""Set up an AI Assistant with a sync webhook tool and filler messages via the Telnyx API.

Usage:
    python setup.py <ngrok_url>

This script:
1. Lists your phone numbers and lets you pick one
2. Creates an AI Assistant with telephony enabled
3. Adds a sync webhook tool (check_order_status) with filler messages
4. Assigns the phone number to the assistant's backing TeXML app
"""
import os, sys, json, requests
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

API_KEY = os.getenv("TELNYX_API_KEY")
if not API_KEY:
    print("Error: TELNYX_API_KEY not set in .env")
    sys.exit(1)

BASE = "https://api.telnyx.com/v2"
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}


def api(method, path, body=None):
    url = f"{BASE}{path}"
    r = requests.request(method, url, headers=HEADERS, json=body, timeout=30)
    if r.status_code >= 400:
        print(f"API error {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


def main():
    if len(sys.argv) < 2:
        print("Usage: python setup.py <ngrok_url>")
        print("Example: python setup.py https://abc123.ngrok.io")
        sys.exit(1)

    ngrok_url = sys.argv[1].rstrip("/")
    webhook_url = f"{ngrok_url}/webhook/order-status"

    # 1. Find a phone number
    print("Finding phone numbers on your account...")
    nums = api("GET", "/phone_numbers?page[size]=20&filter[status]=active")
    numbers = nums.get("data", [])
    if not numbers:
        print("No active phone numbers found. Purchase one in the Telnyx Portal first.")
        sys.exit(1)

    print(f"Found {len(numbers)} number(s):")
    for i, n in enumerate(numbers):
        phone = n.get("phone_number", "unknown")
        conn = n.get("connection_name", "none")
        print(f"  [{i}] {phone}  (connection: {conn})")

    choice = input(f"\nPick a number [0-{len(numbers)-1}]: ").strip()
    try:
        num = numbers[int(choice)]
    except (ValueError, IndexError):
        print("Invalid choice.")
        sys.exit(1)

    phone_number = num["phone_number"]
    print(f"\nUsing: {phone_number}")

    # 2. Create the AI Assistant
    print("\nCreating AI Assistant...")
    assistant = api("POST", "/ai/assistants", {
        "name": "Filler Messages Demo",
        "instructions": (
            "You are a helpful order status assistant. When a customer asks about their order, "
            "use the check_order_status tool to look up the order. Report back the status, "
            "carrier, tracking number, and estimated delivery date. Be friendly and concise."
        ),
        "model": "anthropic/claude-haiku-4-5",
        "greeting": "Hello! Thanks for calling. I can help you check the status of your order. Just give me your order number.",
        "enabled_features": ["telephony"],
    })
    # Response is flat (no "data" wrapper)
    assistant_id = assistant["id"]
    print(f"Created assistant: {assistant_id}")

    # 3. Add the webhook tool with filler messages via PATCH (inline tools)
    print(f"\nAdding webhook tool pointing to: {webhook_url}")
    api("PATCH", f"/ai/assistants/{assistant_id}", {
        "tools": [{
            "type": "webhook",
            "timeout_ms": 30000,
            "webhook": {
                "name": "check_order_status",
                "description": "Check the status of a customer order by order ID. Use this whenever a customer asks about their order.",
                "url": webhook_url,
                "method": "POST",
                "async": False,
                "timeout_ms": 30000,
                "body_parameters": {
                    "type": "object",
                    "properties": {
                        "order_id": {
                            "type": "string",
                            "description": "The customer's order ID number"
                        }
                    },
                    "required": ["order_id"]
                },
                "filler_messages": [
                    {"type": "request_start", "content": "Let me look that up for you."},
                    {"type": "request_response_delayed", "content": "Still working on this, one moment please.", "timing_ms": 5000},
                    {"type": "request_response_delayed", "content": "Almost there, thanks for your patience.", "timing_ms": 15000},
                ]
            }
        }]
    })
    print("Webhook tool with filler messages added.")

    # 4. Assign the phone number to the assistant's backing TeXML app
    # Each AI Assistant with telephony gets a TeXML app automatically.
    # We read its ID from telephony_settings and assign the phone number to it.
    print(f"\nAssigning {phone_number} to assistant...")
    assistant_data = api("GET", f"/ai/assistants/{assistant_id}")
    texml_app_id = (assistant_data.get("telephony_settings") or {}).get("default_texml_app_id")
    if not texml_app_id:
        print("Warning: could not find TeXML app ID. Assign the phone number manually in Mission Control.")
    else:
        api("PATCH", f"/phone_numbers/{phone_number}", {"connection_id": texml_app_id})
        print(f"Phone number assigned (TeXML app: {texml_app_id}).")

    # Done
    print("\n" + "=" * 60)
    print("Setup complete!")
    print("=" * 60)
    print(f"  Assistant ID:  {assistant_id}")
    print(f"  Phone number:  {phone_number}")
    print(f"  Webhook URL:   {webhook_url}")
    print(f"  Delay:         {os.getenv('WEBHOOK_DELAY_SECONDS', '12')}s")
    print()
    print("IMPORTANT: Filler messages must be configured through Mission Control UI.")
    print("The API sets the values, but playback requires the Mission Control Filler Messages tab.")
    print(f"  → Go to: https://portal.telnyx.com → AI → Assistants → {assistant_id}")
    print("  → Open the check_order_status tool → Filler Messages tab")
    print("  → Add the filler messages listed in the guide")
    print()
    print("Next steps:")
    print("  1. Configure filler messages in Mission Control (see above)")
    print("  2. Start the webhook server:  python app.py")
    print("  3. Open the dashboard:        http://localhost:5000")
    print(f"  4. Call {phone_number}")
    print('  5. Ask: "What\'s the status of my order 12345?"')
    print()
    print(f"To clean up later: delete assistant {assistant_id} in Mission Control")


if __name__ == "__main__":
    main()
