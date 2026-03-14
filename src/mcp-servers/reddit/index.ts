/**
 * Reddit MCP Server
 * Fetches recent posts and comments mentioning the product from specified subreddits.
 * Uses Reddit's public JSON API — no OAuth needed for read-only access.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { makeError, StructuredError } from "../../types.js";

const server = new Server(
  { name: "reddit-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_reddit_mentions",
      description:
        "Fetch recent posts and top comments from one or more subreddits. Returns post title, text, comment count, score, and date. Good for capturing organic customer sentiment.",
      inputSchema: {
        type: "object",
        properties: {
          subreddits: {
            type: "array",
            items: { type: "string" },
            description: "List of subreddit names (without r/) to fetch from",
          },
          limit: {
            type: "number",
            description: "Max posts per subreddit (default 15)",
          },
          sort: {
            type: "string",
            enum: ["new", "hot", "top"],
            description: "Sort order (default 'new' for recency)",
          },
        },
        required: ["subreddits"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "get_reddit_mentions") {
    const { subreddits, limit = 15, sort = "new" } = args as {
      subreddits: string[];
      limit?: number;
      sort?: string;
    };

    const allPosts: Array<Record<string, unknown>> = [];
    const errors: StructuredError[] = [];

    for (const subreddit of subreddits) {
      try {
        // Reddit's public JSON endpoint — appending .json works without auth
        const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`;
        const response = await fetch(url, {
          headers: {
            // Reddit requires a User-Agent to avoid rate limiting
            "User-Agent": "voc-agent/1.0 (github.com/voc-agent)",
          },
        });

        if (!response.ok) {
          const mock = getMockRedditPosts(subreddit, limit);
          errors.push(makeError(
            response.status === 403 ? "permission" : "transient",
            `GET r/${subreddit} — HTTP ${response.status}`,
            response.status === 403
              ? "Subreddit may be private or banned"
              : "Reddit rate limit hit; using mock fallback for this subreddit",
            mock
          ));
          allPosts.push(...mock);
          continue;
        }

        const data = await response.json() as {
          data: {
            children: Array<{
              data: {
                title: string;
                selftext: string;
                score: number;
                num_comments: number;
                created_utc: number;
                permalink: string;
              };
            }>;
          };
        };

        const posts = data.data.children.map((child) => ({
          source: "reddit",
          subreddit,
          title: child.data.title,
          text: child.data.selftext.slice(0, 500), // truncate long posts
          score: child.data.score,
          num_comments: child.data.num_comments,
          date: new Date(child.data.created_utc * 1000).toISOString(),
          url: `https://reddit.com${child.data.permalink}`,
        }));

        allPosts.push(...posts);
      } catch {
        const mock = getMockRedditPosts(subreddit, limit);
        errors.push(makeError(
          "transient",
          `fetch r/${subreddit}`,
          "Network error — using mock fallback for this subreddit",
          mock
        ));
        allPosts.push(...mock);
      }
    }

    const result: Record<string, unknown> = { posts: allPosts };
    if (errors.length > 0) result.errors = errors;

    return {
      isError: errors.length > 0 && allPosts.length === 0,
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

function getMockRedditPosts(subreddit: string, limit: number) {
  const posts = [
    {
      source: "reddit",
      subreddit,
      title: "Login not working for anyone else?",
      text: "Been trying to log in for an hour, keeps failing. Is this a known issue? Checked their status page but nothing is shown.",
      score: 47,
      num_comments: 23,
      date: new Date().toISOString(),
      url: `https://reddit.com/r/${subreddit}/mock1`,
    },
    {
      source: "reddit",
      subreddit,
      title: "App is incredibly slow lately",
      text: "Noticed over the past week the app has gotten really sluggish. Loading notes takes 5-10 seconds when it used to be instant. Anyone else?",
      score: 89,
      num_comments: 41,
      date: new Date().toISOString(),
      url: `https://reddit.com/r/${subreddit}/mock2`,
    },
    {
      source: "reddit",
      subreddit,
      title: "Search completely broken after update",
      text: "After the latest update my search returns completely irrelevant results. My notes are there but search can't find them.",
      score: 34,
      num_comments: 12,
      date: new Date().toISOString(),
      url: `https://reddit.com/r/${subreddit}/mock3`,
    },
    {
      source: "reddit",
      subreddit,
      title: "Love the new features but performance is suffering",
      text: "Really enjoy the new table views but it seems like they came at a performance cost. The app is noticeably slower.",
      score: 156,
      num_comments: 67,
      date: new Date().toISOString(),
      url: `https://reddit.com/r/${subreddit}/mock4`,
    },
    {
      source: "reddit",
      subreddit,
      title: "Mobile app crashes constantly",
      text: "On iOS 17, the app crashes at least once per session. Really annoying when I'm in the middle of editing something.",
      score: 28,
      num_comments: 15,
      date: new Date().toISOString(),
      url: `https://reddit.com/r/${subreddit}/mock5`,
    },
  ];
  return posts.slice(0, limit);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
