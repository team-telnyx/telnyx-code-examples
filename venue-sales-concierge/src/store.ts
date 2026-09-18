import type { Env, VenueData } from "./types";

/**
 * Telnyx KV is the single source of truth ("never drift" guarantee):
 *
 *   venue/data      → the venue JSON the website renders and every agent reads
 *   assistant/id    → the AI Assistant provisioned for browser voice
 *   webhook-seen/*  → inbound webhook dedupe locks (10 min TTL)
 *
 * The microsite, the SMS concierge, the voice agent's webhook tool, and the
 * ops dashboard all read the same namespace, so the site and every channel
 * say exactly the same thing.
 */

export const VENUE_KEY = "venue/data";
export const ASSISTANT_KEY = "assistant/id";

export const SAMPLE_VENUE: VenueData = {
  venue: {
    name: "Harborview Grand Pavilion",
    tagline: "Waterfront weddings, galas & corporate events",
    location: "1 Bayfront Terrace, Sausalito, CA 94965",
    description:
      "A landmark waterfront venue on Richardson Bay — 9,200 sq ft of pillarless ballroom, a sunset-facing terrace, and five distinct event spaces 15 minutes from downtown San Francisco.",
  },
  gallery: [
    { url: "https://picsum.photos/seed/pavilion-hall/800/500", caption: "Grand Pavilion Ballroom — 20 ft ceilings, panoramic bay windows" },
    { url: "https://picsum.photos/seed/pavilion-terrace/800/500", caption: "Terrace on the Bay — sunset ceremony site for 350" },
    { url: "https://picsum.photos/seed/pavilion-vineyard/800/500", caption: "The Vineyard Room — intimate dinners for up to 120" },
    { url: "https://picsum.photos/seed/pavilion-courtyard/800/500", caption: "The Courtyard — cocktail receptions under the lights" },
    { url: "https://picsum.photos/seed/pavilion-salon/800/500", caption: "The Bridal Salon — private suite with bay views" },
    { url: "https://picsum.photos/seed/pavilion-lawn/800/500", caption: "Waterfront Lawn — tented receptions up to 800" },
  ],
  spaces: [
    {
      name: "Grand Pavilion Ballroom",
      seated: 500,
      cocktail: 800,
      sqft: 9200,
      features: ["20 ft ceilings", "Panoramic bay windows", "Dimmable chandeliers", "Dedicated bar & prep kitchen"],
    },
    {
      name: "Terrace on the Bay",
      seated: 200,
      cocktail: 350,
      sqft: 4000,
      features: ["Sunset-facing", "Heated for evening events", "Built-in sound zones"],
    },
    {
      name: "The Vineyard Room",
      seated: 120,
      cocktail: 180,
      sqft: 2400,
      features: ["Boardroom & U-shape layouts", "Confidential entry", "Private AV rack"],
    },
    {
      name: "The Courtyard",
      seated: 150,
      cocktail: 250,
      sqft: 3100,
      features: ["Open-air with canopy", "Fountain backdrop", "Live-music power drops"],
    },
  ],
  menus: [
    {
      name: "Waterfront Reception",
      price_per_person: 95,
      description: "Standing reception — passed service plus 6 tasting stations.",
      items: ["Dungeness crab crostini", "Ahi tuna cones", "Marin cheese board", "Mini dutch crunch sandwiches", "Chocolate-dipped madeleines"],
    },
    {
      name: "Seated Dinner — Vineyard",
      price_per_person: 145,
      description: "Four-course plated dinner with wine pairing.",
      items: ["Heirloom beet salad", "Pan-seared halibut or dry-aged ribeye", "Sonoma county wines", "Lemon olive-oil cake"],
    },
    {
      name: "Corporate Day Package",
      price_per_person: 75,
      description: "Full-day meeting package — breakfast, lunch, breaks.",
      items: ["Continental breakfast", "Chef's lunch buffet", "AM/PM coffee & snack breaks", "Stay-refreshed hydration stations"],
    },
  ],
  av: [
    "L-Acoustics PA system with zone control in every space",
    "Dual 4K laser projection + 16:9 LED wall (Ballroom)",
    "Shure ULX-D wireless handheld & lavaliere kits (8 channels)",
    "Programmable stage & architectural lighting with cue board",
    "Built-in live-stream rig with bonded 5G backup",
  ],
  pricing: {
    rental: {
      "Grand Pavilion Ballroom": "$12,000 / day",
      "Terrace on the Bay": "$6,500 / day",
      "The Vineyard Room": "$3,200 / day",
      "The Courtyard": "$4,000 / day",
    },
    catering_from: 75,
    note: "Weekday (Mon–Thu) rentals are 20% off. Peak-season Saturday premium applies Jun–Sep.",
  },
  faqs: [
    {
      question: "What is the capacity of the venue?",
      answer:
        "The Grand Pavilion Ballroom seats 500 for dinner or 800 cocktail-style. Across all five spaces the venue hosts up to 1,200 guests with the Waterfront Lawn tented.",
      keywords: ["capacity", "how many", "how many people", "size", "large", "guests"],
    },
    {
      question: "Do you provide catering?",
      answer:
        "Catering is in-house. Receptions start at $95/person, plated dinners at $145/person, and corporate day packages at $75/person. Outside catering is allowed for cultural cuisine with a kitchen fee.",
      keywords: ["catering", "food", "menu", "dinner", "meal", "cuisine"],
    },
    {
      question: "What AV is included?",
      answer:
        "Every space includes the L-Acoustics PA, wireless microphone kits, and house lighting. Dual 4K laser projection, the LED wall, and the live-stream rig are available in the Ballroom. A/V tech is $600/day.",
      keywords: ["av", "audio", "sound", "projector", "microphone", "lighting", "stream"],
    },
    {
      question: "Is parking available?",
      answer:
        "Valet parking for 120 cars is included with Ballroom rentals. Two public garages (400 spaces) are a 3-minute walk, and we run a shuttle loop from the Sausalito ferry terminal.",
      keywords: ["parking", "valet", "car", "garage", "shuttle"],
    },
    {
      question: "Is the venue accessible?",
      answer:
        "Fully wheelchair accessible — step-free entrances to every space, elevator access to all floors, accessible restrooms on each level, and reserved companion seating. ASL interpreters can be arranged on request.",
      keywords: ["accessible", "accessibility", "wheelchair", "ada", "elevator", "mobility"],
    },
    {
      question: "What are the pricing and package options?",
      answer:
        "Ballroom rental is $12,000/day, Terrace $6,500, Vineyard Room $3,200, Courtyard $4,000. Catering from $75/person. Weekday rentals are 20% off; peak-season Saturdays carry a premium.",
      keywords: ["pricing", "price", "cost", "rate", "budget", "quote", "package", "how much"],
    },
  ],
};

type Kv = Env["VENUE_KV"];

/** Fetch the venue data, seeding the namespace with sample data on first run. */
export async function getVenue(kv: Kv): Promise<VenueData> {
  const existing = await kv.get<VenueData>(VENUE_KEY, { type: "json" });
  if (existing && existing.venue) return existing;
  await kv.put(VENUE_KEY, JSON.stringify(SAMPLE_VENUE));
  return SAMPLE_VENUE;
}

export async function putVenue(kv: Kv, data: VenueData): Promise<void> {
  await kv.put(VENUE_KEY, JSON.stringify(data));
}
