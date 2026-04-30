import OpenAI from "openai"

const GROQ_OPENAI_BASE_URL = "https://api.groq.com/openai/v1"

function createGroqClient(apiKey: string) {
  return new OpenAI({
    baseURL: GROQ_OPENAI_BASE_URL,
    apiKey,
  })
}

/**
 * Server-side JSON completion for Akwasi (Groq OpenAI-compatible API).
 * API key never leaves the server.
 */
export async function akwasiGroqJsonCompletion(params: {
  system: string
  user: string
  temperature?: number
}): Promise<string> {
  const groqApiKey = process.env.GROQ_API_KEY?.trim()
  if (!groqApiKey) {
    throw new Error("GROQ_API_KEY not configured")
  }
  const model = process.env.AI_MODEL?.trim() || "llama-3.3-70b-versatile"
  const client = createGroqClient(groqApiKey)

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: params.temperature ?? 0.35,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
      response_format: { type: "json_object" },
    })
    return completion.choices[0]?.message?.content?.trim() || "{}"
  } catch {
    const completion = await client.chat.completions.create({
      model,
      temperature: params.temperature ?? 0.35,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user + "\n\nRespond with valid JSON only." },
      ],
    })
    return completion.choices[0]?.message?.content?.trim() || "{}"
  }
}
