"""
Restaurant Reservations via WhatsApp — AI-powered booking demo.

Browse real restaurants worldwide, book a table through WhatsApp
conversation with an AI agent, and watch reservations update on
a live dashboard in real time.

Uses Telnyx WhatsApp Business API, Telnyx AI Inference,
Google Places API for restaurant data, and real restaurant photos.

Two Telnyx accounts:
  - Main account: AI Inference, Number Lookup
  - WABA account:  WhatsApp messaging

Run:
    python app.py
"""

import json
import logging
import logging.handlers
import os
import queue
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone, timedelta

import requests
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request

load_dotenv()

app = Flask(__name__)
app.logger.setLevel(logging.DEBUG)

# Persistent file logging + console
LOG_PATH = os.getenv("LOG_PATH", "app.log")
_log_formatter = logging.Formatter(
    "%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
_file_handler = logging.handlers.RotatingFileHandler(
    LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8",
)
_file_handler.setLevel(logging.DEBUG)
_file_handler.setFormatter(_log_formatter)

_console_handler = logging.StreamHandler()
_console_handler.setLevel(logging.DEBUG)
_console_handler.setFormatter(_log_formatter)

logging.basicConfig(level=logging.DEBUG, handlers=[_file_handler, _console_handler])

# ---------------------------------------------------------------------------
# SSE — real-time event streaming to browser clients
# ---------------------------------------------------------------------------
_sse_subscribers = []
_sse_lock = threading.Lock()


def sse_publish(event_type, data):
    """Push an SSE event to all connected browser clients."""
    payload = json.dumps(
        {"type": event_type, "ts": datetime.now(timezone.utc).isoformat(), **data}
    )
    with _sse_lock:
        dead = []
        for q in _sse_subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _sse_subscribers.remove(q)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
TELNYX_API_KEY = os.getenv("TELNYX_API_KEY", "")
TELNYX_WHATSAPP_API_KEY = os.getenv("TELNYX_WHATSAPP_API_KEY", "") or TELNYX_API_KEY
WHATSAPP_NUMBER = os.getenv("WHATSAPP_NUMBER", "")
WHATSAPP_MESSAGING_PROFILE_ID = os.getenv("WHATSAPP_MESSAGING_PROFILE_ID", "")
INFERENCE_URL = "https://api.telnyx.com/v2/ai/chat/completions"
AI_MODEL = os.getenv("AI_MODEL", "THUDM/GLM3-flash")
GOOGLE_PLACES_API_KEY = os.getenv("GOOGLE_PLACES_API_KEY", "")
UNSPLASH_ACCESS_KEY = os.getenv("UNSPLASH_ACCESS_KEY", "")
DEFAULT_CITY = os.getenv("DEFAULT_CITY", "Amsterdam")
PORT = int(os.getenv("PORT", "5051"))
DB_PATH = os.getenv("DB_PATH", "reservations.db")


# ---------------------------------------------------------------------------
# SQLite — restaurants, reservations, conversations
# ---------------------------------------------------------------------------
def get_db():
    """Get a thread-local database connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS restaurants (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL,
            cuisine         TEXT,
            address         TEXT,
            phone           TEXT,
            lat             REAL,
            lon             REAL,
            photo_url       TEXT,
            rating          REAL,
            rating_count    INTEGER DEFAULT 0,
            price_level     TEXT,
            price_range     TEXT,
            website         TEXT,
            maps_url        TEXT,
            open_now        INTEGER,
            hours           TEXT,
            reservable      INTEGER DEFAULT 0,
            vegetarian      INTEGER DEFAULT 0,
            outdoor_seating INTEGER DEFAULT 0,
            dine_in         INTEGER DEFAULT 0,
            delivery        INTEGER DEFAULT 0,
            takeout         INTEGER DEFAULT 0,
            cached_at       TEXT NOT NULL,
            city            TEXT DEFAULT ''
        )
    """)
    # Add city column to existing DBs that don't have it yet
    try:
        cur.execute("ALTER TABLE restaurants ADD COLUMN city TEXT DEFAULT ''")
    except Exception:
        pass

    cur.execute("""
        CREATE TABLE IF NOT EXISTS reservations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            restaurant_id   TEXT NOT NULL,
            customer_phone  TEXT NOT NULL,
            customer_name   TEXT,
            party_size      INTEGER NOT NULL,
            date            TEXT NOT NULL,
            time            TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            notes           TEXT,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_phone  TEXT NOT NULL,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            timestamp       TEXT NOT NULL
        )
    """)
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_conv_phone ON conversations (customer_phone)"
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_res_date ON reservations (date)"
    )

    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Table inventory — 6 tables, fixed time slots
# ---------------------------------------------------------------------------
TABLES = [
    {"id": 1, "seats": 2, "label": "T1"},
    {"id": 2, "seats": 2, "label": "T2"},
    {"id": 3, "seats": 4, "label": "T3"},
    {"id": 4, "seats": 4, "label": "T4"},
    {"id": 5, "seats": 6, "label": "T5"},
    {"id": 6, "seats": 8, "label": "T6"},
]

TIME_SLOTS = [
    "17:30", "18:00", "18:30", "19:00",
    "19:30", "20:00", "20:30", "21:00",
]


# ---------------------------------------------------------------------------
# Restaurant data — Google Places API + fallbacks
# ---------------------------------------------------------------------------
GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText"

