const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
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

// ===== UTILITY FUNCTIONS =====

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

// ===== CHAT HISTORY FUNCTIONS WITH SUPABASE =====

// Lưu message vào Supabase
async function saveMessageToSupabase(ipHash, content, sender, images = []) {
    try {
        console.log(`💾 Saving ${sender} message to Supabase for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString();
        
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
            
            const messages = data.map(row => ({
                content: row.content,
                sender: row.sender,
                images: row.images || [],
                timestamp: new Date(row.created_at).getTime()
            }));
            
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

// ===== EXERCISE HISTORY FUNCTIONS WITH SUPABASE =====

async function saveExerciseToSupabase(ipHash, content, sender, formData = {}) {
    try {
        console.log(`💾 Saving ${sender} exercise to Supabase for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const expiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString();
        
        const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/exercise_sessions`, {
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
                subject: formData.subject || null,
                grade: formData.grade || null,
                difficulty: formData.difficulty || null,
                topic: formData.topic || null,
                quantity: formData.quantity || null,
                form_data: formData,
                expires_at: expiresAt
            })
        });

        if (response.ok) {
            const result = await response.json();
            console.log(`✅ Saved ${sender} exercise to Supabase:`, result[0]?.id);
            return true;
        } else {
            const error = await response.text();
            console.error('❌ Error saving exercise to Supabase:', response.status, error);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Exception saving exercise to Supabase:', error);
        return false;
    }
}

async function getExercisesFromSupabase(ipHash) {
    try {
        console.log(`📖 Loading exercises from Supabase for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const response = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/exercise_sessions?ip_hash=eq.${ipHash}&expires_at=gte.${new Date().toISOString()}&order=created_at.asc&limit=10`,
            {
                headers: {
                    'apikey': process.env.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            console.log(`✅ Loaded ${data.length} exercises from Supabase`);
            
            const exercises = [];
            for (let i = 0; i < data.length; i += 2) {
                const userMsg = data[i];
                const aiMsg = data[i + 1];
                
                if (userMsg && aiMsg && userMsg.sender === 'user' && aiMsg.sender === 'ai') {
                    exercises.push({
                        prompt: userMsg.content,
                        result: aiMsg.content,
                        formData: userMsg.form_data || {},
                        timestamp: new Date(userMsg.created_at).getTime()
                    });
                }
            }
            
            const recentExercises = exercises.slice(-5);
            
            return { exercises: recentExercises };
        } else {
            const error = await response.text();
            console.error('❌ Error loading exercises from Supabase:', response.status, error);
            return { exercises: [] };
        }
        
    } catch (error) {
        console.error('❌ Exception loading exercises from Supabase:', error);
        return { exercises: [] };
    }
}

async function cleanupExpiredExercises() {
    try {
        console.log('🧹 Cleaning up expired exercises...');
        
        const response = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/exercise_sessions?expires_at=lt.${new Date().toISOString()}`,
            {
                method: 'DELETE',
                headers: {
                    'apikey': process.env.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
                }
            }
        );

        if (response.ok) {
            console.log('✅ Cleaned up expired exercises');
        } else {
            const error = await response.text();
            console.error('❌ Error cleaning up expired exercises:', response.status, error);
        }
        
    } catch (error) {
        console.error('❌ Exception cleaning up expired exercises:', error);
    }
}

