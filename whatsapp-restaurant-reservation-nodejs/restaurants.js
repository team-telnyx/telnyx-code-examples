// Restaurant data — Google Places API, fallback seed data, caching.
import { setting } from "./settings.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText";

export const CUISINES = [
  "All", "Indian", "Italian", "Mexican", "Dutch", "Surinamese", "Indonesian",
  "Japanese", "French", "Chinese", "Spanish", "Seafood", "Thai", "Vietnamese",
  "Korean", "American", "Mediterranean",
];

const CUISINE_PHOTOS = {
  fine_dining: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=300&fit=crop",
  dutch: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=400&h=300&fit=crop",
  french: "https://images.unsplash.com/photo-1550547660-d9450f859349?w=400&h=300&fit=crop",
  modern_european: "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=400&h=300&fit=crop",
  italian: "https://images.unsplash.com/photo-1498579150354-977475b7ea0b?w=400&h=300&fit=crop",
  chinese: "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=400&h=300&fit=crop",
  japanese: "https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&h=300&fit=crop",
  indonesian: "https://images.unsplash.com/photo-1562565652-a0d8f0c59eb4?w=400&h=300&fit=crop",
  indian: "https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=400&h=300&fit=crop",
  mexican: "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400&h=300&fit=crop",
  surinamese: "https://images.unsplash.com/photo-1630409351217-bc61f1be0a28?w=400&h=300&fit=crop",
  spanish: "https://images.unsplash.com/photo-1515443961218-a51367888e4b?w=400&h=300&fit=crop",
  seafood: "https://images.unsplash.com/photo-1535399831218-d5bd36d1a6b3?w=400&h=300&fit=crop",
  vegan: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=300&fit=crop",
  steak: "https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=300&fit=crop",
  default: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400&h=300&fit=crop",
};

