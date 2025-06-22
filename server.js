
// server.js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || ['http://localhost:3000', 'http://127.0.0.1:5500'], // Thêm domain frontend của bạn
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Serve static files
app.use(express.static('public'));

// Rate limiting - giới hạn số request
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 50, // Tối đa 50 requests mỗi 15 phút
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

// OpenAI API call function
async function callOpenAI(message) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            // COMMENT TẠM THỜI ĐỂ DEPLOY
            // 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Authorization': `Bearer temp-api-key`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'gpt-3.5-turbo', // Hoặc 'gpt-4' nếu bạn muốn chất lượng cao hơn
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
            max_tokens: 1000, // Giới hạn độ dài phản hồi
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
        version: '1.0.0'
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

        // COMMENT TẠM THỜI ĐỂ DEPLOY
        // if (!process.env.OPENAI_API_KEY) {
        //     return res.status(500).json({ 
        //         error: 'Server chưa được cấu hình API key' 
        //     });
        // }

        // Gọi OpenAI API
        const aiResponse = await callOpenAI(message.trim());

        res.json({ 
            response: aiResponse,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        
        // Trả về lỗi thân thiện với người dùng
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
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

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 API endpoint: http://localhost:${PORT}/api/chat`);
    
    // COMMENT TẠM THỜI ĐỂ DEPLOY
    // if (!process.env.OPENAI_API_KEY) {
    //     console.warn('⚠️  CẢNH BÁO: Chưa có OPENAI_API_KEY trong file .env');
    // }
});

module.exports = app;