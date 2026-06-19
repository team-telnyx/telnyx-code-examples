#!/usr/bin/env python3
"""WireGuard Private Voice Network — create WireGuard mesh network for private SIP trunking with encrypted voice traffic."""
import os, json, time, requests
from dotenv import load_dotenv
from flask import Flask, request, jsonify
import threading, time as _ttl_time
load_dotenv()
app = Flask(__name__)
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY")
API = "https://api.telnyx.com/v2"
headers = {"Authorization": f"Bearer {TELNYX_API_KEY}", "Content-Type": "application/json"}
networks = {}
interfaces = {}

def _start_ttl_cleanup(*stores, ttl_seconds=3600, interval=300):
    def _cleanup():
        while True:
            _ttl_time.sleep(interval)
            cutoff = _ttl_time.time() - ttl_seconds
            for store in stores:
                expired = [k for k, v in store.items()
                           if isinstance(v, dict) and v.get("_ts", _ttl_time.time()) < cutoff]
                for k in expired:
                    store.pop(k, None)
    threading.Thread(target=_cleanup, daemon=True).start()

_start_ttl_cleanup(networks, interfaces)


@app.route("/networks", methods=["POST"])
def create_network():
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/networks", headers=headers,
            json={"name": data.get("name", f"voice-net-{int(time.time())}")})
        result = resp.json()
        net_id = result.get("data", {}).get("id")
        if net_id:
            networks[net_id] = result.get("data", {})
        return jsonify(result), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create network")
        return jsonify({"error": "could not create network"}), 500

@app.route("/networks", methods=["GET"])
def list_networks():
    try:
        resp = requests.get(f"{API}/networks", headers=headers, timeout=15)
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to list networks")
        return jsonify({"error": "could not list networks"}), 500

@app.route("/interfaces", methods=["POST"])
def create_interface():
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/wireguard_interfaces", headers=headers,
            json={"network_id": data.get("network_id"),
                "region_code": data.get("region", "ashburn-va")})
        result = resp.json()
        iface = result.get("data", {})
        if iface.get("id"):
            interfaces[iface["id"]] = iface
        return jsonify(result), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create WireGuard interface")
        return jsonify({"error": "could not create interface"}), 500

@app.route("/peers", methods=["POST"])
def create_peer():
    data = request.get_json()
    try:
        resp = requests.post(f"{API}/wireguard_peers", headers=headers,
            json={"wireguard_interface_id": data.get("interface_id"),
                "public_key": data.get("public_key"),
                "connection_name": data.get("name", "sip-endpoint")})
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        app.logger.exception("Failed to create WireGuard peer")
        return jsonify({"error": "could not create peer"}), 500

@app.route("/interfaces/<iface_id>/config", methods=["GET"])
def get_config(iface_id):
    iface = interfaces.get(iface_id)
    if not iface:
        try:
            resp = requests.get(f"{API}/wireguard_interfaces/{iface_id}", headers=headers, timeout=15)
            iface = resp.json().get("data", {})
        except Exception as e:
            app.logger.exception("Failed to fetch WireGuard interface config")
            return jsonify({"error": "could not retrieve interface config"}), 500
    # nosemgrep: python.flask.security.injection.raw-html-concat.raw-html-format -- builds a WireGuard .conf string returned as JSON, not rendered HTML.
    config = f"""[Interface]
PrivateKey = <YOUR_PRIVATE_KEY>
Address = {iface.get('interface_address', '10.0.0.2/24')}
DNS = {iface.get('dns_address', '10.0.0.1')}

[Peer]
PublicKey = {iface.get('server_public_key', '<SERVER_KEY>')}
Endpoint = {iface.get('endpoint', '<ENDPOINT>')}
AllowedIPs = {iface.get('allowed_ips', '10.0.0.0/24')}
PersistentKeepalive = 25
"""
    return jsonify({"config": config, "interface": iface}), 200

@app.route("/topology", methods=["GET"])
def topology():
    return jsonify({"networks": len(networks), "interfaces": len(interfaces),
        "details": {"networks": list(networks.keys()), "interfaces": list(interfaces.keys())}}), 200

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "networks": len(networks), "interfaces": len(interfaces)}), 200

if __name__ == "__main__":
    app.run(debug=False, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", 5000)))
