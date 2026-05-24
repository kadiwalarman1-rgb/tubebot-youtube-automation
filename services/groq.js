require('dotenv').config();
const Groq = require('groq-sdk');

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const HINDI_TOPICS = [
  'Desi Jokes aur Comedy',
  'Bollywood Funny Scenes',
  'Indian Memes Explained',
  'AI Ke Funny Jawab',
  'Desi Life Relatable Moments',
  'Funny Indian Ads Roast',
  'Bollywood Dialogues Comedy',
  'Indian Students Life Struggles',
  'Desi Parents Funny Moments',
  'Cricket Funny Moments',
  'Exam Time Desi Memes',
  'Shaadi Mein Kya Hota Hai',
  'Office Life Desi Style',
  'Desi Food Obsession',
  'Indian Jugaad Techniques'
];

function getRandomTopic() {
  return HINDI_TOPICS[Math.floor(Math.random() * HINDI_TOPICS.length)];
}

/**
 * Generate YouTube SHORT video content (max 55 seconds)
 */
async function generateVideoContent(topicHint = null) {
  const topic = topicHint || getRandomTopic();
  console.log(`🤖 Groq AI generating SHORT content for topic: ${topic}`);

  try {
    // Step 1: Generate title, description, tags (Shorts optimized)
    const metaResponse = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are a Hindi YouTube Shorts creator. Generate viral Shorts metadata in JSON. Always respond with valid JSON only, no markdown or explanation.`
        },
        {
          role: 'user',
          content: `Create YouTube SHORTS metadata for: "${topic}"

Return ONLY this JSON (no extra text):
{
  "title": "catchy viral Hindi title under 55 chars with emoji, must end with #Shorts",
  "description": "Hindi description 100-150 words with emojis and hashtags including #Shorts #Hindi #Comedy #Viral",
  "tags": ["Shorts", "Hindi", "Comedy", "Viral", "Desi", "Funny", "Entertainment", "India", "Trending", "Memes"],
  "thumbnailText": "punchy thumbnail text max 25 chars",
  "thumbnailSubtext": "subtitle max 35 chars with emoji"
}`
        }
      ],
      temperature: 0.85,
      max_tokens: 600
    });

    let meta;
    try {
      const metaText = metaResponse.choices[0].message.content.trim();
      const jsonMatch = metaText.match(/\{[\s\S]*\}/);
      meta = JSON.parse(jsonMatch ? jsonMatch[0] : metaText);
    } catch {
      meta = {
        title: `${topic} 😂 #Shorts`,
        description: `${topic} ke sabse funny moments! 😄\n\nIs Short mein dekho ${topic} ka kamaal!\n\n#Shorts #Hindi #Comedy #Viral #Desi #Funny #Entertainment #India #Trending`,
        tags: ['Shorts', 'Hindi', 'Comedy', 'Viral', 'Desi', 'Funny', 'Entertainment', 'India', 'Trending', 'Memes'],
        thumbnailText: topic.substring(0, 25),
        thumbnailSubtext: 'Bahut Funny! 😂'
      };
    }

    // Ensure #Shorts is always in title, tags, and description
    if (!meta.title.includes('#Shorts')) meta.title = meta.title.slice(0, 50) + ' #Shorts';
    if (!meta.tags.includes('Shorts')) meta.tags.unshift('Shorts');
    if (!meta.description.includes('#Shorts')) meta.description += '\n\n#Shorts';

    // Step 2: Generate SHORT script (max 55 seconds = ~120 words)
    const scriptResponse = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are a Hindi YouTube Shorts script writer. Write ultra-short, punchy, viral scripts for 50-55 second videos. Be funny, relatable, energetic. Hindi/Hinglish mix is perfect.`
        },
        {
          role: 'user',
          content: `Write a YouTube SHORT script in Hindi for: "${topic}"
Title: "${meta.title}"

STRICT requirements:
- MAX 110-120 words total (must fit in 50-55 seconds when spoken)
- Start with a HOOK (first 3 seconds must grab attention): e.g. "Bhai sun!", "Yeh dekh!", "Iska jawab sun!"
- Main funny content: 2-3 quick relatable points
- End with: "Like karo aur subscribe karo!" (5 seconds)
- Use "..." for natural pauses
- Simple spoken Hindi/Hinglish only
- NO stage directions, NO [brackets], just the spoken words

Write ONLY the script text:`
        }
      ],
      temperature: 0.9,
      max_tokens: 400
    });

    const script = scriptResponse.choices[0].message.content.trim();

    // Step 3: Generate display text overlays (for visual interest)
    let displayTexts;
    try {
      const dispResponse = await client.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'user',
            content: `From this Hindi script, extract 6 SHORT punchy phrases to show as text overlays on screen.
Each phrase: max 40 characters, funny/impactful.
Return ONLY a JSON array: ["text1", "text2", "text3", "text4", "text5", "text6"]

Script: ${script.substring(0, 400)}`
          }
        ],
        temperature: 0.7,
        max_tokens: 200
      });

      const textContent = dispResponse.choices[0].message.content.trim();
      const jsonMatch = textContent.match(/\[[\s\S]*\]/);
      displayTexts = JSON.parse(jsonMatch ? jsonMatch[0] : textContent);
    } catch {
      displayTexts = [
        meta.thumbnailText || topic.substring(0, 35),
        'Bahut Funny! 😂',
        'Yeh toh hota hi hai!',
        'Relatable?',
        'Like karo yaar! ❤️',
        'Subscribe karo! 🔔'
      ];
    }

    console.log('✅ Groq AI Shorts content generated successfully');

    return {
      topic,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      script,
      displayTexts,
      thumbnailText: meta.thumbnailText || topic.substring(0, 25),
      thumbnailSubtext: meta.thumbnailSubtext || 'Bahut Funny! 😂',
      isShort: true
    };

  } catch (error) {
    console.error('Groq API error:', error.message);

    // Fallback content
    return {
      topic,
      title: `${topic} 😂 #Shorts`,
      description: `${topic} ka sabse funny moment! Dekho aur hasao! 😄\n\nLike karo, subscribe karo aur bell dabao! 🔔\n\n#Shorts #Hindi #Comedy #Viral #Desi #Funny`,
      tags: ['Shorts', 'Hindi', 'Comedy', 'Viral', 'Desi', 'Funny', 'Entertainment', 'India'],
      script: `Bhai sun! ... ${topic} ke baare mein kuch hua jo tum believe nahi karoge! ... Yeh toh bilkul waisa hi hai jab ${topic} mein sab kuch ulta ho jata hai! ... Ek baar aisa hua ki... poora scene hi badal gaya! ... Sach mein yaar, ${topic} wale log aise hi hote hain! ... Agar tumhare saath bhi aisa hua hai toh comment mein batao! ... Like karo aur subscribe karo!`,
      displayTexts: [
        `${topic.substring(0, 35)} 😱`,
        'Bhai yeh kya ho raha hai!',
        'Bilkul sahi bola! 😂',
        'Aise hi hota hai!',
        'Comment karo! 💬',
        'Like & Subscribe! 🔔'
      ],
      thumbnailText: topic.substring(0, 25),
      thumbnailSubtext: 'Bahut Funny! 😂',
      isShort: true
    };
  }
}

function getTopics() {
  return HINDI_TOPICS;
}

module.exports = {
  generateVideoContent,
  getRandomTopic,
  getTopics
};
