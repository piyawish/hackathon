import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(process.cwd()));

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/hackathontest.html');
});

let client;

app.post('/api/analyze', async (req, res) => {
  try {
    const { answers } = req.body || {};
    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ error: 'Invalid answers' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.json(buildLocalAssessment(answers));
    }

    if (!client) {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    const prompt = {
      role: 'user',
      content: [
        'You are a mental health triage assistant. Provide a brief, cautious risk summary based on the user responses.',
        'Do not diagnose. Do not claim certainty. Use simple Thai language.',
        'Return ONLY JSON with this schema:',
        '{"summary":"...","risks":{"stress":"low|moderate|high","anxiety":"low|moderate|high","depression":"low|moderate|high"},"recommendations":"..."}',
        'If any responses indicate severe distress, advise to seek professional help immediately.',
        'User answers (0-3 where 3 is frequent):',
        JSON.stringify(answers)
      ].join('\n')
    };

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You must output valid JSON only. No markdown.'
        },
        prompt
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3
    });

    const content = response.choices?.[0]?.message?.content || '{}';
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      console.error('AI JSON parse failed:', content);
      return res.status(500).json({ error: 'AI response was not valid JSON' });
    }

    return res.json(parsed);
  } catch (error) {
    console.error('AI analysis failed:', error);
    if (error?.code === 'insufficient_quota') {
      return res.json(buildLocalAssessment(req.body?.answers || []));
    }
    return res.status(500).json({ error: error?.message || 'AI analysis failed' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Invalid messages' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.json({ reply: buildLocalChatReply(messages) });
    }

    if (!client) {
      client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a supportive mental health chat assistant. Use Thai. Be empathetic, avoid diagnosis, and encourage seeking professional help if risk is high.'
        },
        ...messages
      ],
      temperature: 0.7
    });

    const reply = response.choices?.[0]?.message?.content || '';
    return res.json({ reply });
  } catch (error) {
    console.error('Chat failed:', error);
    if (error?.code === 'insufficient_quota') {
      return res.json({ reply: buildLocalChatReply(req.body?.messages || []) });
    }
    return res.status(500).json({ error: error?.message || 'Chat failed' });
  }
});

function buildLocalAssessment(answers) {
  const scores = answers.map(a => Number(a.score ?? 0));
  const idx = (n) => scores[n - 1] ?? 0;

  // Approximate mapping (DASS-21 style positions)
  const depression = [3, 5, 10, 13, 16, 17, 21].reduce((s, n) => s + idx(n), 0);
  const anxiety = [2, 4, 7, 9, 15, 19, 20].reduce((s, n) => s + idx(n), 0);
  const stress = [1, 6, 8, 11, 12, 14, 18].reduce((s, n) => s + idx(n), 0);

  const level = (v) => (v >= 14 ? 'high' : v >= 7 ? 'moderate' : 'low');

  const risks = {
    stress: level(stress),
    anxiety: level(anxiety),
    depression: level(depression)
  };

  return {
    summary: 'ระบบประเมินอัตโนมัติใช้คะแนนรวมเพื่อประเมินความเสี่ยงเบื้องต้น',
    risks,
    recommendations: 'หากคุณรู้สึกไม่สบายใจอย่างต่อเนื่อง ควรปรึกษาผู้เชี่ยวชาญด้านสุขภาพจิตเพื่อรับคำแนะนำเพิ่มเติม'
  };
}

function buildLocalChatReply(messages) {
  const last = messages[messages.length - 1]?.content || '';
  if (last.includes('เครียด') || last.includes('กังวล')) {
    return 'ขอบคุณที่แชร์นะคะ ลองหายใจช้า ๆ ลึก ๆ สัก 3–5 รอบ แล้วบอกฉันได้ไหมว่าอะไรทำให้รู้สึกกังวลที่สุด?';
  }
  if (last.includes('เศร้า') || last.includes('หมดหวัง')) {
    return 'ฉันรับฟังอยู่นะคะ ความรู้สึกเศร้านี้เกิดขึ้นมานานแค่ไหนแล้ว? หากรุนแรงมาก ควรปรึกษาผู้เชี่ยวชาญด้วยนะคะ';
  }
  return 'ฉันอยู่ตรงนี้เพื่อรับฟังค่ะ เล่าให้ฉันฟังเพิ่มได้เลยว่ากำลังเผชิญอะไรอยู่ในตอนนี้';
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