async function clearExercisesForIP(ipHash) {
    try {
        console.log(`🗑️ Clearing all exercises for IP hash: ${ipHash.substring(0, 8)}...`);
        
        const response = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/exercise_sessions?ip_hash=eq.${ipHash}`,
            {
                method: 'DELETE',
                headers: {
                    'apikey': process.env.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
                }
            }
        );

        if (response.ok) {
            console.log('✅ Cleared all exercises for IP');
            return true;
        } else {
            const error = await response.text();
            console.error('❌ Error clearing exercises:', response.status, error);
            return false;
        }
        
    } catch (error) {
        console.error('❌ Exception clearing exercises:', error);
        return false;
    }
}

// ===== QUESTION FUNCTIONS =====

async function saveQuestion(question, userIP) {
    try {
        console.log('🔄 Đang lưu câu hỏi vào Supabase...');
        console.log('📝 Câu hỏi:', question);
        
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
        exercise_history: 'Supabase (24h persistent)',
        features: ['Chat History', 'Exercise History', 'IP-based Sessions', 'Persistent Storage'],
        env_check: {
            supabase_url: !!process.env.SUPABASE_URL,
            supabase_key: !!process.env.SUPABASE_ANON_KEY,
            deepseek_key: !!process.env.DEEPSEEK_API_KEY,
            chat_salt: !!process.env.CHAT_SALT
        }
    });
});

// ===== CHAT ENDPOINTS =====

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

app.post('/api/chat/save', async (req, res) => {
    try {
        const { message, sender, images = [] } = req.body;
        
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

app.post('/api/chat', async (req, res) => {
    try {
        const { message, images } = req.body;

        console.log('📩 Nhận được tin nhắn:', message);
        if (images && images.length > 0) {
            console.log('🖼️ Có hình ảnh đính kèm:', images.length);
        }

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

        await saveQuestion(message.trim(), req.ip);

        let fullMessage = message.trim();
        if (images && images.length > 0) {
            fullMessage += `\n\n[Người dùng đã gửi ${images.length} hình ảnh đính kèm]`;
        }

        const aiResponse = await callDeepSeek(fullMessage);

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

app.post('/api/exercise', async (req, res) => {
    try {
        const { message, formData } = req.body;

        console.log('📚 Nhận được yêu cầu tạo bài tập:', message?.substring(0, 100) + '...');

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

        const ip = getRealIP(req);
        const ipHash = hashIP(ip);

        await saveExerciseToSupabase(ipHash, message, 'user', formData);
        const aiResponse = await callDeepSeek(message);
        await saveExerciseToSupabase(ipHash, aiResponse, 'ai', formData);

        await saveQuestion(message.trim(), ip);

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

app.get('/api/exercise/history', async (req, res) => {
    try {
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        
        const { exercises } = await getExercisesFromSupabase(ipHash);
        
        res.json({ 
            success: true, 
            exercises: exercises
        });
        
    } catch (error) {
        console.error('❌ Lỗi khi lấy lịch sử bài tập:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.delete('/api/exercise/clear', async (req, res) => {
    try {
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        
        const success = await clearExercisesForIP(ipHash);
        
        if (success) {
            res.json({ success: true, message: 'Đã xóa lịch sử bài tập' });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Không thể xóa lịch sử bài tập' 
            });
        }
        
    } catch (error) {
        console.error('❌ Lỗi khi xóa lịch sử bài tập:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/exercise/stats', async (req, res) => {
    try {
        const response = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/exercise_sessions?expires_at=gte.${new Date().toISOString()}&select=ip_hash,sender,subject,grade,difficulty,created_at,expires_at`,
            {
                headers: {
                    'apikey': process.env.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`
                }
            }
        );

        if (response.ok) {
            const data = await response.json();
            
            const sessionMap = new Map();
            const subjectStats = {};
            const gradeStats = {};
            
            data.forEach(row => {
                const key = row.ip_hash;
                if (!sessionMap.has(key)) {
                    sessionMap.set(key, {
                        ipHash: key.substring(0, 8) + '...',
                        exerciseCount: 0,
                        firstExercise: row.created_at,
                        expiresAt: row.expires_at
                    });
                }
                sessionMap.get(key).exerciseCount++;
                
                if (row.subject) {
                    subjectStats[row.subject] = (subjectStats[row.subject] || 0) + 1;
                }
                
                if (row.grade) {
                    gradeStats[row.grade] = (gradeStats[row.grade] || 0) + 1;
                }
            });
            
            const stats = {
                totalSessions: sessionMap.size,
                totalExercises: data.length,
                subjectDistribution: subjectStats,
                gradeDistribution: gradeStats,
                sessionsInfo: Array.from(sessionMap.values()).map(session => ({
                    ...session,
                    createdAt: session.firstExercise,
                    timeRemaining: Math.max(0, new Date(session.expiresAt).getTime() - Date.now())
                }))
            };
            
            res.json(stats);
        } else {
            res.status(500).json({ error: 'Cannot fetch exercise stats from Supabase' });
        }
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/exercise/cleanup', async (req, res) => {
    try {
        await cleanupExpiredExercises();
        res.json({ success: true, message: 'Exercise cleanup completed' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ===== OTHER ENDPOINTS =====

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

app.get('/health', async (req, res) => {
    try {
        const questionCount = await countQuestions();
        
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
            questionsCount: questionCount,
            chatStorage: 'Supabase (persistent 24h)',
            exerciseStorage: 'Supabase (persistent 24h)',
            tables: ['chat_sessions', 'exercise_sessions', 'questions']
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

app.get('/api/chat/stats', async (req, res) => {
    try {
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

// Cleanup interval
setInterval(() => {
    cleanupExpiredMessages();
    cleanupExpiredExercises();
}, 60 * 60 * 1000);

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại port ${PORT}`);
    console.log(`📱 Health check: http://localhost:${PORT}/health`);
    console.log(`🤖 Chat endpoint: http://localhost:${PORT}/api/chat`);
    console.log(`💬 Chat history: http://localhost:${PORT}/api/chat/history`);
    console.log(`📊 Chat stats: http://localhost:${PORT}/api/chat/stats`);
    console.log(`🧹 Chat cleanup: http://localhost:${PORT}/api/chat/cleanup`);
    console.log(`📚 Exercise endpoint: http://localhost:${PORT}/api/exercise`);
    console.log(`📖 Exercise history: http://localhost:${PORT}/api/exercise/history`);
    console.log(`📈 Exercise stats: http://localhost:${PORT}/api/exercise/stats`);
    console.log(`🗑️ Exercise clear: http://localhost:${PORT}/api/exercise/clear`);
    console.log(`🧹 Exercise cleanup: http://localhost:${PORT}/api/exercise/cleanup`);
    console.log(`📝 Questions: http://localhost:${PORT}/api/questions`);
    console.log(`🧪 Test DeepSeek: http://localhost:${PORT}/api/test-deepseek`);
    
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
    console.log('📚 Exercise Storage: Supabase PostgreSQL (24h persistent)');
    console.log('🗄️ Tables: chat_sessions, exercise_sessions, questions');
});

module.exports = app;