FALLBACK_RESTAURANTS = {
    "Amsterdam": [
        {"id": "fb-ams-1", "name": "De Kas", "cuisine": "dutch", "address": "Kamerlingh Onneslaan 3, Amsterdam", "phone": "+31206204562", "lat": 52.3541, "lon": 4.9258},
        {"id": "fb-ams-2", "name": "Moeders", "cuisine": "dutch", "address": "Rozengracht 251, Amsterdam", "phone": "+31206267957", "lat": 52.3713, "lon": 4.8770},
        {"id": "fb-ams-3", "name": "Tempo Doeloe", "cuisine": "indonesian", "address": "Utrechtsestraat 75, Amsterdam", "phone": "+31206256718", "lat": 52.3618, "lon": 4.8972},
        {"id": "fb-ams-4", "name": "Blauw", "cuisine": "indonesian", "address": "Amstelveenseweg 158, Amsterdam", "phone": "+31206753000", "lat": 52.3519, "lon": 4.8636},
        {"id": "fb-ams-5", "name": "Ashoka", "cuisine": "indian", "address": "Spuistraat 2, Amsterdam", "phone": "+31206206338", "lat": 52.3779, "lon": 4.8907},
        {"id": "fb-ams-6", "name": "Memories of India", "cuisine": "indian", "address": "Reguliersdwarsstraat 88, Amsterdam", "phone": "+31206234578", "lat": 52.3644, "lon": 4.8935},
        {"id": "fb-ams-7", "name": "Toscanini", "cuisine": "italian", "address": "Lindengracht 75, Amsterdam", "phone": "+31206232813", "lat": 52.3809, "lon": 4.8825},
        {"id": "fb-ams-8", "name": "Roberto's", "cuisine": "italian", "address": "Hilton Amsterdam, Apollolaan 138, Amsterdam", "phone": "+31207106691", "lat": 52.3507, "lon": 4.8773},
        {"id": "fb-ams-9", "name": "Taquería Mexiana", "cuisine": "mexican", "address": "Albert Cuypstraat 68, Amsterdam", "phone": None, "lat": 52.3559, "lon": 4.8952},
        {"id": "fb-ams-10", "name": "Salmuera", "cuisine": "mexican", "address": "Ceintuurbaan 149, Amsterdam", "phone": None, "lat": 52.3530, "lon": 4.8974},
        {"id": "fb-ams-11", "name": "Warung Spang Makandra", "cuisine": "surinamese", "address": "Gerard Doustraat 39, Amsterdam", "phone": "+31206705081", "lat": 52.3542, "lon": 4.8932},
        {"id": "fb-ams-12", "name": "Roopram Roti", "cuisine": "surinamese", "address": "Eerste van Swindenstraat 4, Amsterdam", "phone": "+31206938102", "lat": 52.3616, "lon": 4.9260},
        {"id": "fb-ams-13", "name": "Hakata Senpachi", "cuisine": "japanese", "address": "Binnen Bantammerstraat 7, Amsterdam", "phone": "+31206256451", "lat": 52.3739, "lon": 4.9008},
        {"id": "fb-ams-14", "name": "Rijsel", "cuisine": "french", "address": "Marcusstraat 52b, Amsterdam", "phone": "+31206637794", "lat": 52.3558, "lon": 4.9199},
        {"id": "fb-ams-15", "name": "Fulu Mandarijn", "cuisine": "chinese", "address": "Rokin 26, Amsterdam", "phone": "+31206230885", "lat": 52.3706, "lon": 4.8924},
        {"id": "fb-ams-16", "name": "La Oliva", "cuisine": "spanish", "address": "Egelantiersstraat 122, Amsterdam", "phone": "+31206204316", "lat": 52.3764, "lon": 4.8828},
        {"id": "fb-ams-17", "name": "Restaurant Visaandeschelde", "cuisine": "seafood", "address": "Scheldeplein 4, Amsterdam", "phone": "+31206751583", "lat": 52.3488, "lon": 4.8936},
        {"id": "fb-ams-18", "name": "Cannibale Royale", "cuisine": "steak", "address": "Handboogstraat 17a, Amsterdam", "phone": "+31206225507", "lat": 52.3663, "lon": 4.8895},
        {"id": "fb-ams-19", "name": "Vegan Junk Food Bar", "cuisine": "vegan", "address": "Staringplein 22, Amsterdam", "phone": None, "lat": 52.3596, "lon": 4.8761},
        {"id": "fb-ams-20", "name": "BAK Restaurant", "cuisine": "modern_european", "address": "Van Diemenstraat 408, Amsterdam", "phone": "+31206372553", "lat": 52.3905, "lon": 4.8887},
    ],
    "Rotterdam": [
        {"id": "fb-rot-1", "name": "Hotel New York", "cuisine": "dutch", "address": "Koninginnenhoofd 1, Rotterdam", "phone": "+31104390500", "lat": 51.9055, "lon": 4.4864},
        {"id": "fb-rot-2", "name": "FG Restaurant", "cuisine": "french", "address": "Katshoek 37, Rotterdam", "phone": "+31104253020", "lat": 51.9221, "lon": 4.4703},
        {"id": "fb-rot-3", "name": "Ristorante Napoli", "cuisine": "italian", "address": "Meent 79, Rotterdam", "phone": "+31104147674", "lat": 51.9220, "lon": 4.4840},
        {"id": "fb-rot-4", "name": "Dosa Corner", "cuisine": "indian", "address": "West-Kruiskade 15, Rotterdam", "phone": "+31104125544", "lat": 51.9218, "lon": 4.4680},
        {"id": "fb-rot-5", "name": "Supermercado", "cuisine": "mexican", "address": "Schiedamse Vest 91, Rotterdam", "phone": None, "lat": 51.9170, "lon": 4.4730},
        {"id": "fb-rot-6", "name": "Warung Mini", "cuisine": "surinamese", "address": "Witte de Withstraat 47, Rotterdam", "phone": "+31104143688", "lat": 51.9166, "lon": 4.4762},
        {"id": "fb-rot-7", "name": "Fenix Food Factory", "cuisine": "modern_european", "address": "Veerlaan 19d, Rotterdam", "phone": None, "lat": 51.9015, "lon": 4.4829},
        {"id": "fb-rot-8", "name": "Sajoen", "cuisine": "indonesian", "address": "Vasteland 46, Rotterdam", "phone": "+31104137459", "lat": 51.9143, "lon": 4.4791},
    ],
    "The Hague": [
        {"id": "fb-hag-1", "name": "Garoeda", "cuisine": "indonesian", "address": "Kneuterdijk 18a, The Hague", "phone": "+31703469319", "lat": 52.0844, "lon": 4.3119},
        {"id": "fb-hag-2", "name": "Shalimar", "cuisine": "indian", "address": "Gevers Deynootweg 756, The Hague", "phone": "+31703505364", "lat": 52.1032, "lon": 4.2693},
        {"id": "fb-hag-3", "name": "Ristorante Juliani", "cuisine": "italian", "address": "Noordeinde 196, The Hague", "phone": "+31703650400", "lat": 52.0831, "lon": 4.3088},
        {"id": "fb-hag-4", "name": "Taco Mundo", "cuisine": "mexican", "address": "Grote Marktstraat 37, The Hague", "phone": None, "lat": 52.0766, "lon": 4.3108},
        {"id": "fb-hag-5", "name": "Café de Oude Mol", "cuisine": "dutch", "address": "Oude Molstraat 61, The Hague", "phone": "+31703461907", "lat": 52.0790, "lon": 4.3140},
        {"id": "fb-hag-6", "name": "Roti King", "cuisine": "surinamese", "address": "Vaillantlaan 264, The Hague", "phone": "+31703458925", "lat": 52.0640, "lon": 4.3340},
    ],
    "Utrecht": [
        {"id": "fb-utr-1", "name": "Blauw Utrecht", "cuisine": "indonesian", "address": "Springweg 64, Utrecht", "phone": "+31302321462", "lat": 52.0879, "lon": 5.1208},
        {"id": "fb-utr-2", "name": "Desi Masala", "cuisine": "indian", "address": "Voorstraat 68, Utrecht", "phone": "+31302318220", "lat": 52.0898, "lon": 5.1194},
        {"id": "fb-utr-3", "name": "Ristorante Prego", "cuisine": "italian", "address": "Nobelstraat 2, Utrecht", "phone": "+31302310056", "lat": 52.0893, "lon": 5.1190},
        {"id": "fb-utr-4", "name": "Restaurant Zuiver", "cuisine": "dutch", "address": "Heidelberglaan 7, Utrecht", "phone": "+31302532563", "lat": 52.0854, "lon": 5.1672},
        {"id": "fb-utr-5", "name": "Taqueria La Llorona", "cuisine": "mexican", "address": "Twijnstraat 27, Utrecht", "phone": None, "lat": 52.0866, "lon": 5.1225},
        {"id": "fb-utr-6", "name": "Toko Oost", "cuisine": "surinamese", "address": "Kanaalstraat 99, Utrecht", "phone": "+31302933188", "lat": 52.0832, "lon": 5.1065},
    ],
}

