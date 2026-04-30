import { GoogleGenAI } from "@google/genai";
import { env } from "./env";

/**
 * Gemini klient s dual-mode:
 *
 *  (A) Vertex AI — pokud je v .env nastaven VERTEX_PROJECT, použije se
 *      Google Cloud Vertex AI v regionu VERTEX_LOCATION (default
 *      europe-west1). Autentizace přes service account JSON — cestu
 *      k souboru zadáš do GOOGLE_APPLICATION_CREDENTIALS. Data zůstávají
 *      v EU, nepoužívají se na trénování, Google podepisuje DPA.
 *
 *  (B) Google AI Studio API key — fallback pro dev / jednoduchý start.
 *      Stačí GEMINI_API_KEY z aistudio.google.com. Data mohou jít do
 *      trénování v free tieru, a klient nemá data residency garance.
 *
 * Kód volání (generateContent) je v obou módech shodný — @google/genai
 * abstrahuje transport.
 */

let client: GoogleGenAI | null = null;
let clientMode: "vertex" | "api" | null = null;

export function getGemini(): GoogleGenAI {
  if (client) return client;

  const vertexProject = env.VERTEX_PROJECT;
  if (vertexProject) {
    // Vertex mode — kredenciály si SDK natáhne z GOOGLE_APPLICATION_CREDENTIALS
    // (path k service-account JSONu) nebo z Application Default Credentials.
    const location = env.VERTEX_LOCATION || "europe-west1";
    client = new GoogleGenAI({
      vertexai: true,
      project: vertexProject,
      location,
    });
    clientMode = "vertex";
    console.log(`[gemini] Vertex AI mode — project=${vertexProject} location=${location}`);
    return client;
  }

  if (!env.GEMINI_API_KEY) {
    throw new Error(
      "AI klient není nakonfigurovaný. Nastav buď VERTEX_PROJECT (+ GOOGLE_APPLICATION_CREDENTIALS) pro Vertex AI, nebo GEMINI_API_KEY pro Google AI Studio."
    );
  }

  client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  clientMode = "api";
  console.log(`[gemini] AI Studio API key mode (fallback — doporučeno přejít na Vertex)`);
  return client;
}

/** Vrátí info o aktuálně běžícím módu (pro debug / health endpoint). */
export function getGeminiMode(): "vertex" | "api" | "unconfigured" {
  if (clientMode) return clientMode;
  if (env.VERTEX_PROJECT) return "vertex";
  if (env.GEMINI_API_KEY) return "api";
  return "unconfigured";
}

// ---------------------------------------------------------------------------
// Modely
// ---------------------------------------------------------------------------

// Default — rychlý, levný, kvalita pro klasifikaci / chat je dostatečná.
export const DEFAULT_MODEL = "gemini-2.5-flash";

// Alias zachovaný pro zpětnou kompatibilitu s existujícím kódem.
export const FAST_MODEL = "gemini-2.5-flash";

// Pro hlubší úvahu — zdravotní analýzy, budoucí komplexní agenty.
export const ANALYSIS_MODEL = "gemini-2.5-pro";

// Embedding model pro RAG („Zeptat se"). 768 dim výstup, schválně menší než 3072
// aby se vešel do pgvector indexu (HNSW max 2000 dim) a šetřil místo.
export const EMBEDDING_MODEL = "text-embedding-004";
export const EMBEDDING_DIM = 768;
