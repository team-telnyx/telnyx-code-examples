"""MCP Server on Telnyx Edge Compute — expose Telnyx APIs (send SMS, make calls, search numbers, run inference) as MCP tools for AI agents."""
import json
import os
import logging
from urllib.request import Request, urlopen
from urllib.error import URLError

HTTP_SCOPE_TYPE = "http"
logger = logging.getLogger("mcp-server")
TELNYX_API = "https://api.telnyx.com/v2"

TOOLS = [
    {
        "name": "send_sms",
        "description": "Send an SMS message via Telnyx",
        "inputSchema": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Destination phone number in E.164 format"},
                "from_number": {"type": "string", "description": "Your Telnyx phone number in E.164"},
                "text": {"type": "string", "description": "Message body"},
            },
            "required": ["to", "from_number", "text"],
        },
    },
    {
        "name": "search_numbers",
        "description": "Search for available phone numbers to purchase",
        "inputSchema": {
            "type": "object",
            "properties": {
                "country_code": {"type": "string", "description": "ISO 3166-1 alpha-2 country code", "default": "US"},
                "area_code": {"type": "string", "description": "Area code to search in"},
                "limit": {"type": "integer", "description": "Max results", "default": 5},
            },
        },
    },
    {
        "name": "run_inference",
        "description": "Run LLM inference via Telnyx AI (OpenAI-compatible)",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "User prompt"},
                "model": {"type": "string", "description": "Model name", "default": "meta-llama/Llama-3.3-70B-Instruct"},
                "max_tokens": {"type": "integer", "default": 256},
            },
            "required": ["prompt"],
        },
    },
    {
        "name": "list_phone_numbers",
        "description": "List phone numbers on your Telnyx account",
        "inputSchema": {
            "type": "object",
            "properties": {
                "page_size": {"type": "integer", "default": 10},
            },
        },
    },
]


def new():
    return Function()


class Function:
    def __init__(self):
        self.api_key = os.environ.get("TELNYX_API_KEY", "")

    def _telnyx_request(self, method, path, body=None):
        url = f"{TELNYX_API}{path}"
        if not url.startswith("https://"):  # only https Telnyx endpoints
            raise ValueError("refusing non-https URL")
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        data = json.dumps(body).encode() if body else None
        req = Request(url, data=data, headers=headers, method=method)
        try:
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected -- url validated https against the constant Telnyx API base above.
            resp = urlopen(req, timeout=15)
            return json.loads(resp.read())
        except URLError as e:
            return {"error": str(e)}

    def _execute_tool(self, name, args):
        if name == "send_sms":
            return self._telnyx_request("POST", "/messages", {
                "from": args["from_number"], "to": args["to"], "text": args["text"],
            })
        elif name == "search_numbers":
            cc = args.get("country_code", "US")
            limit = args.get("limit", 5)
            path = f"/available_phone_numbers?filter[country_code]={cc}&filter[limit]={limit}"
            if args.get("area_code"):
                path += f"&filter[national_destination_code]={args['area_code']}"
            return self._telnyx_request("GET", path)
        elif name == "run_inference":
            return self._telnyx_request("POST", "/ai/chat/completions", {
                "model": args.get("model", "meta-llama/Llama-3.3-70B-Instruct"),
                "messages": [{"role": "user", "content": args["prompt"]}],
                "max_tokens": args.get("max_tokens", 256),
            })
        elif name == "list_phone_numbers":
            size = args.get("page_size", 10)
            return self._telnyx_request("GET", f"/phone_numbers?page[size]={size}")
        return {"error": f"Unknown tool: {name}"}

    async def _read_body(self, receive):
        body = b""
        while True:
            msg = await receive()
            body += msg.get("body", b"")
            if not msg.get("more_body", False):
                break
        return body

    async def _respond(self, send, status, data):
        payload = json.dumps(data).encode()
        await send({"type": "http.response.start", "status": status,
                     "headers": [[b"content-type", b"application/json"]]})
        await send({"type": "http.response.body", "body": payload})

    async def handle(self, scope, receive, send):
        if scope.get("type") != HTTP_SCOPE_TYPE:
            await self._respond(send, 400, {"error": "not http"})
            return

        path = scope.get("path", "/")
        method = scope.get("method", "GET")

        if path == "/mcp/tools/list" and method in ("GET", "POST"):
            await self._respond(send, 200, {"tools": TOOLS})
            return

        if path == "/mcp/tools/call" and method == "POST":
            body = await self._read_body(receive)
            try:
                req_data = json.loads(body)
            except json.JSONDecodeError:
                await self._respond(send, 400, {"error": "invalid json"})
                return
            tool_name = req_data.get("params", {}).get("name", req_data.get("name", ""))
            tool_args = req_data.get("params", {}).get("arguments", req_data.get("arguments", {}))
            result = self._execute_tool(tool_name, tool_args)
            await self._respond(send, 200, {
                "content": [{"type": "text", "text": json.dumps(result, indent=2)}],
                "isError": "error" in result,
            })
            return

        if path == "/health" and method == "GET":
            await self._respond(send, 200, {
                "status": "ok", "tools": len(TOOLS), "has_api_key": bool(self.api_key),
            })
            return

        if path == "/" and method == "GET":
            await self._respond(send, 200, {
                "name": "telnyx-mcp",
                "description": "Telnyx MCP Server — send SMS, search numbers, run inference",
                "tools": [t["name"] for t in TOOLS],
                "endpoints": {"list_tools": "/mcp/tools/list", "call_tool": "/mcp/tools/call", "health": "/health"},
            })
            return

        await self._respond(send, 404, {"error": "not found"})
