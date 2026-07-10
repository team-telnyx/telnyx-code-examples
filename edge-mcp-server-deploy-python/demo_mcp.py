#!/usr/bin/env python3
"""Interactive CLI demo for the Telnyx MCP Server on Edge Compute.

Usage:  python3 demo_mcp.py
        python3 demo_mcp.py --url https://your-function-id-b.telnyxcompute.com
"""
import argparse
import json
import sys
from getpass import getpass

try:
    import requests
except ImportError:
    print("This demo requires the 'requests' library.  Install it with:")
    print("  pip3 install requests")
    sys.exit(1)

DEFAULT_URL = "https://mcp-test-hello-7101370e-b.telnyxcompute.com"

# ANSI colors
CYAN = "\033[96m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def banner(text):
    print(f"\n{BOLD}{'=' * 60}")
    print(f"  {text}")
    print(f"{'=' * 60}{RESET}\n")


def get(url, path):
    r = requests.get(f"{url}{path}", timeout=15)
    return r.json()


def post(url, path, body):
    r = requests.post(f"{url}{path}", json=body, timeout=30)
    return r.json()


def pretty(data):
    print(json.dumps(data, indent=2))


def health_check(base):
    banner(f"{CYAN}1. Health Check{RESET}")
    try:
        result = get(base, "/health")
        print(f"  Status:     {GREEN}{result.get('status', '?')}{RESET}")
        print(f"  Tools:      {result.get('tools', '?')}")
        key = result.get('has_api_key', False)
        print(f"  API Key:    {GREEN}configured{RESET}" if key else f"  API Key:    {RED}missing{RESET}")
        return True
    except Exception as e:
        print(f"  {RED}Error: {e}{RESET}")
        return False


def list_tools(base):
    banner(f"{CYAN}2. Discover Tools (MCP tools/list){RESET}")
    result = get(base, "/mcp/tools/list")
    tools = result.get("tools", result) if isinstance(result, dict) else result
    for i, tool in enumerate(tools, 1):
        name = tool.get("name", "?")
        desc = tool.get("description", "")
        schema = tool.get("inputSchema", {}).get("properties", {})
        required = tool.get("inputSchema", {}).get("required", [])
        params = ", ".join(
            f"{k}{'*' if k in required else ''}" for k in schema
        ) if schema else "none"
        print(f"  {YELLOW}{i}.{RESET} {BOLD}{name}{RESET}")
        print(f"     {DIM}{desc}{RESET}")
        print(f"     {DIM}params: {params}{RESET}\n")
    return tools


def call_tool(base, name, args):
    banner(f"{CYAN}3. Call Tool: {name}{RESET}")
    display_args = dict(args)
    if name == "send_sms" and "to" in display_args:
        to_val = display_args["to"]
        display_args["to"] = to_val[:3] + "*" * (len(to_val) - 5) + to_val[-2:] if len(to_val) > 5 else to_val
    print(f"  {DIM}Arguments:{RESET}")
    pretty(display_args)
    print(f"\n  {DIM}Result:{RESET}")
    result = post(base, "/mcp/tools/call", {"name": name, "arguments": args})

    raw_text = ""
    if isinstance(result, dict) and "content" in result:
        for item in result["content"]:
            if item.get("type") == "text":
                raw_text = item.get("text", "")
                break
    else:
        raw_text = json.dumps(result)

    try:
        data = json.loads(raw_text)
    except (json.JSONDecodeError, TypeError):
        print(raw_text)
        return result

    if "error" in data:
        print(f"  {RED}Error: {data['error']}{RESET}")
        return result

    if name == "list_phone_numbers":
        numbers = data.get("data", [])
        if not numbers:
            print(f"  {YELLOW}No phone numbers found.{RESET}")
        else:
            print(f"  {GREEN}{len(numbers)} phone number(s) on your account:{RESET}\n")
            for i, n in enumerate(numbers, 1):
                print(f"  {YELLOW}{i}.{RESET} {BOLD}{n.get('phone_number', '?')}{RESET}"
                      f"  {DIM}({n.get('phone_number_type', '?')}, {n.get('status', '?')}){RESET}")

    elif name == "search_numbers":
        numbers = data.get("data", [])
        total = data.get("meta", {}).get("total_results", len(numbers))
        if not numbers:
            print(f"  {YELLOW}No available numbers found.{RESET}")
        else:
            print(f"  {GREEN}{total} available number(s) found:{RESET}\n")
            for i, n in enumerate(numbers, 1):
                num = n.get("phone_number", "?")
                cost = n.get("cost_information", {})
                monthly = cost.get("monthly_cost", "?")
                features = [f["name"] for f in n.get("features", [])]
                print(f"  {YELLOW}{i}.{RESET} {BOLD}{num}{RESET}"
                      f"  {DIM}-${monthly}/mo{RESET}"
                      f"  {DIM}[{', '.join(features)}]{RESET}")

    elif name == "run_inference":
        choices = data.get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content", "")
            model = data.get("model", "?")
            tokens = data.get("usage", {}).get("total_tokens", "?")
            print(f"  {GREEN}Model:{RESET} {model}")
            print(f"  {GREEN}Tokens:{RESET} {tokens}")
            print(f"  {GREEN}Response:{RESET}\n")
            print(f"  {BOLD}{content}{RESET}")
        else:
            print(f"  {YELLOW}No response from model.{RESET}")

    elif name == "send_sms":
        msg_data = data.get("data", {})
        if msg_data:
            to_list = msg_data.get("to", [])
            status = to_list[0].get("status", "?") if to_list else "?"
            to_raw = to_list[0].get("phone_number", args.get("to", "")) if to_list else args.get("to", "")
            masked_to = to_raw[:3] + "*" * (len(to_raw) - 5) + to_raw[-2:] if len(to_raw) > 5 else to_raw
            text = msg_data.get("text", args.get("text", ""))
            direction = msg_data.get("direction", "?")
            cost = msg_data.get("cost", {})
            cost_str = f"${cost.get('amount', '?')}" if cost.get("amount") else ""
            print(f"  {GREEN}SMS sent!{RESET}")
            print(f"  To:        {BOLD}{masked_to}{RESET}")
            print(f"  Status:    {status}")
            print(f"  Direction: {direction}")
            if cost_str:
                print(f"  Cost:      {cost_str}")
            print(f"  Message:   \"{text}\"")
        else:
            print(f"  {RED}Failed to send SMS.{RESET}")

    else:
        pretty(data)

    return result


