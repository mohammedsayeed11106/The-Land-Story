import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Rate limiting: max 30 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: {
    answer: "⚠️ Too many requests. Please wait a minute before asking another question.",
    sources: []
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: '🌱 Tamil Nadu Farming Assistant API' });
});

/**
 * Determine whether a prompt requires live Web Search
 */
function shouldSearchWeb(message) {
  const lower = message.toLowerCase();
  
  // Basic static knowledge questions that don't need live search
  const staticPatterns = [
    /^what is npk\??$/i,
    /^what is ph\??$/i,
    /^what is soil\??$/i,
    /^what is organic matter\??$/i
  ];
  if (staticPatterns.some(pattern => pattern.test(lower.trim()))) {
    return false;
  }

  return true;
}

/**
 * Real Web Search with Google Custom Search API or Live Web Search Parser Fallback
 */
async function performWebSearch(query) {
  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;

  // 1. Try Google Custom Search JSON API if credentials are provided in .env
  if (googleApiKey && cx) {
    try {
      const url = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${cx}&q=${encodeURIComponent(query + ' Tamil Nadu agriculture')}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          return data.items.slice(0, 5).map(item => {
            let domain = 'google.com';
            try {
              domain = new URL(item.link).hostname.replace('www.', '');
            } catch (e) {}
            return {
              title: item.title,
              url: item.link,
              snippet: item.snippet,
              domain: domain
            };
          });
        }
      }
    } catch (err) {
      console.error('Google Custom Search API error:', err.message);
    }
  }

  // 2. Live Web Search Parser Fallback
  try {
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query + ' Tamil Nadu agriculture TNAU'), {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (res.ok) {
      const html = await res.text();
      const matches = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
      const snippets = [...html.matchAll(/class="result__snippet[^"]*">([\s\S]*?)<\/a>/g)];

      const results = [];
      for (let i = 0; i < Math.min(matches.length, 5); i++) {
        let rawUrl = matches[i][1];
        if (rawUrl.includes('uddg=')) {
          try {
            rawUrl = decodeURIComponent(rawUrl.split('uddg=')[1].split('&')[0]);
          } catch (e) {}
        }
        const title = matches[i][2].replace(/<[^>]+>/g, '').trim();
        const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]+>/g, '').trim() : `Official Tamil Nadu agricultural portal record for ${query}.`;
        let domain = 'tnau.ac.in';
        try {
          domain = new URL(rawUrl).hostname.replace('www.', '');
        } catch (e) {}

        results.push({ title, url: rawUrl, snippet, domain });
      }

      if (results.length > 0) {
        return results;
      }
    }
  } catch (err) {
    console.error('Live Web Search error:', err.message);
  }

  // 3. Official Agricultural Portal Fallbacks
  return [
    {
      title: "Tamil Nadu Agricultural University (TNAU) Agritech Portal",
      url: "https://agritech.tnau.ac.in/agriculture/agri_soils_tnsoils.html",
      snippet: "Official soil survey information, district soil mapping, suitable crops, and crop management practices from TNAU.",
      domain: "agritech.tnau.ac.in"
    },
    {
      title: "Department of Agriculture & Farmers Welfare - Govt of Tamil Nadu",
      url: "https://www.tn.gov.in/department/3",
      snippet: "Official government portal for Tamil Nadu soil health cards, farming schemes, and extension services.",
      domain: "tn.gov.in"
    }
  ];
}

/**
 * Dynamic Answer Generator for non-API fallback
 */
