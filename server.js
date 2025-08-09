const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
require('dotenv').config();

// Import Firebase functions
const {
    // Chat functions
    saveMessageToFirestore,
    getMessagesFromFirestore,
    cleanupExpiredMessages,
    clearMessagesForIP,
    // Exercise functions
    saveExerciseToFirestore,
    getExercisesFromFirestore,
    cleanupExpiredExercises,
    clearExercisesForIP,
    // Literature functions
    saveLiteratureToFirestore,
    getLiteratureFromFirestore,
    cleanupExpiredLiterature,
    clearLiteratureForIP,
    // Questions functions
    saveQuestion,
    getQuestions,
    countQuestions,
    // Stats functions
    getChatStats
} = require('./firebase-config');

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
        message: 'EduS Chat Backend đang hoạt động!',
        timestamp: new Date().toISOString(),
        version: '3.0.0',
        ai_provider: 'DeepSeek AI',
        storage: 'Firebase Firestore',
        chat_history: 'Firebase (24h persistent)',
        exercise_history: 'Firebase (24h persistent)',
        literature_history: 'Firebase (24h persistent)',
        features: ['Chat History', 'Exercise History', 'Literature History', 'IP-based Sessions', 'Persistent Storage'],
        env_check: {
            firebase_project_id: !!process.env.FIREBASE_PROJECT_ID,
            firebase_api_key: !!process.env.FIREBASE_API_KEY,
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
        
        const { messages, sessionInfo } = await getMessagesFromFirestore(ipHash);
        
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
        
        const success = await saveMessageToFirestore(ipHash, message, sender, images);
        
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

        await saveExerciseToFirestore(ipHash, message, 'user', formData);
        const aiResponse = await callDeepSeek(message);
        await saveExerciseToFirestore(ipHash, aiResponse, 'ai', formData);

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
        
        const { exercises } = await getExercisesFromFirestore(ipHash);
        
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

// ===== LITERATURE ENDPOINTS =====

app.post('/api/literature', async (req, res) => {
    try {
        const { message, formData } = req.body;

        console.log('📖 Nhận được yêu cầu phân tích văn học:', message?.substring(0, 100) + '...');

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ 
                error: 'Prompt phân tích văn học không hợp lệ' 
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

        await saveLiteratureToFirestore(ipHash, message, 'user', formData);

        // Gọi DeepSeek API với system prompt đặc biệt cho văn học
        const literatureSystemPrompt = 'Bạn là một chuyên gia phân tích văn học với kiến thức sâu rộng về văn học Việt Nam và thế giới. Hãy phân tích một cách chi tiết, sâu sắc và có tính học thuật. Trả lời bằng tiếng Việt với ngôn ngữ trang trọng, phù hợp với phân tích văn học.';
        
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
                        content: literatureSystemPrompt
                    },
                    {
                        role: 'user',
                        content: message
                    }
                ],
                max_tokens: 3000,
                temperature: 0.8,
                top_p: 0.95,
                frequency_penalty: 0.1,
                presence_penalty: 0.1,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ DeepSeek API Error:', errorText);
            throw new Error(`DeepSeek API Error: ${errorText}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;

        await saveLiteratureToFirestore(ipHash, aiResponse, 'ai', formData);

        const trackingMsg = `[LITERATURE] ${message.trim()}`;
        await saveQuestion(trackingMsg, ip);

        res.json({ 
            response: aiResponse,
            timestamp: new Date().toISOString(),
            provider: 'DeepSeek AI',
            model: 'deepseek-chat',
            type: 'literature'
        });

    } catch (error) {
        console.error('Error in /api/literature:', error);
        
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
                error: 'Có lỗi xảy ra khi phân tích văn học. Vui lòng thử lại sau.'
            });
        }
    }
});

app.get('/api/literature/history', async (req, res) => {
    try {
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        
        const { literature } = await getLiteratureFromFirestore(ipHash);
        
        res.json({ 
            success: true, 
            literature: literature
        });
        
    } catch (error) {
        console.error('❌ Lỗi khi lấy lịch sử phân tích văn học:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.delete('/api/literature/clear', async (req, res) => {
    try {
        const ip = getRealIP(req);
        const ipHash = hashIP(ip);
        
        const success = await clearLiteratureForIP(ipHash);
        
        if (success) {
            res.json({ success: true, message: 'Đã xóa lịch sử phân tích văn học' });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Không thể xóa lịch sử phân tích văn học' 
            });
        }
        
    } catch (error) {
        console.error('❌ Lỗi khi xóa lịch sử phân tích văn học:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ===== OTHER ENDPOINTS =====

app.get('/api/questions', async (req, res) => {
    try {
        const questions = await getQuestions(50);
        const total = await countQuestions();
        
        console.log(`📖 Trả về ${questions.length}/${total} câu hỏi từ Firestore`);
        
        res.json({
            total: total,
            questions: questions,
            storage: "Firebase Firestore - Persistent storage",
            ai_provider: "DeepSeek AI",
            serverTime: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Lỗi khi đọc câu hỏi từ Firestore:', error.message);
        res.json({ 
            total: 0, 
            questions: [], 
            error: error.message,
            storage: "Firebase connection failed"
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
            database: 'Connected to Firebase Firestore',
            ai_provider: 'DeepSeek AI',
            deepseek_status: deepseekStatus,
            questionsCount: questionCount,
            chatStorage: 'Firebase Firestore (persistent 24h)',
            exerciseStorage: 'Firebase Firestore (persistent 24h)',
            literatureStorage: 'Firebase Firestore (persistent 24h)',
            collections: ['chatSessions', 'exerciseSessions', 'literatureSessions', 'questions']
        });
    } catch (error) {
        res.json({ 
            status: 'DEGRADED', 
            timestamp: new Date().toISOString(),
            database: 'Firebase connection failed',
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
        const stats = await getChatStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/chat/cleanup', async (req, res) => {
    try {
        await cleanupExpiredMessages();
        res.json({ success: true, message: 'Chat cleanup completed' });
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

app.post('/api/literature/cleanup', async (req, res) => {
    try {
        await cleanupExpiredLiterature();
        res.json({ success: true, message: 'Literature cleanup completed' });
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
    cleanupExpiredLiterature();
}, 60 * 60 * 1000); // Mỗi 1 giờ

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
    console.log(`🗑️ Exercise clear: http://localhost:${PORT}/api/exercise/clear`);
    console.log(`🧹 Exercise cleanup: http://localhost:${PORT}/api/exercise/cleanup`);
    console.log(`📖 Literature endpoint: http://localhost:${PORT}/api/literature`);
    console.log(`📚 Literature history: http://localhost:${PORT}/api/literature/history`);
    console.log(`🗑️ Literature clear: http://localhost:${PORT}/api/literature/clear`);
    console.log(`🧹 Literature cleanup: http://localhost:${PORT}/api/literature/cleanup`);
    console.log(`📝 Questions: http://localhost:${PORT}/api/questions`);
    console.log(`🧪 Test DeepSeek: http://localhost:${PORT}/api/test-deepseek`);
    
    console.log('\n🔧 Kiểm tra cấu hình:');
    if (!process.env.DEEPSEEK_API_KEY) {
        console.warn('⚠️  CẢNH BÁO: Chưa có DEEPSEEK_API_KEY trong file .env');
    } else {
        console.log('✅ DEEPSEEK_API_KEY đã được cấu hình');
    }
    
    if (!process.env.FIREBASE_PROJECT_ID) {
        console.warn('⚠️  CẢNH BÁO: Chưa có FIREBASE_PROJECT_ID trong file .env');
    } else {
        console.log('✅ FIREBASE_PROJECT_ID đã được cấu hình');
    }
    
    if (!process.env.FIREBASE_API_KEY) {
        console.warn('⚠️  CẢNH BÁO: Chưa có FIREBASE_API_KEY trong file .env');
    } else {
        console.log('✅ FIREBASE_API_KEY đã được cấu hình');
    }
    
    if (!process.env.CHAT_SALT) {
        console.warn('⚠️  CẢNH BÁO: Nên thêm CHAT_SALT vào file .env để bảo mật tốt hơn');
    } else {
        console.log('✅ CHAT_SALT đã được cấu hình');
    }
    
    console.log('\n🤖 AI Provider: DeepSeek AI');
    console.log('📖 Model: deepseek-chat');
    console.log('💾 Storage: Firebase Firestore (24h persistent)');
    console.log('🗄️ Collections: chatSessions, exerciseSessions, literatureSessions, questions');
});

module.exports = app;