// server.js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto'); // Thêm để hash IP
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Chat sessions storage (in-memory)
let chatSessions = new Map();

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

// ===== CHAT HISTORY FUNCTIONS =====

// Lấy IP thật của user
function getRealIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.ip || 'unknown';
}

// Hash IP để bảo mật
function hashIP(ip) {
    const salt = process.env.CHAT_SALT || 'default_chat_salt_2024';
    return crypto.createHash('sha256').update(ip + salt).digest('hex');
}

// Dọn dẹp sessions hết hạn
function cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (let [key, session] of chatSessions.entries()) {
        if (session.expiresAt < now) {
            chatSessions.delete(key);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 Đã xóa ${cleanedCount} chat sessions hết hạn`);
    }
}

// Lấy hoặc tạo session cho IP
function getOrCreateSession(ipHash) {
    cleanupExpiredSessions();
    
    let session = chatSessions.get(ipHash);
    const now = Date.now();
    
    if (!session || session.expiresAt < now) {
        // Tạo session mới
        session = {
            messages: [],
            createdAt: now,
            expiresAt: now + (24 * 60 * 60 * 1000), // 24h from now
            lastActivity: now
        };
        chatSessions.set(ipHash, session);
        console.log(`✨ Tạo chat session mới cho IP hash: ${ipHash.substring(0, 8)}...`);
    }
    
    return session;
}

// Lưu message vào session
function saveMessageToSession(ipHash, content, sender, images = []) {
    try {
        const session = getOrCreateSession(ipHash);
        const now = Date.now();
        
        session.messages.push({
            content: content,
            sender: sender, // 'user' hoặc 'ai'
            images: images,
            timestamp: now
        });
        
        session.lastActivity = now;
        chatSessions.set(ipHash, session);
        
        console.log(`💾 Đã lưu tin nhắn ${sender} cho IP hash: ${ipHash.substring(0, 8)}... (${session.messages.length} messages total)`);
        
        return true;
    } catch (error) {
        console.error('❌ Lỗi khi lưu message vào session:', error);
        return false;
    }
}

// ===== EXISTING FUNCTIONS =====

// Hàm lưu câu hỏi vào Supabase
async function saveQuestion(question, userIP) {
    try {
        console.log('🔄 Đang lưu câu hỏi vào Supabase...');
        console.log('📝 Câu hỏi:', question);
        console.log('🌐 URL:', process.env.SUPABASE_URL);
        
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/questions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                question: question,
                user_ip: userIP
            })
        });

        console.log('📊 Response status:', response.status);
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ Đã lưu câu hỏi vào Supabase:', result);
        } else {
            const error = await response.text();
            console.error('❌ Lỗi khi lưu vào Supabase:', response.status, error);
        }
        
    } catch (error) {
        console.error('❌ Exception khi lưu câu hỏi:', error);
    }
}

// Hàm lấy câu hỏi từ Supabase
async function getQuestions(limit = 50) {
    try {
        console.log('🔍 Đang lấy câu hỏi từ Supabase...');
        
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/questions?order=created_at.desc&limit=${limit}`, {
            headers: {
                'apikey': process.env.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
            }
        });

        console.log('📊 Get questions status:', response.status);

        if (response.ok) {
            const data = await response.json();
            console.log('✅ Lấy được câu hỏi:', data.length);
            return data;
        } else {
            const error = await response.text();
            console.error('❌ Lỗi khi lấy câu hỏi:', response.status, error);
            return [];
        }
        
    } catch (error) {
        console.error('❌ Exception khi lấy câu hỏi:', error);
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

// DeepSeek API call function
async function callDeepSeek(message) {
    console.log('🤖 Gọi DeepSeek API...');
    
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: 'Bạn là một AI assistant hữu ích, thông minh và thân thiện. Hãy trả lời bằng tiếng Việt một cách tự nhiên và chi tiết. Khi có thể, hãy cung cấp ví dụ cụ thể và giải thích rõ ràng.'
                },
                {
                    role: 'user',
                    content: message
                }
            ],
            max_tokens: 2000,
            temperature: 0.7,
            top_p: 0.95,
            frequency_penalty: 0.1,
            presence_penalty: 0.1,
            stream: false
        })
    });

    console.log('📊 DeepSeek Response status:', response.status);

    if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ DeepSeek API Error:', errorText);
        
        let error;
        try {
            error = JSON.parse(errorText);
        } catch {
            error = { error: { message: errorText } };
        }
        
        throw new Error(`DeepSeek API Error: ${error.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    console.log('✅ DeepSeek Response received');
    
    return data.choices[0].message.content;
}

// ===== ROUTES =====

app.get('/', (req, res) => {
    res.json({ 
        message: 'DeepSeek Chat Backend đang hoạt động!',
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        ai_provider: 'DeepSeek AI',
        storage: 'Supabase PostgreSQL',
        chat_history: 'In-Memory (24h)',
        features: ['Chat History', 'IP-based Sessions', 'Auto Cleanup'],
        env_check: {
            supabase_url: !!process.env.SUPABASE_URL,
            supabase_key: !!process.env.SUPABASE_ANON_KEY,
            deepseek_key: !!process.env.DEEPSEEK_API_KEY,
            chat_salt: !!process.env.CHAT_SALT
        }
    });
});

// ===== NEW CHAT HISTORY ENDPOINTS =====

// Lấy lịch sử chat theo IP
app.get('/api/chat/history', (req, res) => {
    try {
        cleanupExpiredSessions();
        
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        const session = chatSessions.get(ipHash);
        
        if (session && session.expiresAt > Date.now()) {
            console.log(`📖 Trả về ${session.messages.length} tin nhắn cho IP hash: ${ipHash.substring(0, 8)}...`);
            res.json({ 
                success: true, 
                messages: session.messages,
                sessionInfo: {
                    messageCount: session.messages.length,
                    createdAt: session.createdAt,
                    expiresAt: session.expiresAt,
                    timeRemaining: Math.max(0, session.expiresAt - Date.now())
                }
            });
        } else {
            console.log(`📭 Không có lịch sử chat cho IP hash: ${ipHash.substring(0, 8)}...`);
            res.json({ 
                success: true, 
                messages: [],
                sessionInfo: null
            });
        }
    } catch (error) {
        console.error('❌ Lỗi khi lấy lịch sử chat:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Lưu tin nhắn vào lịch sử
app.post('/api/chat/save', (req, res) => {
    try {
        const { message, sender, images = [] } = req.body;
        
        // Validation
        if (!message || !sender) {
            return res.status(400).json({ 
                success: false, 
                error: 'message và sender là bắt buộc' 
            });
        }
        
        if (!['user', 'ai'].includes(sender)) {
            return res.status(400).json({ 
                success: false, 
                error: 'sender phải là "user" hoặc "ai"' 
            });
        }
        
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        
        const success = saveMessageToSession(ipHash, message, sender, images);
        
        if (success) {
            res.json({ success: true });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Không thể lưu tin nhắn' 
            });
        }
        
    } catch (error) {
        console.error('❌ Lỗi khi lưu tin nhắn:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Xóa lịch sử chat (optional)
app.delete('/api/chat/clear', (req, res) => {
    try {
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        
        if (chatSessions.has(ipHash)) {
            chatSessions.delete(ipHash);
            console.log(`🗑️ Đã xóa lịch sử chat cho IP hash: ${ipHash.substring(0, 8)}...`);
            res.json({ success: true, message: 'Đã xóa lịch sử chat' });
        } else {
            res.json({ success: true, message: 'Không có lịch sử chat để xóa' });
        }
        
    } catch (error) {
        console.error('❌ Lỗi khi xóa lịch sử chat:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ===== EXISTING CHAT ENDPOINT (MODIFIED) =====

app.post('/api/chat', async (req, res) => {
    try {
        const { message, images } = req.body;

        console.log('📩 Nhận được tin nhắn:', message);
        if (images && images.length > 0) {
            console.log('🖼️ Có hình ảnh đính kèm:', images.length);
        }

        // Validation
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ 
                error: 'Tin nhắn không hợp lệ' 
            });
        }

        if (message.length > 4000) {
            return res.status(400).json({ 
                error: 'Tin nhắn quá dài (tối đa 4000 ký tự)' 
            });
        }

        if (!process.env.DEEPSEEK_API_KEY) {
            return res.status(500).json({ 
                error: 'Server chưa được cấu hình DeepSeek API key' 
            });
        }

        // Lưu câu hỏi của người dùng vào Supabase (existing function)
        await saveQuestion(message.trim(), req.ip);

        // Xử lý hình ảnh (nếu có) - DeepSeek có thể hỗ trợ vision trong tương lai
        let fullMessage = message.trim();
        if (images && images.length > 0) {
            fullMessage += `\n\n[Người dùng đã gửi ${images.length} hình ảnh đính kèm]`;
        }

        // Gọi DeepSeek API
        const aiResponse = await callDeepSeek(fullMessage);

        // NOTE: Chat history được lưu thông qua frontend call tới /api/chat/save
        // Không auto-save ở đây để tránh duplicate khi load lại trang

        res.json({ 
            response: aiResponse,
            timestamp: new Date().toISOString(),
            provider: 'DeepSeek AI',
            model: 'deepseek-chat'
        });

    } catch (error) {
        console.error('Error in /api/chat:', error);
        
        if (error.message.includes('insufficient_quota') || error.message.includes('quota')) {
            res.status(503).json({ 
                error: 'Đã hết hạn mức sử dụng API DeepSeek. Vui lòng thử lại sau.' 
            });
        } else if (error.message.includes('rate_limit') || error.message.includes('too_many_requests')) {
            res.status(429).json({ 
                error: 'Quá nhiều yêu cầu. Vui lòng chờ một chút.' 
            });
        } else if (error.message.includes('invalid_api_key')) {
            res.status(401).json({ 
                error: 'API key không hợp lệ.' 
            });
        } else {
            res.status(500).json({ 
                error: 'Có lỗi xảy ra khi kết nối với DeepSeek AI. Vui lòng thử lại sau.',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
});

// ===== EXISTING ENDPOINTS =====

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
            ai_provider: "DeepSeek AI",
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
        cleanupExpiredSessions();
        
        // Test DeepSeek API connection
        let deepseekStatus = 'Unknown';
        try {
            await callDeepSeek('Hello');
            deepseekStatus = 'Connected';
        } catch (error) {
            deepseekStatus = `Error: ${error.message}`;
        }
        
        res.json({ 
            status: 'OK', 
            timestamp: new Date().toISOString(),
            database: 'Connected to Supabase',
            ai_provider: 'DeepSeek AI',
            deepseek_status: deepseekStatus,
            questionsCount: count,
            chatSessions: {
                active: chatSessions.size,
                totalMessages: Array.from(chatSessions.values()).reduce((sum, session) => sum + session.messages.length, 0)
            }
        });
    } catch (error) {
        res.json({ 
            status: 'DEGRADED', 
            timestamp: new Date().toISOString(),
            database: 'Supabase connection failed',
            ai_provider: 'DeepSeek AI',
            error: error.message
        });
    }
});

// API endpoint để test DeepSeek connection
app.get('/api/test-deepseek', async (req, res) => {
    try {
        const testResponse = await callDeepSeek('Xin chào! Bạn có thể trả lời bằng tiếng Việt không?');
        res.json({
            success: true,
            message: 'DeepSeek API hoạt động bình thường',
            test_response: testResponse,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// API để xem thống kê chat sessions (debug)
app.get('/api/chat/stats', (req, res) => {
    try {
        cleanupExpiredSessions();
        
        const stats = {
            totalSessions: chatSessions.size,
            totalMessages: 0,
            sessionsInfo: []
        };
        
        for (let [ipHash, session] of chatSessions.entries()) {
            stats.totalMessages += session.messages.length;
            stats.sessionsInfo.push({
                ipHash: ipHash.substring(0, 8) + '...',
                messageCount: session.messages.length,
                createdAt: new Date(session.createdAt).toISOString(),
                expiresAt: new Date(session.expiresAt).toISOString(),
                timeRemaining: Math.max(0, session.expiresAt - Date.now())
            });
        }
        
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
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

// Cleanup expired sessions every hour
setInterval(() => {
    cleanupExpiredSessions();
}, 60 * 60 * 1000); // 1 hour

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 API endpoint: http://localhost:${PORT}/api/chat`);
    console.log(`📝 Xem câu hỏi: http://localhost:${PORT}/api/questions`);
    console.log(`🧪 Test DeepSeek: http://localhost:${PORT}/api/test-deepseek`);
    console.log(`💬 Chat history: http://localhost:${PORT}/api/chat/history`);
    console.log(`📊 Chat stats: http://localhost:${PORT}/api/chat/stats`);
    
    console.log('\n🔧 Kiểm tra cấu hình:');
    if (!process.env.DEEPSEEK_API_KEY) {
        console.warn('⚠️  CẢNH BÁO: Chưa có DEEPSEEK_API_KEY trong file .env');
    } else {
        console.log('✅ DEEPSEEK_API_KEY đã được cấu hình');
    }
    
    if (!process.env.SUPABASE_URL) {
        console.warn('⚠️  CẢNH BÁO: Chưa có SUPABASE_URL trong file .env');
    } else {
        console.log('✅ SUPABASE_URL đã được cấu hình');
    }
    
    if (!process.env.SUPABASE_ANON_KEY) {
        console.warn('⚠️  CẢNH BÁO: Chưa có SUPABASE_ANON_KEY trong file .env');
    } else {
        console.log('✅ SUPABASE_ANON_KEY đã được cấu hình');
    }
    
    if (!process.env.CHAT_SALT) {
        console.warn('⚠️  CẢNH BÁO: Nên thêm CHAT_SALT vào file .env để bảo mật tốt hơn');
    } else {
        console.log('✅ CHAT_SALT đã được cấu hình');
    }
    
    console.log('\n🤖 AI Provider: DeepSeek AI');
    console.log('📖 Model: deepseek-chat');
    console.log('💾 Chat Storage: In-Memory (24h auto-cleanup)');
});

module.exports = app;