const PRICE_LEVEL_MAP = {
  PRICE_LEVEL_FREE: "",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

const GOOGLE_FIELD_MASK = [
  "places.id", "places.displayName", "places.formattedAddress",
  "places.shortFormattedAddress", "places.location",
  "places.internationalPhoneNumber", "places.primaryTypeDisplayName",
  "places.photos", "places.rating", "places.userRatingCount",
  "places.priceLevel", "places.priceRange",
  "places.websiteUri", "places.googleMapsUri",
  "places.regularOpeningHours",
  "places.reservable", "places.servesVegetarianFood",
  "places.outdoorSeating", "places.dineIn",
  "places.delivery", "places.takeout",
  "nextPageToken",
].join(",");

// ---------------------------------------------------------------------------
// Fallback restaurant seed data
// ---------------------------------------------------------------------------
const FALLBACK_RESTAURANTS = {
  Amsterdam: [
    { id: "fb-ams-1", name: "De Kas", cuisine: "dutch", address: "Kamerlingh Onneslaan 3, Amsterdam", phone: "+31206204562", lat: 52.3541, lon: 4.9258 },
    { id: "fb-ams-2", name: "Moeders", cuisine: "dutch", address: "Rozengracht 251, Amsterdam", phone: "+31206267957", lat: 52.3713, lon: 4.877 },
    { id: "fb-ams-3", name: "Tempo Doeloe", cuisine: "indonesian", address: "Utrechtsestraat 75, Amsterdam", phone: "+31206256718", lat: 52.3618, lon: 4.8972 },
    { id: "fb-ams-4", name: "Blauw", cuisine: "indonesian", address: "Amstelveenseweg 158, Amsterdam", phone: "+31206753000", lat: 52.3519, lon: 4.8636 },
    { id: "fb-ams-5", name: "Ashoka", cuisine: "indian", address: "Spuistraat 2, Amsterdam", phone: "+31206206338", lat: 52.3779, lon: 4.8907 },
    { id: "fb-ams-6", name: "Memories of India", cuisine: "indian", address: "Reguliersdwarsstraat 88, Amsterdam", phone: "+31206234578", lat: 52.3644, lon: 4.8935 },
    { id: "fb-ams-7", name: "Toscanini", cuisine: "italian", address: "Lindengracht 75, Amsterdam", phone: "+31206232813", lat: 52.3809, lon: 4.8825 },
    { id: "fb-ams-8", name: "Roberto's", cuisine: "italian", address: "Hilton Amsterdam, Apollolaan 138, Amsterdam", phone: "+31207106691", lat: 52.3507, lon: 4.8773 },
    { id: "fb-ams-9", name: "Taqueria Mexiana", cuisine: "mexican", address: "Albert Cuypstraat 68, Amsterdam", phone: null, lat: 52.3559, lon: 4.8952 },
    { id: "fb-ams-10", name: "Salmuera", cuisine: "mexican", address: "Ceintuurbaan 149, Amsterdam", phone: null, lat: 52.353, lon: 4.8974 },
    { id: "fb-ams-11", name: "Warung Spang Makandra", cuisine: "surinamese", address: "Gerard Doustraat 39, Amsterdam", phone: "+31206705081", lat: 52.3542, lon: 4.8932 },
    { id: "fb-ams-12", name: "Roopram Roti", cuisine: "surinamese", address: "Eerste van Swindenstraat 4, Amsterdam", phone: "+31206938102", lat: 52.3616, lon: 4.926 },
    { id: "fb-ams-13", name: "Hakata Senpachi", cuisine: "japanese", address: "Binnen Bantammerstraat 7, Amsterdam", phone: "+31206256451", lat: 52.3739, lon: 4.9008 },
    { id: "fb-ams-14", name: "Rijsel", cuisine: "french", address: "Marcusstraat 52b, Amsterdam", phone: "+31206637794", lat: 52.3558, lon: 4.9199 },
    { id: "fb-ams-15", name: "Fulu Mandarijn", cuisine: "chinese", address: "Rokin 26, Amsterdam", phone: "+31206230885", lat: 52.3706, lon: 4.8924 },
    { id: "fb-ams-16", name: "La Oliva", cuisine: "spanish", address: "Egelantiersstraat 122, Amsterdam", phone: "+31206204316", lat: 52.3764, lon: 4.8828 },
    { id: "fb-ams-17", name: "Restaurant Visaandeschelde", cuisine: "seafood", address: "Scheldeplein 4, Amsterdam", phone: "+31206751583", lat: 52.3488, lon: 4.8936 },
    { id: "fb-ams-18", name: "Cannibale Royale", cuisine: "steak", address: "Handboogstraat 17a, Amsterdam", phone: "+31206225507", lat: 52.3663, lon: 4.8895 },
    { id: "fb-ams-19", name: "Vegan Junk Food Bar", cuisine: "vegan", address: "Staringplein 22, Amsterdam", phone: null, lat: 52.3596, lon: 4.8761 },
    { id: "fb-ams-20", name: "BAK Restaurant", cuisine: "modern_european", address: "Van Diemenstraat 408, Amsterdam", phone: "+31206372553", lat: 52.3905, lon: 4.8887 },
  ],
  Rotterdam: [
    { id: "fb-rot-1", name: "Hotel New York", cuisine: "dutch", address: "Koninginnenhoofd 1, Rotterdam", phone: "+31104390500", lat: 51.9055, lon: 4.4864 },
    { id: "fb-rot-2", name: "FG Restaurant", cuisine: "french", address: "Katshoek 37, Rotterdam", phone: "+31104253020", lat: 51.9221, lon: 4.4703 },
    { id: "fb-rot-3", name: "Ristorante Napoli", cuisine: "italian", address: "Meent 79, Rotterdam", phone: "+31104147674", lat: 51.922, lon: 4.484 },
    { id: "fb-rot-4", name: "Dosa Corner", cuisine: "indian", address: "West-Kruiskade 15, Rotterdam", phone: "+31104125544", lat: 51.9218, lon: 4.468 },
    { id: "fb-rot-5", name: "Supermercado", cuisine: "mexican", address: "Schiedamse Vest 91, Rotterdam", phone: null, lat: 51.917, lon: 4.473 },
    { id: "fb-rot-6", name: "Warung Mini", cuisine: "surinamese", address: "Witte de Withstraat 47, Rotterdam", phone: "+31104143688", lat: 51.9166, lon: 4.4762 },
    { id: "fb-rot-7", name: "Fenix Food Factory", cuisine: "modern_european", address: "Veerlaan 19d, Rotterdam", phone: null, lat: 51.9015, lon: 4.4829 },
    { id: "fb-rot-8", name: "Sajoen", cuisine: "indonesian", address: "Vasteland 46, Rotterdam", phone: "+31104137459", lat: 51.9143, lon: 4.4791 },
  ],
  "The Hague": [
    { id: "fb-hag-1", name: "Garoeda", cuisine: "indonesian", address: "Kneuterdijk 18a, The Hague", phone: "+31703469319", lat: 52.0844, lon: 4.3119 },
    { id: "fb-hag-2", name: "Shalimar", cuisine: "indian", address: "Gevers Deynootweg 756, The Hague", phone: "+31703505364", lat: 52.1032, lon: 4.2693 },
    { id: "fb-hag-3", name: "Ristorante Juliani", cuisine: "italian", address: "Noordeinde 196, The Hague", phone: "+31703650400", lat: 52.0831, lon: 4.3088 },
    { id: "fb-hag-4", name: "Taco Mundo", cuisine: "mexican", address: "Grote Marktstraat 37, The Hague", phone: null, lat: 52.0766, lon: 4.3108 },
    { id: "fb-hag-5", name: "Cafe de Oude Mol", cuisine: "dutch", address: "Oude Molstraat 61, The Hague", phone: "+31703461907", lat: 52.079, lon: 4.314 },
    { id: "fb-hag-6", name: "Roti King", cuisine: "surinamese", address: "Vaillantlaan 264, The Hague", phone: "+31703458925", lat: 52.064, lon: 4.334 },
  ],
  Utrecht: [
    { id: "fb-utr-1", name: "Blauw Utrecht", cuisine: "indonesian", address: "Springweg 64, Utrecht", phone: "+31302321462", lat: 52.0879, lon: 5.1208 },
    { id: "fb-utr-2", name: "Desi Masala", cuisine: "indian", address: "Voorstraat 68, Utrecht", phone: "+31302318220", lat: 52.0898, lon: 5.1194 },
    { id: "fb-utr-3", name: "Ristorante Prego", cuisine: "italian", address: "Nobelstraat 2, Utrecht", phone: "+31302310056", lat: 52.0893, lon: 5.119 },
    { id: "fb-utr-4", name: "Restaurant Zuiver", cuisine: "dutch", address: "Heidelberglaan 7, Utrecht", phone: "+31302532563", lat: 52.0854, lon: 5.1672 },
    { id: "fb-utr-5", name: "Taqueria La Llorona", cuisine: "mexican", address: "Twijnstraat 27, Utrecht", phone: null, lat: 52.0866, lon: 5.1225 },
    { id: "fb-utr-6", name: "Toko Oost", cuisine: "surinamese", address: "Kanaalstraat 99, Utrecht", phone: "+31302933188", lat: 52.0832, lon: 5.1065 },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getCuisinePhoto(cuisine) {
  if (!cuisine) return CUISINE_PHOTOS.default;
  const lower = cuisine.toLowerCase().split(";")[0].trim();
  for (const key of Object.keys(CUISINE_PHOTOS)) {
    if (key.includes(lower) || lower.includes(key)) return CUISINE_PHOTOS[key];
  }
  return CUISINE_PHOTOS.default;
}

function getPlacePhotoUrl(photoName) {
  const apiKey = setting("GOOGLE_PLACES_API_KEY");
  if (!photoName || !apiKey) return null;
  return `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=400&maxHeightPx=300&key=${apiKey}`;
}

function parseGooglePlaces(places, cuisineFilter) {
  const restaurants = [];
  for (const place of places) {
    const name = place.displayName?.text || "";
    if (!name) continue;

    const location = place.location || {};
    let cuisineLabel = (place.primaryTypeDisplayName?.text || "").toLowerCase().replace(" restaurant", "").trim();

    const photos = place.photos || [];
    let photoUrl = photos[0] ? getPlacePhotoUrl(photos[0].name) : null;
    if (!photoUrl) photoUrl = getCuisinePhoto(cuisineLabel);

    const priceLevel = PRICE_LEVEL_MAP[place.priceLevel] ?? "";
    const priceRangeObj = place.priceRange || {};
    let priceRange = "";
    if (priceRangeObj.startPrice || priceRangeObj.endPrice) {
      const lo = priceRangeObj.startPrice || {};
      const hi = priceRangeObj.endPrice || {};
      const currency = lo.currencyCode || "EUR";
      const sym = { EUR: "\u20ac", USD: "$", GBP: "\u00a3" }[currency] || `${currency} `;
      const loVal = lo.units || "";
      const hiVal = hi.units || "";
      if (loVal && hiVal) priceRange = `${sym}${loVal}\u2013${sym}${hiVal}`;
    }

    const hoursObj = place.regularOpeningHours || {};
    const openNow = hoursObj.openNow;
    const weekdayHours = hoursObj.weekdayDescriptions || [];

    restaurants.push({
      id: `gp-${place.id || ""}`,
      name,
      cuisine: cuisineLabel || (cuisineFilter ? cuisineFilter.toLowerCase() : ""),
      address: place.shortFormattedAddress || place.formattedAddress || "",
      phone: place.internationalPhoneNumber || "",
      lat: location.latitude ?? null,
      lon: location.longitude ?? null,
      photo_url: photoUrl,
      rating: place.rating ?? null,
      rating_count: place.userRatingCount || 0,
      price_level: priceLevel,
      price_range: priceRange,
      website: place.websiteUri || "",
      maps_url: place.googleMapsUri || "",
      open_now: openNow === true ? 1 : openNow === false ? 0 : null,
      hours: weekdayHours.length ? JSON.stringify(weekdayHours) : "",
      reservable: place.reservable ? 1 : 0,
      vegetarian: place.servesVegetarianFood ? 1 : 0,
      outdoor_seating: place.outdoorSeating ? 1 : 0,
      dine_in: place.dineIn ? 1 : 0,
      delivery: place.delivery ? 1 : 0,
      takeout: place.takeout ? 1 : 0,
    });
  }
  return restaurants;
}

// ---------------------------------------------------------------------------
// Google Places API
// ---------------------------------------------------------------------------
export async function fetchGoogleRestaurants(city, cuisineFilter) {
  const apiKey = setting("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    console.warn("GOOGLE_PLACES_API_KEY not set, skipping Google Places");
    return [];
  }

  const defaultCity = setting("DEFAULT_CITY") || "Amsterdam";
  city = city || defaultCity;
  const cuisinePart = cuisineFilter && cuisineFilter.toLowerCase() !== "all" ? `${cuisineFilter} ` : "";
  const query = `${cuisinePart}restaurants in ${city}`;

  const allPlaces = [];
  let pageToken = null;

  try {
    for (let page = 0; page < 3; page++) {
      const body = { textQuery: query, maxResultCount: 20 };
      if (pageToken) body.pageToken = pageToken;

      const resp = await fetch(GOOGLE_PLACES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) break;
      const data = await resp.json();
      allPlaces.push(...(data.places || []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return parseGooglePlaces(allPlaces, cuisineFilter);
  } catch (err) {
    console.warn("Google Places API failed:", err.message);
    return allPlaces.length ? parseGooglePlaces(allPlaces, cuisineFilter) : [];
  }
}

// ---------------------------------------------------------------------------
// Fallback data
// ---------------------------------------------------------------------------
export function getFallbackRestaurants(city, cuisineFilter) {
  const defaultCity = setting("DEFAULT_CITY") || "Amsterdam";
  city = city || defaultCity;
  let pool = FALLBACK_RESTAURANTS[city] || FALLBACK_RESTAURANTS.Amsterdam || [];
  // Deep-copy so we don't mutate the original
  pool = pool.map((r) => ({ ...r }));

  if (cuisineFilter && cuisineFilter.toLowerCase() !== "all") {
    const cf = cuisineFilter.toLowerCase();
    pool = pool.filter((r) => (r.cuisine || "").toLowerCase().includes(cf));
  }
  for (const r of pool) {
    if (!r.photo_url) r.photo_url = getCuisinePhoto(r.cuisine || "");
  }
  return pool;
}

// ---------------------------------------------------------------------------
// Database caching
// ---------------------------------------------------------------------------
export async function cacheRestaurants(db, restaurants, city = "") {
  const now = new Date().toISOString();
  const cityLower = city.toLowerCase().trim();
  for (const r of restaurants) {
    const addr = (r.address || "").toLowerCase();
    const tag = cityLower && addr.includes(cityLower) ? cityLower : "";
    await db.prepare(
      `INSERT OR IGNORE INTO restaurants
       (id, name, cuisine, address, phone, lat, lon, photo_url,
        rating, rating_count, price_level, price_range, website, maps_url,
        open_now, hours, reservable, vegetarian, outdoor_seating,
        dine_in, delivery, takeout, cached_at, city)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(
      r.id, r.name, r.cuisine || "", r.address || "",
      r.phone || "", r.lat ?? null, r.lon ?? null,
      r.photo_url || "", r.rating ?? null, r.rating_count || 0,
      r.price_level || "", r.price_range || "",
      r.website || "", r.maps_url || "",
      r.open_now ?? null, r.hours || "",
      r.reservable || 0, r.vegetarian || 0,
      r.outdoor_seating || 0, r.dine_in || 0,
      r.delivery || 0, r.takeout || 0, now, tag,
    ).run();
  }
}

export async function seedRestaurants(db) {
  const row = await db.prepare("SELECT COUNT(*) as cnt FROM restaurants").first();
  if (row && row.cnt > 0) return;

  const defaultCity = setting("DEFAULT_CITY") || "Amsterdam";
  console.log("Fetching restaurants from Google Places API...");
  let restaurants = await fetchGoogleRestaurants(defaultCity);

  if (restaurants.length < 5) {
    console.log("Using fallback restaurant data");
    restaurants = getFallbackRestaurants(defaultCity);
  }

  await cacheRestaurants(db, restaurants, defaultCity);
  console.log(`Seeded ${restaurants.length} restaurants`);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
const FILLER_WORDS = new Set([
  "place", "places", "restaurant", "restaurants", "food", "foods",
  "cuisine", "spot", "spots", "joint", "joints", "eatery", "eateries",
  "dining", "the", "a", "an", "in", "at", "near", "around", "some", "good", "best",
]);

// Extract meaningful search keywords from a query string.
function searchKeywords(raw) {
  return raw.toLowerCase().split(/\s+/).filter((w) => w && !FILLER_WORDS.has(w));
}

// Build a WHERE clause that matches ANY keyword against name or cuisine.
// Returns { where, params } for use in a prepared statement.
function keywordFilter(keywords, cityLower) {
  if (!keywords.length) {
    if (cityLower) return { where: "(city LIKE ? OR address LIKE ?)", params: [`%${cityLower}%`, `%${cityLower}%`] };
    return { where: "1=1", params: [] };
  }
  const parts = keywords.map(() => "(name LIKE ? OR cuisine LIKE ?)");
  const params = keywords.flatMap((k) => [`%${k}%`, `%${k}%`]);
  let where = `(${parts.join(" OR ")})`;
  if (cityLower) {
    where += " AND (city LIKE ? OR address LIKE ?)";
    params.push(`%${cityLower}%`, `%${cityLower}%`);
  }
  return { where, params };
}

export async function searchRestaurants(db, queryStr, city) {
  const keywords = searchKeywords(queryStr || "");
  const cityLower = (city || "").toLowerCase().trim();
  const { where, params } = keywordFilter(keywords, cityLower || undefined);

  let { results: rows } = await db.prepare(
    `SELECT * FROM restaurants WHERE ${where} LIMIT 10`
  ).bind(...params).all();

  if (!rows.length) {
    const searchTerm = queryStr
      ? city ? `${queryStr} restaurants in ${city}` : queryStr
      : city || "";
    if (searchTerm) {
      const fresh = await fetchGoogleRestaurants(searchTerm);
      if (fresh.length) await cacheRestaurants(db, fresh, city || "");
      ({ results: rows } = await db.prepare(
        `SELECT * FROM restaurants WHERE ${where} LIMIT 10`
      ).bind(...params).all());
    }
  }
  return rows;
}