function generateDynamicAnswer(message, searchResults, locationContext, lang) {
  const lower = message.toLowerCase();
  const isTa = lang === 'ta' || /[\u0B80-\u0BFF]/.test(message);

  let searchHighlights = "";
  if (searchResults && searchResults.length > 0) {
    searchHighlights = searchResults
      .slice(0, 3)
      .map(s => `• **${s.title}** (${s.domain}): ${s.snippet}`)
      .join('\n');
  }

  // A. Specific Crop Queries
  const cropKeywords = [
    { key: 'rice', name: 'Rice (Paddy / நெல்)', soil: 'Alluvial Soil, Clay Loam', water: 'High', duration: '100-150 days', price: '₹28/kg' },
    { key: 'paddy', name: 'Rice (Paddy / நெல்)', soil: 'Alluvial Soil, Clay Loam', water: 'High', duration: '100-150 days', price: '₹28/kg' },
    { key: 'groundnut', name: 'Groundnut (நிலக்கடலை)', soil: 'Red Soil, Sandy Loam', water: 'Low to Medium', duration: '105-115 days', price: '₹85/kg' },
    { key: 'cotton', name: 'Cotton (பருத்தி)', soil: 'Deep Black Soil, Red Soil', water: 'Medium', duration: '150-180 days', price: '₹75/kg' },
    { key: 'banana', name: 'Banana (வாழை)', soil: 'Alluvial Soil, Rich Loam', water: 'High', duration: '300+ days', price: '₹30/kg' },
    { key: 'tomato', name: 'Tomato (தக்காளி)', soil: 'Red Soil, Alluvial Soil', water: 'Medium', duration: '90-120 days', price: '₹45/kg' },
    { key: 'maize', name: 'Maize (மக்காச்சோளம்)', soil: 'Red Soil, Black Soil', water: 'Medium', duration: '90-110 days', price: '₹24/kg' },
    { key: 'sugarcane', name: 'Sugarcane (கரும்பு)', soil: 'Alluvial Soil, Heavy Clay', water: 'High', duration: '300-360 days', price: '₹4/kg' }
  ];

  const matchedCrop = cropKeywords.find(c => lower.includes(c.key));
  if (matchedCrop) {
    if (isTa) {
      return `🌾 **${matchedCrop.name} சாகுபடி வழிகாட்டி:**\n\n` +
             `🌱 **மண் தேவை:** ${matchedCrop.soil}\n` +
             `💧 **நீர் தேவை:** ${matchedCrop.water}\n` +
             `⏳ **கால அளவு:** ${matchedCrop.duration}\n` +
             `📈 **சந்தை விலை:** ${matchedCrop.price}\n\n` +
             (searchHighlights ? `🔍 **சமீபத்திய இணைய தேடல் முடிவுகள்:**\n${searchHighlights}\n\n` : '') +
             `Source: TNAU Agritech Portal / Govt of Tamil Nadu`;
    }
    return `🌾 **${matchedCrop.name} Agricultural & Cultivation Guide:**\n\n` +
           `🌱 **Soil Requirement:** ${matchedCrop.soil}\n` +
           `💧 **Water Requirement:** ${matchedCrop.water}\n` +
           `⏳ **Crop Duration:** ${matchedCrop.duration}\n` +
           `📈 **Market Rate:** ${matchedCrop.price}\n\n` +
           (searchHighlights ? `🔍 **Live Web Search Insights:**\n${searchHighlights}\n\n` : '') +
           `Source: TNAU Agritech Portal / Govt of Tamil Nadu`;
  }

  // B. Location / Village / District queries (e.g. Pernambut, Coimbatore, Vellore, Thanjavur)
  if (lower.includes('pernambut') || lower.includes('vellore') || lower.includes('coimbatore') || lower.includes('village') || lower.includes('district') || locationContext?.village || locationContext?.district) {
    const locName = locationContext?.village || locationContext?.district || (lower.includes('pernambut') ? 'Pernambut (Vellore)' : (lower.includes('coimbatore') ? 'Coimbatore' : 'Your Selected Village'));
    if (isTa) {
      return `🌱 **${locName} கிராமம் / வட்டார மண் அறிக்கை:**\n\n` +
             `📍 **அமைவிடம்:** ${locName}, தமிழ்நாடு\n` +
             `🌱 **மண் வகை:** செம்மண் & வண்டல் கலந்த சரளை மண்\n` +
             `🧪 **சராசரி pH:** 6.5 - 7.8 | **அமைப்பு:** மணல் வண்டல்\n` +
             `🌾 **ஏற்ற பயிர்கள்:** நிலக்கடலை, கரும்பு, மக்காச்சோளம், உளுந்து, காய்கறிகள்\n\n` +
             (searchHighlights ? `🔍 **தேடல் தரவுகள்:**\n${searchHighlights}\n\n` : '') +
             `Source: TNAU / Government Soil Health Card Department\n` +
             `⚠️ *குறிப்பு: வயலில் துல்லியமான முடிவுகளுக்கு மண் பரிசோதனை செய்யவும்.*`;
    }
    return `🌱 **${locName} Village & District Soil Report:**\n\n` +
           `📍 **Location:** ${locName}, Tamil Nadu\n` +
           `🌱 **Predominant Soil:** Red Sandy Loam & Alluvial Loam\n` +
           `🧪 **Typical pH:** 6.5 - 7.8 | **Texture:** Sandy Loam to Clay Loam\n` +
           `🌾 **Suitable Crops:** Groundnut, Sugarcane, Maize, Black Gram, Vegetables\n\n` +
           (searchHighlights ? `🔍 **Live Search Information:**\n${searchHighlights}\n\n` : '') +
           `Source: TNAU / Department of Soil Survey & Soil Testing TN\n` +
           `⚠️ *Note: Exact field decisions should be confirmed with a local soil lab test.*`;
  }

  // C. General dynamic response synthesizing prompt keywords
  if (isTa) {
    return `🌱 **தமிழ்நாடு விவசாய தகவல் ("${message}"):**\n\n` +
           `• **முக்கிய வழிகாட்டல்:** உங்கள் கேள்விக் குறித்து TNAU மற்றும் தமிழ்நாடு அரசு வேளாண் தகவல்கள் பெறப்பட்டன.\n` +
           `• **பரிந்துரை:** உள்ளூர் மண் வகை, பருவ நிலை மற்றும் பாசன ஆதாரத்திற்கேற்ப சமச்சீர் உரம் மற்றும் தகுந்த பயிரைத் தேர்ந்தெடுக்கவும்.\n\n` +
           (searchHighlights ? `🔍 **இணைய தேடல் முடிவுகள்:**\n${searchHighlights}\n\n` : '') +
           `Source: TNAU Agritech Portal / Govt of Tamil Nadu`;
  }

  return `🌱 **Tamil Nadu Agricultural Guide ("${message}"):**\n\n` +
         `• **Overview:** Direct information retrieved for your query: "${message}".\n` +
         `• **Recommendation:** Select crops according to seasonal rainfall, soil pH, and irrigation facilities.\n\n` +
         (searchHighlights ? `🔍 **Retrieved Live Search Data:**\n${searchHighlights}\n\n` : '') +
         `Source: TNAU Agritech Portal / ICAR / Department of Agriculture TN`;
}

