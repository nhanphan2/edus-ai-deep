// api/get-user-messages.js
export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const fs = require('fs').promises;
        const path = require('path');
        const filePath = path.join('/tmp', 'user-messages.json');
        
        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const messages = JSON.parse(fileContent);
            
            res.status(200).json({ 
                success: true, 
                messages: messages,
                count: messages.length 
            });
        } catch (error) {
            // File không tồn tại hoặc rỗng
            res.status(200).json({ 
                success: true, 
                messages: [],
                count: 0,
                note: 'No messages found or file does not exist'
            });
        }
    } catch (error) {
        console.error('Error reading user messages:', error);
        res.status(500).json({ 
            error: 'Failed to read user messages',
            details: error.message 
        });
    }
}