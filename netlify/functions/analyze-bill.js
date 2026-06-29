exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ message: 'Server misconfigured: no API key' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Invalid JSON' }) };
  }

  const { mime_type, data } = body;
  if (!mime_type || !data) {
    return { statusCode: 400, body: JSON.stringify({ message: 'Missing image data' }) };
  }

  const prompt = `You are BillGuard, a consumer-protection AI. Analyze this bill/invoice image.

Return ONLY valid JSON with this exact shape:
{
  "bill_type": "string",
  "billing_period": "string or null",
  "summary": {
    "total_amount": "string",
    "suspicious_charges_total": "string",
    "line_items_count": 0,
    "risk_level": "HIGH"
  },
  "line_items": [{"name": "string", "amount": "string", "category": "string", "note": "string or null"}],
  "red_flags": [{"title": "string", "description": "string", "severity": "HIGH", "amount_involved": "string or null", "suggested_action": "string"}],
  "jargon_explained": [{"term": "string", "plain_english": "string", "implication": "string", "risk_level": "MEDIUM"}],
  "action_plan": ["string"]
}

Rules:
- Only use values visible in the bill image.
- Flag vague fees, auto-added charges, unusual interest, auto-renewal traps.
- Pick 3-6 confusing legal/financial terms and explain them simply.
- Give 3-5 concrete action steps.
- If unreadable, set bill_type to Unreadable Image and use empty arrays.`;

  try {
    const response = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gemma-4-31b',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime_type};base64,${data}` } },
            { type: 'text', text: prompt }
          ]
        }],
        max_tokens: 2048,
        temperature: 0
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return { statusCode: response.status, body: JSON.stringify({ message: err?.error?.message || 'Cerebras API error' }) };
    }

    const result = await response.json();
    let content = result.choices?.[0]?.message?.content?.trim() || '';
    content = content.replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch(e) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
      else throw new Error('Could not parse model response as JSON');
    }

    return { statusCode: 200, body: JSON.stringify(parsed) };

  } catch(err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: JSON.stringify({ message: err.message || 'Unknown error' }) };
  }
};
