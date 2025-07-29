// server.js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto'); // Thêm để hash IP
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

// ===== CHAT HISTORY FUNCTIONS WITH SUPABASE =====

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

// Lưu message vào Supabase
async function saveMessageToSupabase(ipHash, content, sender, images = []) {
    try {
        console.log(`💾 Saving ${sender} message to Supabase for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString(); // 24h from now
        
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/chat_sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify({
                ip_hash: ipHash,
                content: content,
                sender: sender,
                images: images,
                expires_at: expiresAt
            })
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`✅ Saved ${sender} message to Supabase:`, result[0]?.id);
            return true;
        } else {
            const error = await response.text();
            console.error('❌ Error saving to Supabase:', response.status, error);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Exception saving message to Supabase:', error);
        return false;
    }
}

// Lấy messages từ Supabase theo IP hash
async function getMessagesFromSupabase(ipHash) {
    try {
        console.log(`📖 Loading messages from Supabase for IP hash: ${ipHash.substring(0, 8)}...`);
        
        // Get messages that haven't expired, ordered by creation time
        const response = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/chat_sessions?ip_hash=eq.${ipHash}&expires_at=gte.${new Date().toISOString()}&order=created_at.asc`,
            {
                headers: {
                    'apikey': process.env.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            console.log(`✅ Loaded ${data.length} messages from Supabase`);
            
            // Transform to frontend format
            const messages = data.map(row => ({
                content: row.content,
                sender: row.sender,
                images: row.images || [],
                timestamp: new Date(row.created_at).getTime()
            }));
            
            // Calculate session info
            const sessionInfo = data.length > 0 ? {
                messageCount: data.length,
                createdAt: new Date(data[0].created_at).getTime(),
                expiresAt: new Date(data[0].expires_at).getTime(),
                timeRemaining: Math.max(0, new Date(data[0].expires_at).getTime() - Date.now())
            } : null;
            
            return { messages, sessionInfo };
        } else {
            const error = await response.text();
            console.error('❌ Error loading from Supabase:', response.status, error);
            return { messages: [], sessionInfo: null };
        }
        
    } catch (error) {
        console.error('❌ Exception loading messages from Supabase:', error);
        return { messages: [], sessionInfo: null };
    }
}

// Xóa messages hết hạn (cleanup)
async function cleanupExpiredMessages() {
    try {
        console.log('🧹 Cleaning up expired chat messages...');
        
        const response = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/chat_sessions?expires_at=lt.${new Date().toISOString()}`,
            {
                method: 'DELETE',
                headers: {
                    'apikey': process.env.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
                }
            }
        );

        if (response.ok) {
            console.log('✅ Cleaned up expired chat messages');
        } else {
            const error = await response.text();
            console.error('❌ Error cleaning up expired messages:', response.status, error);
        }
        
    } catch (error) {
        console.error('❌ Exception cleaning up expired messages:', error);
    }
}

// Xóa tất cả messages của một IP
async function clearMessagesForIP(ipHash) {
    try {
        console.log(`🗑️ Clearing all messages for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const response = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/chat_sessions?ip_hash=eq.${ipHash}`,
            {
                method: 'DELETE',
                headers: {
                    'apikey': process.env.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
                }
            }
        );

        if (response.ok) {
            console.log('✅ Cleared all messages for IP');
            return true;
        } else {
            const error = await response.text();
            console.error('❌ Error clearing messages:', response.status, error);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Exception clearing messages:', error);
        return false;
    }
}

// ===== EXISTING FUNCTIONS =====
// ===== EXERCISE HISTORY FUNCTIONS =====

// Exercise sessions storage (separate from chat)
let exerciseSessions = new Map();

// Exercise-specific cleanup function
function cleanupExpiredExerciseSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (let [key, session] of exerciseSessions.entries()) {
        if (session.expiresAt < now) {
            exerciseSessions.delete(key);
            cleanedCount++;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`🧹 Đã xóa ${cleanedCount} exercise sessions hết hạn`);
    }
}

// Save exercise to session
function saveExerciseToSession(ipHash, prompt, result, formData) {
    try {
        cleanupExpiredExerciseSessions();
        
        let session = exerciseSessions.get(ipHash);
        const now = Date.now();
        
        if (!session || session.expiresAt < now) {
            session = {
                exercises: [],
                createdAt: now,
                expiresAt: now + (24 * 60 * 60 * 1000), // 24h
                lastActivity: now
            };
        }
        
        // Add new exercise (keep only last 5 exercises per IP)
        session.exercises.push({
            prompt: prompt,
            result: result,
            formData: formData,
            timestamp: now
        });
        
        // Keep only last 5 exercises
        if (session.exercises.length > 5) {
            session.exercises = session.exercises.slice(-5);
        }
        
        session.lastActivity = now;
        exerciseSessions.set(ipHash, session);
        
        console.log(`💾 Đã lưu exercise cho IP hash: ${ipHash.substring(0, 8)}... (${session.exercises.length} exercises total)`);
        
        return true;
    } catch (error) {
        console.error('❌ Lỗi khi lưu exercise:', error);
        return false;
    }
}
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
        version: '2.2.0',
        ai_provider: 'DeepSeek AI',
        storage: 'Supabase PostgreSQL',
        chat_history: 'Supabase (24h persistent)',
        features: ['Chat History', 'IP-based Sessions', 'Persistent Storage'],
        env_check: {
            supabase_url: !!process.env.SUPABASE_URL,
            supabase_key: !!process.env.SUPABASE_ANON_KEY,
            deepseek_key: !!process.env.DEEPSEEK_API_KEY,
            chat_salt: !!process.env.CHAT_SALT
        }
    });
});

// ===== CHAT HISTORY ENDPOINTS WITH SUPABASE =====

// Lấy lịch sử chat theo IP
app.get('/api/chat/history', async (req, res) => {
    try {
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        
        const { messages, sessionInfo } = await getMessagesFromSupabase(ipHash);
        
        res.json({ 
            success: true, 
            messages: messages,
            sessionInfo: sessionInfo
        });
        
    } catch (error) {
        console.error('❌ Lỗi khi lấy lịch sử chat:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Lưu tin nhắn vào lịch sử
app.post('/api/chat/save', async (req, res) => {
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
        
        const success = await saveMessageToSupabase(ipHash, message, sender, images);
        
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

// Xóa lịch sử chat
app.delete('/api/chat/clear', async (req, res) => {
    try {
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        
        const success = await clearMessagesForIP(ipHash);
        
        if (success) {
            res.json({ success: true, message: 'Đã xóa lịch sử chat' });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Không thể xóa lịch sử chat' 
            });
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
        await saveQuestion(`[EXERCISE] ${formData?.subject || 'Mixed'} - ${message.substring(0, 100)}...`, req.ip);

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
// ===== EXERCISE ENDPOINTS =====

// POST /api/exercise - Tạo bài tập
app.post('/api/exercise', async (req, res) => {
    try {
        const { message, formData } = req.body;

        console.log('📚 Nhận được yêu cầu tạo bài tập:', message?.substring(0, 100) + '...');

        // Validation
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ 
                error: 'Prompt bài tập không hợp lệ' 
            });
        }

        if (message.length > 8000) {
            return res.status(400).json({ 
                error: 'Prompt quá dài (tối đa 8000 ký tự)' 
            });
        }

        if (!process.env.DEEPSEEK_API_KEY) {
            return res.status(500).json({ 
                error: 'Server chưa được cấu hình DeepSeek API key' 
            });
        }

        // Lấy IP và hash
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);

        // Gọi DeepSeek API (dùng chung với chat)
        const aiResponse = await callDeepSeek(message);

        // Lưu exercise vào session riêng
        saveExerciseToSession(ipHash, message, aiResponse, formData);

        // Lưu vào Supabase (nếu muốn keep track)
        await saveQuestion(`[EXERCISE] ${formData?.subject || 'Unknown'} - ${formData?.topic || 'Unknown'}`, ip);

        res.json({ 
            response: aiResponse,
            timestamp: new Date().toISOString(),
            provider: 'DeepSeek AI',
            model: 'deepseek-chat',
            type: 'exercise'
        });

    } catch (error) {
        console.error('Error in /api/exercise:', error);
        
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
                error: 'Có lỗi xảy ra khi tạo bài tập. Vui lòng thử lại sau.'
            });
        }
    }
});

// GET /api/exercise/history - Lấy lịch sử bài tập
app.get('/api/exercise/history', (req, res) => {
    try {
        cleanupExpiredExerciseSessions();
        
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        const session = exerciseSessions.get(ipHash);
        
        if (session && session.expiresAt > Date.now()) {
            console.log(`📖 Trả về ${session.exercises.length} bài tập cho IP hash: ${ipHash.substring(0, 8)}...`);
            res.json({ 
                success: true, 
                exercises: session.exercises
            });
        } else {
            console.log(`📭 Không có lịch sử bài tập cho IP hash: ${ipHash.substring(0, 8)}...`);
            res.json({ 
                success: true, 
                exercises: []
            });
        }
    } catch (error) {
        console.error('❌ Lỗi khi lấy lịch sử bài tập:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
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
            chatStorage: 'Supabase (persistent 24h)'
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

// API để xem thống kê chat sessions (debug) - từ Supabase
app.get('/api/chat/stats', async (req, res) => {
    try {
        // Get stats from Supabase
        const response = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/chat_sessions?expires_at=gte.${new Date().toISOString()}&select=ip_hash,sender,created_at,expires_at`,
            {
                headers: {
                    'apikey': process.env.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            
            // Group by IP hash
            const sessionMap = new Map();
            data.forEach(row => {
                const key = row.ip_hash;
                if (!sessionMap.has(key)) {
                    sessionMap.set(key, {
                        ipHash: key.substring(0, 8) + '...',
                        messageCount: 0,
                        firstMessage: row.created_at,
                        expiresAt: row.expires_at
                    });
                }
                sessionMap.get(key).messageCount++;
            });
            
            const stats = {
                totalSessions: sessionMap.size,
                totalMessages: data.length,
                sessionsInfo: Array.from(sessionMap.values()).map(session => ({
                    ...session,
                    createdAt: session.firstMessage,
                    timeRemaining: Math.max(0, new Date(session.expiresAt).getTime() - Date.now())
                }))
            };
            
            res.json(stats);
        } else {
            res.status(500).json({ error: 'Cannot fetch stats from Supabase' });
        }
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cleanup endpoint (manual trigger)
app.post('/api/chat/cleanup', async (req, res) => {
    try {
        await cleanupExpiredMessages();
        res.json({ success: true, message: 'Cleanup completed' });
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

// Cleanup expired messages and exercises every hour
setInterval(() => {
    cleanupExpiredMessages();
    cleanupExpiredExerciseSessions();
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
    console.log(`🧹 Cleanup: http://localhost:${PORT}/api/chat/cleanup`);
    
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
    console.log('💾 Chat Storage: Supabase PostgreSQL (24h persistent)');
});

module.exports = app;