def main():
    parser = argparse.ArgumentParser(description="Telnyx MCP Server CLI Demo")
    parser.add_argument("--url", default=DEFAULT_URL, help="MCP server base URL")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    banner(f"{BOLD}Telnyx MCP Server on Edge Compute{RESET}")
    print(f"  URL: {DIM}{base}{RESET}")

    if not health_check(base):
        print(f"\n{RED}Server not reachable. Check the URL.{RESET}")
        sys.exit(1)

    tools = list_tools(base)

    while True:
        banner(f"{YELLOW}Choose a tool to demo (1-4) or q to quit:{RESET}")
        options = [
            ("list_phone_numbers", "List phone numbers on your account"),
            ("search_numbers", "Search for available phone numbers"),
            ("run_inference", "Run AI inference (Llama-3.3-70B)"),
            ("send_sms", "Send an SMS message"),
        ]
        for i, (name, desc) in enumerate(options, 1):
            print(f"  {YELLOW}{i}.{RESET} {BOLD}{name}{RESET} — {DIM}{desc}{RESET}")
        print(f"  {YELLOW}q.{RESET} Quit")
        print()

        choice = input(f"  {BOLD}> {RESET}").strip().lower()

        if choice == "q":
            print(f"\n{GREEN}Done.{RESET}\n")
            break

        try:
            idx = int(choice) - 1
            tool_name, _ = options[idx]
        except (ValueError, IndexError):
            print(f"  {RED}Invalid choice.{RESET}")
            continue

        if tool_name == "list_phone_numbers":
            size_input = input(f"  {DIM}page_size (default 5): {RESET}").strip()
            page_size = int(size_input) if size_input else 5
            call_tool(base, "list_phone_numbers", {"page_size": page_size})

        elif tool_name == "search_numbers":
            country = input(f"  {DIM}country_code (default US): {RESET}").strip() or "US"
            area = input(f"  {DIM}area_code (optional, e.g. 415): {RESET}").strip()
            limit_input = input(f"  {DIM}limit (default 5): {RESET}").strip()
            limit = int(limit_input) if limit_input else 5
            tool_args = {"country_code": country, "limit": limit}
            if area:
                tool_args["area_code"] = area
            call_tool(base, "search_numbers", tool_args)

        elif tool_name == "run_inference":
            prompt = input(f"  {DIM}prompt: {RESET}").strip()
            if not prompt:
                prompt = "What is 2+2?"
            model = input(f"  {DIM}model (default meta-llama/Llama-3.3-70B-Instruct): {RESET}").strip()
            model = model or "meta-llama/Llama-3.3-70B-Instruct"
            tokens_input = input(f"  {DIM}max_tokens (default 100): {RESET}").strip()
            max_tokens = int(tokens_input) if tokens_input else 100
            call_tool(base, "run_inference", {"prompt": prompt, "model": model, "max_tokens": max_tokens})

        elif tool_name == "send_sms":
            print(f"\n  {DIM}Fetching your phone numbers...{RESET}")
            acct_result = post(base, "/mcp/tools/call", {"name": "list_phone_numbers", "arguments": {"page_size": 10}})
            acct_numbers = []
            if isinstance(acct_result, dict) and "content" in acct_result:
                for item in acct_result["content"]:
                    if item.get("type") == "text":
                        try:
                            parsed = json.loads(item["text"])
                            acct_numbers = [n.get("phone_number") for n in parsed.get("data", []) if n.get("phone_number")]
                        except json.JSONDecodeError:
                            pass

            if not acct_numbers:
                print(f"  {RED}No phone numbers found on your account.{RESET}")
                continue

            print(f"  {GREEN}Available from numbers:{RESET}")
            for i, num in enumerate(acct_numbers, 1):
                print(f"  {YELLOW}{i}.{RESET} {BOLD}{num}{RESET}")

            from_choice = input(f"\n  {DIM}Pick a from number (1-{len(acct_numbers)}): {RESET}").strip()
            try:
                from_num = acct_numbers[int(from_choice) - 1]
            except (ValueError, IndexError):
                print(f"  {RED}Invalid choice.{RESET}")
                continue

            to = getpass(f"  {DIM}to (E.164, hidden): {RESET}").strip()
            text = input(f"  {DIM}text: {RESET}").strip()
            if not all([to, text]):
                print(f"  {RED}to and text are required.{RESET}")
                continue
            call_tool(base, "send_sms", {"to": to, "from_number": from_num, "text": text})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{GREEN}Bye.{RESET}\n")