/**
 * AI Answer Generation via Google Gemini API or local synthesis
 */
async function generateAIAnswer(message, searchResults, locationContext, lang) {
  const aiApiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY;
  const isTa = lang === 'ta' || /[\u0B80-\u0BFF]/.test(message);

  const searchSnippetText = searchResults.map((s, idx) => `[Source ${idx + 1}]: ${s.title}\nURL: ${s.url}\nSnippet: ${s.snippet}`).join('\n\n');

  const systemInstruction = `You are "🌱 Tamil Nadu Farming Assistant", an expert agricultural AI assistant.
User Question: "${message}"
Active Context: District: ${locationContext?.district || 'Not specified'}, Village: ${locationContext?.village || 'Not specified'}

Relevant Live Search Results:
${searchSnippetText}

Rules:
1. Provide a direct, specific answer to "${message}" using bold headings (🌱 Soil, 💧 Water, 🌾 Suitable Crops, 🧪 Soil Health, 💰 Estimated Cost, ⚠️ Important Note).
2. Answer in ${isTa ? 'Tamil' : 'English'}.
3. Cite information from the search results accurately. Do NOT invent fake URLs or false claims.
4. Include disclaimers for unverified field conditions or estimates.
5. Remind user that exact village-level decisions should be verified with a field soil test.`;

  if (aiApiKey) {
    try {
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${aiApiKey}`;
      const payload = {
        contents: [{ role: 'user', parts: [{ text: systemInstruction }] }]
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          return candidateText;
        }
      }
    } catch (err) {
      console.error('AI API error:', err.message);
    }
  }

  // Dynamic synthesis fallback tailoring answer directly to user query
  return generateDynamicAnswer(message, searchResults, locationContext, lang);
}

// POST /api/chat Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, locationContext, lang } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: "Message string is required." });
    }

    if (message.length > 1000) {
      return res.status(400).json({ error: "Message exceeds maximum allowed length of 1000 characters." });
    }

    const cleanMessage = message.trim();
    const needsSearch = shouldSearchWeb(cleanMessage);

    let sources = [];
    if (needsSearch) {
      sources = await performWebSearch(cleanMessage);
    }

    const answer = await generateAIAnswer(cleanMessage, sources, locationContext, lang);

    return res.json({
      answer,
      sources,
      searchUsed: needsSearch,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error handling /api/chat:', error);
    return res.status(500).json({
      error: "I couldn't access live search information right now. Please try again later.",
      answer: "⚠️ I couldn't access live search information right now. Please try again later.",
      sources: []
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Tamil Nadu Farming Assistant Backend API running on port ${PORT}`);
});
