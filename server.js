// server.js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || ['http://localhost:3000', 'http://127.0.0.1:5500'], 
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: {
        error: 'Quá nhiều yêu cầu từ IP này. Vui lòng thử lại sau.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/', limiter);

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// Hàm lưu câu hỏi vào Supabase
async function saveQuestion(question, userIP) {
    try {
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/questions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                question: question,
                user_ip: userIP,
                created_at: new Date().toISOString()
            })
        });

        if (response.ok) {
            console.log(`✅ Đã lưu câu hỏi vào Supabase`);
        } else {
            const error = await response.text();
            console.error('❌ Lỗi khi lưu vào Supabase:', error);
        }
        
    } catch (error) {
        console.error('❌ Lỗi khi lưu câu hỏi:', error);
    }
}

// Hàm lấy câu hỏi từ Supabase
async function getQuestions(limit = 50) {
    try {
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/questions?order=created_at.desc&limit=${limit}`, {
            headers: {
                'apikey': process.env.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
            }
        });

        if (response.ok) {
            return await response.json();
        } else {
            throw new Error(`Supabase error: ${response.statusText}`);
        }
        
    } catch (error) {
        console.error('❌ Lỗi khi lấy câu hỏi:', error);
        return [];
    }
}

// Hàm đếm tổng số câu hỏi
async function countQuestions() {
    try {
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/questions?select=count`, {
            headers: {
                'apikey': process.env.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
                'Prefer': 'count=exact'
            }
        });

        if (response.ok) {
            const countHeader = response.headers.get('Content-Range');
            if (countHeader) {
                const count = countHeader.split('/')[1];
                return parseInt(count) || 0;
            }
        }
        return 0;
        
    } catch (error) {
        console.error('❌ Lỗi khi đếm câu hỏi:', error);
        return 0;
    }
}

// OpenAI API call function
async function callOpenAI(message) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                {
                    role: 'system',
                    content: 'Bạn là một AI assistant hữu ích, thông minh và thân thiện. Hãy trả lời bằng tiếng Việt một cách tự nhiên và chi tiết.'
                },
                {
                    role: 'user',
                    content: message
                }
            ],
            max_tokens: 1000,
            temperature: 0.7,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0
        })
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`OpenAI API Error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Routes
app.get('/', (req, res) => {
    res.json({ 
        message: 'OpenAI Chat Backend đang hoạt động!',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        storage: 'Supabase PostgreSQL'
    });
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        // Validation
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ 
                error: 'Tin nhắn không hợp lệ' 
            });
        }

        if (message.length > 2000) {
            return res.status(400).json({ 
                error: 'Tin nhắn quá dài (tối đa 2000 ký tự)' 
            });
        }

        if (!process.env.API_KEY) {
            return res.status(500).json({ 
                error: 'Server chưa được cấu hình API key' 
            });
        }

        // Lưu câu hỏi của người dùng vào Supabase
        await saveQuestion(message.trim(), req.ip);

        // Gọi OpenAI API
        const aiResponse = await callOpenAI(message.trim());

        res.json({ 
            response: aiResponse,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        
        if (error.message.includes('insufficient_quota')) {
            res.status(503).json({ 
                error: 'Đã hết hạn mức sử dụng API. Vui lòng thử lại sau.' 
            });
        } else if (error.message.includes('rate_limit_exceeded')) {
            res.status(429).json({ 
                error: 'Quá nhiều yêu cầu. Vui lòng chờ một chút.' 
            });
        } else {
            res.status(500).json({ 
                error: 'Có lỗi xảy ra. Vui lòng thử lại sau.' 
            });
        }
    }
});

// API để xem các câu hỏi đã lưu từ Supabase
app.get('/api/questions', async (req, res) => {
    try {
        const questions = await getQuestions(50);
        const total = await countQuestions();
        
        console.log(`📖 Trả về ${questions.length}/${total} câu hỏi từ Supabase`);
        
        res.json({
            total: total,
            questions: questions,
            storage: "Supabase PostgreSQL - Persistent storage",
            serverTime: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Lỗi khi đọc câu hỏi từ Supabase:', error.message);
        res.json({ 
            total: 0, 
            questions: [], 
            error: error.message,
            storage: "Supabase connection failed"
        });
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const count = await countQuestions();
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            database: 'Connected to Supabase',
            questionsCount: count
        });
    } catch (error) {
        res.json({ 
            status: 'DEGRADED', 
            timestamp: new Date().toISOString(),
            database: 'Supabase connection failed',
            error: error.message
        });
    }
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint không tồn tại' });
});

// Error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({ error: 'Lỗi server không xác định' });
});

// Start server (chỉ khi không phải trên Vercel)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`🚀 Server đang chạy tại port ${PORT}`);
        console.log(`📱 Health check: http://localhost:${PORT}/health`);
        console.log(`🤖 API endpoint: http://localhost:${PORT}/api/chat`);
        console.log(`📝 Xem câu hỏi: http://localhost:${PORT}/api/questions`);
        
        if (!process.env.API_KEY) {
            console.warn('⚠️  CẢNH BÁO: Chưa có API_KEY trong file .env');
        }
        if (!process.env.SUPABASE_URL) {
            console.warn('⚠️  CẢNH BÁO: Chưa có SUPABASE_URL trong file .env');
        }
    });
}

module.exports = app;