# Supported cuisines for dropdown
CUISINES = ["All", "Indian", "Italian", "Mexican", "Dutch", "Surinamese", "Indonesian", "Japanese", "French", "Chinese", "Spanish", "Seafood", "Thai", "Vietnamese", "Korean", "American", "Mediterranean"]

# Photo fallbacks by cuisine type
CUISINE_PHOTOS = {
    "fine_dining": "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=300&fit=crop",
    "dutch": "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&h=300&fit=crop",
    "french": "https://images.unsplash.com/photo-1550547660-d9450f859349?w=400&h=300&fit=crop",
    "modern_european": "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=400&h=300&fit=crop",
    "italian": "https://images.unsplash.com/photo-1498579150354-977475b7ea0b?w=400&h=300&fit=crop",
    "chinese": "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=400&h=300&fit=crop",
    "japanese": "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&h=300&fit=crop",
    "indonesian": "https://images.unsplash.com/photo-1562565652-a0d8f0c59eb4?w=400&h=300&fit=crop",
    "indian": "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=400&h=300&fit=crop",
    "mexican": "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=300&fit=crop",
    "surinamese": "https://images.unsplash.com/photo-1630409351217-bc61f1be0a28?w=400&h=300&fit=crop",
    "spanish": "https://images.unsplash.com/photo-1515443961218-a51367888e4b?w=400&h=300&fit=crop",
    "seafood": "https://images.unsplash.com/photo-1535399831218-d5bd36d1a6b3?w=400&h=300&fit=crop",
    "vegan": "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=300&fit=crop",
    "steak": "https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=300&fit=crop",
    "default": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400&h=300&fit=crop",
}


def get_cuisine_photo(cuisine):
    """Return a photo URL for a cuisine type, using fallback photos."""
    if not cuisine:
        return CUISINE_PHOTOS["default"]
    cuisine_lower = cuisine.lower().split(";")[0].strip()
    for key in CUISINE_PHOTOS:
        if key in cuisine_lower or cuisine_lower in key:
            return CUISINE_PHOTOS[key]
    return CUISINE_PHOTOS["default"]


def get_place_photo_url(photo_name):
    """Build a Google Places photo URL from a photo resource name."""
    if not photo_name or not GOOGLE_PLACES_API_KEY:
        return None
    return (
        f"https://places.googleapis.com/v1/{photo_name}/media"
        f"?maxWidthPx=400&maxHeightPx=300&key={GOOGLE_PLACES_API_KEY}"
    )


PRICE_LEVEL_MAP = {
    "PRICE_LEVEL_FREE": "",
    "PRICE_LEVEL_INEXPENSIVE": "$",
    "PRICE_LEVEL_MODERATE": "$$",
    "PRICE_LEVEL_EXPENSIVE": "$$$",
    "PRICE_LEVEL_VERY_EXPENSIVE": "$$$$",
}


def _parse_google_places(places, cuisine_filter=None):
    """Parse a list of Google Places API place objects into our restaurant dict format."""
    restaurants = []
    for place in places:
        name = place.get("displayName", {}).get("text", "")
        if not name:
            continue

        location = place.get("location", {})
        cuisine_label = (place.get("primaryTypeDisplayName", {}).get("text", "") or "").lower()
        cuisine_label = cuisine_label.replace(" restaurant", "").strip()

        # Photo
        photos = place.get("photos", [])
        photo_url = get_place_photo_url(photos[0]["name"]) if photos else None
        if not photo_url:
            photo_url = get_cuisine_photo(cuisine_label)

        # Price
        price_level = PRICE_LEVEL_MAP.get(place.get("priceLevel", ""), "")
        price_range_obj = place.get("priceRange", {})
        price_range = ""
        if price_range_obj:
            lo = price_range_obj.get("startPrice", {})
            hi = price_range_obj.get("endPrice", {})
            currency = lo.get("currencyCode", "EUR")
            sym = {"EUR": "\u20ac", "USD": "$", "GBP": "\u00a3"}.get(currency, currency + " ")
            lo_val = lo.get("units", "")
            hi_val = hi.get("units", "")
            if lo_val and hi_val:
                price_range = f"{sym}{lo_val}\u2013{sym}{hi_val}"

        # Hours
        hours_obj = place.get("regularOpeningHours", {})
        open_now = hours_obj.get("openNow")
        weekday_hours = hours_obj.get("weekdayDescriptions", [])

        restaurants.append({
            "id": f"gp-{place.get('id', '')}",
            "name": name,
            "cuisine": cuisine_label or (cuisine_filter.lower() if cuisine_filter else ""),
            "address": place.get("shortFormattedAddress") or place.get("formattedAddress", ""),
            "phone": place.get("internationalPhoneNumber", ""),
            "lat": location.get("latitude"),
            "lon": location.get("longitude"),
            "photo_url": photo_url,
            "rating": place.get("rating"),
            "rating_count": place.get("userRatingCount", 0),
            "price_level": price_level,
            "price_range": price_range,
            "website": place.get("websiteUri", ""),
            "maps_url": place.get("googleMapsUri", ""),
            "open_now": 1 if open_now else (0 if open_now is False else None),
            "hours": json.dumps(weekday_hours) if weekday_hours else "",
            "reservable": 1 if place.get("reservable") else 0,
            "vegetarian": 1 if place.get("servesVegetarianFood") else 0,
            "outdoor_seating": 1 if place.get("outdoorSeating") else 0,
            "dine_in": 1 if place.get("dineIn") else 0,
            "delivery": 1 if place.get("delivery") else 0,
            "takeout": 1 if place.get("takeout") else 0,
        })
    return restaurants


_GOOGLE_FIELD_MASK = (
    "places.id,places.displayName,places.formattedAddress,"
    "places.shortFormattedAddress,places.location,"
    "places.internationalPhoneNumber,"
    "places.primaryTypeDisplayName,places.photos,"
    "places.rating,places.userRatingCount,"
    "places.priceLevel,places.priceRange,"
    "places.websiteUri,places.googleMapsUri,"
    "places.regularOpeningHours,"
    "places.reservable,places.servesVegetarianFood,"
    "places.outdoorSeating,places.dineIn,"
    "places.delivery,places.takeout,"
    "nextPageToken"
)


def fetch_google_restaurants(city=None, cuisine_filter=None):
    """Fetch restaurants from Google Places API (Text Search).

    Follows nextPageToken to retrieve all available results (up to ~60).
    """
    if not GOOGLE_PLACES_API_KEY:
        app.logger.warning("GOOGLE_PLACES_API_KEY not set, skipping Google Places")
        return []

    city = city or DEFAULT_CITY
    cuisine_part = f"{cuisine_filter} " if cuisine_filter and cuisine_filter.lower() != "all" else ""
    query = f"{cuisine_part}restaurants in {city}"

    all_places = []
    page_token = None

    try:
        for _ in range(3):  # Google allows max 3 pages (60 results)
            body = {"textQuery": query, "maxResultCount": 20}
            if page_token:
                body["pageToken"] = page_token

            resp = requests.post(
                GOOGLE_PLACES_URL,
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": _GOOGLE_FIELD_MASK,
                },
                json=body,
                timeout=15,
            )
            resp.raise_for_status()
            data = resp.json()
            all_places.extend(data.get("places", []))

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return _parse_google_places(all_places, cuisine_filter)

    except Exception as exc:
        app.logger.warning("Google Places API failed: %s", exc)
        # Return whatever we've parsed so far
        return _parse_google_places(all_places, cuisine_filter) if all_places else []


