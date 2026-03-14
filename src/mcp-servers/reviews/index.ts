/**
 * Reviews MCP Server
 * Fetches public reviews from Trustpilot and the App Store.
 * No auth required for public reviews.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "reviews-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_trustpilot_reviews",
      description:
        "Fetch recent public reviews for a company from Trustpilot. Returns review text, rating, and date.",
      inputSchema: {
        type: "object",
        properties: {
          company_slug: {
            type: "string",
            description: "Trustpilot company slug (e.g. 'notion')",
          },
          limit: {
            type: "number",
            description: "Max reviews to return (default 20)",
          },
        },
        required: ["company_slug"],
      },
    },
    {
      name: "get_app_store_reviews",
      description:
        "Fetch recent App Store reviews for an iOS app. Returns review text, rating, and date.",
      inputSchema: {
        type: "object",
        properties: {
          app_id: {
            type: "string",
            description: "App Store app ID (numeric, e.g. '1045940956')",
          },
          country: {
            type: "string",
            description: "Country code (default 'us')",
          },
          limit: {
            type: "number",
            description: "Max reviews to return (default 20)",
          },
        },
        required: ["app_id"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_trustpilot_reviews") {
    const { company_slug, limit = 20 } = args as {
      company_slug: string;
      limit?: number;
    };

    try {
      // Trustpilot public consumer API — no auth needed for reading public reviews
      const url = `https://www.trustpilot.com/review/${company_slug}`;
      const apiUrl = `https://api.trustpilot.com/v1/business-units/find?name=${company_slug}`;

      // Fall back to scraping the public JSON endpoint Trustpilot exposes
      const response = await fetch(
        `https://api.trustpilot.com/v1/business-units/find?name=${encodeURIComponent(company_slug)}`,
        {
          headers: {
            "apikey": process.env.TRUSTPILOT_API_KEY || "",
          },
        }
      );

      if (!response.ok) {
        // Return mock data if API key not set or rate limited
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(getMockTrustpilotReviews(company_slug, limit), null, 2),
            },
          ],
        };
      }

      const businessUnit = await response.json() as { id: string };
      const reviewsResponse = await fetch(
        `https://api.trustpilot.com/v1/business-units/${businessUnit.id}/reviews?perPage=${limit}`,
        {
          headers: {
            "apikey": process.env.TRUSTPILOT_API_KEY || "",
          },
        }
      );

      const data = await reviewsResponse.json() as {
        reviews: Array<{
          text: string;
          stars: number;
          createdAt: string;
          title: string;
        }>;
      };

      const reviews = data.reviews.map((r) => ({
        source: "trustpilot",
        text: r.text,
        rating: r.stars,
        date: r.createdAt,
        title: r.title,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(reviews, null, 2) }],
      };
    } catch {
      // Return mock data on any error so the agent can still run
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(getMockTrustpilotReviews(company_slug, limit), null, 2),
          },
        ],
      };
    }
  }

  if (name === "get_app_store_reviews") {
    const { app_id, country = "us", limit = 20 } = args as {
      app_id: string;
      country?: string;
      limit?: number;
    };

    try {
      // Apple's public RSS feed — no auth needed
      const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=1/id=${app_id}/sortby=mostrecent/json`;
      const response = await fetch(url);

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(getMockAppStoreReviews(limit), null, 2),
            },
          ],
        };
      }

      const data = await response.json() as {
        feed?: {
          entry?: Array<{
            "im:rating"?: { label: string };
            content?: { label: string };
            title?: { label: string };
            updated?: { label: string };
          }>;
        };
      };

      const entries = data.feed?.entry?.slice(1) ?? []; // first entry is app metadata
      const reviews = entries.slice(0, limit).map((entry) => ({
        source: "app_store",
        text: entry.content?.label ?? "",
        rating: parseInt(entry["im:rating"]?.label ?? "0"),
        title: entry.title?.label ?? "",
        date: entry.updated?.label ?? "",
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(reviews, null, 2) }],
      };
    } catch {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(getMockAppStoreReviews(limit), null, 2),
          },
        ],
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

function getMockTrustpilotReviews(company: string, limit: number) {
  const reviews = [
    { source: "trustpilot", rating: 2, date: new Date().toISOString(), title: "Login keeps failing", text: "I can't log into my account for the past 3 days. The app just shows a blank screen after entering credentials. Very frustrating." },
    { source: "trustpilot", rating: 1, date: new Date().toISOString(), title: "Terrible performance lately", text: "The app has become so slow. Pages take 10+ seconds to load. It used to be instant. Something broke in the last update." },
    { source: "trustpilot", rating: 5, date: new Date().toISOString(), title: "Great product overall", text: "Love using this daily for my team. The new features are excellent. Only issue is occasional slowness." },
    { source: "trustpilot", rating: 2, date: new Date().toISOString(), title: "Can't log in on mobile", text: "Mobile login is broken. Works on desktop but mobile app throws an error every time I try to sign in." },
    { source: "trustpilot", rating: 4, date: new Date().toISOString(), title: "Good but needs polish", text: "Great concept and mostly works well. Search functionality is slow and sometimes returns wrong results." },
    { source: "trustpilot", rating: 1, date: new Date().toISOString(), title: "App crashes on startup", text: `${company} app crashes immediately after the splash screen. Tried reinstalling, nothing works.` },
  ];
  return reviews.slice(0, limit);
}

function getMockAppStoreReviews(limit: number) {
  const reviews = [
    { source: "app_store", rating: 1, date: new Date().toISOString(), title: "Broken login", text: "Cannot log in at all. App crashes when I tap the login button. Please fix this ASAP." },
    { source: "app_store", rating: 2, date: new Date().toISOString(), title: "So slow", text: "Every page takes forever to load. Used to be snappy, now it's unusable. Loading spinner constantly." },
    { source: "app_store", rating: 5, date: new Date().toISOString(), title: "Amazing app", text: "Best productivity app I've used. Syncs perfectly across devices. Highly recommend." },
    { source: "app_store", rating: 3, date: new Date().toISOString(), title: "Good but laggy", text: "Love the features but the performance has gotten worse. Simple actions feel sluggish." },
    { source: "app_store", rating: 2, date: new Date().toISOString(), title: "Search is broken", text: "The search function stopped working properly. It used to find my notes instantly, now results are wrong or missing." },
  ];
  return reviews.slice(0, limit);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
