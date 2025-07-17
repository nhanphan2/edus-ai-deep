// api/save-user-message.js
export default async function handler(req, res) {
    // Chỉ cho phép POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, timestamp, hasImages, userAgent, sessionId } = req.body;

        // Kiểm tra dữ liệu
        if (!message && !hasImages) {
            return res.status(400).json({ error: 'No message content' });
        }

        // Chuẩn bị dữ liệu để lưu
        const userMessageData = {
            message: message || '',
            timestamp: timestamp || new Date().toISOString(),
            hasImages: hasImages || false,
            userAgent: userAgent || 'unknown',
            sessionId: sessionId || 'anonymous',
            ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress
        };

        // Lưu vào database hoặc file
        await saveUserMessage(userMessageData);

        res.status(200).json({ 
            success: true, 
            message: 'User message saved successfully' 
        });

    } catch (error) {
        console.error('Error saving user message:', error);
        res.status(500).json({ 
            error: 'Failed to save user message',
            details: error.message 
        });
    }
}

// Hàm lưu tin nhắn - có thể chọn 1 trong các cách sau:

// CÁCH A: Lưu vào file JSON (đơn giản)
async function saveUserMessage(data) {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
        const filePath = path.join('/tmp', 'user-messages.json');
        let messages = [];
        
        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            messages = JSON.parse(fileContent);
        } catch (error) {
            // File không tồn tại, tạo mới
            messages = [];
        }
        
        messages.push(data);
        await fs.writeFile(filePath, JSON.stringify(messages, null, 2));
    } catch (error) {
        console.error('Error writing to file:', error);
        throw error;
    }
}

// CÁCH B: Lưu vào MongoDB (nâng cao hơn)
/*
async function saveUserMessage(data) {
    const { MongoClient } = require('mongodb');
    const uri = process.env.MONGODB_URI; // Thêm vào biến môi trường
    
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('chat_app');
        const collection = db.collection('user_messages');
        
        await collection.insertOne(data);
    } finally {
        await client.close();
    }
}
*/

// CÁCH C: Lưu vào Google Sheets (miễn phí)
/*
async function saveUserMessage(data) {
    const response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
    });
}
*/