def get_fallback_restaurants(city=None, cuisine_filter=None):
    """Return fallback restaurants, filtered by city and cuisine."""
    city = city or DEFAULT_CITY
    pool = FALLBACK_RESTAURANTS.get(city, FALLBACK_RESTAURANTS.get("Amsterdam", []))
    if cuisine_filter and cuisine_filter.lower() != "all":
        cf = cuisine_filter.lower()
        pool = [r for r in pool if cf in (r.get("cuisine") or "").lower()]
    for r in pool:
        if not r.get("photo_url"):
            r["photo_url"] = get_cuisine_photo(r.get("cuisine", ""))
    return pool


def seed_restaurants():
    """Load default city restaurants into DB — from Google Places if possible, else fallbacks."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM restaurants")
    count = cur.fetchone()[0]
    if count > 0:
        conn.close()
        return

    app.logger.info("Fetching restaurants from Google Places API...")
    restaurants = fetch_google_restaurants(city=DEFAULT_CITY)

    if len(restaurants) < 5:
        app.logger.info("Using fallback restaurant data")
        restaurants = get_fallback_restaurants(city=DEFAULT_CITY)

    now = datetime.now(timezone.utc).isoformat()
    city_lower = DEFAULT_CITY.lower().strip()
    for r in restaurants:
        cur.execute(
            "INSERT OR IGNORE INTO restaurants "
            "(id, name, cuisine, address, phone, lat, lon, photo_url, "
            "rating, rating_count, price_level, price_range, website, maps_url, "
            "open_now, hours, reservable, vegetarian, outdoor_seating, "
            "dine_in, delivery, takeout, cached_at, city) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (r["id"], r["name"], r.get("cuisine", ""), r.get("address", ""),
             r.get("phone", ""), r.get("lat"), r.get("lon"),
             r.get("photo_url", ""), r.get("rating"), r.get("rating_count", 0),
             r.get("price_level", ""), r.get("price_range", ""),
             r.get("website", ""), r.get("maps_url", ""),
             r.get("open_now"), r.get("hours", ""),
             r.get("reservable", 0), r.get("vegetarian", 0),
             r.get("outdoor_seating", 0), r.get("dine_in", 0),
             r.get("delivery", 0), r.get("takeout", 0), now, city_lower),
        )
    conn.commit()
    conn.close()
    app.logger.info("Seeded %d restaurants", len(restaurants))


def _cache_restaurants(restaurants, city=""):
    """Insert a list of restaurant dicts into the DB.

    Only tags a restaurant with the requested city if its address actually
    contains the city name.  This prevents Google Places results from
    neighbouring cities being mis-filed.
    """
    now = datetime.now(timezone.utc).isoformat()
    city_lower = city.lower().strip() if city else ""
    conn = get_db()
    for r in restaurants:
        # Determine the correct city tag: only use the requested city
        # if the restaurant's address actually mentions it.
        addr = (r.get("address") or "").lower()
        if city_lower and city_lower in addr:
            tag = city_lower
        else:
            tag = ""
            if city_lower:
                app.logger.debug(
                    "Skipping city tag '%s' for '%s' (address: %s)",
                    city_lower, r["name"], r.get("address", ""),
                )
        conn.execute(
            "INSERT OR IGNORE INTO restaurants "
            "(id, name, cuisine, address, phone, lat, lon, photo_url, "
            "rating, rating_count, price_level, price_range, website, maps_url, "
            "open_now, hours, reservable, vegetarian, outdoor_seating, "
            "dine_in, delivery, takeout, cached_at, city) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (r["id"], r["name"], r.get("cuisine", ""), r.get("address", ""),
             r.get("phone", ""), r.get("lat"), r.get("lon"),
             r.get("photo_url", ""), r.get("rating"), r.get("rating_count", 0),
             r.get("price_level", ""), r.get("price_range", ""),
             r.get("website", ""), r.get("maps_url", ""),
             r.get("open_now"), r.get("hours", ""),
             r.get("reservable", 0), r.get("vegetarian", 0),
             r.get("outdoor_seating", 0), r.get("dine_in", 0),
             r.get("delivery", 0), r.get("takeout", 0), now, tag),
        )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Conversation history
# ---------------------------------------------------------------------------
def store_message(phone, role, content):
    conn = get_db()
    conn.execute(
        "INSERT INTO conversations (customer_phone, role, content, timestamp) VALUES (?, ?, ?, ?)",
        (phone, role, content, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    conn.close()


def get_conversation_history(phone, limit=20):
    conn = get_db()
    rows = conn.execute(
        "SELECT role, content, timestamp FROM conversations "
        "WHERE customer_phone = ? ORDER BY timestamp DESC LIMIT ?",
        (phone, limit),
    ).fetchall()
    conn.close()
    return [dict(r) for r in reversed(rows)]


# ---------------------------------------------------------------------------
# Reservation helpers
# ---------------------------------------------------------------------------
def get_reservations_for_date(date_str):
    """Get all reservations for a given date."""
    conn = get_db()
    rows = conn.execute(
        "SELECT r.*, rest.name as restaurant_name FROM reservations r "
        "LEFT JOIN restaurants rest ON r.restaurant_id = rest.id "
        "WHERE r.date = ? ORDER BY r.time",
        (date_str,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_reservations_for_phone(phone):
    """Get upcoming reservations for a customer."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    conn = get_db()
    rows = conn.execute(
        "SELECT r.*, rest.name as restaurant_name FROM reservations r "
        "LEFT JOIN restaurants rest ON r.restaurant_id = rest.id "
        "WHERE r.customer_phone = ? AND r.date >= ? AND r.status != 'cancelled' "
        "ORDER BY r.date, r.time",
        (phone, today),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def check_availability(restaurant_id, date_str, party_size):
    """Check available time slots for a restaurant on a given date.

    Returns list of available time slots with suitable tables.
    """
    party_size = int(party_size)
    conn = get_db()
    # Get existing reservations for this restaurant on this date
    booked = conn.execute(
        "SELECT time, party_size FROM reservations "
        "WHERE restaurant_id = ? AND date = ? AND status IN ('pending', 'confirmed')",
        (restaurant_id, date_str),
    ).fetchall()
    conn.close()

    booked_times = {}
    for row in booked:
        t = row["time"]
        if t not in booked_times:
            booked_times[t] = []
        booked_times[t].append(row["party_size"])

    available = []
    for slot in TIME_SLOTS:
        # Count how many tables are already booked at this time
        booked_at_slot = booked_times.get(slot, [])
        # Find a suitable table (enough seats, not already booked)
        suitable_tables = [
            t for t in TABLES
            if t["seats"] >= party_size
            and sum(1 for b in booked_at_slot if b <= t["seats"]) < 1
        ]
        # Simplified: check if any table with enough seats is free
        booked_count = len(booked_at_slot)
        if booked_count < len(TABLES) and any(t["seats"] >= party_size for t in TABLES):
            available.append(slot)

    return available


def make_reservation(restaurant_id, customer_phone, customer_name, party_size, date_str, time_str, notes=""):
    """Create a new reservation."""
    party_size = int(party_size)
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO reservations (restaurant_id, customer_phone, customer_name, "
        "party_size, date, time, status, notes, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)",
        (restaurant_id, customer_phone, customer_name, party_size,
         date_str, time_str, notes, now, now),
    )
    reservation_id = cur.lastrowid
    conn.commit()

    # Fetch the full reservation with restaurant name
    row = conn.execute(
        "SELECT r.*, rest.name as restaurant_name FROM reservations r "
        "LEFT JOIN restaurants rest ON r.restaurant_id = rest.id "
        "WHERE r.id = ?",
        (reservation_id,),
    ).fetchone()
    conn.close()

    reservation = dict(row) if row else {"id": reservation_id}
    sse_publish("reservation.new", {"reservation": reservation})
    return reservation


def cancel_reservation(reservation_id):
    """Cancel a reservation."""
    reservation_id = int(reservation_id)
    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    conn.execute(
        "UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?",
        (now, reservation_id),
    )
    conn.commit()
    row = conn.execute(
        "SELECT r.*, rest.name as restaurant_name FROM reservations r "
        "LEFT JOIN restaurants rest ON r.restaurant_id = rest.id "
        "WHERE r.id = ?",
        (reservation_id,),
    ).fetchone()
    conn.close()
    reservation = dict(row) if row else {"id": reservation_id}
    sse_publish("reservation.update", {"reservation": reservation})
    return reservation


def search_restaurants(query_str, city=None):
    """Search restaurants by name or cuisine. If city is given and no cached
    results exist, fetch fresh data from Google Places first."""
    conn = get_db()
    if city:
        city_lower = city.lower().strip()
        # Match on the city column OR fall back to address LIKE for legacy rows
        rows = conn.execute(
            "SELECT * FROM restaurants WHERE (name LIKE ? OR cuisine LIKE ?) "
            "AND (city LIKE ? OR address LIKE ?) LIMIT 10",
            (f"%{query_str}%", f"%{query_str}%", f"%{city_lower}%", f"%{city}%"),
        ).fetchall()
        if not rows:
            # Fetch from Google Places for this city + query
            conn.close()
            search_term = f"{query_str} restaurants in {city}" if query_str else city
            fresh = fetch_google_restaurants(search_term)
            if fresh:
                _cache_restaurants(fresh, city=city)
            conn = get_db()
            rows = conn.execute(
                "SELECT * FROM restaurants WHERE (name LIKE ? OR cuisine LIKE ?) "
                "AND (city LIKE ? OR address LIKE ?) LIMIT 10",
                (f"%{query_str}%", f"%{query_str}%", f"%{city_lower}%", f"%{city}%"),
            ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM restaurants WHERE name LIKE ? OR cuisine LIKE ? LIMIT 10",
            (f"%{query_str}%", f"%{query_str}%"),
        ).fetchall()
        if not rows and query_str:
            # Try fetching from Google Places
            conn.close()
            fresh = fetch_google_restaurants(query_str)
            if fresh:
                _cache_restaurants(fresh, city=query_str)
            conn = get_db()
            rows = conn.execute(
                "SELECT * FROM restaurants WHERE name LIKE ? OR cuisine LIKE ? LIMIT 10",
                (f"%{query_str}%", f"%{query_str}%"),
            ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# WhatsApp messaging — text, interactive list, interactive buttons
# ---------------------------------------------------------------------------
def _wa_headers():
    return {
        "Authorization": f"Bearer {TELNYX_WHATSAPP_API_KEY}",
        "Content-Type": "application/json",
    }


def send_whatsapp_text(to, text):
    """Send a plain text WhatsApp message."""
    payload = {
        "from": WHATSAPP_NUMBER,
        "to": to,
        "messaging_profile_id": WHATSAPP_MESSAGING_PROFILE_ID,
        "whatsapp_message": {"type": "text", "text": {"body": text}},
    }
    resp = requests.post(
        "https://api.telnyx.com/v2/messages/whatsapp",
        headers=_wa_headers(), json=payload, timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def send_whatsapp_list(to, body_text, button_text, sections):
    """Send an interactive list message via WhatsApp.

    sections: [{"title": "...", "rows": [{"id": "...", "title": "...", "description": "..."}]}]
    """
    payload = {
        "from": WHATSAPP_NUMBER,
        "to": to,
        "messaging_profile_id": WHATSAPP_MESSAGING_PROFILE_ID,
        "whatsapp_message": {
            "type": "interactive",
            "interactive": {
                "type": "list",
                "body": {"text": body_text},
                "action": {
                    "button": button_text,
                    "sections": sections,
                },
            },
        },
    }
    resp = requests.post(
        "https://api.telnyx.com/v2/messages/whatsapp",
        headers=_wa_headers(), json=payload, timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def send_whatsapp_buttons(to, body_text, buttons):
    """Send an interactive button message via WhatsApp.

    buttons: [{"id": "...", "title": "..."}]  (max 3)
    """
    payload = {
        "from": WHATSAPP_NUMBER,
        "to": to,
        "messaging_profile_id": WHATSAPP_MESSAGING_PROFILE_ID,
        "whatsapp_message": {
            "type": "interactive",
            "interactive": {
                "type": "button",
                "body": {"text": body_text},
                "action": {
                    "buttons": [
                        {"type": "reply", "reply": {"id": b["id"], "title": b["title"]}}
                        for b in buttons[:3]
                    ],
                },
            },
        },
    }
    resp = requests.post(
        "https://api.telnyx.com/v2/messages/whatsapp",
        headers=_wa_headers(), json=payload, timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# AI Agentic Loop — system prompt, tools, inference
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = f"""You are a friendly restaurant reservation assistant. You help customers browse restaurants and book tables via WhatsApp. You can find restaurants in any city — just ask the customer where they'd like to dine.

Today's date is {datetime.now(timezone.utc).strftime('%Y-%m-%d')} ({datetime.now(timezone.utc).strftime('%A')}).

Available time slots: {', '.join(TIME_SLOTS)}

CRITICAL RULES:
- ALWAYS use the send_whatsapp tool to reply to the customer. NEVER put your reply in a plain text response — it MUST go through send_whatsapp. Every turn must end with exactly one send_whatsapp call.
- Send EXACTLY ONE WhatsApp message per turn. After calling send_whatsapp, STOP. Do not call send_whatsapp again — wait for the customer to reply.
- You may call search_restaurants, check_availability, or other data tools multiple times before sending your ONE message via send_whatsapp.
- Keep messages short — this is WhatsApp, not email. 1-3 sentences max.
- Always use send_whatsapp with message_type="text" — do NOT use "list" or "buttons" message types.

Conversation flow:
1. Customer says hi → Greet them and ask what they're looking for. Call send_whatsapp with your greeting.
2. Customer mentions a restaurant → Use search_restaurants to find it, then call send_whatsapp with the match and ask for date and party size.
3. Customer provides details → Use check_availability, then call send_whatsapp with available times.
4. Customer picks a time → Use make_reservation to book it, then call send_whatsapp with confirmation.
5. If the customer wants to cancel → Use get_customer_reservations, then cancel_reservation, then call send_whatsapp to confirm cancellation.

Other guidelines:
- NEVER invent or guess the customer's name. You only know their phone number. If you need their name, ask them. Until they tell you, do not use any name.
- Default to today's date if the customer says "tonight" or "today"
- Parse relative dates: "tomorrow", "this Friday", "next week", etc.
- If a voice note transcription is provided, respond naturally to its content"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_restaurants",
            "description": "Search for restaurants by name or cuisine in a given city. If no cached results exist, fetches live data from Google Places. Always pass the city when the customer mentions a location.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query — restaurant name or cuisine type (e.g. 'De Kas', 'indian', 'seafood')",
                    },
                    "city": {
                        "type": "string",
                        "description": "City or area to search in (e.g. 'Heemstede', 'Amsterdam', 'Rotterdam')",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_availability",
            "description": "Check available time slots for a specific restaurant on a given date and party size.",
            "parameters": {
                "type": "object",
                "properties": {
                    "restaurant_id": {"type": "string", "description": "Restaurant ID"},
                    "date": {"type": "string", "description": "Date in YYYY-MM-DD format"},
                    "party_size": {"type": "integer", "description": "Number of guests"},
                },
                "required": ["restaurant_id", "date", "party_size"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "make_reservation",
            "description": "Create a confirmed restaurant reservation. Only call this after the customer confirms via buttons.",
            "parameters": {
                "type": "object",
                "properties": {
                    "restaurant_id": {"type": "string", "description": "Restaurant ID"},
                    "customer_phone": {"type": "string", "description": "Customer phone in E.164 format"},
                    "customer_name": {"type": "string", "description": "Customer name (if known)"},
                    "party_size": {"type": "integer", "description": "Number of guests"},
                    "date": {"type": "string", "description": "Date in YYYY-MM-DD format"},
                    "time": {"type": "string", "description": "Time slot (e.g. '19:00')"},
                    "notes": {"type": "string", "description": "Special requests or notes"},
                },
                "required": ["restaurant_id", "customer_phone", "party_size", "date", "time"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_reservation",
            "description": "Cancel an existing reservation by ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reservation_id": {"type": "integer", "description": "Reservation ID to cancel"},
                },
                "required": ["reservation_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_customer_reservations",
            "description": "Get all upcoming reservations for a customer by phone number.",
            "parameters": {
                "type": "object",
                "properties": {
                    "phone": {"type": "string", "description": "Customer phone in E.164 format"},
                },
                "required": ["phone"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_whatsapp",
            "description": "Send a WhatsApp message to the customer. Supports text, interactive list, and interactive button messages.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient phone number in E.164 format"},
                    "message_type": {
                        "type": "string",
                        "enum": ["text", "list", "buttons"],
                        "description": "Message type: 'text' for plain text, 'list' for selection list, 'buttons' for quick reply buttons (max 3)",
                    },
                    "text": {"type": "string", "description": "Message body text"},
                    "button_text": {
                        "type": "string",
                        "description": "For list messages: the button text that opens the list (e.g. 'Choose a restaurant')",
                    },
                    "sections": {
                        "type": "array",
                        "description": "For list messages: sections with selectable rows",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "rows": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "id": {"type": "string"},
                                            "title": {"type": "string"},
                                            "description": {"type": "string"},
                                        },
                                    },
                                },
                            },
                        },
                    },
                    "buttons": {
                        "type": "array",
                        "description": "For button messages: quick reply buttons (max 3)",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                            },
                        },
                    },
                },
                "required": ["to", "message_type", "text"],
            },
        },
    },
]


def call_inference(messages):
    """Call Telnyx AI Inference and return the raw response."""
    resp = requests.post(
        INFERENCE_URL,
        headers={
            "Authorization": f"Bearer {TELNYX_API_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "model": AI_MODEL,
            "messages": messages,
            "tools": TOOLS,
            "max_tokens": 4096,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def execute_tool(tool_name, tool_input, customer_phone):
    """Route an AI tool call to the appropriate function."""
    if tool_name == "search_restaurants":
        city = tool_input.get("city")
        results = search_restaurants(tool_input.get("query", ""), city=city)
        if city:
            sse_publish("restaurant.search", {"city": city, "query": tool_input.get("query", "")})
        return json.dumps({"restaurants": results}, default=str)

    if tool_name == "check_availability":
        slots = check_availability(
            tool_input["restaurant_id"],
            tool_input["date"],
            tool_input.get("party_size", 2),
        )
        return json.dumps({"available_slots": slots, "date": tool_input["date"]})

    if tool_name == "make_reservation":
        reservation = make_reservation(
            restaurant_id=tool_input["restaurant_id"],
            customer_phone=tool_input.get("customer_phone", customer_phone),
            customer_name=tool_input.get("customer_name", ""),
            party_size=tool_input["party_size"],
            date_str=tool_input["date"],
            time_str=tool_input["time"],
            notes=tool_input.get("notes", ""),
        )
        sse_publish("restaurant.selected", {"restaurant_id": tool_input["restaurant_id"]})
        return json.dumps({"reservation": reservation}, default=str)

    if tool_name == "cancel_reservation":
        reservation = cancel_reservation(tool_input["reservation_id"])
        return json.dumps({"reservation": reservation}, default=str)

    if tool_name == "get_customer_reservations":
        reservations = get_reservations_for_phone(tool_input["phone"])
        return json.dumps({"reservations": reservations}, default=str)

    if tool_name == "send_whatsapp":
        to = tool_input["to"]
        msg_type = tool_input.get("message_type", "text")
        text = tool_input.get("text", "")

        try:
            if msg_type == "list":
                send_whatsapp_list(
                    to, text,
                    tool_input.get("button_text", "Select"),
                    tool_input.get("sections", []),
                )
            elif msg_type == "buttons":
                send_whatsapp_buttons(
                    to, text,
                    tool_input.get("buttons", []),
                )
            else:
                send_whatsapp_text(to, text)
        except requests.HTTPError as exc:
            app.logger.warning("WhatsApp send failed (%s), falling back to text: %s", msg_type, exc)
            # Fall back to plain text if interactive fails
            if msg_type != "text":
                send_whatsapp_text(to, text)

        store_message(to, "assistant", text)
        sse_publish("channel.whatsapp", {
            "direction": "outbound",
            "text": text,
            "to": to,
            "message_type": msg_type,
        })
        return json.dumps({"status": "sent", "message_type": msg_type})

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


def process_inbound_whatsapp(from_number, text):
    """Process an inbound WhatsApp message through the AI agentic loop."""
    history = get_conversation_history(from_number)
    history_text = "\n".join(
        f"{msg['role']}: {msg['content']}" for msg in history
    )

    # Check for existing reservations
    reservations = get_reservations_for_phone(from_number)
    res_text = ""
    if reservations:
        res_text = "\nCustomer's upcoming reservations:\n" + "\n".join(
            f"  #{r['id']}: {r.get('restaurant_name', r['restaurant_id'])} on {r['date']} at {r['time']} "
            f"(party of {r['party_size']}, status: {r['status']})"
            for r in reservations
        )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Customer phone: {from_number}\n"
                f"Inbound WhatsApp message: {text}\n\n"
                f"Conversation history:\n{history_text}\n"
                f"{res_text}\n\n"
                f"Handle this message. Use your tools to search restaurants, check availability, "
                f"and make reservations as needed. Always send a WhatsApp response."
            ),
        },
    ]

    sse_publish("agent.thinking", {"content": f"Processing message from {from_number}..."})

    # Agentic loop — keep calling inference until no more tool calls
    max_iterations = 10
    for _ in range(max_iterations):
        try:
            data = call_inference(messages)
        except Exception as exc:
            app.logger.error("Inference failed: %s", exc)
            sse_publish("agent.error", {"error": str(exc)})
            # Send a fallback text response
            try:
                send_whatsapp_text(
                    from_number,
                    "Sorry, I'm having trouble processing your request right now. Please try again in a moment.",
                )
            except Exception:
                pass
            return

        choice = data["choices"][0]
        msg = choice["message"]

        if msg.get("content"):
            sse_publish("agent.thinking", {"content": msg["content"]})

        if not msg.get("tool_calls"):
            # No more tools — AI is done. If it produced text but never
            # called send_whatsapp, send the text to the customer directly.
            if msg.get("content"):
                try:
                    send_whatsapp_text(from_number, msg["content"])
                    store_message(from_number, "assistant", msg["content"])
                    # Publish as channel.whatsapp so the phone simulator
                    # renders a chat bubble (same event as send_whatsapp tool).
                    sse_publish("channel.whatsapp", {
                        "direction": "outbound",
                        "text": msg["content"],
                        "to": from_number,
                        "message_type": "text",
                    })
                except Exception as exc:
                    app.logger.error("Auto-send failed: %s", exc)
                    sse_publish("agent.error", {"error": str(exc)})
            showTyping_done = True
            sse_publish("agent.done", {"content": "Message sent"})
            break

        messages.append(msg)

        message_sent = False
        for tc in msg["tool_calls"]:
            fn = tc["function"]
            tool_name = fn["name"]
            try:
                raw_args = fn.get("arguments", "{}")
                tool_input = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                if not isinstance(tool_input, dict):
                    tool_input = {}
            except (json.JSONDecodeError, TypeError):
                tool_input = {}

            sse_publish("agent.tool_call", {"tool": tool_name, "input": tool_input})
            result = execute_tool(tool_name, tool_input, from_number)
            sse_publish("agent.tool_result", {"tool": tool_name, "result": result})

            messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": result,
            })

            if tool_name == "send_whatsapp":
                message_sent = True

        # Stop the loop once a message has been sent to the customer
        if message_sent:
            sse_publish("agent.done", {"content": "Message sent, waiting for reply"})
            break


# ---------------------------------------------------------------------------
# Audio transcription — voice notes
# ---------------------------------------------------------------------------
def transcribe_audio(audio_url):
    """Download and transcribe a WhatsApp voice note using Telnyx AI."""
    try:
        # Download the audio file — WhatsApp media URLs require auth
        app.logger.info("Downloading voice note from: %s", audio_url)
        audio_resp = requests.get(
            audio_url,
            headers={"Authorization": f"Bearer {TELNYX_WHATSAPP_API_KEY}"},
            timeout=15,
        )
        audio_resp.raise_for_status()
        app.logger.info("Downloaded audio: %d bytes, content-type: %s",
                        len(audio_resp.content), audio_resp.headers.get("content-type", "unknown"))

        # Use Telnyx AI for speech-to-text
        content_type = audio_resp.headers.get("content-type", "audio/ogg")
        ext = "ogg" if "ogg" in content_type else "mp4" if "mp4" in content_type else "ogg"
        files = {"file": (f"voice.{ext}", audio_resp.content, content_type)}
        resp = requests.post(
            "https://api.telnyx.com/v2/ai/audio/transcriptions",
            headers={"Authorization": f"Bearer {TELNYX_API_KEY}"},
            files=files,
            data={"model": "openai/whisper-large-v3-turbo"},
            timeout=30,
        )
        app.logger.info("Transcription response: %s %s", resp.status_code, resp.text[:500])
        resp.raise_for_status()
        return resp.json().get("text", "")
    except Exception as exc:
        app.logger.error("Audio transcription failed: %s", exc)
        return ""


# ---------------------------------------------------------------------------
# Webhook handlers — deduplication to prevent feedback loops
# ---------------------------------------------------------------------------
_processed_msg_ids = set()
_phone_cooldown = {}  # phone -> timestamp of last processed message
_dedup_lock = threading.Lock()
COOLDOWN_SECONDS = 3  # Ignore rapid-fire webhooks from the same number


def _is_duplicate(msg_id, from_number):
    """Check if this message was already processed or is within cooldown."""
    now = time.time()
    with _dedup_lock:
        # Check message ID dedup
        if msg_id and msg_id in _processed_msg_ids:
            return True
        # Check per-phone cooldown
        last_time = _phone_cooldown.get(from_number, 0)
        if now - last_time < COOLDOWN_SECONDS:
            return True
        # Mark as processed
        if msg_id:
            _processed_msg_ids.add(msg_id)
            # Keep set bounded
            if len(_processed_msg_ids) > 1000:
                _processed_msg_ids.clear()
        _phone_cooldown[from_number] = now
    return False


@app.route("/webhooks/whatsapp", methods=["POST"])
def handle_whatsapp():
    """Handle inbound WhatsApp messages from Telnyx."""
    payload = request.get_json()
    if not payload:
        return jsonify({"error": "No payload"}), 400

    data = payload.get("data", {})
    p = data.get("payload", {})
    event_type = data.get("event_type")

    # Only process inbound messages
    if event_type != "message.received":
        return jsonify({"status": "ignored"}), 200
    if p.get("direction") != "inbound":
        return jsonify({"status": "ignored"}), 200

    from_number = p.get("from", {}).get("phone_number", "")
    if not from_number:
        return jsonify({"status": "ignored"}), 200

    # Ignore messages from our own number (echo)
    if from_number == WHATSAPP_NUMBER:
        return jsonify({"status": "ignored"}), 200

    # Deduplicate by message ID and cooldown
    msg_id = p.get("id") or data.get("id", "")
    if _is_duplicate(msg_id, from_number):
        app.logger.debug("Skipping duplicate/cooldown: msg_id=%s phone=%s", msg_id, from_number)
        return jsonify({"status": "duplicate"}), 200

    body = p.get("body", {})
    msg_type = body.get("type", "text")

    # Extract text based on message type
    text = ""
    if msg_type == "text":
        text_obj = body.get("text", {})
        text = text_obj.get("body", "") if isinstance(text_obj, dict) else str(text_obj)
    elif msg_type in ("interactive",):
        # Interactive reply (list_reply or button_reply)
        interactive = body.get("interactive", {})
        reply_type = interactive.get("type", "")
        if reply_type == "list_reply":
            reply = interactive.get("list_reply", {})
            text = reply.get("title", "") or reply.get("id", "")
        elif reply_type == "button_reply":
            reply = interactive.get("button_reply", {})
            text = reply.get("title", "") or reply.get("id", "")
    elif msg_type == "audio":
        # Voice note — download and transcribe
        audio_obj = body.get("audio", {})
        audio_url = audio_obj.get("url", "") if isinstance(audio_obj, dict) else ""
        if audio_url:
            sse_publish("agent.thinking", {"content": "Transcribing voice note..."})
            text = transcribe_audio(audio_url)
            if text:
                text = f"[Voice note transcription]: {text}"
            else:
                text = "[Voice note received but could not be transcribed]"
    else:
        # Image, video, document, etc.
        caption = body.get("caption", "") or body.get(msg_type, {}).get("caption", "")
        text = caption or f"[{msg_type} message received]"

    if not text:
        text = "[Empty message]"

    # Store inbound message
    store_message(from_number, "user", text)

    # Publish to dashboard
    sse_publish("channel.whatsapp", {
        "direction": "inbound",
        "from": from_number,
        "text": text,
        "message_type": msg_type,
    })

    # Process in background thread so webhook returns fast
    def _process():
        try:
            process_inbound_whatsapp(from_number, text)
        except Exception as exc:
            app.logger.error("WhatsApp processing failed: %s", exc)
            sse_publish("agent.error", {"error": str(exc)})

    threading.Thread(target=_process, daemon=True).start()
    return jsonify({"status": "processing"}), 200


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "whatsapp_number": WHATSAPP_NUMBER,
        "city": DEFAULT_CITY,
    })


@app.route("/api/restaurants", methods=["GET"])
def api_restaurants():
    """List restaurants with pagination. Accepts ?city=, ?cuisine=, ?q=, ?page=, ?per_page=.

    When city or cuisine changes, fetches fresh data from Google Places API
    (falling back to hardcoded data if the API is down).
    """
    city = request.args.get("city", "").strip() or DEFAULT_CITY
    cuisine = request.args.get("cuisine", "").strip() or "All"
    q = request.args.get("q", "").strip()
    page = max(1, request.args.get("page", 1, type=int))
    per_page = min(50, max(1, request.args.get("per_page", 12, type=int)))

    # Check if we have cached data for this city
    city_lower = city.lower().strip()
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM restaurants WHERE city LIKE ? OR address LIKE ? ORDER BY name",
        (f"%{city_lower}%", f"%{city}%"),
    ).fetchall()
    conn.close()

    # If no cached data for this city, fetch fresh
    if not rows:
        restaurants = fetch_google_restaurants(city=city, cuisine_filter=None)
        if len(restaurants) < 3:
            restaurants = get_fallback_restaurants(city=city)
        _cache_restaurants(restaurants, city=city)
        result = restaurants
    else:
        result = [dict(r) for r in rows]

    # Apply cuisine filter
    if cuisine and cuisine.lower() != "all":
        cf = cuisine.lower()
        filtered = [r for r in result if cf in (r.get("cuisine") or "").lower()]
        # If no matches in cache, do a targeted Google Places search
        if not filtered and GOOGLE_PLACES_API_KEY:
            filtered = fetch_google_restaurants(city=city, cuisine_filter=cuisine)
            if filtered:
                _cache_restaurants(filtered, city=city)
        result = filtered

    # Apply text search filter
    if q:
        ql = q.lower()
        result = [r for r in result if ql in (r.get("name") or "").lower() or ql in (r.get("cuisine") or "").lower()]

    # Paginate
    total = len(result)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = min(page, total_pages)
    start = (page - 1) * per_page
    page_items = result[start:start + per_page]

    return jsonify({
        "restaurants": page_items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
    })


@app.route("/api/restaurants/refresh", methods=["POST"])
def api_refresh_restaurants():
    """Refresh restaurant data from Google Places API for a city."""
    data = request.get_json(silent=True) or {}
    city = data.get("city", "").strip() or request.args.get("city", "").strip() or DEFAULT_CITY

    # Clear cached restaurants for this city
    conn = get_db()
    conn.execute("DELETE FROM restaurants WHERE address LIKE ?", (f"%{city}%",))
    conn.commit()
    conn.close()

    restaurants = fetch_google_restaurants(city=city)
    if len(restaurants) < 3:
        restaurants = get_fallback_restaurants(city=city)

    _cache_restaurants(restaurants)
    return jsonify({"status": "refreshed", "count": len(restaurants), "city": city})


@app.route("/api/cuisines", methods=["GET"])
def api_cuisines():
    """Return available cuisine filters."""
    return jsonify(CUISINES)


@app.route("/api/reservations", methods=["GET"])
def api_reservations():
    """List reservations. Default: all upcoming. Pass ?date=YYYY-MM-DD for a specific date."""
    date_str = request.args.get("date", "")
    if date_str:
        reservations = get_reservations_for_date(date_str)
    else:
        # Return all upcoming reservations (today and future)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        conn = get_db()
        rows = conn.execute(
            "SELECT r.*, rest.name as restaurant_name FROM reservations r "
            "LEFT JOIN restaurants rest ON r.restaurant_id = rest.id "
            "WHERE r.date >= ? ORDER BY r.date, r.time",
            (today,),
        ).fetchall()
        conn.close()
        reservations = [dict(r) for r in rows]
        date_str = today
    return jsonify({"date": date_str, "reservations": reservations})


@app.route("/api/reservations/<int:res_id>", methods=["PATCH"])
def api_update_reservation(res_id):
    """Update a reservation's status."""
    data = request.get_json()
    if not data or "status" not in data:
        return jsonify({"error": "status is required"}), 400

    new_status = data["status"]
    if new_status not in ("pending", "confirmed", "cancelled", "completed", "no_show"):
        return jsonify({"error": "Invalid status"}), 400

    now = datetime.now(timezone.utc).isoformat()
    conn = get_db()
    conn.execute(
        "UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?",
        (new_status, now, res_id),
    )
    conn.commit()
    row = conn.execute(
        "SELECT r.*, rest.name as restaurant_name FROM reservations r "
        "LEFT JOIN restaurants rest ON r.restaurant_id = rest.id "
        "WHERE r.id = ?",
        (res_id,),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({"error": "Not found"}), 404

    reservation = dict(row)
    sse_publish("reservation.update", {"reservation": reservation})
    return jsonify(reservation)


# ---------------------------------------------------------------------------
# Dashboard & SSE
# ---------------------------------------------------------------------------
@app.route("/", methods=["GET"])
def dashboard():
    return render_template(
        "index.html",
        whatsapp_number=WHATSAPP_NUMBER,
        city=DEFAULT_CITY,
        cuisines=CUISINES,
    )


@app.route("/stream", methods=["GET"])
def sse_stream():
    """SSE endpoint — streams events to the browser."""
    q = queue.Queue(maxsize=200)
    with _sse_lock:
        _sse_subscribers.append(q)

    def generate():
        try:
            while True:
                try:
                    payload = q.get(timeout=30)
                    yield f"data: {payload}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            with _sse_lock:
                if q in _sse_subscribers:
                    _sse_subscribers.remove(q)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    init_db()
    seed_restaurants()
    app.run(host="0.0.0.0", port=PORT, debug=False)
