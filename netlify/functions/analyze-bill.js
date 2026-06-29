// netlify/functions/analyze-bill.js
import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ message: "Method not allowed" }),
      };
    }

    const apiKey = process.env.CEREBRAS_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Server misconfigured: no API key" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { mime_type, data } = body;

    if (!mime_type || !data) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Missing image data" }),
      };
    }

    const prompt = `
You are BillGuard, a consumer-protection AI. Analyze this bill/invoice image.

Return ONLY valid JSON with this shape:

{
  "bill_type": "string",
  "billing_period": "string or null",
  "summary": {
    "total_amount": "string",
    "suspicious_charges_total": "string",
    "line_items_count": number,
    "risk_level": "HIGH" | "MEDIUM" | "LOW"
  },
  "line_items": [
    {
      "name": "string",
      "amount": "string",
      "category": "string",
      "note": "string or null"
    }
  ],
  "red_flags": [
    {
      "title": "string",
      "description": "string",
      "severity": "HIGH" | "MEDIUM" | "LOW",
      "amount_involved": "string or null",
      "suggested_action": "string"
    }
  ],
  "jargon_explained": [
    {
      "term": "string",
      "plain_english": "string",
      "implication": "string",
      "risk_level": "HIGH" | "MEDIUM" | "LOW" | "NEUTRAL"
    }
  ],
  "action_plan": [
    "string"
  ]
}

Rules:
- Do not hallucinate amounts; only use values visible in the bill image.
- red_flags: flag vague fees, auto-added charges, unusual interest, auto-renewal traps.
- jargon_explained: pick 3–6 confusing legal/financial terms and explain them simply.
- action_plan: 3–5 concrete actions (e.g., call support, dispute charges, cancel plan).
- If the image is unreadable, set "bill_type": "Unreadable Image" and use empty arrays.
`;

    const cerebrasRes = await fetch(
      "https://api.cerebras.ai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gemma-4-31b",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mime_type};base64,${data}`,
                  },
                },
                {
                  type: "text",
                  text: prompt,
                },
              ],
            },
          ],
          max_tokens: 2048,
          temperature: 0,
        }),
      }
    );

    if (!cerebrasRes.ok) {
      const err = await cerebrasRes.json().catch(() => ({}));
      console.error("Cerebras error:", err);
      return {
        statusCode: cerebrasRes.status,
        body: JSON.stringify({
          message: err?.error?.message || "Cerebras API error",
        }),
      };
    }

    const dataResp = await cerebrasRes.json();
    let content = dataResp.choices?.[0]?.message?.content?.trim() || "";

    // Strip Markdown fences if present
    content = content
      .replace(/^```json\s*/i, "")
      .replace(/^```/, "")
      .replace(/```$/, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match);
      else throw e;
    }

    return {
      statusCode: 200,
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: err.message || "Unknown error" }),
    };
  }
};
